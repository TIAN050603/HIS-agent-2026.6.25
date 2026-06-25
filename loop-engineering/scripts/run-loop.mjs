import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  createCheckpoint,
  fromRoot,
  loadConfig,
  makeRunId,
  nowIso,
  parseArgs,
  readJson,
  writeJson,
  writeText
} from "./loop-lib.mjs";
import { runCase } from "./run-case.mjs";
import { scoreIteration } from "./score-iteration.mjs";

const CHECKPOINT_FILES = [
  "package.json",
  "AGENTS.md",
  "AGENT_LOOP_ENGINEERING.md",
  "IMPLEMENTATION_REPORT.md",
  "PROJECT_BACKLOG.md",
  "AGENT_V2_DESIGN.md",
  "AGENT_CAPABILITY_MATRIX.md",
  "PATIENT_FIELD_CAPABILITY_REPORT.md",
  "VOICE_ROLE_MAPPING_REPORT.md",
  "VOICE_TASK_EQUIVALENCE_REPORT.md",
  "TASK_TELEMETRY_REPORT.md",
  "PERFORMANCE_BASELINE.md",
  "tests/e2e/README.md"
];

async function main() {
  const args = parseArgs();
  const mode = String(args.mode || "baseline");
  const config = loadConfig();
  const iteration = Number(args.iteration || nextIteration(config.artifactRoot));
  const rawModeConfig = config.modes?.[mode] || config.modes?.baseline || {};
  const modeConfig = {
    ...rawModeConfig,
    runMutations: Boolean(rawModeConfig.runMutations && process.env.RUN_AGENT_LOOP_MUTATIONS === "1")
  };
  const runId = args.runId || makeRunId(mode);
  const artifactDir = join(config.artifactRoot, `iteration-${String(iteration).padStart(3, "0")}`);
  mkdirSync(join(artifactDir, "traces"), { recursive: true });
  mkdirSync(join(artifactDir, "screenshots"), { recursive: true });
  mkdirSync(join(artifactDir, "checkpoints"), { recursive: true });

  const checkpointManifest = createCheckpoint(CHECKPOINT_FILES, join(artifactDir, "checkpoints", "before-loop"));
  const allCases = readJson(fromRoot(config.caseFile));
  const includePriorities = new Set(modeConfig.includePriorities || ["P0", "P1", "P2"]);
  const filterCategory = args.category ? String(args.category) : "";
  const normalizedFilterCategory = filterCategory.toLowerCase();
  const filterCase = args.case ? String(args.case) : "";
  const cases = allCases
    .filter((item) => includePriorities.has(item.priority))
    .filter((item) => !filterCategory
      || item.category === filterCategory
      || item.loop === filterCategory
      || String(item.priority || "").toLowerCase() === normalizedFilterCategory)
    .filter((item) => !filterCase || item.case_id === filterCase);
  const caseResults = [];

  for (const caseDef of cases) {
    const shouldSkipMutation = caseDef.expected_postconditions?.data_restored && !modeConfig.runMutations && caseDef.automation === "not_yet_automated";
    const result = await runCase({
      ...caseDef,
      skip_mutation_reason: shouldSkipMutation ? "mutations disabled in this mode" : ""
    }, {
      config,
      mode,
      iteration,
      runId,
      artifactDir
    });
    caseResults.push(stripTraceEvents(result));
  }

  const scoring = scoreIteration(caseResults, readJson(fromRoot(config.scoreRulesFile)));
  const firstFailure = caseResults.find((item) => item.first_failure)?.first_failure || null;
  const result = {
    iteration,
    mode,
    run_id: runId,
    filter: {
      category: filterCategory,
      case: filterCase
    },
    started_at: nowIso(),
    base_url: config.baseUrl,
    score: scoring.score,
    passed: caseResults.filter((item) => item.status === "passed").length,
    failed: caseResults.filter((item) => item.status === "failed").length,
    skipped: caseResults.filter((item) => item.status === "skipped").length,
    hard_failures: scoring.hardFailures,
    first_failure: firstFailure,
    regressions: [],
    data_restored: caseResults.every((item) => item.data_restored !== false),
    recommended_fix_layer: firstFailure?.recommended_fix_layer || "",
    checkpoint: {
      type: "file-copy",
      path: relative(fromRoot("."), join(artifactDir, "checkpoints", "before-loop")).replace(/\\/g, "/"),
      files: checkpointManifest
    },
    deductions: scoring.deductions,
    case_results: caseResults
  };

  const resultPath = join(artifactDir, "result.json");
  const reportPath = join(artifactDir, "report.md");
  writeJson(resultPath, result);
  writeJson(fromRoot("artifacts", "agent-loop", runId, "result.json"), result);
  writeText(reportPath, renderReport(result, allCases));

  console.log(`Loop ${mode} iteration ${iteration}`);
  console.log(`Artifacts: ${relative(fromRoot("."), artifactDir).replace(/\\/g, "/")}`);
  console.log(`Score: ${result.score}`);
  console.log(`Passed: ${result.passed}, failed: ${result.failed}, skipped: ${result.skipped}`);
  if (firstFailure) {
    console.log(`First failure: ${firstFailure.case_id} / ${firstFailure.event}`);
  }
  process.exit(result.failed > 0 ? 1 : 0);
}

