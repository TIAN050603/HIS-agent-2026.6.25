import { loadConfig, launchBrowser, pageUrl, snapshotDemoState, writeJson, parseArgs } from "./loop-lib.mjs";

const args = parseArgs();
const config = loadConfig();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(pageUrl(config, args.page || "login", "loop-snapshot"));
  const snapshot = await snapshotDemoState(page, config.storageKeys);
  const output = args.output || "loop-engineering/artifacts/manual-snapshot.json";
  writeJson(output, { created_at: new Date().toISOString(), base_url: config.baseUrl, snapshot });
  console.log(output);
} finally {
  await browser.close();
}
