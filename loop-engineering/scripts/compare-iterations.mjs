import { readJson, parseArgs } from "./loop-lib.mjs";

const args = parseArgs();
if (!args.before || !args.after) {
  console.error("Usage: node loop-engineering/scripts/compare-iterations.mjs --before <result.json> --after <result.json>");
  process.exit(1);
}
const before = readJson(args.before);
const after = readJson(args.after);
const diff = {
  before_score: before.score,
  after_score: after.score,
  delta: after.score - before.score,
  before_failed: before.failed,
  after_failed: after.failed,
  new_hard_failures: (after.hard_failures || []).filter((item) => !(before.hard_failures || []).some((old) => old.case_id === item.case_id && old.hard_failure === item.hard_failure))
};
console.log(JSON.stringify(diff, null, 2));
process.exit(diff.new_hard_failures.length ? 1 : 0);
