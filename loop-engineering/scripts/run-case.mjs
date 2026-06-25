import {
  assertion,
  collectBrowserState,
  elapsedMs,
  fetchHealth,
  launchBrowser,
  loadConfig,
  normalizeTraceEvent,
  nowIso,
  pageUrl,
  parseArgs,
  restoreDemoState,
  snapshotDemoState,
  writeCaseArtifacts
} from "./loop-lib.mjs";
import { evaluateCaseResult } from "./evaluate-case.mjs";

export async function runCase(caseDef, context) {
  const startedAt = nowIso();
  const started = Date.now();
  const trace = [];
  const assertions = [];
  let dataRestored = true;
  let recommendedFixLayer = "";
  let browser = null;

  const record = (event, actual = {}, details = {}) => {
    trace.push(normalizeTraceEvent({
      iteration: context.iteration,
      caseId: caseDef.case_id,
      runId: context.runId,
      event,
      expected: caseDef.expected_postconditions || {},
      actual,
      details
    }));
  };

  try {
    record("case_started", { automation: caseDef.automation || "" });

    if (caseDef.automation === "service_health") {
      const frontend = await fetchHealth(`${context.config.baseUrl}/html/login.html`, 3000);
      const backend = await fetchHealth(`${context.config.health.backendUrl}/api/health`, 3000);
      const asr = await fetchHealth(`${context.config.health.asrUrl}/health`, 3000);
      const llm = await fetchHealth(`${context.config.health.backendUrl}/api/llm/test`, 15000);
      const directLlm = await fetchHealth(`${context.config.health.llmUrl}/health`, 3000);
      const diarization = await fetchHealth(`${context.config.health.diarizationUrl}/health`, 3000);
      const actual = { frontend, backend, asr, llm, directLlm, diarization };
      record("health_checked", actual, { action: "fetch_health" });
      assertions.push(assertion("frontend_health", frontend.ok, "HTTP 2xx", frontend));
      assertions.push(assertion("backend_health", backend.ok, "HTTP 2xx", backend));
      assertions.push(assertion("asr_health", asr.ok, "HTTP 2xx", asr));
      assertions.push(assertion("backend_llm_health", llm.ok && /"ok"\s*:\s*true/.test(llm.body || ""), "backend /api/llm/test ok", llm));
      assertions.push(assertion("direct_llm_health_observed", true, "record status only", directLlm));
      assertions.push(assertion("diart_health_observed", true, "record status only", diarization));
    } else if (caseDef.automation === "not_yet_automated") {
      record("case_skipped_not_automated", { reason: "case is cataloged but not automated in baseline runner" });
      return {
        case_id: caseDef.case_id,
        priority: caseDef.priority,
        status: "skipped",
        started_at: startedAt,
        finished_at: nowIso(),
        elapsed_ms: elapsedMs(started),
        assertions,
        skip_reason: "not_yet_automated",
        data_restored: true,
        trace_events: trace
      };
    } else {
      browser = await launchBrowser();
      const page = await browser.newPage();
      page.setDefaultTimeout(context.config.defaultTimeoutMs || 10000);
      await page.goto(pageUrl(context.config, caseDef.startPage || "login", `${context.runId}-${caseDef.case_id}`));
      await page.waitForLoadState("domcontentloaded");
      const snapshot = await snapshotDemoState(page, context.config.storageKeys);

      try {
        if (caseDef.automation === "login_invalid_manual" || caseDef.automation === "login_valid_manual") {
          await runLoginManualCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_login_invalid") {
          await runAgentLoginInvalidCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_login_valid") {
          await runAgentLoginValidCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "no_mutation_save_denied") {
          await runNoMutationSaveDeniedCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "snapshot_restore_self_check") {
          await runSnapshotRestoreSelfCheck(page, context.config.storageKeys, assertions, record);
        } else if (caseDef.automation === "terminal_task_not_reanimated") {
          await runTerminalTaskCase(page, assertions, record);
        } else if (caseDef.automation === "no_llm_no_action") {
          await runNoLlmNoActionCase(page, assertions, record);
        } else if (caseDef.automation === "input_draft_persist") {
          await runInputDraftPersistCase(page, assertions, record);
        } else if (caseDef.automation === "wrong_patient_protection") {
          await runWrongPatientProtectionCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_patient_field_mutation") {
          await runAgentPatientMutationCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_refresh_restore_no_repeat") {
          await runRefreshRestoreNoRepeatCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_missing_patient_clarify") {
          await runMissingPatientClarifyCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_missing_field_clarify") {
          await runMissingFieldClarifyCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_new_task_during_waiting_user") {
          await runNewTaskDuringWaitingUserCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "agent_cancel_task_terminal") {
          await runCancelTaskTerminalCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "primary_voice_input_only") {
          await runPrimaryVoiceInputOnlyCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "voice_session_review_before_execute") {
          await runVoiceSessionReviewBeforeExecuteCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "diart_unavailable_manual") {
          await runDiartUnavailableManualCase(page, caseDef, assertions, record);
        } else if (caseDef.automation === "latest_agent_message_visible") {
          await runLatestAgentMessageVisibleCase(page, assertions, record);
        } else if (caseDef.automation === "user_scroll_not_forced_bottom") {
          await runUserScrollNotForcedBottomCase(page, assertions, record);
        } else if (caseDef.automation === "new_message_prompt") {
          await runNewMessagePromptCase(page, assertions, record);
        } else if (caseDef.automation === "progress_does_not_steal_home_view") {
          await runProgressDoesNotStealHomeViewCase(page, assertions, record);
        } else if (caseDef.automation === "expanded_steps_not_reset") {
          await runExpandedStepsNotResetCase(page, assertions, record);
        } else if (caseDef.automation === "agent_history_rich_fields") {
          await runAgentHistoryRichFieldsCase(page, assertions, record);
        } else {
          assertions.push(assertion("unknown_automation", false, "known automation", caseDef.automation || ""));
          recommendedFixLayer = "loop_runner_case_dispatch";
        }
      } finally {
        dataRestored = await restoreDemoState(page, snapshot);
        const afterRestore = await collectBrowserState(page);
        record("demo_state_restored", afterRestore, { postcondition: { data_restored: dataRestored } });
      }
    }
  } catch (error) {
    assertions.push(assertion("case_runtime_error", false, "no runtime error", error.message));
    recommendedFixLayer = recommendedFixLayer || "loop_runner";
    record("case_runtime_error", {}, { error: error.message });
  } finally {
    if (browser) await browser.close();
  }

  if (!dataRestored) {
    assertions.push(assertion("demo_state_restored", false, true, false, "localStorage snapshot restore did not match"));
  }

  const raw = {
    case_id: caseDef.case_id,
    priority: caseDef.priority,
    status: "passed",
    started_at: startedAt,
    finished_at: nowIso(),
    elapsed_ms: elapsedMs(started),
    assertions,
    data_restored: dataRestored,
    recommended_fix_layer: recommendedFixLayer,
    hard_failure: dataRestored ? "" : "data_restore_failed",
    trace_events: trace
  };
  const evaluated = evaluateCaseResult(caseDef, raw);
  if (context.artifactDir) writeCaseArtifacts(context.artifactDir, evaluated, trace);
  return evaluated;
}

async function runLoginManualCase(page, caseDef, assertions, record) {
  const { username, password } = caseDef.input || {};
  await page.fill("#loginAccountInput", username);
  await page.fill("#loginPasswordInput", password);
  const before = await collectBrowserState(page);
  record("login_form_filled", before, {
    action: "fill_login_form",
    action_payload: {
      username,
      password_matched_requested: true
    }
  });
  await page.click("#loginButton");
  if (caseDef.automation === "login_valid_manual") {
    await page.waitForURL(/dashboard\.html/, { timeout: 2500 }).catch(async () => {
      await page.waitForTimeout(800);
    });
  } else {
    await page.waitForTimeout(250);
  }
  const after = await collectBrowserState(page);
  record("login_submit_clicked", after, {
    action: "submit_login",
    action_payload: {
      username,
      password_matched_requested: true
    },
    action_result: {
      clicked_selector: "#loginButton"
    }
  });
  const shouldAuth = caseDef.expected_postconditions?.auth === true;
  assertions.push(assertion("auth_state", after.auth === shouldAuth, shouldAuth, after.auth, after.visible_text));
  if (shouldAuth) {
    assertions.push(assertion("page_left_login", after.page_type === "dashboard" || /dashboard\.html/.test(after.url), "dashboard", { page_type: after.page_type, url: after.url }));
  } else {
    assertions.push(assertion("still_on_login", after.page_type === "login", "login", after.page_type));
    assertions.push(assertion("shows_login_error", /账号或密码错误/.test(after.visible_text), "账号或密码错误", after.visible_text));
  }
}

async function runAgentLoginInvalidCase(page, caseDef, assertions, record) {
  const username = "1234";
  const password = "123";
  const taskId = `${caseDef.case_id}_task`;
  await simulateLlmPlanner(page, [
    {
      id: "step_fill_login",
      goal: "Fill requested credentials",
      requiredPage: "login",
      actionType: "fill_login_form",
      args: { username, password }
    },
    {
      id: "step_submit_login",
      goal: "Submit login form",
      requiredPage: "login",
      actionType: "submit_login",
      args: { username, password }
    }
  ], {}, taskId);
  await ensureAgentOpen(page);
  await page.fill("#hisAgentInput", "输入账户为1234，密码为123，然后登录");
  await page.click("#hisAgentSendButton");
  await page.waitForFunction((id) => {
    const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
    return history.some((item) => item.task_id === id && item.status === "failed");
  }, taskId, { timeout: 10000 }).catch(async () => {
    await page.waitForTimeout(500);
  });
  const after = await collectBrowserState(page);
  record("agent_invalid_login_submitted", after, {
    action: "submit_agent_text",
    action_payload: {
      username,
      password_matched_requested: true
    },
    action_result: {
      login_form: after.login_form,
      latest_task_status: after.latest_task && after.latest_task.status
    }
  });
  const task = await readHistoryTask(page, taskId);
  assertions.push(assertion("requested_username_preserved", after.login_form.username_value === username, username, after.login_form.username_value));
  assertions.push(assertion("password_filled", after.login_form.password_filled === true, true, after.login_form.password_filled));
  assertions.push(assertion("auth_stays_false", after.auth === false, false, after.auth));
  assertions.push(assertion("still_on_login", after.page_type === "login", "login", after.page_type));
  assertions.push(assertion("task_failed", task && task.status === "failed", "failed", task && task.status));
  assertions.push(assertion("no_active_completed_task", !after.active_task || after.active_task.status !== "completed", "not completed", after.active_task && after.active_task.status));
  assertions.push(assertion("login_error_visible", /账号或密码错误|璐﹀彿|password/i.test(after.visible_text), "login error", after.visible_text));
}

