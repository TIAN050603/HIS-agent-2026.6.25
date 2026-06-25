import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  fromRoot,
  nowIso,
  readJson,
  writeJson,
  writeText
} from "./loop-lib.mjs";

async function main() {
  const artifactRoot = fromRoot("loop-engineering", "artifacts");
  const iterations = existsSync(artifactRoot)
    ? readdirSync(artifactRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^iteration-\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    : [];
  const latest = iterations[iterations.length - 1] || "";
  const latestResultPath = latest ? join(artifactRoot, latest, "result.json") : "";
  const latestResult = latestResultPath && existsSync(latestResultPath) ? readJson(latestResultPath) : null;
  const caseTimings = latestResult && Array.isArray(latestResult.case_results)
    ? latestResult.case_results.map((item) => ({
        case_id: item.case_id,
        priority: item.priority,
        status: item.status,
        elapsed_ms: item.elapsed_ms || 0
      }))
    : [];
  const durations = caseTimings.map((item) => item.elapsed_ms).filter((value) => Number.isFinite(value));
  const output = {
    generated_at: nowIso(),
    source_iteration: latest,
    source_run_id: latestResult && latestResult.run_id || "",
    base_url: latestResult && latestResult.base_url || "",
    score: latestResult && latestResult.score,
    passed: latestResult && latestResult.passed,
    failed: latestResult && latestResult.failed,
    skipped: latestResult && latestResult.skipped,
    total_elapsed_ms: durations.reduce((sum, value) => sum + value, 0),
    max_case_elapsed_ms: durations.length ? Math.max(...durations) : 0,
    average_case_elapsed_ms: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    case_timings: caseTimings,
    thresholds: {
      status_refresh_expected_ms: 5000,
      llm_health_fast_check_expected_ms: 5000,
      single_loop_case_expected_ms: 15000
    },
    status: latestResult ? "baseline_collected" : "no_loop_result_found"
  };
  writeJson(fromRoot("artifacts", "performance-baseline", "current.json"), output);
  writeText(fromRoot("PERFORMANCE_BASELINE.md"), renderReport(output));
  console.log(JSON.stringify({
    status: output.status,
    source_iteration: output.source_iteration,
    average_case_elapsed_ms: output.average_case_elapsed_ms,
    max_case_elapsed_ms: output.max_case_elapsed_ms
  }, null, 2));
}

function renderReport(result) {
  const lines = [
    "# Performance Baseline",
    "",
    `Generated at: ${result.generated_at}`,
    `Source iteration: ${result.source_iteration || "none"}`,
    `Source run ID: ${result.source_run_id || "none"}`,
    `Base URL: ${result.base_url || "unknown"}`,
    "",
    "## Summary",
    "",
    `- Status: ${result.status}`,
    `- Score: ${result.score ?? "unknown"}`,
    `- Passed / failed / skipped: ${result.passed ?? "-"} / ${result.failed ?? "-"} / ${result.skipped ?? "-"}`,
    `- Total measured case elapsed: ${result.total_elapsed_ms}ms`,
    `- Average case elapsed: ${result.average_case_elapsed_ms}ms`,
    `- Max case elapsed: ${result.max_case_elapsed_ms}ms`,
    "",
    "## Case Timings",
    "",
    ...result.case_timings.map((item) => `- ${item.case_id}: ${item.status}, ${item.elapsed_ms}ms`),
    "",
    "## Threshold Notes",
    "",
    `- Status refresh target: ${result.thresholds.status_refresh_expected_ms}ms`,
    `- LLM health fast-check target: ${result.thresholds.llm_health_fast_check_expected_ms}ms`,
    `- Single loop case target: ${result.thresholds.single_loop_case_expected_ms}ms`,
    ""
  ];
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
