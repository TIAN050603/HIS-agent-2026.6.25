import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

const roots = [
  "html",
  "shared",
  "tests/e2e",
  "docs/reports",
  ".agents/skills/his-ui-e2e-review"
];

const explicitFiles = [
  "AGENTS.md",
  "package.json"
];

const textExtensions = new Set([".html", ".js", ".css", ".md", ".ts", ".json"]);
const bannedPatterns = [
  "Ã",
  "å",
  "é",
  "è",
  "鐩",
  "婚",
  "榇",
  "淇",
  "鍖",
  "閿",
  "閻",
  "脙",
  "�",
  "锟"
];
const repeatedQuestionPattern = /\?{2,}/;
const requiredCopy = [
  "医院信息系统 HIS Demo",
  "用户登录",
  "患者管理",
  "患者列表",
  "返回工作台",
  "退出登录",
  "AI Agent"
];

const decoder = new TextDecoder("utf-8", { fatal: true });
const files = new Set(explicitFiles);

function textForMojibakeScan(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      return !line.includes("mojibakePattern") &&
        !line.includes("bannedPatterns") &&
        !line.includes("典型乱码片段") &&
        !line.includes("不得出现典型乱码片段");
    })
    .join("\n");
}

function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(path);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot) : "";
    if (textExtensions.has(ext)) files.add(path);
  }
}

for (const root of roots) collect(root);

const errors = [];
const allText = [];

for (const file of [...files].sort()) {
  let text = "";
  try {
    text = decoder.decode(readFileSync(file));
  } catch (error) {
    errors.push(`${file}: is not valid UTF-8 (${error.message})`);
    continue;
  }

  allText.push(text);
  const scanText = textForMojibakeScan(text);
  if (repeatedQuestionPattern.test(scanText)) {
    errors.push(`${file}: contains repeated question marks that may indicate mojibake`);
  }

  for (const pattern of bannedPatterns) {
    if (scanText.includes(pattern)) {
      errors.push(`${file}: contains mojibake marker "${pattern}"`);
    }
  }

  if (file.endsWith(".html")) {
    const headStart = text.slice(0, 1024);
    if (!/<meta\s+charset=["']?UTF-8["']?\s*\/?>/i.test(headStart)) {
      errors.push(`${file}: missing early <meta charset="UTF-8">`);
    }
  }
}

const combined = allText.join("\n");
for (const copy of requiredCopy) {
  if (!combined.includes(copy)) {
    errors.push(`missing required Chinese copy: ${copy}`);
  }
}

if (errors.length) {
  console.error("Encoding check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Encoding check passed: ${files.size} files are valid UTF-8 and required Chinese copy is present.`);
