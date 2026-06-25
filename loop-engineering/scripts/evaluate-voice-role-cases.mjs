import {
  fromRoot,
  nowIso,
  writeJson,
  writeText
} from "./loop-lib.mjs";

const CASES = [
  { id: "vr-001", text: "哪里不舒服？", expected_role: "doctor", reason: "question_from_doctor" },
  { id: "vr-002", text: "我胸闷半天，活动后加重。", expected_role: "patient", reason: "symptom_answer" },
  { id: "vr-003", text: "把主诉写成胸闷半天，现病史补充活动后加重并保存。", expected_role: "doctor", reason: "page_action_instruction" },
  { id: "vr-004", text: "最近咳嗽两天，还有点低热。", expected_role: "patient", reason: "symptom_answer" },
  { id: "vr-005", text: "记录患者 P001 主诉为咳嗽两天伴低热。", expected_role: "doctor", reason: "record_instruction" },
  { id: "vr-006", text: "夜间更严重，白痰不多。", expected_role: "patient", reason: "symptom_answer" },
  { id: "vr-007", text: "先不要保存，等我确认。", expected_role: "doctor", reason: "workflow_instruction" },
  { id: "vr-008", text: "没有药物过敏。", expected_role: "patient", reason: "medical_history_answer" },
  { id: "vr-009", text: "一键交换医生患者标签后再整理。", expected_role: "doctor", reason: "ui_instruction" },
  { id: "vr-010", text: "我叫张伟，今年四十五岁。", expected_role: "patient", reason: "identity_answer" }
];

function classifyWithBaselineHeuristic(text) {
  const value = String(text || "");
  if (/写成|记录|改为|保存|不要保存|确认|整理|交换|补充|更新/.test(value)) return "doctor";
  if (/哪里|几天|多久|不舒服|还有/.test(value) && /[？?]/.test(value)) return "doctor";
  return "patient";
}

async function main() {
  const runId = `voice-role-${nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const results = CASES.map((item) => {
    const actual = classifyWithBaselineHeuristic(item.text);
    return {
      ...item,
      actual_role: actual,
      passed: actual === item.expected_role,
      engine: "baseline_fixture_heuristic"
    };
  });
  const output = {
    run_id: runId,
    generated_at: nowIso(),
    status: "fixture_baseline",
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    live_diarization_validated: false,
    llm_semantic_role_validated: false,
    note: "This establishes semantic-role fixtures. It does not claim live Diart or LLM role mapping is complete.",
    cases: results
  };
  writeJson(fromRoot("tests", "voice-cases", "semantic-role-cases.json"), CASES);
  writeJson(fromRoot("artifacts", "voice-role", "result.json"), output);
  writeText(fromRoot("VOICE_ROLE_MAPPING_REPORT.md"), renderReport(output));
  console.log(JSON.stringify({
    run_id: output.run_id,
    status: output.status,
    passed: output.passed,
    failed: output.failed
  }, null, 2));
}

function renderReport(result) {
  const lines = [
    "# Voice Role Mapping Report",
    "",
    `Generated at: ${result.generated_at}`,
    `Run ID: ${result.run_id}`,
    "",
    "## Summary",
    "",
    `- Fixture cases: ${result.total}`,
    `- Baseline heuristic passed: ${result.passed}/${result.total}`,
    `- Live diarization validated: ${result.live_diarization_validated}`,
    `- LLM semantic role validated: ${result.llm_semantic_role_validated}`,
    "",
    "## Boundary",
    "",
    "- The fixture baseline checks semantic role examples without changing ASR or Diart.",
    "- It does not pretend Diart is available when only manual turns are present.",
    "- Product execution should still prefer manually corrected doctor/patient labels before task drafting.",
    "",
    "## Cases",
    "",
    ...result.cases.map((item) => `- ${item.id}: expected=${item.expected_role}, actual=${item.actual_role}, passed=${item.passed}, text=${item.text}`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