function stripTraceEvents(result) {
  const { trace_events, ...rest } = result;
  return rest;
}

function nextIteration(artifactRoot) {
  let index = 1;
  while (existsSync(join(artifactRoot, `iteration-${String(index).padStart(3, "0")}`))) {
    index += 1;
  }
  return index;
}

function renderReport(result, allCases) {
  const counts = allCases.reduce((acc, item) => {
    acc[item.priority] = (acc[item.priority] || 0) + 1;
    return acc;
  }, {});
  const lines = [
    `# Loop Engineering ${result.mode} report`,
    "",
    `- Run ID: ${result.run_id}`,
    `- Iteration: ${result.iteration}`,
    `- Base URL: ${result.base_url}`,
    `- Score: ${result.score}`,
    `- Passed / failed / skipped: ${result.passed} / ${result.failed} / ${result.skipped}`,
    `- Case matrix: P0=${counts.P0 || 0}, P1=${counts.P1 || 0}, P2=${counts.P2 || 0}`,
    `- Data restored: ${result.data_restored}`,
    `- Hard failures: ${result.hard_failures.length ? result.hard_failures.map((item) => `${item.case_id}:${item.hard_failure}`).join(", ") : "none"}`,
    ""
  ];
  if (result.first_failure) {
    lines.push("## First Failure", "");
    lines.push(`- Case: ${result.first_failure.case_id}`);
    lines.push(`- Event: ${result.first_failure.event}`);
    lines.push(`- Expected: ${JSON.stringify(result.first_failure.expected)}`);
    lines.push(`- Actual: ${JSON.stringify(result.first_failure.actual)}`);
    lines.push(`- Evidence: ${result.first_failure.evidence || ""}`);
    lines.push(`- Recommended fix layer: ${result.first_failure.recommended_fix_layer || ""}`);
    lines.push("");
  } else {
    lines.push("## First Failure", "", "none", "");
  }
  lines.push("## Cases", "");
  for (const item of result.case_results) {
    lines.push(`- ${item.status.toUpperCase()} ${item.priority} ${item.case_id}${item.skip_reason ? ` (${item.skip_reason})` : ""}`);
  }
  lines.push("");
  lines.push("## Boundary Notes");
  lines.push("");
  lines.push("- Explorer produced browser or health traces only; it did not modify source code.");
  lines.push("- Evaluator used deterministic assertions and did not trust task completed claims alone.");
  lines.push("- Implementer should only fix the first failed highest-priority case in the next loop.");
  lines.push("- Password plaintext is not written to traces; only password match status is recorded.");
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
