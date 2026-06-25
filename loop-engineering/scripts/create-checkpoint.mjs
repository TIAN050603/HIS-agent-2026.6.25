import { join } from "node:path";
import { createCheckpoint, loadConfig, parseArgs } from "./loop-lib.mjs";

const args = parseArgs();
const config = loadConfig();
const files = String(args.files || "package.json,AGENTS.md,IMPLEMENTATION_REPORT.md,PROJECT_BACKLOG.md,AGENT_V2_DESIGN.md,tests/e2e/README.md")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const output = args.output || join(config.artifactRoot, "manual-checkpoint");
const manifest = createCheckpoint(files, output);
console.log(JSON.stringify({ output, files: manifest }, null, 2));