async function runAgentLoginValidCase(page, caseDef, assertions, record) {
  const username = "123";
  const password = "123";
  const taskId = `${caseDef.case_id}_task`;
  await simulateLlmPlanner(page, [
    {
      id: "step_fill_login",
      goal: "Fill requested credentials",
      requiredPage: "login",
      actionType: "fill_login_form",
      args: { username, password }
    },
    {
      id: "step_submit_login",
      goal: "Submit login form",
      requiredPage: "login",
      actionType: "submit_login",
      args: { username, password }
    }
  ], {}, taskId);
  await ensureAgentOpen(page);
  await page.fill("#hisAgentInput", "输入账户为123，密码为123，然后登录");
  await page.click("#hisAgentSendButton");
  await page.waitForURL(/dashboard\.html/, { timeout: 10000 }).catch(async () => {
    await page.waitForTimeout(1000);
  });
  await page.waitForFunction((id) => {
    const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
    return history.some((item) => item.task_id === id && item.status === "completed");
  }, taskId, { timeout: 10000 }).catch(async () => {
    await page.waitForTimeout(500);
  });
  const after = await collectBrowserState(page);
  const task = await readHistoryTask(page, taskId);
  record("agent_valid_login_submitted", after, {
    action: "submit_agent_text",
    action_payload: {
      username,
      password_matched_requested: true
    },
    action_result: {
      latest_task_status: task && task.status
    }
  });
  assertions.push(assertion("auth_true", after.auth === true, true, after.auth));
  assertions.push(assertion("page_left_login", after.page_type === "dashboard" || /dashboard\.html/.test(after.url), "dashboard", { page_type: after.page_type, url: after.url }));
  assertions.push(assertion("task_completed", task && task.status === "completed", "completed", task && task.status));
}

