import { readFileSync } from "node:fs";
import {
  fromRoot,
  nowIso,
  writeJson,
  writeText
} from "./loop-lib.mjs";

async function main() {
  const runId = `voice-task-equivalence-${nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const widgetSource = readFileSync(fromRoot("shared", "agent-widget.js"), "utf8");
  const checks = [
    {
      name: "voice_review_generates_editable_task",
      passed: widgetSource.includes("kind: \"voice-task-review\"") &&
        widgetSource.includes("data-voice-task-editor") &&
        widgetSource.includes("已根据就诊会话整理出以下任务")
    },
    {
      name: "voice_confirmed_task_calls_common_handler",
      passed: widgetSource.includes("voice_confirmed_task") &&
        widgetSource.includes("await handleCommand(taskText, \"voice_confirmed_task\"")
    },
    {
      name: "common_handler_calls_agent_task_orchestrator",
      passed: widgetSource.includes("AgentTaskOrchestrator.startTask") &&
        widgetSource.includes("taskContract")
    },
    {
      name: "voice_draft_does_not_directly_execute",
      passed: widgetSource.includes("direct_execution: false") &&
        widgetSource.includes("state.pendingVoicePlan")
    }
  ];
  const output = {
    run_id: runId,
    generated_at: nowIso(),
    status: checks.every((item) => item.passed) ? "static_equivalence_passed" : "static_equivalence_failed",
    static_checks: checks,
    typed_pipeline_entry: "handleCommand -> AgentTaskOrchestrator.startTask",
    voice_pipeline_entry: "executePendingVoiceTask -> handleCommand(..., voice_confirmed_task)",
    live_llm_equivalence_validated: false,
    note: "Static equivalence verifies that confirmed voice task text enters the same text task pipeline. Live LLM equivalence still depends on RUN_LLM_E2E."
  };
  writeJson(fromRoot("artifacts", "voice-task-equivalence", "result.json"), output);
  writeText(fromRoot("VOICE_TASK_EQUIVALENCE_REPORT.md"), renderReport(output));
  console.log(JSON.stringify({
    run_id: output.run_id,
    status: output.status,
    checks: checks
  }, null, 2));
  if (!checks.every((item) => item.passed)) process.exit(1);
}

function renderReport(result) {
  const lines = [
    "# Voice Task Equivalence Report",
    "",
    `Generated at: ${result.generated_at}`,
    `Run ID: ${result.run_id}`,
    "",
    "## Summary",
    "",
    `- Voice pipeline entry: ${result.voice_pipeline_entry}`,
    `- Typed task pipeline entry: ${result.typed_pipeline_entry}`,
    `- Static equivalence status: ${result.status}`,
    `- Live LLM equivalence validated: ${result.live_llm_equivalence_validated}`,
    "",
    "## Checks",
    "",
    ...result.static_checks.map((item) => `- ${item.name}: ${item.passed}`),
    "",
    "## Boundary",
    "",
    "- Voice session task drafting only produces editable natural-language task text.",
    "- After doctor confirmation, the edited text is passed through the normal Agent taskflow and backend planner.",
    "- This report is static unless combined with RUN_LLM_E2E browser execution.",
    ""
  ];
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
