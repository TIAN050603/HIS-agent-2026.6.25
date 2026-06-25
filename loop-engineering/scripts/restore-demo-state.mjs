import { readFileSync } from "node:fs";
import { loadConfig, launchBrowser, pageUrl, restoreDemoState, parseArgs } from "./loop-lib.mjs";

const args = parseArgs();
if (!args.input) {
  console.error("Usage: node loop-engineering/scripts/restore-demo-state.mjs --input <snapshot.json>");
  process.exit(1);
}
const config = loadConfig();
const payload = JSON.parse(readFileSync(args.input, "utf8"));
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(pageUrl(config, args.page || "login", "loop-restore"));
  const ok = await restoreDemoState(page, payload.snapshot || payload);
  console.log(JSON.stringify({ ok }, null, 2));
  process.exit(ok ? 0 : 1);
} finally {
  await browser.close();
}
