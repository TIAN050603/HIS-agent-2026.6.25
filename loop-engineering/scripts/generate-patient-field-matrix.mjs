import { join } from "node:path";
import {
  fromRoot,
  launchBrowser,
  loadConfig,
  nowIso,
  pageUrl,
  writeJson,
  writeText
} from "./loop-lib.mjs";

async function main() {
  const config = loadConfig();
  const runId = `patient-field-matrix-${nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const browser = await launchBrowser();
  let result;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(config.defaultTimeoutMs || 10000);
    await page.goto(pageUrl(config, "patient-editor", runId));
    await page.waitForLoadState("domcontentloaded");
    result = await page.evaluate((baseUrl) => {
      const fields = (window.PatientFieldSchema && window.PatientFieldSchema.fields || []).map((field) => ({ ...field }));
      const patients = (window.PatientStore && window.PatientStore.getAllPatients ? window.PatientStore.getAllPatients() : []).map((patient) => ({ ...patient }));
      const cssEscape = window.CSS && window.CSS.escape ? window.CSS.escape.bind(window.CSS) : (value) => String(value).replace(/"/g, '\\"');
      const editorFields = fields.filter((field) => field.showInEditor !== false);
      const editableEditorFields = editorFields.filter((field) => field.editable);
      const readonlyFields = fields.filter((field) => !field.editable || field.showInEditor === false);
      function testValue(field, patient) {
        const current = patient[field.key];
        if (field.type === "select") {
          const options = (field.options || []).filter(Boolean);
          return options.find((option) => option !== current) || current || "";
        }
        if (field.type === "date") return current === "2026-01-02" ? "2026-01-03" : "2026-01-02";
        if (field.type === "number") return String((Number(current) || 0) + 1);
        if (/phone/i.test(field.key)) return "1390000" + String(patient.patientId || "P000").replace(/\D/g, "").padStart(4, "0");
        return "LoopTest-" + patient.patientId + "-" + field.key;
      }
      const controls = Object.fromEntries(editorFields.map((field) => {
        const control = document.querySelector('[data-field="' + cssEscape(field.key) + '"]');
        return [field.key, {
          exists: Boolean(control),
          tag: control ? control.tagName.toLowerCase() : "",
          disabled: control ? Boolean(control.disabled) : false
        }];
      }));
      const matrix = patients.map((patient) => ({
        patientId: patient.patientId,
        name: patient.name,
        fields: editableEditorFields.map((field) => ({
          field: field.key,
          label: field.label,
          type: field.type,
          original_value_present: patient[field.key] !== undefined,
          target_value: testValue(field, patient),
          editor_control_exists: Boolean(controls[field.key] && controls[field.key].exists),
          editor_control_enabled: Boolean(controls[field.key] && controls[field.key].exists && !controls[field.key].disabled),
          status: controls[field.key] && controls[field.key].exists && !controls[field.key].disabled ? "covered_by_schema_and_editor" : "missing_editor_control"
        }))
      }));
      return {
        run_id: "",
        generated_at: new Date().toISOString(),
        base_url: baseUrl,
        patient_count: patients.length,
        editable_editor_field_count: editableEditorFields.length,
        total_candidate_cells: patients.length * editableEditorFields.length,
        fields: editableEditorFields.map((field) => ({
          field: field.key,
          label: field.label,
          type: field.type,
          options_count: Array.isArray(field.options) ? field.options.length : 0,
          aliases_count: Array.isArray(field.aliases) ? field.aliases.length : 0
        })),
        readonly_or_hidden_fields: readonlyFields.map((field) => ({
          field: field.key,
          label: field.label,
          editable: Boolean(field.editable),
          showInEditor: field.showInEditor !== false
        })),
        controls,
        matrix,
        summary: {
          generated_only: true,
          full_mutation_execution: false,
          reason: "baseline/evaluate do not execute all patient x field mutations without explicit RUN_AGENT_LOOP_MUTATIONS=1"
        }
      };
    }, config.baseUrl);
  } finally {
    await browser.close();
  }

  result.run_id = runId;
  const editableControls = result.fields.map((field) => result.controls[field.field]).filter(Boolean);
  result.hard_gates = {
    all_demo_patients_discovered: result.patient_count === 20,
    all_editable_editor_fields_have_controls: editableControls.every((control) => control.exists && !control.disabled),
    full_patient_field_execution_complete: false
  };
  result.status = result.hard_gates.all_demo_patients_discovered && result.hard_gates.all_editable_editor_fields_have_controls
    ? "matrix_generated"
    : "incomplete";

  writeJson(fromRoot("tests", "agent-cases", "patient-field-capability-matrix.json"), result);
  writeJson(fromRoot("artifacts", "patient-field-matrix", "result.json"), result);
  writeText(fromRoot("PATIENT_FIELD_CAPABILITY_REPORT.md"), renderReport(result));
  console.log(JSON.stringify({
    run_id: result.run_id,
    status: result.status,
    patient_count: result.patient_count,
    editable_editor_field_count: result.editable_editor_field_count,
    total_candidate_cells: result.total_candidate_cells
  }, null, 2));
}

function renderReport(result) {
  const editableControls = result.fields.map((field) => result.controls[field.field]).filter(Boolean);
  const passedControls = editableControls.filter((control) => control.exists && !control.disabled).length;
  const lines = [
    "# Patient Field Capability Report",
    "",
    `Generated at: ${result.generated_at}`,
    `Run ID: ${result.run_id}`,
    `Base URL: ${result.base_url}`,
    "",
    "## Summary",
    "",
    `- Demo patients discovered: ${result.patient_count}`,
    `- Editable editor fields: ${result.editable_editor_field_count}`,
    `- Candidate patient-field cells: ${result.total_candidate_cells}`,
    `- Editable editor controls present and enabled: ${passedControls}/${editableControls.length}`,
    `- Full mutation execution complete: ${result.hard_gates.full_patient_field_execution_complete}`,
    "",
    "## Boundary",
    "",
    "- This report discovers the full Demo patient x editable-field matrix from the live page schema and editor DOM.",
    "- It does not execute every mutation in baseline/evaluate mode, so skipped execution must not be counted as pass.",
    "- Real mutation execution still requires explicit mutation mode and data restore verification.",
    "",
    "## Fields",
    "",
    ...result.fields.map((field) => `- ${field.field} (${field.type})`),
    "",
    "## Read-only Or Hidden",
    "",
    ...result.readonly_or_hidden_fields.map((field) => `- ${field.field}: editable=${field.editable}, showInEditor=${field.showInEditor}`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
