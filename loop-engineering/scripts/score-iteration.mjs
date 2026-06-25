import { readJson, fromRoot } from "./loop-lib.mjs";

export function scoreIteration(caseResults, scoreRules = readJson(fromRoot("loop-engineering", "score-rules.json"))) {
  let score = scoreRules.baseScore || 100;
  const hardFailures = [];
  const deductions = [];

  for (const result of caseResults) {
    if (result.status !== "failed") continue;
    const hard = result.hard_failure || result.first_failure?.hard_failure || "";
    if (hard && scoreRules.hardFailures?.[hard] != null) {
      score += scoreRules.hardFailures[hard];
      hardFailures.push({ case_id: result.case_id, hard_failure: hard });
      continue;
    }
    const key = `${result.priority}_failed`;
    const deduction = scoreRules.deductions?.[key] ?? -10;
    score += deduction;
    deductions.push({ case_id: result.case_id, deduction, reason: key });
  }

  score = Math.max(0, Math.min(100, score));
  return { score, hardFailures, deductions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("score-iteration.mjs exports scoreIteration(); use run-loop to score a run.");
}