async function runNoMutationSaveDeniedCase(page, caseDef, assertions, record) {
  const taskId = `${caseDef.case_id}_task`;
  const contract = {
    target_patient: { patientId: "P001", name: "张伟" },
    expected_mutations: [
      { field: "chiefComplaint", value: "咳嗽两天伴低热" },
      { field: "presentIllness", value: "夜间咳嗽明显" }
    ],
    requires_save: true,
    requires_verification: true,
    source: "loop_no_mutation_save_denied"
  };
  await simulateLlmPlanner(page, [
    {
      id: "step_find",
      goal: "Find patient",
      requiredPage: "patientManagement",
      actionType: "find_patient",
      args: { patientSelector: { patientId: "P001", name: "张伟" } }
    },
    {
      id: "step_open",
      goal: "Open patient editor",
      requiredPage: "patientManagement",
      actionType: "open_patient_editor",
      args: { patientSelector: { patientId: "P001", name: "张伟" } }
    },
    {
      id: "step_save",
      goal: "Save patient",
      requiredPage: "patientEditor",
      actionType: "save_patient",
      args: { patientSelector: { patientId: "P001", name: "张伟" } }
    }
  ], { task_contract: contract, expected_mutations: contract.expected_mutations }, taskId);

  await page.evaluate(() => {
    localStorage.setItem("hisDemoAuthenticated", "true");
  });
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/html/patient-editor.html?patientId=P001&v=loop-no-mutation-save-denied`);
  await page.waitForLoadState("domcontentloaded");
  const before = await collectBrowserState(page);
  await ensureAgentOpen(page);
  const chatButton = page.locator("#hisAgentOpenChatButton");
  if (await chatButton.count()) await chatButton.click();
  await page.fill("#hisAgentInput", "将张伟的主诉更新为咳嗽两天伴低热，现病史更新为夜间咳嗽明显，并保存。");
  await page.click("#hisAgentSendButton");
  await page.waitForFunction((id) => {
    const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
    return history.some((item) => item.task_id === id && item.status === "failed");
  }, taskId, { timeout: 10000 }).catch(async () => {
    await page.waitForTimeout(500);
  });
  const after = await collectBrowserState(page);
  const task = await readHistoryTask(page, taskId);
  const beforeP001 = before.patients_compact.find((patient) => patient.patientId === "P001");
  const afterP001 = after.patients_compact.find((patient) => patient.patientId === "P001");
  record("no_mutation_plan_rejected", after, {
    action: "submit_agent_text",
    action_payload: {
      task_contract: contract
    },
    action_result: {
      latest_task_status: task && task.status,
      before_patient: beforeP001,
      after_patient: afterP001
    },
    postcondition: {
      no_audit_added: after.audit_count === before.audit_count,
      patient_unchanged: JSON.stringify(beforeP001) === JSON.stringify(afterP001)
    }
  });
  assertions.push(assertion("task_failed", task && task.status === "failed", "failed", task && task.status));
  assertions.push(assertion("no_audit_added", after.audit_count === before.audit_count, before.audit_count, after.audit_count));
  assertions.push(assertion("patient_unchanged", JSON.stringify(beforeP001) === JSON.stringify(afterP001), beforeP001, afterP001));
  assertions.push(assertion("plan_steps_not_completed", task && Array.isArray(task.plan) && task.plan.every((step) => step.status !== "completed"), "no completed steps", task && task.plan));
  assertions.push(assertion("reject_message_visible", /缺少必要修改步骤|mutation/i.test(after.visible_text), "mutation plan rejected", after.visible_text));
}

async function runSnapshotRestoreSelfCheck(page, storageKeys, assertions, record) {
  const before = await snapshotDemoState(page, storageKeys);
  await page.evaluate(() => {
    window.localStorage.setItem("hisAgentInputDraftV2", "loop temporary draft");
    window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({ task_id: "loop_temp", status: "running" }));
  });
  const changed = await collectBrowserState(page);
  record("demo_state_temporarily_changed", changed, { action: "localStorage_test_write" });
  const restored = await restoreDemoState(page, before);
  const after = await snapshotDemoState(page, storageKeys);
  record("snapshot_restore_self_checked", { restored }, { postcondition: { data_restored: restored } });
  assertions.push(assertion("snapshot_restored", restored, true, restored));
  assertions.push(assertion("snapshot_values_match", JSON.stringify(before) === JSON.stringify(after), "original snapshot", "restored snapshot"));
}

async function runTerminalTaskCase(page, assertions, record) {
  await page.evaluate(() => {
    const now = Date.now();
    window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
      task_id: "loop_terminal_completed",
      objective: "loop terminal task",
      status: "completed",
      started_at: new Date(now - 1000).toISOString(),
      finished_at: new Date(now).toISOString(),
      plan: []
    }));
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(200);
  const after = await collectBrowserState(page);
  record("terminal_task_reloaded", after, { action: "reload" });
  const status = after.active_task?.status || "";
  assertions.push(assertion("no_running_terminal_task", status !== "running", "not running", status || "empty"));
  assertions.push(assertion("no_waiting_terminal_task", status !== "waiting_user", "not waiting_user", status || "empty"));
}

async function runNoLlmNoActionCase(page, assertions, record) {
  await page.route(/\/api\/(llm|qwen)\/test$/, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "loop no llm" }) });
  });
  await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "loop no llm" }) });
  });
  const before = await collectBrowserState(page);
  await ensureAgentOpen(page);
  await page.fill("#hisAgentInput", "修改患者 P001 的手机号为 13800138000 并保存");
  await page.click("#hisAgentSendButton");
  await page.waitForTimeout(800);
  const after = await collectBrowserState(page);
  record("no_llm_task_submitted", after, { action: "submit_agent_text" });
  assertions.push(assertion("no_business_mutation", after.audit_count === before.audit_count, before.audit_count, after.audit_count));
  assertions.push(assertion("patient_count_stable", after.patient_count === before.patient_count, before.patient_count, after.patient_count));
  const taskStatus = after.active_task?.status || "";
  assertions.push(assertion("not_completed_without_llm", taskStatus !== "completed", "not completed", taskStatus || "empty"));
}

async function runInputDraftPersistCase(page, assertions, record) {
  await ensureAgentOpen(page);
  await page.fill("#hisAgentInput", "loop draft should persist");
  await page.evaluate(() => {
    window.localStorage.setItem("hisDemoAuthenticated", "true");
  });
  await page.goto(page.url().replace(/login\.html.*/, "dashboard.html?v=loop-draft"));
  await page.waitForLoadState("domcontentloaded");
  await ensureAgentOpen(page);
  const value = await page.inputValue("#hisAgentInput");
  const after = await collectBrowserState(page);
  record("input_draft_checked", after, { action: "navigate_and_read_draft" });
  assertions.push(assertion("draft_restored", value === "loop draft should persist", "loop draft should persist", value));
}

async function runWrongPatientProtectionCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await loginViaUi(page, record);
  const origin = new URL(page.url()).origin;

  await page.goto(loopPageUrl(origin, "/html/patient-editor.html", "loop-wrong-patient-1", { patientId: "P002" }));
  await page.waitForLoadState("domcontentloaded");
  const beforeScenario1 = await readPatientsAndAudit(page, ["P001", "P002"]);
  const task1 = buildPatientMutationTask({
    caseId: `${caseDef.case_id}_scenario_1`,
    objective: "当前页面是 P002，但任务要求修改 P001 手机号并保存。",
    patient: { patientId: "P001", name: "张伟" },
    updates: [{ field: "phone", value: "13900010001" }]
  });
  const run1 = await executePlannedBrowserTask(page, task1, record, "wrong_patient_scenario_1");
  const afterScenario1 = await readPatientsAndAudit(page, ["P001", "P002"]);
  record("wrong_patient_scenario_1_checked", run1.state, {
    task_id: task1.task_id,
    canonical_patient: { patientId: "P001", name: "张伟" },
    page_patient: run1.state.page_patient,
    action_payload: { field: "phone", value: "13900010001" },
    action_result: {
      before: beforeScenario1,
      after: afterScenario1,
      task_status: run1.task && run1.task.status
    },
    postcondition: {
      p001_changed: afterScenario1.P001.patient && afterScenario1.P001.patient.phone === "13900010001",
      p002_unchanged: JSON.stringify(beforeScenario1.P002.patient) === JSON.stringify(afterScenario1.P002.patient)
    }
  });
  assertions.push(assertion("scenario_1_task_completed", run1.task && run1.task.status === "completed", "completed", run1.task && run1.task.status));
  assertions.push(assertion("scenario_1_p001_changed_only_after_correct_context", afterScenario1.P001.patient && afterScenario1.P001.patient.phone === "13900010001", "13900010001", afterScenario1.P001.patient && afterScenario1.P001.patient.phone));
  assertions.push(assertion("scenario_1_p002_not_modified", JSON.stringify(beforeScenario1.P002.patient) === JSON.stringify(afterScenario1.P002.patient), beforeScenario1.P002.patient, afterScenario1.P002.patient));
  assertions.push(assertion("scenario_1_audit_on_target_only", afterScenario1.P001.auditCount > beforeScenario1.P001.auditCount && afterScenario1.P002.auditCount === beforeScenario1.P002.auditCount, { P001: "> before", P002: beforeScenario1.P002.auditCount }, { P001: afterScenario1.P001.auditCount, P002: afterScenario1.P002.auditCount }));

  await page.goto(loopPageUrl(origin, "/html/patient-editor.html", "loop-wrong-patient-2", { patientId: "P002" }));
  await page.waitForLoadState("domcontentloaded");
  const beforeScenario2 = await readPatientsAndAudit(page, ["P001", "P002"]);
  const task2 = buildPatientMutationTask({
    caseId: `${caseDef.case_id}_scenario_2`,
    objective: "模拟 open_patient_editor 实际停在 P002，后续写入必须被阻止或重新打开 P001。",
    patient: { patientId: "P001", name: "张伟" },
    updates: [{ field: "phone", value: "13900010002" }]
  });
  await seedDeferredOpenTask(page, task2, { patientId: "P001", name: "张伟" });
  const wrongContextState = await collectBrowserState(page);
  record("wrong_patient_context_observed", wrongContextState, {
    task_id: task2.task_id,
    canonical_patient: { patientId: "P001", name: "张伟" },
    page_patient: wrongContextState.page_patient,
    action: "resume_deferred_open_patient_editor",
    postcondition: { should_not_complete_open_on_wrong_patient: true }
  });
  const resumeResult = await page.evaluate((backendUrl) => window.AgentTaskOrchestrator.resume({
    backendUrl: backendUrl || window.HisRuntimeConfig.serviceUrls().backendUrl
  }), loopBackendUrl());
  await page.waitForTimeout(350);
  const afterScenario2 = await readPatientsAndAudit(page, ["P001", "P002"]);
  const activeScenario2 = await readActiveOrHistoryTask(page, task2.task_id);
  record("wrong_patient_scenario_2_checked", await collectBrowserState(page), {
    task_id: task2.task_id,
    canonical_patient: { patientId: "P001", name: "张伟" },
    action_result: { resumeResult, task: activeScenario2 },
    postcondition: {
      no_update_before_correct_context: JSON.stringify(beforeScenario2) === JSON.stringify(afterScenario2),
      not_completed_on_wrong_context: !activeScenario2 || activeScenario2.status !== "completed"
    }
  });
  assertions.push(assertion("scenario_2_not_completed_on_wrong_patient", !activeScenario2 || activeScenario2.status !== "completed", "not completed", activeScenario2 && activeScenario2.status));
  assertions.push(assertion("scenario_2_no_update_or_save", JSON.stringify(beforeScenario2) === JSON.stringify(afterScenario2), beforeScenario2, afterScenario2));

  await page.goto(loopPageUrl(origin, "/html/patient-editor.html", "loop-empty-editor"));
  await page.waitForLoadState("domcontentloaded");
  const beforeScenario3 = await readPatientsAndAudit(page, ["P001", "P002"]);
  const task3 = buildPatientMutationTask({
    caseId: `${caseDef.case_id}_scenario_3`,
    objective: "当前编辑页没有 patientId，任务要求修改 P001 手机号并保存。",
    patient: { patientId: "P001", name: "张伟" },
    updates: [{ field: "phone", value: "13900010003" }]
  });
  const run3 = await executePlannedBrowserTask(page, task3, record, "wrong_patient_scenario_3");
  const afterScenario3 = await readPatientsAndAudit(page, ["P001", "P002"]);
  record("wrong_patient_scenario_3_checked", run3.state, {
    task_id: task3.task_id,
    canonical_patient: { patientId: "P001", name: "张伟" },
    page_patient: run3.state.page_patient,
    action_result: { before: beforeScenario3, after: afterScenario3, task_status: run3.task && run3.task.status },
    postcondition: {
      target_or_safe_fail: (run3.task && run3.task.status === "completed" && afterScenario3.P001.patient && afterScenario3.P001.patient.phone === "13900010003") || (run3.task && run3.task.status === "failed"),
      p002_unchanged: JSON.stringify(beforeScenario3.P002.patient) === JSON.stringify(afterScenario3.P002.patient)
    }
  });
  assertions.push(assertion("scenario_3_no_empty_form_write", JSON.stringify(beforeScenario3.P002.patient) === JSON.stringify(afterScenario3.P002.patient), beforeScenario3.P002.patient, afterScenario3.P002.patient));
  assertions.push(assertion("scenario_3_correct_target_or_safe_fail", (run3.task && run3.task.status === "completed" && afterScenario3.P001.patient && afterScenario3.P001.patient.phone === "13900010003") || (run3.task && run3.task.status === "failed"), "completed on P001 or safe failed", { status: run3.task && run3.task.status, P001: afterScenario3.P001.patient }));
}

async function runAgentPatientMutationCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  const spec = normalizeMutationSpec(caseDef);
  await loginViaUi(page, record);
  const origin = new URL(page.url()).origin;
  await page.goto(loopPageUrl(origin, "/html/patient-management.html", caseDef.case_id));
  await page.waitForLoadState("domcontentloaded");
  const before = await readPatientsAndAudit(page, [spec.patient.patientId]);
  const task = buildPatientMutationTask({
    caseId: caseDef.case_id,
    objective: caseDef.input || caseDef.title || "loop patient mutation",
    patient: spec.patient,
    updates: spec.updates
  });
  const run = await executePlannedBrowserTask(page, task, record, caseDef.case_id);
  const after = await readPatientsAndAudit(page, [spec.patient.patientId]);
  const afterPatient = after[spec.patient.patientId] && after[spec.patient.patientId].patient;
  const beforePatient = before[spec.patient.patientId] && before[spec.patient.patientId].patient;
  const fieldResults = spec.updates.map((update) => ({
    field: update.field,
    expected: String(update.value),
    actual: afterPatient && String(afterPatient[update.field] ?? "")
  }));
  record("agent_patient_mutation_checked", run.state, {
    task_id: task.task_id,
    canonical_patient: spec.patient,
    page_patient: run.state.page_patient,
    action_payload: { updates: spec.updates },
    action_result: {
      task_status: run.task && run.task.status,
      fields: fieldResults,
      audit_before: before[spec.patient.patientId] && before[spec.patient.patientId].auditCount,
      audit_after: after[spec.patient.patientId] && after[spec.patient.patientId].auditCount
    },
    postcondition: {
      no_login_page: run.state.page_type !== "login",
      all_fields_match: fieldResults.every((item) => item.expected === item.actual),
      audit_added: after[spec.patient.patientId].auditCount > before[spec.patient.patientId].auditCount
    }
  });
  assertions.push(assertion("task_completed", run.task && run.task.status === "completed", "completed", run.task && run.task.status));
  assertions.push(assertion("page_not_login", run.state.page_type !== "login", "not login", run.state.page_type));
  assertions.push(assertion("correct_patient_context", run.state.page_state && String(run.state.page_state.patientId || "").toUpperCase() === spec.patient.patientId, spec.patient.patientId, run.state.page_state && run.state.page_state.patientId));
  assertions.push(assertion("fields_match", fieldResults.every((item) => item.expected === item.actual), spec.updates, fieldResults));
  assertions.push(assertion("audit_added", after[spec.patient.patientId].auditCount > before[spec.patient.patientId].auditCount, `>${before[spec.patient.patientId].auditCount}`, after[spec.patient.patientId].auditCount));
  assertions.push(assertion("patient_changed_from_before", JSON.stringify(beforePatient) !== JSON.stringify(afterPatient), "changed", { before: beforePatient, after: afterPatient }));
}

async function runRefreshRestoreNoRepeatCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  const spec = {
    patient: { patientId: "P004", name: "陈敏" },
    updates: [{ field: "chiefComplaint", value: "胸闷半天，活动后加重。" }]
  };
  await loginViaUi(page, record);
  const origin = new URL(page.url()).origin;
  await page.goto(loopPageUrl(origin, "/html/patient-management.html", "loop-refresh-restore"));
  await page.waitForLoadState("domcontentloaded");
  const before = await readPatientsAndAudit(page, [spec.patient.patientId]);
  const task = buildPatientMutationTask({
    caseId: caseDef.case_id,
    objective: "刷新恢复测试：修改 P004 主诉并保存。",
    patient: spec.patient,
    updates: spec.updates
  });
  await resetActiveTask(page);
  const first = await page.evaluate(({ plannedTask, backendUrl }) => window.AgentTaskOrchestrator.executePlannedTask(plannedTask, {
    backendUrl: backendUrl || window.HisRuntimeConfig.serviceUrls().backendUrl
  }), { plannedTask: task, backendUrl: loopBackendUrl() });
  record("refresh_restore_first_dispatch", await collectBrowserState(page), {
    task_id: task.task_id,
    action_result: first
  });
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  const run = await resumePlannedBrowserTask(page, task, record, caseDef.case_id);
  const after = await readPatientsAndAudit(page, [spec.patient.patientId]);
  const taskAfter = run.task || await readActiveOrHistoryTask(page, task.task_id);
  const completedSaveSteps = (taskAfter && Array.isArray(taskAfter.plan) ? taskAfter.plan : []).filter((step) => (step.actionType || step.action_type) === "save_patient" && step.status === "completed");
  record("refresh_restore_checked", run.state, {
    task_id: task.task_id,
    action_result: { task: taskAfter, before, after },
    postcondition: {
      completed_once: taskAfter && taskAfter.status === "completed",
      no_duplicate_save_step: completedSaveSteps.length === 1,
      audit_delta: after[spec.patient.patientId].auditCount - before[spec.patient.patientId].auditCount
    }
  });
  assertions.push(assertion("task_completed_after_refresh", taskAfter && taskAfter.status === "completed", "completed", taskAfter && taskAfter.status));
  assertions.push(assertion("save_step_completed_once", completedSaveSteps.length === 1, 1, completedSaveSteps.length));
  assertions.push(assertion("audit_not_duplicated", after[spec.patient.patientId].auditCount - before[spec.patient.patientId].auditCount === 1, 1, after[spec.patient.patientId].auditCount - before[spec.patient.patientId].auditCount));
}

async function runMissingPatientClarifyCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await loginViaUi(page, record);
  const origin = new URL(page.url()).origin;
  await page.goto(loopPageUrl(origin, "/html/patient-management.html", caseDef.case_id));
  await page.waitForLoadState("domcontentloaded");
  const before = await readPatientsAndAudit(page, ["P001", "P999"]);
  const task = buildClarificationSeedTask({
    caseId: caseDef.case_id,
    objective: "loop missing patient clarification",
    firstStep: {
      id: "step_find_missing_patient",
      goal: "Find missing patient",
      requiredPage: "patientManagement",
      actionType: "find_patient",
      args: { patientSelector: { patientId: "P999", name: "missing loop patient" } }
    }
  });
  const waiting = await executePlannedBrowserTask(page, task, record, caseDef.case_id);
  const waitingTask = waiting.task || await readActiveOrHistoryTask(page, task.task_id);
  record("missing_patient_waiting_checked", waiting.state, {
    task_id: task.task_id,
    action_result: { task_status: waitingTask && waitingTask.status, last_error: waitingTask && waitingTask.lastError },
    postcondition: { same_task_id: waitingTask && waitingTask.task_id === task.task_id }
  });
  assertions.push(assertion("task_waiting_for_patient", waitingTask && waitingTask.status === "waiting_user", "waiting_user", waitingTask && waitingTask.status));
  assertions.push(assertion("same_task_id_while_waiting", waitingTask && waitingTask.task_id === task.task_id, task.task_id, waitingTask && waitingTask.task_id));

  await routeContinuationPlanner(page, buildPatientMutationTask({
    caseId: `${caseDef.case_id}_continued`,
    objective: "continue same task after patient clarification",
    patient: { patientId: "P001", name: "张伟" },
    updates: [{ field: "phone", value: "13900199001" }]
  }));
  const continued = await page.evaluate(({ text, backendUrl }) => window.AgentTaskOrchestrator.startTask(text, {
    backendUrl: backendUrl || window.HisRuntimeConfig.serviceUrls().backendUrl
  }), { text: "其实是 P001 张伟，把手机号改为 13900199001 并保存。", backendUrl: loopBackendUrl() });
  record("missing_patient_reply_submitted", await collectBrowserState(page), {
    task_id: task.task_id,
    action: "AgentTaskOrchestrator.startTask",
    action_result: continued
  });
  const run = await resumePlannedBrowserTask(page, task, record, `${caseDef.case_id}_continued`);
  const after = await readPatientsAndAudit(page, ["P001"]);
  const finalTask = run.task || await readActiveOrHistoryTask(page, task.task_id);
  record("missing_patient_continuation_checked", run.state, {
    task_id: task.task_id,
    canonical_patient: { patientId: "P001", name: "张伟" },
    action_result: { before, after, task_status: finalTask && finalTask.status },
    postcondition: {
      same_task_id: finalTask && finalTask.task_id === task.task_id,
      canonical_patient_id: "P001",
      p001_phone_updated: after.P001.patient && after.P001.patient.phone === "13900199001"
    }
  });
  assertions.push(assertion("same_task_id_after_patient_reply", finalTask && finalTask.task_id === task.task_id, task.task_id, finalTask && finalTask.task_id));
  assertions.push(assertion("canonical_patient_p001_after_reply", after.P001.patient && after.P001.patient.phone === "13900199001", "13900199001", after.P001.patient && after.P001.patient.phone));
  assertions.push(assertion("task_completed_after_patient_reply", finalTask && finalTask.status === "completed", "completed", finalTask && finalTask.status));
}

async function runMissingFieldClarifyCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await loginViaUi(page, record);
  const origin = new URL(page.url()).origin;
  await page.goto(loopPageUrl(origin, "/html/patient-management.html", caseDef.case_id));
  await page.waitForLoadState("domcontentloaded");
  const before = await readPatientsAndAudit(page, ["P001"]);
  const task = buildClarificationSeedTask({
    caseId: caseDef.case_id,
    objective: "loop missing field clarification",
    firstStep: {
      id: "step_ask_missing_field",
      goal: "Ask which field should be changed",
      requiredPage: "patientManagement",
      actionType: "ask_clarification",
      args: { question: "需要补充要修改的字段。" }
    },
    slots: { target_patient: { patientId: "P001", name: "张伟" } }
  });
  const waiting = await executePlannedBrowserTask(page, task, record, caseDef.case_id);
  const waitingTask = waiting.task || await readActiveOrHistoryTask(page, task.task_id);
  assertions.push(assertion("task_waiting_for_field", waitingTask && waitingTask.status === "waiting_user", "waiting_user", waitingTask && waitingTask.status));
  assertions.push(assertion("same_task_id_field_waiting", waitingTask && waitingTask.task_id === task.task_id, task.task_id, waitingTask && waitingTask.task_id));

  await routeContinuationPlanner(page, buildPatientMutationTask({
    caseId: `${caseDef.case_id}_continued`,
    objective: "continue same task after field clarification",
    patient: { patientId: "P001", name: "张伟" },
    updates: [{ field: "phone", value: "13900199002" }]
  }));
  const continued = await page.evaluate(({ text, backendUrl }) => window.AgentTaskOrchestrator.startTask(text, {
    backendUrl: backendUrl || window.HisRuntimeConfig.serviceUrls().backendUrl
  }), { text: "字段是手机号，改成 13900199002 并保存。", backendUrl: loopBackendUrl() });
  record("missing_field_reply_submitted", await collectBrowserState(page), {
    task_id: task.task_id,
    action: "AgentTaskOrchestrator.startTask",
    action_result: continued
  });
  const run = await resumePlannedBrowserTask(page, task, record, `${caseDef.case_id}_continued`);
  const after = await readPatientsAndAudit(page, ["P001"]);
  const finalTask = run.task || await readActiveOrHistoryTask(page, task.task_id);
  record("missing_field_continuation_checked", run.state, {
    task_id: task.task_id,
    action_result: { before, after, task_status: finalTask && finalTask.status },
    postcondition: {
      same_task_id: finalTask && finalTask.task_id === task.task_id,
      field: "phone",
      phone_updated: after.P001.patient && after.P001.patient.phone === "13900199002"
    }
  });
  assertions.push(assertion("same_task_id_after_field_reply", finalTask && finalTask.task_id === task.task_id, task.task_id, finalTask && finalTask.task_id));
  assertions.push(assertion("field_phone_after_reply", after.P001.patient && after.P001.patient.phone === "13900199002", "13900199002", after.P001.patient && after.P001.patient.phone));
  assertions.push(assertion("task_completed_after_field_reply", finalTask && finalTask.status === "completed", "completed", finalTask && finalTask.status));
}

async function runNewTaskDuringWaitingUserCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await loginViaUi(page, record);
  await seedWaitingTask(page, {
    task_id: `${caseDef.case_id}_waiting`,
    objective: "old loop task waiting for user",
    waitingFor: "field"
  });
  await ensureAgentOpen(page);
  await page.fill("#hisAgentInput", "请把 P002 李娜的科室改为心血管内科并保存。");
  await page.click("#hisAgentSendButton");
  await page.waitForTimeout(400);
  const after = await collectBrowserState(page);
  const active = await readActiveOrHistoryTask(page, `${caseDef.case_id}_waiting`);
  const conflictVisible = await page.locator("text=取消旧任务并开始新任务").count();
  record("new_task_during_waiting_checked", after, {
    task_id: `${caseDef.case_id}_waiting`,
    action: "submit_agent_text",
    action_result: {
      active_task_status: active && active.status,
      conflict_action_visible: conflictVisible > 0
    },
    postcondition: {
      asks_cancel_old_task: conflictVisible > 0,
      old_task_not_cancelled: active && active.status === "waiting_user"
    }
  });
  assertions.push(assertion("asks_cancel_old_task", conflictVisible > 0, true, conflictVisible > 0));
  assertions.push(assertion("old_task_still_waiting", active && active.status === "waiting_user", "waiting_user", active && active.status));
}

async function runCancelTaskTerminalCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await loginViaUi(page, record);
  const taskId = `${caseDef.case_id}_running`;
  await seedWaitingTask(page, {
    task_id: taskId,
    objective: "loop task to cancel",
    waitingFor: "field"
  });
  await ensureAgentOpen(page);
  await page.fill("#hisAgentInput", "取消任务");
  await page.click("#hisAgentSendButton");
  await page.waitForTimeout(400);
  const after = await collectBrowserState(page);
  const task = await readHistoryTask(page, taskId);
  const sendLabel = await page.locator("#hisAgentSendButton").textContent().catch(() => "");
  const sendAction = await page.locator("#hisAgentSendButton").getAttribute("data-action").catch(() => "");
  record("cancel_task_terminal_checked", after, {
    task_id: taskId,
    action: "cancel_task",
    action_result: { task_status: task && task.status, sendLabel, sendAction },
    postcondition: {
      task_status: task && task.status,
      timer_stopped: !after.active_task,
      send_button_restored: /发送/.test(sendLabel || "") && (!sendAction || sendAction === "send")
    }
  });
  assertions.push(assertion("task_cancelled", task && (task.status === "cancelled" || task.status === "canceled"), "cancelled", task && task.status));
  assertions.push(assertion("no_active_task_after_cancel", !after.active_task, "empty", after.active_task && after.active_task.status));
  assertions.push(assertion("send_button_restored", /发送/.test(sendLabel || "") && (!sendAction || sendAction === "send"), "发送/send", { sendLabel, sendAction }));
}

async function runPrimaryVoiceInputOnlyCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await routeVoiceHealth(page, { diarizationAvailable: true });
  await installVoiceHarness(page, { transcript: "主输入语音测试任务文本" });
  await ensureAgentOpen(page);
  const before = await collectBrowserState(page);
  await page.click("#hisAgentVoiceButton");
  await page.waitForFunction(() => {
    const input = document.querySelector("#hisAgentInput");
    return input && /主输入语音测试任务文本/.test(input.value || "");
  }, null, { timeout: 5000 });
  const recordingState = await readVoiceHarnessState(page);
  const viewDuring = await page.evaluate(() => ({
    activeTab: document.querySelector("#hisAgentPanel")?.dataset?.activeTab || "",
    voiceHidden: document.querySelector("#hisAgentVoiceView")?.hidden,
    inputValue: document.querySelector("#hisAgentInput")?.value || "",
    voiceButtonText: document.querySelector("#hisAgentVoiceButton")?.textContent || "",
    activeTask: localStorage.getItem("hisAgentActiveTask")
  }));
  await page.click("#hisAgentVoiceButton");
  await page.waitForFunction(() => {
    const voice = window.HisVoiceInputController && window.HisVoiceInputController.getState
      ? window.HisVoiceInputController.getState()
      : {};
    return !voice.recording && (voice.voiceInputStatus === "idle" || !voice.voiceInputStatus);
  }, null, { timeout: 5000 });
  const stoppedState = await readVoiceHarnessState(page);
  const after = await collectBrowserState(page);
  record("primary_voice_input_only_checked", after, {
    action: "voice_dictation_start_stop",
    action_result: { before, viewDuring, recordingState, stoppedState },
    postcondition: {
      input_filled: /主输入语音测试任务文本/.test(viewDuring.inputValue || ""),
      no_auto_send: !after.active_task && after.task_history_count === before.task_history_count,
      no_voice_view: viewDuring.voiceHidden === true,
      media_released: stoppedState.trackStopCount > 0 && stoppedState.openWebSockets === 0
    }
  });
  assertions.push(assertion("input_filled", /主输入语音测试任务文本/.test(viewDuring.inputValue || ""), true, viewDuring.inputValue));
  assertions.push(assertion("no_auto_send", !after.active_task && after.task_history_count === before.task_history_count, "no task", { activeTask: after.active_task, history: after.task_history_count, beforeHistory: before.task_history_count }));
  assertions.push(assertion("does_not_enter_voice_view", viewDuring.voiceHidden === true, true, viewDuring.voiceHidden));
  assertions.push(assertion("dictation_stopped_and_released", stoppedState.trackStopCount > 0 && stoppedState.openWebSockets === 0, true, stoppedState));
}

async function runVoiceSessionReviewBeforeExecuteCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  const expectedMutations = [
    { field: "chiefComplaint", fieldLabel: "主诉", value: "咳嗽两天伴低热" },
    { field: "presentIllness", fieldLabel: "现病史", value: "患者近两天咳嗽，有少量白痰，夜间明显，伴低热" },
    { field: "pastHistory", fieldLabel: "既往病史", value: "无明确慢性病史" }
  ];
  await routeVoiceTaskDraft(
    page,
    "请将患者 P001 张伟的主诉改为咳嗽两天伴低热，现病史补充患者近两天咳嗽、有少量白痰、夜间明显、伴低热，既往病史写成无明确慢性病史，并保存。",
    expectedMutations
  );
  await ensureAgentOpen(page);
  const before = await collectBrowserState(page);
  await page.click("#hisAgentVisitSessionButton");
  await page.waitForTimeout(250);
  const afterEnter = await page.evaluate(() => {
    const voice = window.HisVoiceInputController && window.HisVoiceInputController.getState
      ? window.HisVoiceInputController.getState()
      : {};
    return {
      recording: Boolean(voice.recording),
      didCallGetUserMedia: Boolean(voice.didCallGetUserMedia),
      voiceHidden: document.querySelector("#hisAgentVoiceView")?.hidden
    };
  });
  await page.click("#hisAgentMockTurnsButton");
  await page.click("#hisAgentPlanVoiceTaskButton");
  await page.waitForSelector("[data-voice-task-editor='1']", { timeout: 8000 });
  const review = await page.evaluate(() => ({
    editorValue: document.querySelector("[data-voice-task-editor='1']")?.value || "",
    executeButton: Array.from(document.querySelectorAll("[data-agent-action='voice-task-execute']")).some((button) => /执行任务/.test(button.textContent || "")),
    activeTask: localStorage.getItem("hisAgentActiveTask"),
    historyCount: JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").length,
    pendingVoicePlan: Boolean(JSON.parse(localStorage.getItem("his_agent_widget_state_v1") || "{}").pendingVoicePlan),
    expectedMutationFields: (JSON.parse(localStorage.getItem("his_agent_widget_state_v1") || "{}").pendingVoicePlan?.expectedMutations || []).map((item) => item.field)
  }));
  const after = await collectBrowserState(page);
  record("voice_session_review_checked", after, {
    action: "voice_turns_to_agent_task",
    action_result: { before, afterEnter, review },
    postcondition: {
      no_auto_mic_on_enter: !afterEnter.recording && !afterEnter.didCallGetUserMedia,
      review_editor_visible: /P001/.test(review.editorValue || ""),
      past_history_contract_present: review.expectedMutationFields.includes("pastHistory"),
      no_auto_execute: !review.activeTask && after.audit_count === before.audit_count
    }
  });
  assertions.push(assertion("visit_session_does_not_auto_record", !afterEnter.recording && !afterEnter.didCallGetUserMedia, true, afterEnter));
  assertions.push(assertion("review_editor_visible", /P001/.test(review.editorValue || "") && review.executeButton, "review editor with execute", review));
  assertions.push(assertion("voice_review_contract_contains_past_history", review.expectedMutationFields.includes("pastHistory"), true, review.expectedMutationFields));
  assertions.push(assertion("voice_review_not_auto_executed", !review.activeTask && after.audit_count === before.audit_count, "no active task/no audit", { activeTask: review.activeTask, beforeAudit: before.audit_count, afterAudit: after.audit_count }));
}

async function runDiartUnavailableManualCase(page, caseDef, assertions, record) {
  await routeStructuredLlmHealthOk(page);
  await routeVoiceHealth(page, { diarizationAvailable: false });
  await installVoiceHarness(page, { transcript: "医生口述整理任务", sessionRole: "doctor" });
  await ensureAgentOpen(page);
  await page.click("#hisAgentVisitSessionButton");
  await page.click("#hisAgentStartVoiceButton");
  await page.waitForFunction(() => {
    const turns = Array.from(document.querySelectorAll("#hisAgentTurns .his-agent-turn"));
    return turns.some((node) => /医生口述整理任务/.test(node.textContent || ""));
  }, null, { timeout: 5000 });
  await page.click("#hisAgentStopVoiceButton");
  await page.waitForFunction(() => {
    const voice = window.HisVoiceInputController && window.HisVoiceInputController.getState
      ? window.HisVoiceInputController.getState()
      : {};
    return !voice.recording;
  }, null, { timeout: 5000 });
  const voiceState = await readVoiceHarnessState(page);
  const ui = await page.evaluate(() => ({
    planHidden: document.querySelector("#hisAgentPlanVoiceTaskButton")?.hidden,
    turnsText: document.querySelector("#hisAgentTurns")?.textContent || "",
    statusText: document.querySelector("#hisAgentVoiceStatusCard")?.textContent || "",
    voice: window.HisVoiceInputController && window.HisVoiceInputController.getState
      ? window.HisVoiceInputController.getState()
      : {}
  }));
  const after = await collectBrowserState(page);
  record("diart_unavailable_manual_checked", after, {
    action: "voice_session_without_diart",
    action_result: { ui, voiceState },
    postcondition: {
      manual_turns_available: /医生口述整理任务/.test(ui.turnsText || ""),
      diart_not_automatic: !/diart_local/.test(JSON.stringify(ui.voice || {})),
      plan_available: ui.planHidden === false,
      media_released: voiceState.trackStopCount > 0
    }
  });
  assertions.push(assertion("manual_turns_when_diart_unavailable", /医生口述整理任务/.test(ui.turnsText || ""), true, ui.turnsText));
  assertions.push(assertion("does_not_fake_automatic_diart", !/diart_local/.test(JSON.stringify(ui.voice || {})), "no diart_local", ui.voice));
  assertions.push(assertion("plan_button_available_after_manual_turn", ui.planHidden === false, false, ui.planHidden));
  assertions.push(assertion("session_stopped_and_released", voiceState.trackStopCount > 0 && voiceState.openWebSockets === 0, true, voiceState));
}

async function openPatientTopicChat(page) {
  await ensureAgentOpen(page);
  await page.click(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='patient-management']");
  await page.waitForTimeout(150);
}

async function seedScrollableMessages(page, count = 24) {
  await openPatientTopicChat(page);
  await page.evaluate((messageCount) => {
    for (let index = 0; index < messageCount; index += 1) {
      window.HisAgentWidget.addMessage("agent", "loop 滚动测试消息 " + index, "agent");
    }
  }, count);
}

async function runLatestAgentMessageVisibleCase(page, assertions, record) {
  await seedScrollableMessages(page, 18);
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    const body = document.querySelector("#hisAgentBody");
    const prompt = document.querySelector("#hisAgentNewMessagesButton");
    if (prompt && !prompt.hidden && typeof prompt.click === "function") {
      prompt.click();
    }
    if (body) {
      body.scrollTop = body.scrollHeight;
      body.dispatchEvent(new Event("scroll"));
    }
  });
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    const body = document.querySelector("#hisAgentBody");
    if (body) {
      body.scrollTop = body.scrollHeight;
      body.dispatchEvent(new Event("scroll"));
    }
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    window.HisAgentWidget.addMessage("agent", "loop 最新消息必须可见", "agent");
  });
  await page.waitForTimeout(380);
  const actual = await page.evaluate(() => {
    const body = document.querySelector("#hisAgentBody");
    const messages = Array.from(document.querySelectorAll("#hisAgentHistory .his-agent-message"));
    const last = messages[messages.length - 1];
    if (!body || !last) return { visible: false, messageCount: messages.length };
    const bodyRect = body.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    return {
      visible: lastRect.bottom <= bodyRect.bottom + 4 && lastRect.top >= bodyRect.top - 4,
      messageCount: messages.length,
      latestText: last.textContent || "",
      scrollTop: body.scrollTop,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight
    };
  });
  record("latest_agent_message_visible_checked", await collectBrowserState(page), { action_result: actual, postcondition: { latest_output_visible: actual.visible } });
  assertions.push(assertion("latest_output_visible", actual.visible && /loop 最新消息必须可见/.test(actual.latestText || ""), true, actual));
}

async function runUserScrollNotForcedBottomCase(page, assertions, record) {
  await seedScrollableMessages(page, 24);
  const actual = await page.evaluate(() => {
    const body = document.querySelector("#hisAgentBody");
    if (!body) return { preserved: false, reason: "missing_body" };
    body.scrollTop = 0;
    body.dispatchEvent(new Event("scroll"));
    const before = body.scrollTop;
    window.HisAgentWidget.addMessage("agent", "loop 用户上滚后新增消息", "agent");
    const after = body.scrollTop;
    return {
      preserved: before < 80 && after < 120,
      before,
      after,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight
    };
  });
  record("user_scroll_not_forced_bottom_checked", await collectBrowserState(page), { action_result: actual, postcondition: { scroll_preserved: actual.preserved } });
  assertions.push(assertion("scroll_preserved", actual.preserved, true, actual));
}

async function runNewMessagePromptCase(page, assertions, record) {
  await seedScrollableMessages(page, 24);
  const actual = await page.evaluate(() => {
    const body = document.querySelector("#hisAgentBody");
    if (!body) return { promptVisible: false, reason: "missing_body" };
    body.scrollTop = 0;
    body.dispatchEvent(new Event("scroll"));
    window.HisAgentWidget.addMessage("agent", "loop 新消息提示", "agent");
    const prompt = document.querySelector("#hisAgentNewMessagesButton");
    return {
      promptVisible: Boolean(prompt && !prompt.hidden && prompt.offsetParent !== null),
      promptText: prompt && prompt.textContent || "",
      scrollTop: body.scrollTop
    };
  });
  record("new_message_prompt_checked", await collectBrowserState(page), { action_result: actual, postcondition: { new_message_prompt_visible: actual.promptVisible } });
  assertions.push(assertion("new_message_prompt_visible", actual.promptVisible, true, actual));
}

async function runProgressDoesNotStealHomeViewCase(page, assertions, record) {
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem("hisAgentActiveTask", JSON.stringify({
      task_id: "loop_return_home_stable",
      objective: "修改患者 P001 的手机号并保存",
      status: "running",
      source: "backend_llm",
      current_step_index: 0,
      created_at: now / 1000,
      started_at_ms: now,
      plan: [
        { id: "step_1", goal: "确认患者", actionType: "find_patient", source: "backend_llm", status: "running" },
        { id: "step_2", goal: "保存", actionType: "save_patient", source: "backend_llm", status: "pending" }
      ],
      progress_messages: [],
      step_logs: []
    }));
  });
  await ensureAgentOpen(page);
  await page.click("#hisAgentOpenChatButton");
  await page.click("#hisAgentViewBackButton");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
      detail: { task_id: "loop_return_home_stable", elapsed_ms: 1200, text: "完成步骤：确认患者" }
    }));
  });
  await page.waitForTimeout(150);
  const actual = await page.evaluate(() => ({
    homeVisible: !document.querySelector("#hisAgentHomeView")?.hidden,
    chatHidden: Boolean(document.querySelector("#hisAgentChatView")?.hidden),
    events: window.AgentFlowTrace?.getEvents?.().map((item) => item.event) || []
  }));
  record("progress_does_not_steal_home_view_checked", await collectBrowserState(page), { action_result: actual, postcondition: { view_state: actual.homeVisible && actual.chatHidden } });
  assertions.push(assertion("progress_keeps_home_view", actual.homeVisible && actual.chatHidden, "home", actual));
}

async function runExpandedStepsNotResetCase(page, assertions, record) {
  await page.evaluate(() => {
    const plan = Array.from({ length: 18 }, (_, index) => ({
      id: `step_${index + 1}`,
      goal: `loop 展开步骤滚动稳定性 ${index + 1}`,
      actionType: index === 14 ? "update_patient_field" : "noop",
      requiredPage: "patientEditor",
      status: index < 14 ? "completed" : index === 14 ? "running" : "pending",
      source: "backend_llm"
    }));
    localStorage.removeItem("hisAgentTaskStepsUiV2");
    localStorage.setItem("hisAgentActiveTask", JSON.stringify({
      task_id: "loop_step_scroll_task",
      objective: "验证展开步骤滚动条不会被进度刷新拉回顶部",
      status: "running",
      source: "backend_llm",
      plan,
      current_step_index: 14,
      progress_messages: [],
      created_at: Date.now() / 1000,
      started_at_ms: Date.now() - 4500,
      updated_at: Date.now() / 1000
    }));
  });
  await ensureAgentOpen(page);
  await page.click("#hisAgentOpenChatButton");
  await page.click("#hisAgentCurrentTaskCard details.his-agent-current-steps > summary");
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => {
    const details = document.querySelector("#hisAgentCurrentTaskCard details.his-agent-current-steps");
    const list = document.querySelector("#hisAgentTaskList");
    if (list) list.scrollTop = list.scrollHeight;
    return { open: Boolean(details && details.open), scrollTop: list && list.scrollTop || 0 };
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
      detail: { task_id: "loop_step_scroll_task", elapsed_ms: 5200, text: "完成步骤：第 15 步" }
    }));
  });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => {
    const details = document.querySelector("#hisAgentCurrentTaskCard details.his-agent-current-steps");
    const list = document.querySelector("#hisAgentTaskList");
    return { open: Boolean(details && details.open), scrollTop: list && list.scrollTop || 0 };
  });
  const passed = Boolean(before.open && after.open && after.scrollTop >= Math.max(0, before.scrollTop - 20));
  record("expanded_steps_not_reset_checked", await collectBrowserState(page), { action_result: { before, after }, postcondition: { steps_open: after.open, scroll_top_preserved: passed } });
  assertions.push(assertion("steps_open_after_progress", after.open, true, after));
  assertions.push(assertion("steps_scroll_preserved", passed, true, { before, after }));
}

async function runAgentHistoryRichFieldsCase(page, assertions, record) {
  const now = Date.now();
  await page.evaluate((timestamp) => {
    localStorage.setItem("hisAgentTaskHistory", JSON.stringify([
      {
        task_id: "loop_history_rich_task",
        objective: "修改患者 P001 的手机号为 13800138000 并保存",
        status: "completed",
        source: "backend_llm",
        slots: { target_patient_id: "P001" },
        created_at_ms: timestamp - 4000,
        started_at_ms: timestamp - 3500,
        finished_at_ms: timestamp - 500,
        elapsed_ms: 3000,
        usage_total: { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 },
        plan: [
          {
            id: "step_update_phone",
            goal: "修改手机号字段",
            requiredPage: "patientEditor",
            actionType: "update_patient_field",
            status: "completed",
            source: "backend_llm",
            elapsed_ms: 1200,
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
            args: { patientSelector: { patientId: "P001" }, field: "phone", value: "13800138000" },
            result: {
              success: true,
              action_type: "update_patient_field",
              patientId: "P001",
              field: "phone",
              fieldLabel: "手机号",
              oldValue: "13900000001",
              newValue: "13800138000",
              audit: { oldValue: "13900000001", newValue: "13800138000", source: "backend_llm" }
            }
          }
        ]
      }
    ]));
  }, now);
  await page.goto(pageUrl({ ...loadConfig(), baseUrl: new URL(page.url()).origin }, "agent-history", "loop-history-rich") + "&taskId=loop_history_rich_task");
  await page.waitForLoadState("domcontentloaded");
  const actual = await page.evaluate(() => document.body.textContent || "");
  const checks = {
    elapsedVisible: /00:0\d|耗时|elapsed/i.test(actual),
    tokenVisible: /token|30|Token/i.test(actual),
    auditVisible: /oldValue|newValue|13800138000|手机号/.test(actual)
  };
  record("agent_history_rich_fields_checked", await collectBrowserState(page), { action_result: checks, postcondition: checks });
  assertions.push(assertion("elapsed_visible", checks.elapsedVisible, true, checks));
  assertions.push(assertion("token_visible", checks.tokenVisible, true, checks));
  assertions.push(assertion("audit_visible", checks.auditVisible, true, checks));
}

async function ensureAgentOpen(page) {
  const openPanel = page.locator("#hisAgentPanel.open");
  if (await openPanel.count()) return;
  await page.click("#hisAgentLauncher");
}

async function simulateLlmPlanner(page, plan, slots = {}, taskId = "loop_task") {
  await page.route(/\/api\/(llm|qwen)\/test$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: "loop-e2e", model: "mock-llm", content: "ok" })
    });
  });
  await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON();
    } catch (error) {
      body = {};
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        mode: "loop-harness",
        llmUsed: true,
        provider: "loop-e2e",
        model: "mock-llm",
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        response: {
          kind: "task",
          message: "loop mock task planned",
          task: {
            task_id: taskId,
            objective: body.user_message || "loop task",
            status: "running",
            slots,
            plan,
            current_step_index: 0,
            created_at: Date.now() / 1000,
            updated_at: Date.now() / 1000
          }
        },
        trace: { loop: true }
      })
    });
  });
}

async function routeStructuredLlmHealthOk(page) {
  await page.route(/\/api\/(llm|qwen)\/test$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        provider: "loop-structured",
        model: "backend_llm_contract_stub",
        content: "ok"
      })
    });
  });
}

async function readHistoryTask(page, taskId) {
  return page.evaluate((id) => {
    const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
    return history.find((item) => item.task_id === id) || null;
  }, taskId);
}

async function loginViaUi(page, record) {
  const origin = new URL(page.url()).origin;
  await page.goto(loopPageUrl(origin, "/html/login.html", "loop-login"));
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#loginAccountInput", "123");
  await page.fill("#loginPasswordInput", "123");
  const before = await collectBrowserState(page);
  if (record) {
    record("loop_ui_login_filled", before, {
      action: "manual_login_setup",
      action_payload: { username: "123", password_matched_requested: true }
    });
  }
  await page.click("#loginButton");
  await page.waitForURL(/dashboard\.html/, { timeout: 5000 }).catch(async () => {
    await page.waitForTimeout(800);
  });
}

function normalizeMutationSpec(caseDef) {
  const raw = caseDef.mutation || {};
  const patientId = String(raw.patientId || raw.patient_id || caseDef.expected_postconditions?.patient_id || "P001").toUpperCase();
  const name = String(raw.name || patientNameById(patientId) || "");
  const updates = Array.isArray(raw.updates) && raw.updates.length
    ? raw.updates.map((item) => ({ field: item.field, value: item.value }))
    : [{ field: caseDef.expected_postconditions?.field || "phone", value: caseDef.expected_postconditions?.value || "13800138000" }];
  return {
    patient: { patientId, name },
    updates
  };
}

function patientNameById(patientId) {
  const names = {
    P001: "张伟",
    P002: "李娜",
    P003: "王强",
    P004: "陈敏",
    P005: "赵磊",
    P006: "刘洋",
    P007: "孙芳",
    P008: "周杰",
    P009: "吴敏",
    P010: "郑强"
  };
  return names[String(patientId || "").toUpperCase()] || "";
}

function buildPatientMutationTask({ caseId, objective, patient, updates }) {
  const target = {
    patientId: String(patient.patientId || "").toUpperCase(),
    name: patient.name || patientNameById(patient.patientId)
  };
  const expectedMutations = (updates || []).map((item) => ({
    field: item.field,
    value: item.value
  }));
  const plan = [
    {
      id: "step_find_patient",
      goal: "定位目标患者 " + target.patientId,
      requiredPage: "patientManagement",
      actionType: "find_patient",
      args: { patientSelector: target }
    },
    {
      id: "step_open_patient",
      goal: "打开目标患者编辑页 " + target.patientId,
      requiredPage: "patientManagement",
      actionType: "open_patient_editor",
      args: { patientSelector: target }
    }
  ];
  expectedMutations.forEach((mutation, index) => {
    plan.push({
      id: "step_update_" + (index + 1),
      goal: "更新字段 " + mutation.field,
      requiredPage: "patientEditor",
      actionType: "update_patient_field",
      args: { patientSelector: target, field: mutation.field, value: mutation.value }
    });
  });
  plan.push({
    id: "step_save_patient",
    goal: "保存目标患者",
    requiredPage: "patientEditor",
    actionType: "save_patient",
    args: { patientSelector: target }
  });
  expectedMutations.forEach((mutation, index) => {
    plan.push({
      id: "step_verify_field_" + (index + 1),
      goal: "校验字段 " + mutation.field,
      requiredPage: "patientEditor",
      actionType: "verify_patient_field",
      args: { patientSelector: target, field: mutation.field, value: mutation.value }
    });
  });
  plan.push({
    id: "step_verify_store",
    goal: "核对 patient-store",
    requiredPage: "patientEditor",
    actionType: "verify_patient_store",
    args: { patientSelector: target }
  });
  const taskId = "loop_" + caseId + "_" + Date.now();
  return {
    task_id: taskId,
    objective: objective || "loop patient mutation",
    status: "planned",
    source: "backend_llm",
    current_step_index: 0,
    slots: {
      target_patient: target,
      canonical_patient: target,
      resolved_patient: target,
      expected_mutations: expectedMutations,
      task_contract: {
        target_patient: target,
        expected_mutations: expectedMutations,
        requires_save: true,
        requires_verification: true,
        source: "loop_structured_backend_llm"
      }
    },
    task_contract: {
      target_patient: target,
      expected_mutations: expectedMutations,
      requires_save: true,
      requires_verification: true,
      source: "loop_structured_backend_llm"
    },
    plan
  };
}

async function executePlannedBrowserTask(page, task, record, label) {
  await resetActiveTask(page);
  const first = await page.evaluate(({ plannedTask, backendUrl }) => window.AgentTaskOrchestrator.executePlannedTask(plannedTask, {
    backendUrl: backendUrl || window.HisRuntimeConfig.serviceUrls().backendUrl
  }), { plannedTask: task, backendUrl: loopBackendUrl() });
  record("planned_task_dispatched", await collectBrowserState(page), {
    task_id: task.task_id,
    action: "executePlannedTask",
    action_payload: { label, objective: task.objective, plan_length: task.plan.length },
    action_result: first
  });
  return await resumePlannedBrowserTask(page, task, record, label);
}

async function resumePlannedBrowserTask(page, task, record, label) {
  let lastResult = null;
  for (let round = 0; round < 10; round += 1) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(380);
    const state = await collectBrowserState(page);
    const storedTask = await readActiveOrHistoryTask(page, task.task_id);
    if (storedTask && ["completed", "failed", "waiting_user", "blocked_no_llm", "cancelled", "canceled"].includes(String(storedTask.status || ""))) {
      return { task: storedTask, state, result: lastResult };
    }
    lastResult = await page.evaluate((backendUrl) => window.AgentTaskOrchestrator.resume({
      backendUrl: backendUrl || window.HisRuntimeConfig.serviceUrls().backendUrl
    }), loopBackendUrl());
    record("planned_task_resume_round", await collectBrowserState(page), {
      task_id: task.task_id,
      action: "AgentTaskOrchestrator.resume",
      action_payload: { label, round },
      action_result: lastResult
    });
  }
  return {
    task: await readActiveOrHistoryTask(page, task.task_id),
    state: await collectBrowserState(page),
    result: lastResult
  };
}

async function resetActiveTask(page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("hisAgentActiveTask");
  });
}

async function seedDeferredOpenTask(page, task, patient) {
  const now = Date.now();
  const seeded = JSON.parse(JSON.stringify(task));
  seeded.status = "running";
  seeded.started_at = now / 1000;
  seeded.started_at_ms = now;
  seeded.created_at = seeded.created_at || seeded.started_at;
  seeded.current_step_index = 1;
  seeded.plan = seeded.plan.map((step, index) => {
    const next = Object.assign({}, step, {
      source: "backend_llm",
      status: index === 1 ? "running" : (index < 1 ? "completed" : "pending")
    });
    if (index === 1) {
      next.started_at = now / 1000;
      next.started_at_ms = now;
      next.result = {
        success: true,
        navigation_happened: true,
        defer_step_completion: true,
        expected_patient: { patientId: String(patient.patientId || "").toUpperCase() }
      };
    }
    return next;
  });
  await page.evaluate((activeTask) => {
    window.localStorage.setItem("hisAgentActiveTask", JSON.stringify(activeTask));
  }, seeded);
}

async function readActiveOrHistoryTask(page, taskId) {
  return page.evaluate((id) => {
    const parse = (key, fallback) => {
      try {
        return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
      } catch (error) {
        return fallback;
      }
    };
    const active = parse("hisAgentActiveTask", null);
    if (active && active.task_id === id) return active;
    const history = parse("hisAgentTaskHistory", []);
    return Array.isArray(history) ? history.find((item) => item.task_id === id) || null : null;
  }, taskId);
}

async function readPatientsAndAudit(page, patientIds) {
  return page.evaluate((ids) => {
    const parse = (key, fallback) => {
      try {
        return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
      } catch (error) {
        return fallback;
      }
    };
    const patients = parse("his_demo_patients_v2", []);
    const audit = parse("his_demo_patient_audit_v2", []);
    return ids.reduce((result, rawId) => {
      const patientId = String(rawId || "").toUpperCase();
      const patient = Array.isArray(patients) ? patients.find((item) => String(item.patientId || "").toUpperCase() === patientId) || null : null;
      const auditItems = Array.isArray(audit) ? audit.filter((item) => String(item.patientId || "").toUpperCase() === patientId) : [];
      result[patientId] = {
        patient: patient ? JSON.parse(JSON.stringify(patient)) : null,
        auditCount: auditItems.length,
        auditIds: auditItems.map((item) => item.audit_id).filter(Boolean)
      };
      return result;
    }, {});
  }, patientIds);
}

function buildClarificationSeedTask({ caseId, objective, firstStep, slots = {} }) {
  const taskId = "loop_" + caseId + "_" + Date.now();
  return {
    task_id: taskId,
    objective: objective || "loop clarification task",
    status: "planned",
    source: "backend_llm",
    current_step_index: 0,
    slots,
    plan: [
      Object.assign({
        id: "step_clarify",
        goal: "Need user clarification",
        requiredPage: "patientManagement",
        actionType: "ask_clarification",
        args: { question: "Need clarification." }
      }, firstStep || {})
    ]
  };
}

async function routeContinuationPlanner(page, plannedTask) {
  await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        mode: "loop-continuation",
        llmUsed: true,
        provider: "loop-e2e",
        model: "mock-llm",
        usage: { prompt_tokens: 18, completion_tokens: 12, total_tokens: 30 },
        response: {
          kind: "task",
          message: "loop continuation planned",
          task: Object.assign({}, plannedTask, {
            status: "running",
            source: "backend_llm"
          })
        },
        trace: { loop: true, continuation: true }
      })
    });
  });
}

async function seedWaitingTask(page, seed) {
  await page.evaluate((data) => {
    const now = Date.now();
    const task = {
      task_id: data.task_id,
      objective: data.objective || "loop waiting task",
      status: "waiting_user",
      source: "backend_llm",
      waitingFor: data.waitingFor || "field",
      lastError: "Need user clarification.",
      started_at: now / 1000,
      started_at_ms: now,
      updated_at: now / 1000,
      current_step_index: 0,
      slots: { waitingFor: data.waitingFor || "field" },
      plan: [
        {
          id: "step_waiting",
          goal: "Need user clarification",
          actionType: "ask_clarification",
          requiredPage: "patientManagement",
          status: "waiting_user",
          source: "backend_llm",
          started_at: now / 1000,
          result: { success: false, waiting: true, message: "Need user clarification." }
        }
      ],
      progress_messages: [
        { text: "Need user clarification.", type: "waiting_user", at: new Date(now).toISOString() }
      ]
    };
    window.localStorage.setItem("hisAgentActiveTask", JSON.stringify(task));
  }, seed);
}

async function routeVoiceHealth(page, options = {}) {
  const diarizationAvailable = options.diarizationAvailable !== false;
  await page.route(/\/diarization\/health(?:\?|$)/, async (route) => {
    await route.fulfill({
      status: diarizationAvailable ? 200 : 503,
      contentType: "application/json",
      body: JSON.stringify(diarizationAvailable
        ? { ok: true, status: "connected", provider: "diart_local" }
        : { ok: false, status: "unavailable", provider: "manual", message: "loop diart unavailable" })
    });
  });
  await page.route(/\/health(?:\?|$)/, async (route) => {
    const url = route.request().url();
    if (/\/diarization\/health(?:\?|$)/.test(url)) return route.fallback ? route.fallback() : route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, model: "loop-asr", provider: "loop-asr", loaded: true })
    });
  });
}

async function routeVoiceTaskDraft(page, taskText, expectedMutations = []) {
  await page.route(/\/api\/voice\/turns-to-agent-task$/, async (route) => {
    const normalizedMutations = Array.isArray(expectedMutations) ? expectedMutations : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task_text: taskText,
        result_type: "explicit_action",
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        proposed_fields: normalizedMutations.map((item) => ({
          field: item.field,
          label: item.fieldLabel || item.label || item.field,
          value: item.value
        })),
        expected_mutations: normalizedMutations,
        task_contract: {
          target_patient: { patientId: "P001", name: "张伟" },
          expected_mutations: normalizedMutations,
          requires_save: true,
          requires_verification: true,
          source: "loop_voice_turns_to_agent_task"
        }
      })
    });
  });
}

async function installVoiceHarness(page, options = {}) {
  await page.evaluate((settings) => {
    const transcript = settings.transcript || "loop voice transcript";
    const sessionRole = settings.sessionRole || "doctor";
    const harness = {
      trackStopCount: 0,
      closeCount: 0,
      sentCount: 0,
      instances: []
    };
    window.__loopVoiceHarness = harness;

    const track = {
      kind: "audio",
      readyState: "live",
      enabled: true,
      stop() {
        this.readyState = "ended";
        harness.trackStopCount += 1;
      }
    };
    const stream = {
      id: "loop-media-stream",
      active: true,
      getTracks() { return [track]; },
      getAudioTracks() { return [track]; }
    };
    const mediaDevices = Object.assign({}, navigator.mediaDevices || {}, {
      getUserMedia() {
        harness.didCallGetUserMedia = true;
        return Promise.resolve(stream);
      }
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices
    });

    class LoopAudioContext {
      constructor() {
        this.sampleRate = 16000;
        this.state = "running";
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createScriptProcessor() {
        return { connect() {}, disconnect() {}, onaudioprocess: null };
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    }
    window.AudioContext = LoopAudioContext;
    window.webkitAudioContext = LoopAudioContext;

    class LoopWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        this.url = String(url || "");
        this.readyState = LoopWebSocket.CONNECTING;
        this.binaryType = "";
        this.__sentFinal = false;
        harness.instances.push(this);
        setTimeout(() => {
          this.readyState = LoopWebSocket.OPEN;
          if (typeof this.onopen === "function") this.onopen({ target: this });
          this.emitLoopMessage();
        }, 10);
      }
      send(data) {
        harness.sentCount += 1;
        if (typeof data === "string" && /"end"|end/.test(data)) {
          this.close();
        }
      }
      close() {
        if (this.readyState === LoopWebSocket.CLOSED) return;
        this.readyState = LoopWebSocket.CLOSED;
        harness.closeCount += 1;
        if (typeof this.onclose === "function") this.onclose({ target: this });
      }
      emitLoopMessage() {
        if (this.readyState !== LoopWebSocket.OPEN || this.__sentFinal) return;
        this.__sentFinal = true;
        if (/diarization/i.test(this.url)) {
          const payload = { type: "session_started", status: "connected", provider: "diart_local" };
          if (typeof this.onmessage === "function") this.onmessage({ data: JSON.stringify(payload) });
          return;
        }
        const role = sessionRole === "patient" ? "patient" : "doctor";
        const payload = {
          type: "final",
          normalizedText: transcript,
          rawText: transcript,
          turns: [
            {
              text: transcript,
              role,
              role_label: role === "patient" ? "患者" : "医生",
              is_final: true,
              source: "loop_fake_asr",
              speaker_id: role === "patient" ? "speaker_1" : "speaker_0"
            }
          ]
        };
        if (typeof this.onmessage === "function") this.onmessage({ data: JSON.stringify(payload) });
      }
    }
    window.WebSocket = LoopWebSocket;
  }, options);
}

async function readVoiceHarnessState(page) {
  return page.evaluate(() => {
    const voice = window.HisVoiceInputController && window.HisVoiceInputController.getState
      ? window.HisVoiceInputController.getState()
      : {};
    const harness = window.__loopVoiceHarness || {};
    const instances = Array.isArray(harness.instances) ? harness.instances : [];
    return {
      recording: Boolean(voice.recording),
      voiceInputStatus: voice.voiceInputStatus || "",
      microphoneStatus: voice.microphoneStatus || "",
      streamTrackCount: voice.streamTrackCount || 0,
      asrWebSocketStatus: voice.asrWebSocketStatus || "",
      diarizationProvider: voice.diarizationProvider || "",
      diarizationStatus: voice.diarizationStatus || "",
      trackStopCount: harness.trackStopCount || 0,
      closeCount: harness.closeCount || 0,
      sentCount: harness.sentCount || 0,
      openWebSockets: instances.filter((item) => item && item.readyState !== 3).length
    };
  });
}

function loopBackendUrl() {
  return String(process.env.HIS_BACKEND_URL || "").replace(/\/+$/, "");
}

function loopPageUrl(origin, path, tag, extraParams = {}) {
  const url = new URL(path, origin);
  url.searchParams.set("v", tag || "loop");
  const serviceParams = {
    backendUrl: process.env.HIS_BACKEND_URL,
    asrUrl: process.env.HIS_ASR_URL,
    llmUrl: process.env.HIS_LLM_URL,
    diarizationUrl: process.env.HIS_DIARIZATION_URL
  };
  Object.entries(serviceParams).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, String(value).replace(/\/+$/, ""));
  });
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  const config = loadConfig();
  const cases = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(args.caseFile || config.caseFile, "utf8")));
  const target = cases.find((item) => item.case_id === args.case);
  if (!target) {
    console.error(`Case not found: ${args.case || ""}`);
    process.exit(1);
  }
  const result = await runCase(target, {
    config,
    iteration: Number(args.iteration || 1),
    runId: args.runId || "single-case",
    artifactDir: args.artifactDir || ""
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}
