import { walk } from "https://deno.land/std@0.181.0/fs/mod.ts";
import { green } from "https://deno.land/std@0.208.0/fmt/colors.ts";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
import { relative } from "https://deno.land/std@0.181.0/path/mod.ts";

const env = await load();

function parseEnvList(value: string | undefined): string[] {
  return value ? value.split(",").map((item) => item.trim()) : [];
}

const CONFIG = {
  excludedPaths: parseEnvList(env.EXCLUDED_PATHS),
  includedExtensions: parseEnvList(env.INCLUDED_EXTENSIONS),
  excludedExtensions: parseEnvList(env.EXCLUDED_EXTENSIONS),
  skippedFiles: parseEnvList(env.SKIPPED_FILES),
  skippedContent: env.SKIPPED_CONTENT || "<!-- Skipped -->"
};

interface FileNode {
  name: string;
  type: "f" | "d";
  content?: string;
  children?: FileNode[];
}

async function scan(rootPath: string): Promise<FileNode> {
  const root: FileNode = { name: getFileName(rootPath), type: "d", children: [] };
  await processDirectory(rootPath, root, rootPath);
  return root;
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

async function processDirectory(path: string, node: FileNode, rootPath: string): Promise<void> {
  for await (const entry of walk(path, { includeDirs: true })) {
    if (shouldSkip(entry.path, rootPath)) continue;

    const relativePath = relative(rootPath, entry.path);
    const parts = relativePath.split(/[/\\]/);
    let currentNode = node;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;
      const isDirectory = await Deno.stat(entry.path).then(stat => stat.isDirectory);

      let childNode = currentNode.children?.find(child => child.name === part);

      if (!childNode) {
        childNode = {
          name: part,
          type: isDirectory ? "d" : "f",
          ...(isDirectory ? { children: [] } : {})
        };
        currentNode.children?.push(childNode);
      }

      if (isLastPart && childNode.type === "f") {
        childNode.content = await getContentForFile(entry.path);
      } else {
        currentNode = childNode;
      }
    }
  }
}

function shouldSkip(filePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, filePath);
  return (
    CONFIG.excludedPaths.some((ex) => relativePath.startsWith(ex)) ||
    CONFIG.skippedFiles.includes(getFileName(filePath))
  );
}

async function getContentForFile(filePath: string): Promise<string> {
  const fileExt = `.${filePath.split(".").pop()?.toLowerCase() || ""}`;

  if (
    (CONFIG.includedExtensions.length > 0 && !CONFIG.includedExtensions.includes(fileExt)) ||
    CONFIG.excludedExtensions.includes(fileExt)
  ) {
    return CONFIG.skippedContent;
  }

  let content = await Deno.readTextFile(filePath);

  if (fileExt === ".js" || fileExt === ".ts") {
    content = minimizeScriptContent(content);
  }

  return content;
}

function minimizeScriptContent(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function selectFolder(): Promise<string | null> {
  const process = Deno.run({
    cmd: [
      "powershell.exe",
      "-C",
      "Add-Type -A System.Windows.Forms;$f=New-Object System.Windows.Forms.FolderBrowserDialog;$f.ShowDialog()|Out-Null;$f.SelectedPath",
    ],
    stdout: "piped",
  });
  const output = await process.output();
  process.close();
  return new TextDecoder().decode(output).trim() || null;
}

async function main() {
  const folderPath = await selectFolder();
  if (!folderPath) return console.log("No folder selected");

  console.log("Scanning...");
  const result = await scan(folderPath);

  const resultStructure = JSON.stringify(result, null, 2);
  console.log(green(`Scanned structure size: ${resultStructure.length} characters`));

  await Deno.writeTextFile("folder_structure.json", resultStructure);

  try {
    await Deno.run({ cmd: ["cmd", "/c", "start", "", "folder_structure.json"] }).status();
  } catch (e) {
    console.error("Failed to open:", e.message);
  }
}

if (import.meta.main) main();