(function () {
  "use strict";

  const TASK_KEY = "hisAgentActiveTask";
  const HISTORY_KEY = "hisAgentTaskHistory";
  const SESSION_KEY = "hisAgentSessionState";
  const TASK_TTL_MS = 30 * 60 * 1000;
  const BACKEND_LLM_SOURCE = "backend_llm";
  const PROGRESS_EVENT = "his-agent-task-progress";
  const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "blocked_no_llm"]);
  const PATIENT_NOT_FOUND_MESSAGE = "没有找到匹配患者，请提供 patientId、姓名、手机号或返回患者管理确认。";
  const LOGIN_FAILURE_MESSAGE = "登录失败，账号或密码不正确，请检查后重试。";
  const TASK_TIMING_KEYS = [
    "planning_ms",
    "route_input_ms",
    "llm_health_ms",
    "observe_ms",
    "action_ms",
    "verify_ms",
    "animation_ms",
    "ui_animation_ms",
    "demo_delay_ms",
    "page_navigation_ms",
    "status_probe_ms",
    "total_ms"
  ];
  const STEP_BREAKDOWN_KEYS = [
    "before_observe_ms",
    "execute_ms",
    "after_observe_ms",
    "verify_ms",
    "animation_ms",
    "demo_delay_ms",
    "page_navigation_ms",
    "wait_ms"
  ];
  const ALLOWED_ACTIONS = new Set([
    "fill_input",
    "fill_login_form",
    "submit_login",
    "logout",
    "open_page",
    "navigate_internal",
    "find_patient",
    "select_patient",
    "open_patient_editor",
    "update_patient_field",
    "update_patient_fields",
    "verify_patient_field",
    "verify_patient_store",
    "save_patient",
    "create_structured_draft",
    "write_clinical_note_field",
    "ask_clarification",
    "finish_task",
    "cancel_task",
    "noop"
  ]);
  const PROTECTED_PAGES = new Set(["dashboard", "patientManagement", "patientEditor"]);
  const PROTECTED_ACTIONS = new Set([
    "find_patient",
    "select_patient",
    "open_patient_editor",
    "update_patient_field",
    "update_patient_fields",
    "verify_patient_field",
    "verify_patient_store",
    "save_patient",
    "create_structured_draft",
    "write_clinical_note_field"
  ]);
  const EDITABLE_FIELDS = new Set([
    "name",
    "gender",
    "age",
    "birthDate",
    "phone",
    "idType",
    "idNumber",
    "address",
    "emergencyContact",
    "emergencyPhone",
    "department",
    "visitType",
    "insuranceType",
    "hasAllergy",
    "allergyNote",
    "medicalHistory",
    "symptoms",
    "remark",
    "chiefComplaint",
    "presentIllness",
    "pastHistory",
    "allergyHistory",
    "vitalSigns",
    "diagnosis",
    "examSummary",
    "orders",
    "note"
  ]);
  const CLINICAL_NOTE_FIELDS = new Set([
    "chiefComplaint",
    "presentIllness",
    "pastHistory",
    "allergyHistory",
    "medicalHistory",
    "vitalSigns",
    "diagnosis",
    "examSummary",
    "orders",
    "note"
  ]);

  async function startTask(objective, context) {
    const settings = context || {};
    const backendUrl = normalizeBackendUrl(settings.backendUrl);
    const routeStartedAtMs = Date.now();
    const startedAtMs = Number(settings.taskStartedAtMs || 0) || Date.now();
    const runId = String(settings.runId || "");
    const observeStartedAtMs = Date.now();
    const fullPatientIndex = getFullPatientIndex();
    const pageState = enrichPageStateWithPatients(settings.pageState || collectPageState(), fullPatientIndex);
    const initialObserveMs = Date.now() - observeStartedAtMs;
    let activeTask = loadTask() || {};
    if (activeTask && ["completed", "failed", "cancelled", "blocked_no_llm"].includes(activeTask.status)) {
      appendHistory(activeTask, "新任务开始前清理旧任务，避免污染本次患者匹配。");
      clearTask();
      activeTask = {};
    }
    if (activeTask && activeTask.status === "waiting_user" && isLoginConfirmationTask(activeTask)) {
      const reply = handleLoginPreconditionReply(activeTask, objective);
      if (reply && reply.resume) return runTaskLoop({ backendUrl: backendUrl });
      if (reply) return reply;
    }
    if (activeTask && activeTask.status === "waiting_user") {
      return continueWaitingTask(activeTask, objective, Object.assign({}, settings, {
        backendUrl: backendUrl,
        pageState: pageState,
        fullPatientIndex: fullPatientIndex
      }));
      return { handled: true, success: false, waiting: true, message: "当前有一个任务正在等待补充信息。请选择继续当前任务，或取消旧任务并开始新任务。" };
    }
    if (activeTask && activeTask.status === "running") {
      return { handled: true, success: false, waiting: true, message: "当前已有任务正在执行，是否取消当前任务并开始新任务？" };
    }
    dispatchProgress({ task_id: "", run_id: runId, elapsed_ms: 0, text: "已收到任务：" + String(objective || "").trim(), type: "progress" });
    dispatchProgress({ task_id: "", run_id: runId, elapsed_ms: Math.max(0, Date.now() - startedAtMs), text: "LLM 正在解析任务目标", type: "progress" });
    const payload = buildPlannerPayload(objective, {
      pageState: pageState,
      activeTask: activeTask,
      agentMessages: settings.agentMessages,
      speakerTurns: settings.speakerTurns,
      fullPatientIndex: fullPatientIndex,
      connectionStatus: settings.connectionStatus,
      source: settings.source,
      inputRoute: settings.inputRoute,
      taskContract: settings.taskContract
    });

    const planningStartedAtMs = Date.now();
    const planner = await callBackend(backendUrl, "/api/universal-agent/task-plan", payload);
    const planningMs = Date.now() - planningStartedAtMs;
    if (!planner.ok || !planner.response) {
      const failed = buildPlannerFailureTask(objective, planner.error || "backend_llm_unavailable", runId);
      ensureTaskTiming(failed);
      addTaskTiming(failed, "planning_ms", planningMs);
      addTaskTiming(failed, "observe_ms", initialObserveMs);
      addTaskTiming(failed, "route_input_ms", Math.max(0, planningStartedAtMs - routeStartedAtMs - initialObserveMs));
      finishTask(failed, "failed", failed.lastError || "任务规划失败。", { source: "planner" });
      return plannerFailureResult(failed);
    }

    const response = planner.response;
    persistTrace("planner", planner.trace || {}, response);
    if (response.kind === "ask_clarification") {
      return {
        handled: true,
        success: false,
        waiting: true,
        message: response.message || questionFromClarification(response.clarification)
      };
    }
    if (!response.task || !Array.isArray(response.task.plan) || !response.task.plan.length) {
      return { handled: true, success: false, message: response.message || "LLM planner did not return an executable task." };
    }

    const task = markBackendLlmTask(normalizeTask(response.task, objective));
    task.run_id = runId;
    const loginGate = enforceLoginPrecondition(task, pageState);
    if (loginGate) return loginGate;
    const planValidation = validateTaskPlanAgainstContract(task);
    if (!planValidation.ok) {
      return rejectInvalidMutationPlan(task, planValidation);
    }
    markTaskStarted(task, startedAtMs);
    task.created_at = task.created_at || task.started_at;
    ensureTaskTiming(task);
    addTaskTiming(task, "planning_ms", planningMs);
    addTaskTiming(task, "observe_ms", initialObserveMs);
    addTaskTiming(task, "route_input_ms", Math.max(0, planningStartedAtMs - routeStartedAtMs - initialObserveMs));
    addUsage(task, planner.raw && planner.raw.usage, "planner");
    addProgress(task, "LLM 返回任务计划，预计 " + task.plan.length + " 步", { usage: task.usage_last || null, stage: "planner" });
    if (task.slots && task.slots.plan_validation && task.slots.plan_validation.repaired) {
      addProgress(task, "任务计划缺少必要修改步骤，已按修改合同补全，尚未执行页面操作。", { planValidation: task.slots.plan_validation });
    }
    saveTask(task);
    return runTaskLoop({ backendUrl: backendUrl });
  }

  async function planTaskOnly(objective, context) {
    const settings = context || {};
    const backendUrl = normalizeBackendUrl(settings.backendUrl);
    const routeStartedAtMs = Date.now();
    const observeStartedAtMs = Date.now();
    const fullPatientIndex = getFullPatientIndex();
    const pageState = enrichPageStateWithPatients(settings.pageState || collectPageState(), fullPatientIndex);
    const initialObserveMs = Date.now() - observeStartedAtMs;
    const activeTask = retireInactiveTask(loadTask()) || {};
    if (activeTask && (activeTask.status === "waiting_user" || activeTask.status === "running")) {
      return { handled: true, success: false, waiting: true, message: "当前已有任务正在进行或等待补充，请先处理当前任务。" };
    }
    const payload = buildPlannerPayload(objective, {
      pageState: pageState,
      activeTask: activeTask,
      agentMessages: settings.agentMessages,
      speakerTurns: settings.speakerTurns,
      fullPatientIndex: fullPatientIndex,
      connectionStatus: settings.connectionStatus,
      source: settings.source,
      inputRoute: settings.inputRoute,
      taskContract: settings.taskContract
    });
    const planningStartedAtMs = Date.now();
    const planner = await callBackend(backendUrl, "/api/universal-agent/task-plan", payload);
    const planningMs = Date.now() - planningStartedAtMs;
    if (!planner.ok || !planner.response) {
      return {
        handled: true,
        success: false,
        llmStatus: "disconnected",
        agentMode: "blocked_no_llm",
        message: "LLM 当前不可用，无法整理就诊会话任务计划。"
      };
    }
    const response = planner.response;
    persistTrace("voice_planner", planner.trace || {}, response);
    if (response.kind === "ask_clarification") {
      return {
        handled: true,
        success: false,
        waiting: true,
        message: response.message || questionFromClarification(response.clarification)
      };
    }
    if (!response.task || !Array.isArray(response.task.plan) || !response.task.plan.length) {
      return { handled: true, success: false, message: response.message || "LLM 未返回可确认的任务计划。" };
    }
    const task = markBackendLlmTask(normalizeTask(response.task, objective));
    const planValidation = validateTaskPlanAgainstContract(task);
    if (!planValidation.ok) {
      return { handled: true, success: false, message: "任务计划缺少必要修改步骤，尚未执行保存。", planValidation: planValidation };
    }
    task.status = "planned";
    task.current_step_index = 0;
    task.started_at = null;
    task.started_at_ms = null;
    ensureTaskTiming(task);
    addTaskTiming(task, "planning_ms", planningMs);
    addTaskTiming(task, "observe_ms", initialObserveMs);
    addTaskTiming(task, "route_input_ms", Math.max(0, planningStartedAtMs - routeStartedAtMs - initialObserveMs));
    if (planner.raw && planner.raw.usage) {
      task.usage_last = normalizeUsage(planner.raw.usage);
      task.usage_total = normalizeUsage(planner.raw.usage);
    }
    return {
      handled: true,
      success: true,
      llmStatus: "connected",
      agentMode: "llm_enabled",
      message: response.message || "LLM 已整理出可确认的任务计划。",
      task: task,
      usage: task.usage_last || null
    };
  }

  async function executePlannedTask(task, context) {
    if (!task || !Array.isArray(task.plan) || !task.plan.length) {
      return { handled: true, success: false, message: "没有可执行的任务计划。" };
    }
    const settings = context || {};
    const backendUrl = normalizeBackendUrl(settings.backendUrl);
    const existing = retireInactiveTask(loadTask()) || {};
    if (existing && (existing.status === "waiting_user" || existing.status === "running")) {
      return { handled: true, success: false, waiting: true, message: "当前已有任务正在进行或等待补充，请先取消或完成当前任务。" };
    }
    const startedAtMs = Number(settings.taskStartedAtMs || 0) || Date.now();
    const executable = markBackendLlmTask(normalizeTask(JSON.parse(JSON.stringify(task)), task.objective));
    const planValidation = validateTaskPlanAgainstContract(executable);
    if (!planValidation.ok) {
      return rejectInvalidMutationPlan(executable, planValidation);
    }
    executable.status = "running";
    executable.current_step_index = 0;
    markTaskStarted(executable, startedAtMs);
    executable.created_at = executable.created_at || executable.started_at;
    executable.finished_at = null;
    executable.finished_at_ms = null;
    executable.finished_mono_ms = null;
    executable.elapsed_ms = 0;
    ensureTaskTiming(executable);
    executable.timing.total_ms = 0;
    executable.plan = executable.plan.map(function (step, index) {
      return Object.assign({}, step, {
        id: step.id || ("step_" + (index + 1)),
        status: "pending",
        started_at: null,
        started_at_ms: null,
        started_mono_ms: null,
        finished_at: null,
        finished_at_ms: null,
        finished_mono_ms: null,
        elapsed_ms: 0,
        timing: null,
        timing_breakdown: null,
        usage: null,
        usage_source: "local_dom",
        token_source: "local_dom",
        source: BACKEND_LLM_SOURCE
      });
    });
    addProgress(executable, "医生已确认执行语音会话任务计划，开始执行。", { source: "voice_confirmation" });
    saveTask(executable);
    return runTaskLoop({ backendUrl: backendUrl });
  }

  async function continueWaitingTask(activeTask, reply, context) {
    const settings = context || {};
    const backendUrl = normalizeBackendUrl(settings.backendUrl);
    const task = normalizeTask(activeTask, activeTask && activeTask.objective);
    const replyText = String(reply || "").trim();
    if (!replyText) {
      return { handled: true, success: false, waiting: true, message: "当前任务正在等待补充信息，请输入要补充的内容。" };
    }

    task.status = "planning";
    task.clarifications = Array.isArray(task.clarifications) ? task.clarifications : [];
    task.clarifications.push({
      text: replyText,
      at: new Date().toISOString(),
      previous_waiting_for: task.waitingFor || task.waiting_for || (task.slots && task.slots.waitingFor) || ""
    });
    addProgress(task, "收到补充信息，保持原 taskId 并重新请求后端 LLM planner。", {
      route: "continue_active_task",
      clarification_count: task.clarifications.length
    });
    saveTask(task);

    const objective = buildContinuationObjective(task, replyText);
    const fullPatientIndex = settings.fullPatientIndex || getFullPatientIndex();
    const pageState = enrichPageStateWithPatients(settings.pageState || collectPageState(), fullPatientIndex);
    const planner = await callBackend(backendUrl, "/api/universal-agent/task-plan", buildPlannerPayload(objective, {
      pageState: pageState,
      activeTask: task,
      agentMessages: settings.agentMessages,
      speakerTurns: settings.speakerTurns,
      fullPatientIndex: fullPatientIndex,
      connectionStatus: settings.connectionStatus,
      source: settings.source,
      inputRoute: settings.inputRoute
    }));

    if (!planner.ok || !planner.response) {
      task.status = "waiting_user";
      task.lastError = planner.error || "backend_llm_unavailable";
      addProgress(task, "补充信息重新规划失败，继续等待用户。", { error: task.lastError });
      saveTask(task);
      return { handled: true, success: false, waiting: true, message: "LLM 暂时无法根据补充信息继续任务，请稍后重试或取消任务。" };
    }

    const response = planner.response;
    persistTrace("continuation_planner", planner.trace || {}, response);
    addUsage(task, planner.raw && planner.raw.usage, "continuation_planner");

    if (response.kind === "ask_clarification") {
      task.status = "waiting_user";
      task.lastError = response.message || questionFromClarification(response.clarification);
      task.waitingFor = response.clarification && response.clarification.reason || task.waitingFor || "generic_clarification";
      addProgress(task, "LLM 仍需要补充信息。", { clarification: response.clarification || null });
      saveTask(task);
      return { handled: true, success: false, waiting: true, message: task.lastError };
    }

    if (!response.task || !Array.isArray(response.task.plan) || !response.task.plan.length) {
      task.status = "waiting_user";
      task.lastError = response.message || "LLM did not return an executable continuation plan.";
      saveTask(task);
      return { handled: true, success: false, waiting: true, message: task.lastError };
    }

    const nextTask = markBackendLlmTask(normalizeTask(response.task, task.objective));
    const completedSteps = (Array.isArray(task.plan) ? task.plan : []).filter(function (step) {
      return step && step.status === "completed";
    }).map(function (step, index) {
      return Object.assign({}, step, {
        id: step.id || step.step_id || ("completed_before_clarification_" + (index + 1)),
        status: "completed",
        source: BACKEND_LLM_SOURCE
      });
    });
    nextTask.task_id = task.task_id;
    nextTask.objective = task.objective;
    nextTask.created_at = task.created_at;
    nextTask.created_at_ms = task.created_at_ms;
    nextTask.started_at = task.started_at || Date.now() / 1000;
    nextTask.started_at_ms = task.started_at_ms || Date.now();
    nextTask.status = "running";
    nextTask.current_step_index = completedSteps.length;
    nextTask.plan = completedSteps.concat((nextTask.plan || []).map(function (step, index) {
      return Object.assign({}, step, {
        id: step.id || ("continuation_step_" + (index + 1)),
        status: step.status === "completed" ? "completed" : "pending",
        source: BACKEND_LLM_SOURCE
      });
    }));
    nextTask.slots = Object.assign({}, task.slots || {}, nextTask.slots || {});
    nextTask.clarifications = task.clarifications.slice(-12);
    nextTask.progress_messages = (task.progress_messages || []).slice(-40);
    nextTask.step_logs = (task.step_logs || []).slice(-20);
    const continuationUsage = planner.raw && planner.raw.usage;
    nextTask.usage_total = continuationUsage ? sumUsage(task.usage_total, continuationUsage) : (task.usage_total || null);
    nextTask.usage_last = continuationUsage ? normalizeUsage(continuationUsage) : task.usage_last || null;
    nextTask.lastError = "";
    addProgress(nextTask, "补充信息已合并，继续执行同一个任务。", { route: "continue_active_task" });
    saveTask(nextTask);
    return runTaskLoop({ backendUrl: backendUrl });
  }

  function buildContinuationObjective(task, replyText) {
    return [
      "继续同一个 HIS Agent 任务，不要创建新 task。",
      "原任务：" + String(task && task.objective || ""),
      "当前等待：" + String(task && (task.waitingFor || task.waiting_for || task.lastError || "")),
      "用户补充：" + String(replyText || ""),
      "请根据补充信息重新生成结构化计划；如果仍不明确，返回 ask_clarification。"
    ].join("\n");
  }

  async function resume(context) {
    const task = loadTask();
    if (!task) return null;
    if (isExpired(task)) {
      finishTask(task, "failed", "Task expired before it could continue.");
      return { handled: true, success: false, done: true, message: "任务超过 30 分钟未继续，已停止。" };
    }
    if (task.status === "blocked_no_llm") {
      return {
        handled: true,
        success: false,
        waiting: true,
        llmStatus: "disconnected",
        agentMode: "blocked_no_llm",
        message: "任务已因 LLM 未连接而暂停。LLM 恢复后，请手动确认是否继续。"
      };
    }
    if (task.status === "waiting_user" && isLoginConfirmationTask(task) && isInHisContext(collectPageState())) {
      task.status = "running";
      task.lastError = "";
      task.precondition = Object.assign({}, task.precondition || {}, {
        loginProvided: true,
        resumedAfterLoginAt: new Date().toISOString()
      });
      task.slots = task.slots || {};
      task.slots.loginProvided = true;
      task.slots.waitingFor = "";
      addProgress(task, "检测到已进入 HIS Demo，继续原任务。", { precondition: task.precondition });
      saveTask(task);
    }
    return runTaskLoop(context || {});
  }

  function cancel() {
    return cancelActiveTask("用户取消任务。", "legacy_cancel");
  }

  function cancelActiveTask(reason, source) {
    const task = loadTask();
    if (task) {
      finishTask(task, "cancelled", reason || "用户取消任务。", {
        source: source || "user",
        suppressSave: true
      });
      return { handled: true, success: true, taskId: task.task_id || "", status: "cancelled", message: "已取消当前任务，未继续执行页面动作。" };
    }
    clearTask();
    return { handled: true, success: true, taskId: "", status: "cancelled", message: "当前没有正在执行的任务。" };
  }

  function clearActiveTask(reason) {
    const task = loadTask();
    if (task) appendHistory(task, reason || "清空当前 activeTask。");
    clearTask();
    return { handled: true, success: true, message: "已清空当前任务。" };
  }

  function getTask() {
    return retireInactiveTask(loadTask());
  }

  function clearBlockedNoLlmTask() {
    const task = loadTask();
    if (!task || task.status !== "blocked_no_llm") {
      return false;
    }
    appendHistory(task, "LLM connection restored; stale blocked task cleared from UI.");
    clearTask();
    return true;
  }

  function getSummary() {
    const task = retireInactiveTask(loadTask());
    if (!task) return { hasActiveTask: false };
    const completed = task.plan.filter(function (step) { return step.status === "completed"; }).length;
    const current = task.plan[task.current_step_index] || null;
    return {
      hasActiveTask: true,
      taskId: task.task_id || "",
      runId: task.run_id || "",
      objective: task.objective,
      status: task.status,
      waitingFor: task.waitingFor || task.waiting_for || (task.slots && task.slots.waitingFor) || "",
      source: task.source || "",
      currentStep: current ? current.goal || current.id : "",
      currentStepIndex: task.current_step_index,
      totalSteps: task.plan.length,
      completedSteps: completed,
      pendingSteps: Math.max(0, task.plan.length - completed),
      lastError: task.lastError || "",
      elapsedMs: taskElapsedMs(task),
      usageLast: task.usage_last || null,
      usageTotal: task.usage_total || null,
      timing: task.timing || null,
      slots: sanitizeArgs(task.slots || {}),
      clarifications: Array.isArray(task.clarifications) ? task.clarifications.slice(-8) : [],
      auditIds: Array.isArray(task.audit_ids) ? task.audit_ids.slice(-20) : [],
      progressMessages: Array.isArray(task.progress_messages) ? task.progress_messages.slice(-30) : [],
      stepLogs: Array.isArray(task.step_logs) ? task.step_logs.slice(-12) : [],
      plan: task.plan.map(compactStep)
    };
  }

  function getHistory() {
    try {
      return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    } catch (error) {
      return [];
    }
  }

  async function runTaskLoop(context) {
    const task = normalizeTask(loadTask());
    if (!task) return null;
    const backendUrl = normalizeBackendUrl(context && context.backendUrl);

    let guard = 0;
    while (guard < 8) {
      guard += 1;
      if (!isTaskStillActive(task)) {
        return { handled: true, success: true, cancelled: true, message: "任务已取消，忽略晚到的 LLM 状态。" };
      }
      if (!isBackendLlmTask(task)) return blockTaskNoLlm(task, "unavailable", "task_source_not_backend_llm");

      const step = task.plan[task.current_step_index];
      if (!step) return finishSuccess(task);
      if (step.status === "completed") {
        task.current_step_index += 1;
        saveTask(task);
        continue;
      }
      if (!isBackendLlmStep(step)) return blockTaskNoLlm(task, "unavailable", "step_source_not_backend_llm");
      if ((step.actionType || step.action_type) === "verify_patient_store") {
        startStep(task, step);
        const observeStartedAtMs = Date.now();
        const pageState = collectPageState();
        addStepBreakdown(step, "before_observe_ms", Date.now() - observeStartedAtMs);
        const action = withBackendLlmSource({ type: "verify_patient_store", args: step.args || {} }, task, step);
        recordFlowTrace("action_selected", {
          task_id: task.task_id || "",
          step_id: step.id || step.step_id || "",
          task_slots: sanitizeArgs(task.slots || {}),
          resolved_patient: task.slots && task.slots.canonical_patient || task.slots && task.slots.resolved_patient || null,
          action: "verify_patient_store",
          action_payload: sanitizeAction(action),
          page_type: pageState.pageType || getPageType(),
          url: window.location.href
        });
      const actionStartedAtMs = Date.now();
      const result = await executePatientVerifyAction(action, task, step, pageState);
      await applyDemoPacingAfterStep(action, step, result);
      recordActionTiming(step, Date.now() - actionStartedAtMs, result);
        recordFlowTrace("action_executed", {
          task_id: task.task_id || "",
          step_id: step.id || step.step_id || "",
          task_slots: sanitizeArgs(task.slots || {}),
          resolved_patient: task.slots && task.slots.canonical_patient || task.slots && task.slots.resolved_patient || null,
          action: "verify_patient_store",
          action_payload: sanitizeAction(action),
          action_result: result || {},
          page_type: result && result.pageAfter || pageState.pageType || getPageType(),
          url: window.location.href
        });
        persistTrace("action", { selected_action: sanitizeAction(action) }, result);
        if (!result.success) {
          return failStep(task, step, result.error || result.message || "patient-store verification failed.");
        }
        completeStep(task, step, result);
        if (task.current_step_index >= task.plan.length) {
          return finishSuccess(task);
        }
        continue;
      }

      startStep(task, step);
      const observeStartedAtMs = Date.now();
      const pageState = collectPageState();
      addStepBreakdown(step, "before_observe_ms", Date.now() - observeStartedAtMs);
      const decision = decideActionFromBackendStep(task, step, pageState);
      if (decision.waiting || decision.done) return decision;

      recordFlowTrace("action_selected", {
        task_id: task.task_id || "",
        step_id: step.id || step.step_id || "",
        task_slots: sanitizeArgs(task.slots || {}),
        resolved_patient: task.slots && task.slots.canonical_patient || task.slots && task.slots.resolved_patient || null,
        action: decision.action && decision.action.type || "",
        action_payload: sanitizeAction(decision.action || {}),
        page_type: pageState.pageType || getPageType(),
        url: window.location.href
      });
      const actionStartedAtMs = Date.now();
      const result = await executeHarnessAction(decision.action, task, step, pageState);
      await applyDemoPacingAfterStep(decision.action, step, result);
      recordActionTiming(step, Date.now() - actionStartedAtMs, result);
      if (!isTaskStillActive(task)) {
        return { handled: true, success: true, cancelled: true, message: "任务已取消，忽略晚到的页面动作结果。" };
      }
      recordFlowTrace("action_executed", {
        task_id: task.task_id || "",
        step_id: step.id || step.step_id || "",
        task_slots: sanitizeArgs(task.slots || {}),
        resolved_patient: task.slots && task.slots.canonical_patient || task.slots && task.slots.resolved_patient || null,
        action: decision.action && decision.action.type || "",
        action_payload: sanitizeAction(decision.action || {}),
        action_result: result || {},
        page_type: result && result.pageAfter || pageState.pageType || getPageType(),
        url: window.location.href
      });
      persistTrace("action", { selected_action: sanitizeAction(decision.action) }, result);
      if (!result.success) {
        if (result.prevent_repair) {
          return failStep(task, step, result.error || result.message || "动作执行失败。");
        }
        const repaired = await tryRepair(context, task, step, decision.action, result);
        if (!isTaskStillActive(task)) {
          return { handled: true, success: true, cancelled: true, message: "任务已取消，忽略晚到的修复结果。" };
        }
        return repaired || failStep(task, step, result.error || result.message || "动作执行失败。");
      }
      if (result.defer_step_completion && result.navigation_happened) {
        step.result = result;
        addProgress(task, "正在打开并等待页面确认：" + (step.goal || step.id || step.actionType || "step"), {
          step: compactStep(step),
          actionResult: result
        });
        saveTask(task);
        return { handled: true, success: true, navigated: true, message: result.observation || "页面跳转后会验证目标上下文。" };
      }
      completeStep(task, step, result);
      if (task.current_step_index >= task.plan.length && !result.navigation_happened) {
        return finishSuccess(task);
      }
      if (result.navigation_happened) {
        saveTask(task);
        return { handled: true, success: true, navigated: true, message: result.observation || "页面跳转后会继续执行。" };
      }
    }

    saveTask(task);
    return { handled: true, success: true, message: "任务状态已保存，等待下一轮观察。" };
  }

  function decideActionFromBackendStep(task, step, pageState) {
    const pageType = pageState.pageType || getPageType();
    const actionType = step.actionType || step.action_type;
    const args = step.args || {};
    if (actionType === "ask_clarification") {
      return waitStep(task, step, args.question || step.goal || "需要补充信息后才能继续。");
    }
    if (actionType === "submit_login" && pageType !== "login" && isInHisContext(pageState)) {
      return { action: withBackendLlmSource({ type: "noop", args: { verifiedLogin: true } }, task, step) };
    }
    if (actionType === "find_patient" || actionType === "select_patient") {
      const found = resolvePatient(extractPatientSelector(args, step, task), task, step);
      if (found.status === "ambiguous") return waitStep(task, step, "找到多个匹配患者，请补充 patientId。");
      if (!found.patient) return waitStep(task, step, PATIENT_NOT_FOUND_MESSAGE, { patientResolver: found });
      return { action: withBackendLlmSource({ type: "select_patient", args: { patient: found.patient } }, task, step) };
    }
    if (actionType === "open_patient_editor") {
      const found = ensureResolvedPatient(task, step, args, pageState);
      if (found.status === "ambiguous") return waitStep(task, step, "找到多个匹配患者，请补充 patientId。");
      const patient = found.patient;
      if (!patient) return waitStep(task, step, PATIENT_NOT_FOUND_MESSAGE, { patientResolver: found });
      const context = patientEditorContext(pageState);
      if (pageType === "patientEditor" && patientEditorContextMatches(context, patient)) {
        return { action: withBackendLlmSource({ type: "noop", args: { verifiedPatient: compactPatient(patient), pagePatient: context } }, task, step) };
      }
      return { action: withBackendLlmSource({ type: "open_patient_editor", args: { patientId: patient.patientId }, continue_after_navigation: true }, task, step) };
    }
    if (actionType === "verify_patient_store") {
      const found = ensureResolvedPatient(task, step, args, pageState);
      if (found.status === "ambiguous") return waitStep(task, step, "找到多个匹配患者，请补充 patientId。");
      if (!found.patient) return waitStep(task, step, PATIENT_NOT_FOUND_MESSAGE, { patientResolver: found });
      args.patientId = found.patient.patientId;
      return { action: withBackendLlmSource({ type: "verify_patient_store", args: args }, task, step) };
    }
    if (actionType === "update_patient_field" || actionType === "update_patient_fields" || actionType === "save_patient" || actionType === "verify_patient_field" || actionType === "verify_patient_store" || actionType === "create_structured_draft" || actionType === "write_clinical_note_field") {
      const found = ensureResolvedPatient(task, step, args, pageState);
      if (found.status === "ambiguous") return waitStep(task, step, "找到多个匹配患者，请补充 patientId。");
      if (found.patient) {
        const context = patientEditorContext(pageState);
        if (pageType !== "patientEditor" || !patientEditorContextMatches(context, found.patient)) {
          return { action: withBackendLlmSource({ type: "open_patient_editor", args: { patientId: found.patient.patientId }, continue_after_navigation: true }, task, step) };
        }
        args.patientId = found.patient.patientId;
      } else {
        return waitStep(task, step, PATIENT_NOT_FOUND_MESSAGE, { patientResolver: found });
      }
    }
    if (step.requiredPage && step.requiredPage !== pageType) {
      return { action: withBackendLlmSource(routeToPage(step.requiredPage), task, step) };
    }
    return { action: withBackendLlmSource({ type: actionType || "noop", args: args, continue_after_navigation: Boolean(step.continue_after_navigation) }, task, step) };
  }

  async function executeHarnessAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    const type = action && action.type;
    if (!isBackendLlmTask(task) || !isBackendLlmStep(step) || !action || action.source !== BACKEND_LLM_SOURCE) {
      return actionResult(false, type || "unknown", pageBefore, "", [], false, "Agent action blocked: backend LLM source required.");
    }
    if (!ALLOWED_ACTIONS.has(type)) {
      return actionResult(false, type, pageBefore, "", [], false, "Action is not in allowlist.");
    }

    const args = action.args || {};
    if (type === "update_patient_field") {
      return await executePatientFieldUpdateAction(action, task, step, pageState);
    }
    if (type === "update_patient_fields") {
      return await executePatientFieldsUpdateAction(action, task, step, pageState);
    }
    if (type === "save_patient") {
      return await executePatientSaveAction(action, task, step, pageState);
    }
    if (type === "verify_patient_field" || type === "verify_patient_store") {
      return await executePatientVerifyAction(action, task, step, pageState);
    }
    if (type === "create_structured_draft") {
      return await executeStructuredDraftAction(action, task, step, pageState);
    }
    if (type === "write_clinical_note_field") {
      return await executeClinicalNoteFieldAction(action, task, step, pageState);
    }
    if (type === "fill_login_form") {
      const parsed = normalizeLoginCredentials(args, { allowExisting: false });
      if (!parsed.ok) {
        return actionResult(false, type, pageBefore, pageBefore, [], false, parsed.message, parsed.message, {
          prevent_repair: true,
          login: parsed.summary
        });
      }
      const login = parsed.credentials;
      if (isLoginFormAlreadyReady(pageState, login)) {
        return actionResult(true, type, pageBefore, getPageType(), [], false, "", "登录表单已填写正确，跳过重复输入。", {
          login: readLoginFormSnapshot(login)
        });
      }
      const formResult = await applyPageAction({ type: "fill_login_form", args: login });
      const snapshot = readLoginFormSnapshot(login);
      if (formResult && formResult.handled) {
        const ok = Boolean(formResult.success && snapshot.username_matches_requested && snapshot.password_matches_requested);
        return actionResult(ok, type, pageBefore, getPageType(), [], false, ok ? "" : (formResult.message || "登录表单填写结果与请求不一致。"), ok ? (formResult.message || "已填写登录表单。") : "登录表单填写结果与请求不一致。", {
          prevent_repair: !ok,
          login: snapshot
        });
      }
      const a = await applyPageAction({ type: "fill_input", target: { selector: "#loginAccountInput" }, value: login.username });
      const b = await applyPageAction({ type: "fill_input", target: { selector: "#loginPasswordInput" }, value: login.password });
      const fallbackSnapshot = readLoginFormSnapshot(login);
      const ok = Boolean(a.success && b.success && fallbackSnapshot.username_matches_requested && fallbackSnapshot.password_matches_requested);
      return actionResult(ok, type, pageBefore, getPageType(), [], false, ok ? "" : "填写登录表单失败。", ok ? "已填写登录表单。" : "填写登录表单失败。", {
        prevent_repair: !ok,
        login: fallbackSnapshot
      });
    }
    if (type === "submit_login") {
      const parsed = normalizeLoginCredentials(args, { allowExisting: true });
      if (!parsed.ok) {
        return actionResult(false, type, pageBefore, pageBefore, [], false, parsed.message, parsed.message, {
          prevent_repair: true,
          login: parsed.summary
        });
      }
      const requested = parsed.credentials;
      const beforeSubmitSnapshot = readLoginFormSnapshot(requested);
      if (requested && (!beforeSubmitSnapshot.username_matches_requested || !beforeSubmitSnapshot.password_matches_requested)) {
        return actionResult(false, type, pageBefore, pageBefore, [], false, "登录表单内容与请求不一致，未提交。", "登录表单内容与请求不一致，未提交。", {
          prevent_repair: true,
          login: beforeSubmitSnapshot
        });
      }
      const urlBefore = window.location.href;
      const dispatchStartedAtMs = Date.now();
      const result = await applyPageAction({ type: "submit_login", args: requested || {} });
      const dispatchMs = Date.now() - dispatchStartedAtMs;
      const verifyStartedAtMs = Date.now();
      const outcome = await waitForLoginPostcondition(urlBefore, requested, result);
      const verifyMs = Math.max(1, Date.now() - verifyStartedAtMs);
      const loginTiming = {
        execute_ms: dispatchMs,
        verify_ms: verifyMs,
        page_navigation_ms: outcome.navigation_happened ? verifyMs : 0
      };
      if (!outcome.success) {
        return actionResult(false, type, pageBefore, outcome.pageType || getPageType(), [], outcome.navigation_happened, LOGIN_FAILURE_MESSAGE, LOGIN_FAILURE_MESSAGE, {
          prevent_repair: true,
          login: outcome.login,
          postcondition: outcome,
          timing_breakdown: loginTiming
        });
      }
      return actionResult(true, type, pageBefore, outcome.pageType || getPageType(), [], outcome.navigation_happened, "", "登录成功，已进入 HIS。", {
        defer_step_completion: Boolean(outcome.pending_navigation),
        login: outcome.login,
        postcondition: outcome,
        timing_breakdown: loginTiming
      });
    }
    if (type === "open_page" || type === "navigate_internal" || type === "navigate") {
      const page = args.page || action.page || action.value;
      const target = pageToUrl(page);
      if (!target) return actionResult(false, type, pageBefore, "", [], false, "导航目标不是 HIS 内部页面。");
      const animationStartedAtMs = Date.now();
      await markAgentNavigationTarget(page);
      const animationMs = Date.now() - animationStartedAtMs;
      window.setTimeout(function () { window.location.href = target; }, 170);
      return actionResult(true, type, pageBefore, page, [], true, "", "正在打开 " + page + "。", {
        timing_breakdown: { animation_ms: animationMs, page_navigation_ms: 170 }
      });
    }
    if (type === "select_patient") {
      const patient = args.patient;
      return actionResult(Boolean(patient), type, pageBefore, pageBefore, [], false, patient ? "" : "患者未定位。", patient ? "已定位患者：" + formatPatient(patient) : "");
    }
    if (type === "open_patient_editor") {
      if (!args.patientId) return actionResult(false, type, pageBefore, "", [], false, "缺少 patientId。");
      const animationStartedAtMs = Date.now();
      await markPatientRow(args.patientId);
      const animationMs = Date.now() - animationStartedAtMs;
      window.setTimeout(function () { window.location.href = "patient-editor.html?patientId=" + encodeURIComponent(args.patientId); }, 170);
      return actionResult(true, type, pageBefore, "patientEditor", [], true, "", "正在打开患者编辑页。", {
        defer_step_completion: true,
        expected_patient: { patientId: String(args.patientId || "").toUpperCase() },
        timing_breakdown: { animation_ms: animationMs, page_navigation_ms: 170 }
      });
    }
    if (type === "update_patient_field") {
      const normalized = normalizeUpdate(args.field, args.value);
      if (!normalized) return actionResult(false, type, pageBefore, pageBefore, [], false, "字段不可编辑或值无法归一。");
      const result = await applyPageAction(Object.assign({}, fieldToPageAction(normalized.field, normalized.value), auditMeta(task, step, "backend_llm")));
      return actionResult(Boolean(result.success), type, pageBefore, pageBefore, [normalized.field], false, result.success ? "" : result.message, result.message || "字段已更新。", {
        field: normalized.field
      });
    }
    if (type === "update_patient_fields") {
      const updates = Array.isArray(args.updates) ? args.updates : [];
      const changed = [];
      let demoDelayMs = 0;
      for (const item of updates) {
        const normalized = normalizeUpdate(item.field, item.value);
        if (!normalized) return actionResult(false, type, pageBefore, pageBefore, changed, false, "updates 中包含不可编辑字段。");
        if (changed.length) {
          demoDelayMs += await waitDemoPacing("field");
        }
        const result = await applyPageAction(Object.assign({}, fieldToPageAction(normalized.field, normalized.value), auditMeta(task, step, "backend_llm")));
        if (!result.success) return actionResult(false, type, pageBefore, pageBefore, changed, false, result.message || "字段更新失败。");
        changed.push(normalized.field);
      }
      return actionResult(true, type, pageBefore, pageBefore, changed, false, "", "已更新患者字段。", {
        timing_breakdown: demoDelayMs ? { demo_delay_ms: demoDelayMs, animation_ms: demoDelayMs } : null
      });
    }
    if (type === "save_patient") {
      const result = await applyPageAction(Object.assign({ type: "save_patient" }, auditMeta(task, step, "backend_llm")));
      return actionResult(Boolean(result.success), type, pageBefore, pageBefore, [], false, result.success ? "" : result.message, result.message || "已保存。");
    }
    if (type === "finish_task" || type === "verify_patient_field" || type === "verify_patient_store" || type === "noop") {
      return actionResult(true, type, pageBefore, pageBefore, [], false, "", "已完成校验。");
    }
    return actionResult(false, type, pageBefore, pageBefore, [], false, "未实现的 allowlist action。");
  }

  async function executePatientFieldUpdateAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    const args = action.args || {};
    const normalized = normalizeStructuredUpdate(args, task);
    if (!normalized.ok) {
      addProgress(task, "字段解析或取值校验失败：" + normalized.message, { fieldResolver: normalized.fieldResolver || null, action: sanitizeAction(action) });
      return actionResult(false, action.type, pageBefore, pageBefore, [], false, normalized.message, normalized.message);
    }
    addProgress(task, "使用旧编辑页 action adapter 修改" + normalized.fieldLabel, { action: sanitizeAction(action), fieldResolver: normalized.fieldResolver });
    const result = await applyPageAction(Object.assign({
      type: "update_patient_field",
      args: { field: normalized.field, value: normalized.value },
      target: { field: normalized.field },
      value: normalized.value
    }, auditMeta(task, step, BACKEND_LLM_SOURCE)));
    if (result && result.success) {
      addProgress(task, "正在修改" + normalized.fieldLabel + "：" + stringifyValue(result.oldValue) + " -> " + stringifyValue(result.newValue || normalized.value), { adapterResult: compactAdapterResult(result) });
      if (result.eventsDispatched && result.eventsDispatched.length) addProgress(task, "已触发表单 " + result.eventsDispatched.join("/") + " 事件", { adapterResult: compactAdapterResult(result) });
      addProgress(task, "已填写页面字段，等待保存流程写入 patient-store", { changedFields: result.changedFields || [normalized.field] });
      recordAppliedMutation(task, normalized, result, step);
    }
    return actionResult(Boolean(result && result.success), action.type, pageBefore, pageBefore, [normalized.field], false, result && result.success ? "" : result && result.message, result && result.message || "字段已更新。", result && result.success ? buildActionTelemetry(result, task, step) : {});
  }

  async function executePatientFieldsUpdateAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    const args = action.args || {};
    const updates = Array.isArray(args.updates) ? args.updates : [];
    const changed = [];
    for (const item of updates) {
      const result = await executePatientFieldUpdateAction(Object.assign({}, action, { type: "update_patient_field", args: item || {} }), task, step, pageState);
      if (!result.success) return actionResult(false, action.type, pageBefore, pageBefore, changed, false, result.message || result.error || "字段批量更新失败。", result.message || result.error || "");
      changed.push.apply(changed, result.changed_fields || []);
    }
    return actionResult(true, action.type, pageBefore, pageBefore, changed, false, "", "已更新患者字段。");
  }

  async function executePatientSaveAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    const precondition = validateSavePreconditions(task, pageState);
    if (!precondition.ok) {
      addProgress(task, "保存被阻止：" + precondition.message, { code: precondition.code, mutationLedger: task.mutation_ledger || null });
      return actionResult(false, action.type, pageBefore, pageBefore, [], false, precondition.message, precondition.message, {
        prevent_repair: true,
        code: precondition.code,
        mutation_ledger: task.mutation_ledger || null
      });
    }
    addProgress(task, "正在保存 / 同步患者信息", { action: sanitizeAction(action) });
    const result = await applyPageAction(Object.assign({ type: "save_patient", args: action.args || {} }, auditMeta(task, step, BACKEND_LLM_SOURCE)));
    if (result && result.success) addProgress(task, "保存 / 同步完成", { adapterResult: compactAdapterResult(result) });
    if (result && result.success) {
      const saved = recordSaveResult(task, result);
      if (!saved.ok) {
        addProgress(task, "保存结果校验失败：" + saved.message, { code: saved.code, adapterResult: compactAdapterResult(result), mutationLedger: task.mutation_ledger || null });
        return actionResult(false, action.type, pageBefore, pageBefore, result.changedFields || [], false, saved.message, saved.message, {
          prevent_repair: true,
          code: saved.code,
          mutation_ledger: task.mutation_ledger || null,
          adapterResult: compactAdapterResult(result)
        });
      }
    }
    return actionResult(Boolean(result && result.success), action.type, pageBefore, pageBefore, result && (result.changedFields || result.changed_fields) || [], false, result && result.success ? "" : result && result.message, result && result.message || "已保存。", result && result.success ? buildActionTelemetry(result, task, step) : {});
  }

  async function executePatientVerifyAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    addProgress(task, "正在校验患者字段或 patient-store", { action: sanitizeAction(action) });
    if (action.type === "verify_patient_store") {
      const storeResult = verifyExpectedMutationsInStore(task);
      if (storeResult.success) addProgress(task, "patient-store 校验通过", { storeVerification: storeResult });
      return actionResult(Boolean(storeResult.success), action.type, pageBefore, pageBefore, [], false, storeResult.success ? "" : storeResult.message, storeResult.message, storeResult);
    }
    const result = await applyPageAction(Object.assign({ type: action.type, args: action.args || {} }, auditMeta(task, step, BACKEND_LLM_SOURCE)));
    if (result && result.success) addProgress(task, "校验通过", { adapterResult: compactAdapterResult(result) });
    if (action.type === "verify_patient_field" && result && result.success) {
      recordVerifiedMutation(task, action, result, step);
    }
    if (action.type === "verify_patient_field" && !(result && result.success)) {
      const satisfied = verifyExpectedFieldAlreadySatisfied(action, task, pageState, result);
      if (satisfied && satisfied.success) {
        addProgress(task, "校验通过", { adapterResult: compactAdapterResult(satisfied) });
        recordVerifiedMutation(task, action, satisfied, step);
        return actionResult(true, action.type, pageBefore, pageBefore, [], false, "", satisfied.message || "已完成校验。", buildActionTelemetry(satisfied, task, step));
      }
    }
    return actionResult(Boolean(result && result.success), action.type, pageBefore, pageBefore, [], false, result && result.success ? "" : result && result.message, result && result.message || "已完成校验。", result ? buildActionTelemetry(result, task, step) : {});
  }

  async function executeStructuredDraftAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    const draft = normalizeClinicalDraftArgs(action.args || {}, task);
    if (!draft.ok) {
      addProgress(task, "病历草稿生成失败：" + draft.message, { action: sanitizeAction(action), fieldResolver: draft.fieldResolver || null });
      return actionResult(false, action.type, pageBefore, pageBefore, [], false, draft.message, draft.message);
    }
    const draftPatient = clinicalDraftPatientContext(action.args || {}, task);
    task.slots = task.slots || {};
    task.slots.structured_draft = {
      patientId: draftPatient.patientId,
      patientName: draftPatient.patientName,
      field: draft.field,
      fieldLabel: draft.fieldLabel,
      text: draft.text,
      createdAt: new Date().toISOString()
    };
    addProgress(task, "已生成病历草稿：" + truncateText(draft.text, 240), {
      draft: {
        patientId: draftPatient.patientId,
        patientName: draftPatient.patientName,
        field: draft.field,
        fieldLabel: draft.fieldLabel,
        text: draft.text
      },
      action: sanitizeAction(action)
    });
    return actionResult(true, action.type, pageBefore, pageBefore, [], false, "", "已生成病历草稿，等待医生确认或后续写入。", {
      draft_text: draft.text,
      draft_field: draft.field,
      fieldLabel: draft.fieldLabel,
      patientId: draftPatient.patientId,
      patientName: draftPatient.patientName
    });
  }

  async function executeClinicalNoteFieldAction(action, task, step, pageState) {
    const pageBefore = pageState.pageType || getPageType();
    const draft = normalizeClinicalDraftArgs(action.args || {}, task);
    if (!draft.ok) {
      addProgress(task, "病历字段写入失败：" + draft.message, { action: sanitizeAction(action), fieldResolver: draft.fieldResolver || null });
      return actionResult(false, action.type, pageBefore, pageBefore, [], false, draft.message, draft.message);
    }
    addProgress(task, "正在写入病历字段：" + draft.fieldLabel, {
      action: sanitizeAction(action),
      draft: { field: draft.field, fieldLabel: draft.fieldLabel }
    });
    const result = await executePatientFieldUpdateAction(Object.assign({}, action, {
      type: "update_patient_field",
      args: {
        field: draft.field,
        fieldLabel: draft.fieldLabel,
        value: draft.text
      }
    }), task, step, pageState);
    return Object.assign({}, result, {
      action_type: action.type,
      draft_field: draft.field,
      draft_text: draft.text
    });
  }

  function normalizeStructuredUpdate(args, task) {
    const fieldSelector = {
      field: args && (args.field || args.fieldKey),
      fieldLabel: args && args.fieldLabel,
      query: args && args.query
    };
    const resolved = resolvePatientField(fieldSelector, task);
    if (!resolved.ok || !EDITABLE_FIELDS.has(resolved.field)) {
      return { ok: false, message: "field_not_found: " + (resolved.query || (args && (args.field || args.fieldLabel || args.query)) || ""), fieldResolver: resolved };
    }
    let next = args && args.value != null ? String(args.value).trim() : "";
    if (!next) return { ok: false, message: "invalid_value: 字段值不能为空", fieldResolver: resolved };
    if (resolved.field === "birthDate") next = normalizeDate(next);
    if ((resolved.field === "phone" || resolved.field === "emergencyPhone")) {
      next = next.replace(/\s+/g, "");
      if (!/^1\d{10}$/.test(next)) return { ok: false, message: "invalid_value: " + resolved.fieldLabel + "必须是 11 位手机号", fieldResolver: resolved };
    }
    return { ok: true, field: resolved.field, fieldLabel: resolved.fieldLabel || resolved.field, value: next, fieldResolver: resolved };
  }

  function normalizeClinicalDraftArgs(args, task) {
    const source = args || {};
    const draftText = firstNonEmpty(
      source.draftText,
      source.draft_text,
      source.content,
      source.text,
      source.note,
      source.value
    );
    if (!draftText) {
      return { ok: false, message: "draft_text_missing: create_structured_draft 需要 draftText/content/text" };
    }
    const fieldInput = source.field || source.targetField || source.target_field || source.fieldLabel || "note";
    const resolved = resolvePatientField({ field: fieldInput, fieldLabel: source.fieldLabel, query: source.query }, task);
    if (!resolved.ok || !EDITABLE_FIELDS.has(resolved.field)) {
      return { ok: false, message: "field_not_found: " + (resolved.query || fieldInput || ""), fieldResolver: resolved };
    }
    if (!CLINICAL_NOTE_FIELDS.has(resolved.field)) {
      return { ok: false, message: "not_clinical_note_field: " + (resolved.fieldLabel || resolved.field), fieldResolver: resolved };
    }
    return {
      ok: true,
      field: resolved.field,
      fieldLabel: resolved.fieldLabel || resolved.field,
      text: String(draftText).trim(),
      fieldResolver: resolved
    };
  }

  function clinicalDraftPatientContext(args, task) {
    const source = args || {};
    const selector = extractPatientSelector(source, null, task, { includeTaskSlots: true, allowGenericName: true }) || {};
    const resolved = task && task.slots && task.slots.resolved_patient || {};
    const patientId = String(
      source.patientId ||
      source.patient_id ||
      selector.patientId ||
      selector.patient_id ||
      resolved.patientId ||
      task && task.slots && task.slots.target_patient_id ||
      ""
    ).toUpperCase();
    const patientName = String(
      source.patientName ||
      source.patient_name ||
      selector.name ||
      selector.patientName ||
      selector.patient_name ||
      resolved.name ||
      ""
    );
    return { patientId: patientId, patientName: patientName };
  }

  function firstNonEmpty() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  async function tryRepair(context, task, step, action, result) {
    const backendUrl = normalizeBackendUrl(context && context.backendUrl);
    const repairPayload = buildRepairPayload(task, enrichPageStateWithPatients(collectPageState(), getFullPatientIndex()), action, result);
    const repair = await callBackend(backendUrl, "/api/universal-agent/task-repair", repairPayload);
    if (!repair.ok || !repair.response) return null;
    persistTrace("repair", repair.trace || {}, repair.response);
    addUsage(task, repair.raw && repair.raw.usage, "repair");
    if (repair.raw && repair.raw.usage) addProgress(task, "LLM repair 返回修正动作；Token：" + formatUsage(repair.raw.usage), { usage: repair.raw.usage, stage: "repair" });
    if (repair.response.kind === "ask_clarification") return waitStep(task, step, repair.response.message || questionFromClarification(repair.response.clarification));
    if (repair.response.kind === "corrected_action" && repair.response.action) {
      const retry = await executeHarnessAction(withBackendLlmSource(repair.response.action, task, step), task, step, collectPageState());
      if (retry.success) {
        completeStep(task, step, retry);
        return retry.navigation_happened ? { handled: true, success: true, navigated: true, message: retry.observation } : runTaskLoop(context || {});
      }
    }
    return null;
  }

  async function checkLlmConnected(backendUrl) {
    if (!backendUrl) return { connected: false, status: "disconnected", error: "backend_url_missing" };
    try {
      let response = await fetch(backendUrl + "/api/llm/test", { method: "GET" });
      if (response.status === 404) {
        response = await fetch(backendUrl + "/api/qwen/test", { method: "GET" });
      }
      const data = await response.json().catch(function () { return {}; });
      if (response.ok && data.ok) return { connected: true, status: "connected", data: data };
      const error = data.error || ("HTTP " + response.status);
      return { connected: false, status: response.status === 400 ? "not_configured" : "unavailable", error: error };
    } catch (error) {
      return { connected: false, status: "disconnected", error: error.message };
    }
  }

  async function callBackend(backendUrl, path, payload) {
    if (!backendUrl) return { ok: false, error: "backend_url_missing" };
    try {
      const response = await fetch(backendUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(function () { return {}; });
      if (response.ok && data.ok && data.response) return { ok: true, response: data.response, trace: data.trace || {}, raw: data };
      return { ok: false, error: data.error || data.message || ("HTTP " + response.status), trace: data.trace || {}, raw: data };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function blockTaskNoLlm(task, llmStatus, reason) {
    task.status = "blocked_no_llm";
    task.llmStatus = llmStatus || "disconnected";
    task.agentMode = "blocked_no_llm";
    task.lastError = reason || "LLM unavailable";
    addProgress(task, "LLM 连接不可用，任务已暂停且不会执行页面动作：" + (reason || llmStatus || "unknown"), { llmStatus: llmStatus || "disconnected" });
    saveTask(task);
    return blockedNoLlmResult();
  }

  function blockedNoLlmResult() {
    return {
      handled: true,
      success: false,
      waiting: true,
      llmStatus: "disconnected",
      agentMode: "blocked_no_llm",
      message: noLlmMessage()
    };
  }

  function plannerFailureResult(task) {
    return {
      handled: true,
      success: false,
      done: true,
      llmStatus: "connected",
      agentMode: "llm_enabled",
      message: task && task.lastError ? task.lastError : "任务规划失败，未执行任何页面动作。"
    };
  }

  function noLlmMessage() {
    return "当前 LLM 未连接，Agent 无法理解并执行任务。你仍可以手动使用页面按钮和表单。";
  }

  function buildBlockedNoLlmTask(objective, reason) {
    return {
      task_id: makeTaskId(),
      objective: String(objective || ""),
      status: "blocked_no_llm",
      source: BACKEND_LLM_SOURCE,
      llmStatus: "disconnected",
      agentMode: "blocked_no_llm",
      slots: {},
      plan: [],
      current_step_index: 0,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
      lastError: reason || "backend_llm_unavailable"
    };
  }

  function buildPlannerFailureTask(objective, reason, runId) {
    const message = "任务规划失败，未执行任何页面动作：" + (reason || "backend_planner_failed");
    const now = Date.now();
    return {
      task_id: makeTaskId(),
      run_id: runId || "",
      objective: String(objective || ""),
      status: "failed",
      source: BACKEND_LLM_SOURCE,
      llmStatus: "connected",
      agentMode: "llm_enabled",
      slots: {},
      plan: [{
        id: "planner_failed",
        goal: "生成任务计划",
        actionType: "task_plan",
        status: "failed",
        source: BACKEND_LLM_SOURCE,
        error: message
      }],
      current_step_index: 0,
      created_at: now / 1000,
      created_at_ms: now,
      updated_at: now / 1000,
      lastError: message
    };
  }

  function markBackendLlmTask(task) {
    task.source = BACKEND_LLM_SOURCE;
    task.agentMode = "llm_enabled";
    task.llmStatus = "connected";
    task.plan = task.plan.map(function (step, index) {
      return Object.assign({}, step, {
        id: step.id || ("step_" + (index + 1)),
        status: step.status || "pending",
        source: BACKEND_LLM_SOURCE
      });
    });
    return task;
  }

  function enforceLoginPrecondition(task, pageState) {
    if (!task || !isLoginPageUnauthenticated(pageState) || !taskNeedsAuthenticatedContext(task)) {
      return null;
    }
    if (hasSubmitLoginBeforeProtectedStep(task)) {
      task.slots = task.slots || {};
      task.slots.requiresLogin = true;
      task.slots.loginProvided = true;
      return null;
    }
    const credentials = getStructuredLoginCredentials(task);
    if (credentials) {
      prependDemoLoginSteps(task, credentials, "LLM 已提供登录信息，补齐登录前置步骤。");
      return null;
    }

    task.status = "waiting_user";
    task.precondition = {
      type: "requires_login",
      requiresLogin: true,
      currentPage: "login",
      loginProvided: false,
      canUseDemoLogin: true,
      message: loginPreconditionMessage()
    };
    task.lastError = task.precondition.message;
    task.slots = task.slots || {};
    task.slots.requiresLogin = true;
    task.slots.loginProvided = false;
    task.slots.waitingFor = "demo_login_confirmation";
    addProgress(task, "登录前置条件未满足：当前在 login 页面，任务需要进入 HIS 后执行。", { precondition: task.precondition });
    saveTask(task);
    return {
      handled: true,
      success: false,
      waiting: true,
      message: task.precondition.message,
      precondition: task.precondition
    };
  }

  function handleLoginPreconditionReply(task, objective) {
    const decision = classifyLoginPreconditionReply(objective);
    if (decision === "deny") {
      finishTask(task, "cancelled", "用户未确认使用 Demo 登录，任务已取消。");
      return { handled: true, success: true, done: true, message: "已取消等待登录确认的任务。" };
    }
    if (decision !== "confirm") {
      const message = loginPreconditionMessage();
      task.lastError = message;
      task.precondition = Object.assign({}, task.precondition || {}, { message: message });
      addProgress(task, "仍在等待登录确认。", { precondition: task.precondition });
      saveTask(task);
      return { handled: true, success: false, waiting: true, message: message };
    }

    prependDemoLoginSteps(task, { username: "123", password: "123", useDemo: true }, "用户确认使用 Demo 默认账号密码后继续。");
    task.status = "running";
    task.lastError = "";
    task.precondition = Object.assign({}, task.precondition || {}, {
      loginProvided: true,
      confirmedAt: new Date().toISOString()
    });
    task.slots = task.slots || {};
    task.slots.loginProvided = true;
    task.slots.useDemoLogin = true;
    task.slots.waitingFor = "";
    addProgress(task, "已确认使用 Demo 默认账号密码，开始执行登录前置步骤。", { precondition: task.precondition });
    saveTask(task);
    return { resume: true };
  }

  function isLoginConfirmationTask(task) {
    if (!task || task.status !== "waiting_user") return false;
    if (task.precondition && task.precondition.type === "requires_login") return true;
    if (task.slots && task.slots.waitingFor === "demo_login_confirmation") return true;
    const text = String(task.lastError || task.objective || "");
    return /Demo|123\/123|登录|登錄|login/i.test(text);
  }

  function isLoginPageUnauthenticated(pageState) {
    const state = pageState || {};
    const loginState = state.loginState || {};
    return (state.pageType || getPageType()) === "login" && !state.hisDemoAuthenticated && !state.isInHisContext && !loginState.isDemoLoggedIn && !loginState.authenticated;
  }

  function isLoginFormAlreadyReady(pageState, credentials) {
    const domSnapshot = readLoginFormSnapshot(credentials);
    if (domSnapshot.available) {
      return domSnapshot.username_matches_requested && domSnapshot.password_matches_requested;
    }
    const state = pageState || {};
    const loginState = state.loginState || {};
    const formFields = state.formFields || {};
    const accountValue = String(loginState.usernameValue || (formFields.account && formFields.account.value) || "");
    const expectedAccount = String((credentials && (credentials.username || credentials.account)) || "");
    const expectedPassword = String((credentials && Object.prototype.hasOwnProperty.call(credentials, "password") ? credentials.password : "") || "");
    const accountMatches = accountValue === expectedAccount;
    const passwordMatches = expectedPassword === "123"
      ? Boolean(loginState.passwordMatchesDemo || loginState.formReadyForDemoLogin)
      : false;
    return (state.pageType || getPageType()) === "login" && accountMatches && passwordMatches;
  }

  function normalizeLoginCredentials(args, options) {
    const source = args || {};
    const opts = options || {};
    const hasUsername = Object.prototype.hasOwnProperty.call(source, "username") || Object.prototype.hasOwnProperty.call(source, "account");
    const hasPassword = Object.prototype.hasOwnProperty.call(source, "password");
    const useDemo = Boolean(source.useDemo || source.use_demo);
    const summary = {
      requested_username: hasUsername ? String(source.username !== undefined ? source.username : source.account) : "",
      password_provided: hasPassword,
      use_demo: useDemo
    };
    if (useDemo) {
      return {
        ok: true,
        credentials: { username: "123", password: "123", useDemo: true },
        summary: Object.assign({}, summary, { requested_username: "123", password_provided: true, use_demo: true })
      };
    }
    if (opts.allowExisting && !hasUsername && !hasPassword) {
      return { ok: true, credentials: null, summary: summary };
    }
    if (!hasUsername || !hasPassword) {
      return {
        ok: false,
        message: "缺少账号或密码，不能自动使用 Demo 默认账号。",
        summary: summary
      };
    }
    return {
      ok: true,
      credentials: {
        username: String(source.username !== undefined ? source.username : source.account),
        password: String(source.password)
      },
      summary: summary
    };
  }

  function readLoginFormSnapshot(credentials) {
    const account = document.querySelector("#loginAccountInput");
    const password = document.querySelector("#loginPasswordInput");
    const requestedUsername = credentials ? String(credentials.username !== undefined ? credentials.username : credentials.account || "") : "";
    const hasRequestedPassword = Boolean(credentials && Object.prototype.hasOwnProperty.call(credentials, "password"));
    const requestedPassword = hasRequestedPassword ? String(credentials.password) : "";
    const usernameValue = account ? String(account.value || "") : "";
    const passwordValue = password ? String(password.value || "") : "";
    return {
      available: Boolean(account && password),
      requested_username: requestedUsername,
      username_dom_value: usernameValue,
      username_matches_requested: credentials ? usernameValue === requestedUsername : null,
      password_filled: Boolean(passwordValue),
      password_matches_requested: credentials ? passwordValue === requestedPassword : null
    };
  }

  function getLoginFailureText() {
    const node = document.querySelector("#loginMessage");
    const text = node ? String(node.textContent || "").trim() : "";
    if (!text) return "";
    const className = node.className || "";
    if (/\berror\b/.test(className) || /错误|不正确|失败/.test(text)) return text;
    return "";
  }

  function getLoginSuccessText() {
    const node = document.querySelector("#loginMessage");
    const text = node ? String(node.textContent || "").trim() : "";
    if (!text) return "";
    const className = node.className || "";
    if (/\bsuccess\b/.test(className) || /登录成功|进入 HIS/.test(text)) return text;
    return "";
  }

  function readAuthFlag() {
    try {
      return window.localStorage && window.localStorage.getItem("hisDemoAuthenticated") === "true";
    } catch (error) {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, Number(ms || 0));
    });
  }

  function demoPacingConfig() {
    if (window.__HIS_AGENT_FAST_ANIMATION__) {
      return { enabled: false, stepDelayMs: 0, fieldDelayMs: 0, clickDelayMs: 0 };
    }
    const defaults = { enabled: true, stepDelayMs: 1000, fieldDelayMs: 1000, clickDelayMs: 1000 };
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryValue = params.get("demoPacing") || params.get("agentPacing");
      if (queryValue === "0" || queryValue === "false") {
        window.sessionStorage && window.sessionStorage.setItem("his_agent_demo_pacing_override", "0");
        return { enabled: false, stepDelayMs: 0, fieldDelayMs: 0, clickDelayMs: 0 };
      }
      if (queryValue === "1" || queryValue === "true") {
        window.sessionStorage && window.sessionStorage.setItem("his_agent_demo_pacing_override", "1");
        return defaults;
      }
      const sessionOverride = window.sessionStorage && window.sessionStorage.getItem("his_agent_demo_pacing_override");
      if (sessionOverride === "0") return { enabled: false, stepDelayMs: 0, fieldDelayMs: 0, clickDelayMs: 0 };
      if (sessionOverride === "1") return defaults;
    } catch (error) {}
    let source = window.__HIS_AGENT_DEMO_PACING__ || null;
    if (!source && window.HIS_AGENT_RUNTIME_CONFIG && window.HIS_AGENT_RUNTIME_CONFIG.demoPacing) {
      source = window.HIS_AGENT_RUNTIME_CONFIG.demoPacing;
    }
    if (!source) {
      try {
        const raw = window.localStorage && window.localStorage.getItem("his_agent_demo_pacing");
        if (raw === "true" || raw === "1") source = { enabled: true };
        else if (raw) source = JSON.parse(raw);
      } catch (error) {
        source = null;
      }
    }
    if (!source || typeof source !== "object") return defaults;
    return {
      enabled: source.enabled === true || source.enabled === "true" || source.enabled === 1,
      stepDelayMs: Math.max(0, Number(source.stepDelayMs !== undefined ? source.stepDelayMs : defaults.stepDelayMs)),
      fieldDelayMs: Math.max(0, Number(source.fieldDelayMs !== undefined ? source.fieldDelayMs : defaults.fieldDelayMs)),
      clickDelayMs: Math.max(0, Number(source.clickDelayMs !== undefined ? source.clickDelayMs : defaults.clickDelayMs))
    };
  }

  async function waitDemoPacing(kind) {
    const config = demoPacingConfig();
    if (!config.enabled) return 0;
    const key = kind === "click" ? "clickDelayMs" : (kind === "field" ? "fieldDelayMs" : "stepDelayMs");
    const delay = Math.max(0, Number(config[key] || 0));
    if (!delay) return 0;
    await sleep(delay);
    return delay;
  }

  async function waitDemoPacingAfterAction(kind) {
    const config = demoPacingConfig();
    if (!config.enabled) return 0;
    const key = kind === "click" ? "clickDelayMs" : (kind === "field" ? "fieldDelayMs" : "stepDelayMs");
    const delay = Math.max(0, Number(config.stepDelayMs || 0), Number(config[key] || 0));
    if (!delay) return 0;
    await sleep(delay);
    return delay;
  }

  async function applyDemoPacingAfterStep(action, step, result) {
    if (!result || result.success === false) return 0;
    const type = action && action.type || step && (step.actionType || step.action_type) || "";
    let kind = "";
    if (type === "update_patient_field" || type === "update_patient_fields" || type === "set_select" || type === "fill_login_form" || type === "write_clinical_note_field") kind = "field";
    if (type === "save_patient" || type === "submit_login" || type === "open_page" || type === "navigate_internal" || type === "navigate" || type === "open_patient_editor" || type === "select_patient" || type === "logout") kind = "click";
    if (!kind) return 0;
    const delay = await waitDemoPacingAfterAction(kind);
    if (!delay) return 0;
    result.timing_breakdown = mergeTimingBreakdown(result.timing_breakdown, {
      demo_delay_ms: delay,
      animation_ms: delay
    });
    return delay;
  }

  function mergeTimingBreakdown(left, right) {
    const merged = Object.assign({}, left || {});
    Object.keys(right || {}).forEach(function (key) {
      merged[key] = Math.max(0, Math.round(Number(merged[key] || 0) + Number(right[key] || 0)));
    });
    return merged;
  }

  async function waitForLoginPostcondition(urlBefore, requested, dispatchResult) {
    const startedAt = Date.now();
    let last = {
      success: false,
      pageType: getPageType(),
      navigation_happened: false,
      login: readLoginFormSnapshot(requested),
      dispatch_success: Boolean(dispatchResult && dispatchResult.success),
      clicked_element: dispatchResult && (dispatchResult.clickedElement || dispatchResult.clicked_element || dispatchResult.element || ""),
      message: dispatchResult && dispatchResult.message || ""
    };
    while (Date.now() - startedAt < 2600) {
      const state = collectPageState();
      const pageType = state.pageType || getPageType();
      const auth = Boolean(readAuthFlag() || state.hisDemoAuthenticated || (state.loginState && state.loginState.authenticated));
      const errorText = getLoginFailureText();
      const successText = getLoginSuccessText();
      const navigation = window.location.href !== urlBefore || pageType !== "login";
      last = {
        success: pageType !== "login" && isInHisContext(state) && auth && !errorText,
        pageType: pageType,
        navigation_happened: navigation,
        pending_navigation: pageType === "login" && auth && Boolean(successText) && !errorText,
        hisDemoAuthenticated: auth,
        isInHisContext: isInHisContext(state),
        login_error: errorText,
        login_success: successText,
        login: readLoginFormSnapshot(requested),
        dispatch_success: Boolean(dispatchResult && dispatchResult.success),
        clicked_element: dispatchResult && (dispatchResult.clickedElement || dispatchResult.clicked_element || dispatchResult.element || ""),
        message: errorText || successText || (dispatchResult && dispatchResult.message) || ""
      };
      if (last.success) return last;
      if (last.pending_navigation) {
        last.success = true;
        last.navigation_happened = true;
        return last;
      }
      if (pageType === "login" && errorText) return last;
      await sleep(120);
    }
    return last;
  }

  function isInHisContext(pageState) {
    const state = pageState || {};
    const pageType = state.pageType || getPageType();
    const loginState = state.loginState || {};
    return Boolean(state.isInHisContext || state.hisDemoAuthenticated || loginState.isInHisContext || loginState.authenticated || pageType === "dashboard" || pageType === "patientManagement" || pageType === "patientEditor");
  }

  function taskNeedsAuthenticatedContext(task) {
    return Array.isArray(task && task.plan) && task.plan.some(stepNeedsAuthenticatedContext);
  }

  function stepNeedsAuthenticatedContext(step) {
    if (!step) return false;
    const actionType = step.actionType || step.action_type || step.type || "";
    if (PROTECTED_ACTIONS.has(actionType)) return true;
    const args = step.args || {};
    const page = normalizePageName(args.page || step.requiredPage || step.required_page || step.page || step.value);
    return (actionType === "open_page" || actionType === "navigate_internal" || actionType === "navigate") && PROTECTED_PAGES.has(page);
  }

  function hasSubmitLoginBeforeProtectedStep(task) {
    const plan = Array.isArray(task && task.plan) ? task.plan : [];
    let submittedLogin = false;
    for (const step of plan) {
      const actionType = step && (step.actionType || step.action_type || step.type);
      if (actionType === "submit_login") submittedLogin = true;
      if (stepNeedsAuthenticatedContext(step)) return submittedLogin;
    }
    return false;
  }

  function prependDemoLoginSteps(task, credentials, reason) {
    task.slots = task.slots || {};
    const parsed = normalizeLoginCredentials(credentials || {}, { allowExisting: false });
    if (!parsed.ok) {
      addProgress(task, "登录前置步骤缺少账号或密码，未自动使用 Demo 默认账号。", { login: parsed.summary });
      return;
    }
    const login = {
      username: parsed.credentials.username,
      password: parsed.credentials.password
    };
    task.slots.requiresLogin = true;
    task.slots.loginProvided = true;
    task.slots.login = { username: login.username, passwordFilled: Boolean(login.password), useDemo: Boolean(parsed.credentials.useDemo) };
    if (hasSubmitLoginBeforeProtectedStep(task)) return;
    const loginSteps = [
      {
        id: "pre_login_fill",
        goal: "填写 Demo 登录账号密码",
        requiredPage: "login",
        actionType: "fill_login_form",
        args: login,
        status: "pending",
        source: BACKEND_LLM_SOURCE
      },
      {
        id: "pre_login_submit",
        goal: "提交 Demo 登录并进入 HIS 工作台",
        requiredPage: "login",
        actionType: "submit_login",
        args: login,
        status: "pending",
        source: BACKEND_LLM_SOURCE
      }
    ];
    task.plan = loginSteps.concat((task.plan || []).map(function (step) {
      return Object.assign({}, step, { status: step.status === "completed" ? "pending" : (step.status || "pending") });
    }));
    task.current_step_index = 0;
    addProgress(task, reason || "补齐登录前置步骤。", { loginPrecondition: true });
  }

  function getStructuredLoginCredentials(task) {
    const slots = (task && task.slots) || {};
    const login = slots.login || slots.loginCredentials || slots.credentials || {};
    const hasUsername = Object.prototype.hasOwnProperty.call(login, "username") ||
      Object.prototype.hasOwnProperty.call(login, "account") ||
      Object.prototype.hasOwnProperty.call(slots, "username") ||
      Object.prototype.hasOwnProperty.call(slots, "account");
    const hasPassword = Object.prototype.hasOwnProperty.call(login, "password") ||
      Object.prototype.hasOwnProperty.call(slots, "password");
    const username = login.username !== undefined ? login.username : (login.account !== undefined ? login.account : (slots.username !== undefined ? slots.username : slots.account));
    const password = login.password !== undefined ? login.password : slots.password;
    const useDemo = Boolean(login.useDemo || login.use_demo || slots.useDemoLogin || slots.use_demo_login);
    if (useDemo) {
      return { username: "123", password: "123", useDemo: true };
    }
    if (hasUsername && hasPassword) {
      return { username: String(username), password: String(password), useDemo: false };
    }
    return null;
  }

  function classifyLoginPreconditionReply(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return "unknown";
    if (/^(no|n|cancel|stop)$/i.test(text) || /取消|不要|不用|先不|否|不行|算了/.test(text)) return "deny";
    if (/^(yes|y|ok|okay|continue|go|sure)$/i.test(text)) return "confirm";
    if (/^(是|好|好的|行|可以|确认|继续|继续吧|可以的|好的呀|没问题)$/.test(text)) return "confirm";
    if (/使用默认账号|用默认账号|默认账号|使用 demo|用 demo|demo|123\/123|123|确认执行|继续执行|继续当前任务|用默认|用这个账号/.test(text)) return "confirm";
    return "unknown";
  }

  function loginPreconditionMessage() {
    return "当前任务需要先登录 HIS。请先登录，或告诉我使用 Demo 默认账号密码 123/123 后继续执行。";
  }

  function normalizePageName(page) {
    const value = String(page || "").trim();
    const aliases = {
      "patient-management": "patientManagement",
      "patient-management.html": "patientManagement",
      "patient_editor": "patientEditor",
      "patient-editor": "patientEditor",
      "patient-editor.html": "patientEditor",
      "dashboard.html": "dashboard",
      "login.html": "login"
    };
    return aliases[value] || value;
  }

  function withBackendLlmSource(action, task, step) {
    return Object.assign({}, action || {}, {
      source: BACKEND_LLM_SOURCE,
      task_id: task && task.task_id,
      step_id: step && step.id
    });
  }

  function isBackendLlmTask(task) {
    return Boolean(task && task.source === BACKEND_LLM_SOURCE);
  }

  function isBackendLlmStep(step) {
    return Boolean(step && step.source === BACKEND_LLM_SOURCE);
  }

  function normalizeTask(task, objective) {
    if (!task) return null;
    if (window.AgentTaskModel && typeof window.AgentTaskModel.normalizeTask === "function") {
      task = window.AgentTaskModel.normalizeTask(task, {
        objective: objective || task.objective || "",
        source: task.source || BACKEND_LLM_SOURCE
      });
    }
    task.task_id = task.task_id || makeTaskId();
    task.objective = task.objective || String(objective || "");
    task.status = task.status || "running";
    task.slots = task.slots || {};
    task.plan = Array.isArray(task.plan) ? task.plan : [];
    task.current_step_index = Number(task.current_step_index || 0);
    task.created_at = task.created_at || Date.now() / 1000;
    task.started_at = task.started_at || task.created_at;
    task.started_at_ms = task.started_at_ms || Math.round(task.started_at * 1000);
    resumeMonoClock(task);
    task.updated_at = Date.now() / 1000;
    task.step_logs = Array.isArray(task.step_logs) ? task.step_logs : [];
    task.progress_messages = Array.isArray(task.progress_messages) ? task.progress_messages : [];
    task.usage_total = task.usage_total ? normalizeUsage(task.usage_total) : null;
    task.usage_last = task.usage_last || null;
    task.waitingFor = task.waitingFor || task.waiting_for || (task.slots && task.slots.waitingFor) || null;
    task.audit_ids = Array.isArray(task.audit_ids) ? task.audit_ids : [];
    task.clarifications = Array.isArray(task.clarifications) ? task.clarifications : [];
    normalizeTaskMutationContract(task);
    return task;
  }

  function nowMonoMs() {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function markTaskStarted(task, startedAtMs) {
    if (!task) return task;
    const wall = Number(startedAtMs || 0) || Date.now();
    task.started_at = wall / 1000;
    task.started_at_ms = wall;
    task.started_mono_ms = nowMonoMs();
    task.finished_at = null;
    task.finished_at_ms = null;
    task.finished_mono_ms = null;
    task.elapsed_ms = 0;
    return task;
  }

  function resumeMonoClock(record) {
    if (!record || isTerminalTaskStatus(record.status)) return record;
    const startedAtMs = Number(record.started_at_ms || 0);
    if (!startedAtMs || typeof record.started_mono_ms === "number") return record;
    record.started_mono_ms = Math.max(0, nowMonoMs() - Math.max(0, Date.now() - startedAtMs));
    return record;
  }

  function runningElapsedMs(record, endWallMs) {
    if (!record) return 0;
    const startedWallMs = Number(record.started_at_ms || 0);
    const finishedWallMs = Number(endWallMs || record.finished_at_ms || 0);
    if (finishedWallMs && startedWallMs) {
      return Math.max(0, Math.round(finishedWallMs - startedWallMs));
    }
    if (typeof record.started_mono_ms === "number") {
      return Math.max(0, Math.round(nowMonoMs() - Number(record.started_mono_ms)));
    }
    if (startedWallMs) {
      return Math.max(0, Math.round(Date.now() - startedWallMs));
    }
    return typeof record.elapsed_ms === "number" ? Math.max(0, Math.round(record.elapsed_ms)) : 0;
  }

  function normalizeTaskMutationContract(task) {
    if (!task) return task;
    task.slots = task.slots || {};
    const rawContract = task.task_contract || task.slots.task_contract || {
      target_patient: task.slots.target_patient || task.slots.canonical_patient || task.slots.resolved_patient || {},
      expected_mutations: task.expected_mutations || task.slots.expected_mutations || [],
      requires_save: task.slots.requires_save,
      requires_verification: task.slots.requires_verification
    };
    const contract = normalizeMutationContract(rawContract);
    if (!contract || !contract.expected_mutations || !contract.expected_mutations.length) {
      task.expected_mutations = [];
      task.mutation_ledger = task.mutation_ledger || {
        expected_mutations: [],
        applied_mutations: [],
        verified_mutations: [],
        dirty_fields: []
      };
      return task;
    }
    task.task_contract = contract;
    task.expected_mutations = contract.expected_mutations.slice();
    task.slots.task_contract = contract;
    task.slots.expected_mutations = contract.expected_mutations.slice();
    task.slots.target_patient = contract.target_patient || task.slots.target_patient || {};
    task.slots.requires_save = contract.requires_save;
    task.slots.requires_verification = contract.requires_verification;
    const ledger = task.mutation_ledger && typeof task.mutation_ledger === "object" ? task.mutation_ledger : {};
    task.mutation_ledger = {
      expected_mutations: contract.expected_mutations.slice(),
      applied_mutations: Array.isArray(ledger.applied_mutations) ? ledger.applied_mutations : [],
      verified_mutations: Array.isArray(ledger.verified_mutations) ? ledger.verified_mutations : [],
      dirty_fields: Array.isArray(ledger.dirty_fields) ? ledger.dirty_fields : [],
      save: ledger.save || null
    };
    return task;
  }

  function normalizeMutationContract(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const expected = normalizeExpectedMutations(source.expected_mutations || source.expectedMutations || source.mutations || []);
    if (!expected.length) return {};
    const targetSource = source.target_patient || source.targetPatient || {};
    const target = {
      patientId: String(targetSource.patientId || targetSource.patient_id || "").trim().toUpperCase(),
      name: String(targetSource.name || targetSource.patientName || targetSource.patient_name || "").trim()
    };
    return {
      target_patient: target,
      expected_mutations: expected,
      requires_save: source.requires_save === false || source.requiresSave === false ? false : true,
      requires_verification: source.requires_verification === false || source.requiresVerification === false ? false : true,
      source: String(source.source || "")
    };
  }

  function normalizeExpectedMutations(items) {
    if (!Array.isArray(items)) return [];
    const result = [];
    const seen = new Set();
    items.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const resolved = resolvePatientField({
        field: item.field || item.fieldKey,
        fieldLabel: item.fieldLabel || item.label,
        query: item.query || item.name
      });
      const value = firstNonEmpty(item.value, item.expectedValue, item.expected_value, item.text);
      if (!resolved.ok || !EDITABLE_FIELDS.has(resolved.field) || !value) return;
      const key = resolved.field + "\n" + value;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        field: resolved.field,
        fieldLabel: resolved.fieldLabel || resolved.field,
        value: value
      });
    });
    return result;
  }

  function expectedMutations(task) {
    normalizeTaskMutationContract(task);
    return Array.isArray(task && task.expected_mutations) ? task.expected_mutations : [];
  }

  function mutationValuesMatch(left, right) {
    return normalizeMutationCompareValue(left) === normalizeMutationCompareValue(right);
  }

  function normalizeMutationCompareValue(value) {
    let text = String(value == null ? "" : value);
    if (typeof text.normalize === "function") {
      text = text.normalize("NFKC");
    }
    return text
      .replace(/\s+/g, "")
      .replace(/[。；;，,]+$/g, "")
      .trim();
  }

  function mutationFieldMatches(item, expected) {
    return item && expected && item.field === expected.field && mutationValuesMatch(item.value, expected.value);
  }

  function stepMutations(step) {
    const actionType = step && (step.actionType || step.action_type);
    const args = step && step.args && typeof step.args === "object" ? step.args : {};
    if (actionType === "update_patient_field" || actionType === "verify_patient_field") {
      const normalized = normalizeStructuredUpdate({
        field: args.field,
        fieldLabel: args.fieldLabel,
        query: args.query,
        value: firstNonEmpty(args.value, args.expectedValue, args.expected_value)
      });
      return normalized.ok ? [{ field: normalized.field, fieldLabel: normalized.fieldLabel, value: normalized.value }] : [];
    }
    if (actionType === "write_clinical_note_field") {
      const draft = normalizeClinicalDraftArgs(args);
      return draft.ok ? [{ field: draft.field, fieldLabel: draft.fieldLabel, value: draft.text }] : [];
    }
    if (actionType === "update_patient_fields") {
      return normalizeExpectedMutations(Array.isArray(args.updates) ? args.updates : []);
    }
    return [];
  }

  function validateTaskPlanAgainstContract(task) {
    const expected = expectedMutations(task);
    if (!expected.length) return { ok: true, errors: [] };
    const plan = Array.isArray(task.plan) ? task.plan : [];
    const errors = [];
    const saveIndex = plan.findIndex(function (step) {
      return (step.actionType || step.action_type) === "save_patient";
    });
    if (task.task_contract && task.task_contract.requires_save !== false && saveIndex < 0) {
      errors.push("missing_save_patient");
    }
    expected.forEach(function (mutation) {
      const updateIndexes = [];
      const verifyIndexes = [];
      plan.forEach(function (step, index) {
        const actionType = step.actionType || step.action_type;
        const matches = stepMutations(step).some(function (item) {
          return mutationFieldMatches(item, mutation);
        });
        if (matches && (actionType === "update_patient_field" || actionType === "update_patient_fields" || actionType === "write_clinical_note_field")) {
          updateIndexes.push(index);
        }
        if (matches && actionType === "verify_patient_field") {
          verifyIndexes.push(index);
        }
      });
      if (!updateIndexes.length) {
        errors.push("missing_update:" + mutation.field);
      } else if (saveIndex >= 0 && Math.min.apply(Math, updateIndexes) > saveIndex) {
        errors.push("update_after_save:" + mutation.field);
      }
      if (task.task_contract && task.task_contract.requires_verification !== false) {
        if (!verifyIndexes.length) {
          errors.push("missing_verify:" + mutation.field);
        } else if (saveIndex >= 0 && Math.min.apply(Math, verifyIndexes) < saveIndex) {
          errors.push("verify_before_save:" + mutation.field);
        }
      }
    });
    if (plan.length <= 3 && plan.every(function (step) {
      return ["find_patient", "open_patient_editor", "save_patient"].includes(step.actionType || step.action_type);
    })) {
      errors.push("mutation_task_only_find_open_save");
    }
    return { ok: !errors.length, errors: errors };
  }

  function rejectInvalidMutationPlan(task, validation) {
    const message = "任务计划缺少必要修改步骤，尚未执行保存。";
    addProgress(task, "任务计划缺少必要修改步骤，正在修复，尚未执行页面操作。", {
      planValidation: validation || null,
      expectedMutations: expectedMutations(task)
    });
    finishTask(task, "failed", message, { source: "mutation_contract_validation" });
    return { handled: true, success: false, done: true, message: message, planValidation: validation || null };
  }

  function recordAppliedMutation(task, normalized, result, step) {
    const expected = expectedMutations(task);
    if (!expected.length || !normalized || !normalized.field) return;
    const matched = expected.find(function (item) {
      return item.field === normalized.field && mutationValuesMatch(item.value, normalized.value);
    });
    if (!matched) return;
    task.mutation_ledger = task.mutation_ledger || { expected_mutations: expected.slice(), applied_mutations: [], verified_mutations: [], dirty_fields: [] };
    const entry = {
      field: matched.field,
      fieldLabel: matched.fieldLabel || normalized.fieldLabel || matched.field,
      expectedValue: matched.value,
      oldValue: result && result.oldValue,
      appliedValue: result && result.newValue != null ? result.newValue : normalized.value,
      actionId: result && result.action_id || "",
      stepId: step && step.id || "",
      appliedAt: new Date().toISOString()
    };
    task.mutation_ledger.applied_mutations = task.mutation_ledger.applied_mutations.filter(function (item) {
      return item.field !== entry.field;
    });
    task.mutation_ledger.applied_mutations.push(entry);
    if (!mutationValuesMatch(entry.oldValue, entry.appliedValue) && !task.mutation_ledger.dirty_fields.includes(entry.field)) {
      task.mutation_ledger.dirty_fields.push(entry.field);
    }
    addProgress(task, "已记录字段修改账本：" + entry.fieldLabel, { mutationLedger: task.mutation_ledger });
  }

  function recordVerifiedMutation(task, action, result, step) {
    const expected = expectedMutations(task);
    if (!expected.length || !result || !result.success) return;
    const field = result.field || (action && action.args && action.args.field) || "";
    const expectedValue = result.expectedValue != null ? result.expectedValue : action && action.args && (action.args.value || action.args.expectedValue);
    const matched = expected.find(function (item) {
      return item.field === field && mutationValuesMatch(item.value, expectedValue);
    });
    if (!matched) return;
    task.mutation_ledger = task.mutation_ledger || { expected_mutations: expected.slice(), applied_mutations: [], verified_mutations: [], dirty_fields: [] };
    const entry = {
      field: matched.field,
      fieldLabel: matched.fieldLabel || result.fieldLabel || matched.field,
      expectedValue: matched.value,
      actualValue: result.actualValue != null ? result.actualValue : expectedValue,
      stepId: step && step.id || "",
      verifiedAt: new Date().toISOString()
    };
    task.mutation_ledger.verified_mutations = task.mutation_ledger.verified_mutations.filter(function (item) {
      return item.field !== entry.field;
    });
    task.mutation_ledger.verified_mutations.push(entry);
    addProgress(task, "已记录字段校验账本：" + entry.fieldLabel, { mutationLedger: task.mutation_ledger });
  }

  function contractTargetPatient(task) {
    const contract = task && task.task_contract || {};
    const target = contract.target_patient || task && task.slots && (task.slots.target_patient || task.slots.canonical_patient || task.slots.resolved_patient) || {};
    return {
      patientId: String(target.patientId || target.patient_id || task && task.slots && task.slots.target_patient_id || "").trim().toUpperCase(),
      name: String(target.name || target.patientName || target.patient_name || "").trim()
    };
  }

  function validateSavePreconditions(task, pageState) {
    const expected = expectedMutations(task);
    if (!expected.length) return { ok: true };
    const ledger = task.mutation_ledger || {};
    const target = contractTargetPatient(task);
    const context = patientEditorContext(pageState || collectPageState());
    if (target.patientId && !patientEditorContextMatches(context, { patientId: target.patientId, name: target.name || "" })) {
      return { ok: false, code: "patient_context_mismatch", message: "当前患者与任务目标不一致，已阻止保存。" };
    }
    const applied = Array.isArray(ledger.applied_mutations) ? ledger.applied_mutations : [];
    const dirty = Array.isArray(ledger.dirty_fields) ? ledger.dirty_fields : [];
    const missingApplied = expected.filter(function (mutation) {
      return !applied.some(function (item) {
        return item.field === mutation.field && mutationValuesMatch(item.appliedValue, mutation.value);
      });
    });
    if (missingApplied.length) {
      return { ok: false, code: "missing_required_mutations", message: "保存前缺少必要字段修改：" + missingApplied.map(function (item) { return item.fieldLabel || item.field; }).join("、") };
    }
    const missingDirty = expected.filter(function (mutation) {
      return !dirty.includes(mutation.field) && !mutationAlreadySatisfied(mutation, target.patientId);
    });
    if (missingDirty.length) {
      return { ok: false, code: "no_dirty_changes", message: "未检测到必要字段的真实草稿变化，已阻止保存。" };
    }
    return { ok: true };
  }

  function recordSaveResult(task, result) {
    const expected = expectedMutations(task);
    if (!expected.length || !result) return { ok: true };
    const changed = result.changedFields || result.changed_fields || [];
    const target = contractTargetPatient(task);
    const missingChanged = expected.filter(function (mutation) {
      return !changed.includes(mutation.field) && !mutationAlreadySatisfied(mutation, target.patientId);
    });
    task.mutation_ledger = task.mutation_ledger || { expected_mutations: expected.slice(), applied_mutations: [], verified_mutations: [], dirty_fields: [] };
    task.mutation_ledger.save = {
      success: Boolean(result.success),
      patientId: result.patientId || "",
      changedFields: changed.slice(),
      audit_id: result.audit_id || "",
      audit: result.audit || null,
      savedAt: new Date().toISOString()
    };
    if (missingChanged.length) {
      return { ok: false, code: "missing_saved_fields", message: "页面保存结果缺少必要字段：" + missingChanged.map(function (item) { return item.fieldLabel || item.field; }).join("、") };
    }
    if (!result.audit_id) {
      return { ok: false, code: "missing_audit_log", message: "页面保存成功但未返回业务 audit log。" };
    }
    return { ok: true };
  }

  function mutationAlreadySatisfied(mutation, patientId) {
    if (!mutation || !mutation.field) return false;
    const patient = readPatientFromStore(patientId);
    if (!patient) return false;
    return mutationValuesMatch(patient[mutation.field], mutation.value);
  }

  function validateTaskCompletion(task) {
    const expected = expectedMutations(task);
    if (!expected.length) return { ok: true };
    const ledger = task.mutation_ledger || {};
    const applied = Array.isArray(ledger.applied_mutations) ? ledger.applied_mutations : [];
    const verified = Array.isArray(ledger.verified_mutations) ? ledger.verified_mutations : [];
    const missingApplied = expected.filter(function (mutation) {
      return !applied.some(function (item) { return item.field === mutation.field && mutationValuesMatch(item.appliedValue, mutation.value); });
    });
    if (missingApplied.length) return { ok: false, code: "missing_required_mutations", message: "任务缺少必要字段修改，不能完成。" };
    if (task.task_contract && task.task_contract.requires_save !== false) {
      if (!ledger.save || !ledger.save.success) return { ok: false, code: "missing_save_success", message: "任务缺少成功保存结果，不能完成。" };
      if (!ledger.save.audit_id) return { ok: false, code: "missing_audit_log", message: "任务缺少保存 audit log，不能完成。" };
    }
    if (task.task_contract && task.task_contract.requires_verification !== false) {
      const missingVerified = expected.filter(function (mutation) {
        return !verified.some(function (item) { return item.field === mutation.field && mutationValuesMatch(item.actualValue, mutation.value); });
      });
      if (missingVerified.length) return { ok: false, code: "missing_verified_mutations", message: "任务缺少字段校验，不能完成。" };
    }
    const target = contractTargetPatient(task);
    const patient = readPatientFromStore(target.patientId);
    if (patient) {
      const storeMismatch = expected.filter(function (mutation) {
        return !mutationValuesMatch(patient[mutation.field], mutation.value);
      });
      if (storeMismatch.length) return { ok: false, code: "patient_store_mismatch", message: "patient-store 与预期字段值不一致，不能完成。" };
    }
    return { ok: true };
  }

  function verifyExpectedMutationsInStore(task) {
    const expected = expectedMutations(task);
    const target = contractTargetPatient(task);
    if (!expected.length) {
      return { success: true, code: "no_expected_mutations", message: "无需核对字段修改。" };
    }
    if (!target.patientId || !window.PatientStore) {
      return { success: false, code: "patient_store_unavailable", message: "无法读取目标 patient-store。" };
    }
    const patient = readPatientFromStore(target.patientId);
    if (!patient) {
      return { success: false, code: "patient_not_found", message: "patient-store 中未找到目标患者：" + target.patientId };
    }
    const mismatches = expected.filter(function (mutation) {
      return !mutationValuesMatch(patient[mutation.field], mutation.value);
    });
    if (mismatches.length) {
      return {
        success: false,
        code: "patient_store_mismatch",
        message: "patient-store 字段值不一致：" + mismatches.map(function (item) { return item.fieldLabel || item.field; }).join("、"),
        patientId: target.patientId,
        mismatches: mismatches
      };
    }
    return {
      success: true,
      code: "verified",
      message: "patient-store 已核对预期字段。",
      patientId: target.patientId,
      verifiedFields: expected.map(function (item) { return item.field; })
    };
  }

  function readPatientFromStore(patientId) {
    const id = String(patientId || "").trim().toUpperCase();
    if (!id || !window.PatientStore) return null;
    if (typeof window.PatientStore.getPatient === "function") {
      return window.PatientStore.getPatient(id);
    }
    if (typeof window.PatientStore.getPatientById === "function") {
      return window.PatientStore.getPatientById(id);
    }
    if (typeof window.PatientStore.getAllPatients === "function") {
      const patients = window.PatientStore.getAllPatients() || [];
      return patients.find(function (patient) {
        return String(patient && patient.patientId || "").toUpperCase() === id;
      }) || null;
    }
    return null;
  }

  function verifyExpectedFieldAlreadySatisfied(action, task, pageState, adapterResult) {
    const args = action && action.args || {};
    const selector = args.patientSelector || args.patient_selector || {};
    const fieldInput = args.field || args.fieldLabel || args.query || "";
    const expected = firstNonEmpty(args.value, args.expectedValue, args.expected_value);
    const resolved = resolvePatientField({ field: fieldInput, fieldLabel: args.fieldLabel, query: args.query }, task);
    if (!resolved.ok || !EDITABLE_FIELDS.has(resolved.field) || !expected) return null;
    const slots = task && task.slots || {};
    const target = slots.target_patient || slots.canonical_patient || slots.resolved_patient || {};
    const state = pageState || {};
    const active = state.activePatient || state.patient || state.selectedPatient || {};
    const patientId = String(
      selector.patientId ||
      selector.patient_id ||
      args.patientId ||
      args.patient_id ||
      target.patientId ||
      target.patient_id ||
      state.patientId ||
      active.patientId ||
      ""
    ).toUpperCase();
    const candidates = [];
    [active, state.patient, state.selectedPatient].forEach(function (patient) {
      if (patient && typeof patient === "object") candidates.push(patient);
    });
    const stored = readPatientFromStore(patientId);
    if (stored) candidates.push(stored);
    for (const patient of candidates) {
      if (!patient || typeof patient !== "object") continue;
      const candidateId = String(patient.patientId || "").toUpperCase();
      if (patientId && candidateId && candidateId !== patientId) continue;
      const actual = patient[resolved.field];
      if (mutationValuesMatch(actual, expected)) {
        return {
          handled: true,
          success: true,
          code: "verified",
          message: "已确认" + (resolved.fieldLabel || resolved.field) + "为：" + String(actual == null ? "" : actual),
          patientId: candidateId || patientId,
          field: resolved.field,
          fieldLabel: resolved.fieldLabel || resolved.field,
          expectedValue: String(expected),
          actualValue: String(actual == null ? "" : actual),
          adapterResult: adapterResult || null
        };
      }
    }
    return null;
  }

  function normalizeUpdate(field, value) {
    const resolved = resolvePatientField(field);
    if (!resolved.ok || !EDITABLE_FIELDS.has(resolved.field)) return null;
    const canonical = resolved.field;
    let next = value == null ? "" : String(value).trim();
    if (canonical === "birthDate") next = normalizeDate(next);
    if ((canonical === "phone" || canonical === "emergencyPhone") && next && !/^1\d{10}$/.test(next.replace(/\s+/g, ""))) return null;
    if ((canonical === "phone" || canonical === "emergencyPhone")) next = next.replace(/\s+/g, "");
    return next ? { field: canonical, value: next } : null;
  }

  function resolvePatientField(selector, task) {
    const input = selector && typeof selector === "object" ? selector : { field: selector };
    if (task) addStepLog(task, "field resolver 输入：" + safeJson(input));
    if (window.PatientFieldSchema && typeof window.PatientFieldSchema.resolvePatientField === "function") {
      const result = window.PatientFieldSchema.resolvePatientField(input);
      if (task) {
        if (result.ok) {
          addStepLog(task, "字段匹配：" + result.field + "（" + result.fieldLabel + "，" + result.matchType + "）。");
          addProgress(task, "已匹配字段：" + result.fieldLabel + "（" + result.field + "）", { fieldResolver: result });
        } else {
          addStepLog(task, "字段匹配失败：" + (result.reason || "field_not_found"));
        }
      }
      return result;
    }
    const key = String(input.field || input.fieldKey || input.fieldLabel || input.query || selector || "");
    return { ok: EDITABLE_FIELDS.has(key), field: key, fieldLabel: key, matchType: "key" };
  }

  function normalizeDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (!match) return text;
    return [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
  }

  function fieldToPageAction(field, value) {
    if (field === "gender" || field === "department" || field === "visitType" || field === "insuranceType") {
      return { type: "set_select", target: { field: field }, value: value };
    }
    return { type: "update_patient_field", target: { field: field }, value: value };
  }

  function routeToPage(requiredPage) {
    if (requiredPage === "login") return { type: "open_page", args: { page: "login" }, continue_after_navigation: true };
    if (requiredPage === "dashboard") return { type: "open_page", args: { page: "dashboard" }, continue_after_navigation: true };
    if (requiredPage === "patientManagement") return { type: "open_page", args: { page: "patientManagement" }, continue_after_navigation: true };
    if (requiredPage === "patientEditor") return { type: "open_page", args: { page: "patientEditor" }, continue_after_navigation: true };
    return { type: "noop", args: {} };
  }

  function pageToUrl(page) {
    const pages = { login: "login.html", dashboard: "dashboard.html", patientManagement: "patient-management.html", patientEditor: "patient-editor.html" };
    return pages[page] || "";
  }

  async function applyPageAction(action) {
    if (typeof window.applyHisAgentAction === "function") {
      const pageResult = await Promise.resolve(window.applyHisAgentAction(action));
      if (pageResult && pageResult.handled) return pageResult;
    }
    return { handled: true, success: false, message: "当前页面未接收该动作。" };
  }

  function completeStep(task, step, result) {
    const finishedAtMs = Date.now();
    step.status = "completed";
    step.result = result;
    step.error = "";
    step.finished_at = finishedAtMs / 1000;
    step.finished_at_ms = finishedAtMs;
    step.finished_mono_ms = nowMonoMs();
    step.elapsed_ms = runningElapsedMs(step, finishedAtMs);
    step.usage_source = step.usage ? "backend_llm" : "local_dom";
    step.token_source = step.usage ? "backend_llm" : "local_dom";
    finalizeStepTiming(step);
    task.current_step_index = Math.max(task.current_step_index, task.plan.indexOf(step) + 1);
    task.lastError = "";
    task.status = "running";
    updateTaskTiming(task);
    addProgress(task, "完成步骤：" + (step.goal || step.id || step.actionType || "step"), { step: compactStep(step), actionResult: result });
    saveTask(task);
  }

  function failStep(task, step, message) {
    const finishedAtMs = Date.now();
    step.status = "failed";
    step.error = message;
    step.finished_at = finishedAtMs / 1000;
    step.finished_at_ms = finishedAtMs;
    step.finished_mono_ms = nowMonoMs();
    step.elapsed_ms = runningElapsedMs(step, finishedAtMs);
    step.usage_source = step.usage ? "backend_llm" : "local_dom";
    step.token_source = step.usage ? "backend_llm" : "local_dom";
    finalizeStepTiming(step);
    task.lastError = message;
    updateTaskTiming(task);
    addProgress(task, "任务失败：" + (message || "动作执行失败。"), { step: compactStep(step), error: message || "" });
    finishTask(task, "failed", message);
    return { handled: true, success: false, done: true, message: message };
    step.status = "failed";
    step.error = message;
    task.status = "failed";
    task.lastError = message;
    saveTask(task);
    return { handled: true, success: false, done: true, message: message };
  }

  function waitStep(task, step, message, details) {
    step.status = "waiting_user";
    step.error = message;
    if (details && typeof details === "object") {
      step.waiting_details = details;
    }
    task.status = "waiting_user";
    task.lastError = message;
    if (step.started_at_ms && !step.finished_at_ms) {
      const pausedAtMs = Date.now();
      step.finished_at = pausedAtMs / 1000;
      step.finished_at_ms = pausedAtMs;
      step.finished_mono_ms = nowMonoMs();
      step.elapsed_ms = runningElapsedMs(step, pausedAtMs);
      finalizeStepTiming(step);
    }
    updateTaskTiming(task);
    addProgress(task, "等待用户补充信息：" + (message || ""), Object.assign({ step: compactStep(step) }, details || {}));
    saveTask(task);
    return { handled: true, success: false, waiting: true, message: message };
    step.status = "waiting_user";
    step.error = message;
    task.status = "waiting_user";
    task.lastError = message;
    saveTask(task);
    return { handled: true, success: false, waiting: true, message: message };
  }

  function finishSuccess(task) {
    const completion = validateTaskCompletion(task);
    if (!completion.ok) {
      const message = completion.message || "任务目标尚未满足，不能标记完成。";
      addProgress(task, "任务完成前校验失败：" + message, { completionValidation: completion, mutationLedger: task && task.mutation_ledger || null });
      finishTask(task, "failed", message, { source: "mutation_contract_completion" });
      return { handled: true, success: false, done: true, message: message, completionValidation: completion };
    }
    const message = "任务已完成。";
    finishTask(task, "completed", message);
    return { handled: true, success: true, done: true, message: message };
  }

  function finishTask(task, status, message, options) {
    const opts = options || {};
    const finishedAtMs = Date.now();
    task.status = status;
    task.finished_at = finishedAtMs / 1000;
    task.finished_at_ms = finishedAtMs;
    task.finished_mono_ms = nowMonoMs();
    task.elapsed_ms = runningElapsedMs(task, finishedAtMs);
    updateTaskTiming(task);
    task.lastError = status === "completed" ? "" : (message || "");
    if (status === "cancelled" && Array.isArray(task.plan)) {
      task.plan = task.plan.map(function (step) {
        const currentStatus = String(step && step.status || "pending").toLowerCase();
        if (currentStatus === "completed") return step;
        const stepStarted = Number(step && step.started_at_ms || 0);
        const frozenElapsed = stepStarted ? runningElapsedMs(step, finishedAtMs) : (typeof step.elapsed_ms === "number" ? step.elapsed_ms : 0);
        return Object.assign({}, step, {
          status: currentStatus === "running" ? "cancelled" : "skipped",
          finished_at: finishedAtMs / 1000,
          finished_at_ms: finishedAtMs,
          finished_mono_ms: nowMonoMs(),
          elapsed_ms: frozenElapsed,
          error: message || "用户取消任务。"
        });
      });
    }
    const usageText = task.usage_total ? "Token：" + formatUsage(task.usage_total) : "后端未返回 token usage";
    addProgress(task, (status === "completed" ? "任务完成" : "任务结束：" + status) + "。总耗时：" + formatElapsed(task.elapsed_ms) + "。" + usageText, { status: status, elapsedMs: task.elapsed_ms, usageTotal: task.usage_total || null, source: opts.source || "" });
    appendHistory(task, message);
    clearTask();
    return task;
    task.status = status;
    task.finished_at = Date.now() / 1000;
    task.lastError = status === "completed" ? "" : (message || "");
    appendHistory(task, message);
    clearTask();
  }

  function actionResult(success, actionType, pageBefore, pageAfter, changedFields, navigation, error, observation, extra) {
    const meta = extra || {};
    return Object.assign({
      success: Boolean(success),
      action_type: actionType,
      page_before: pageBefore,
      page_after: pageAfter || "",
      changed_fields: changedFields || [],
      navigation_happened: Boolean(navigation),
      error: error || "",
      observation: observation || "",
      message: observation || error || "",
      usage_source: (meta.usage || meta.usage_total) ? "backend_llm" : "local_dom",
      token_source: (meta.usage || meta.usage_total) ? "backend_llm" : "local_dom"
    }, meta);
  }

  function auditMeta(task, step, source) {
    return {
      audit: {
        actor: "agent",
        source: source || BACKEND_LLM_SOURCE,
        task_id: task && task.task_id,
        instruction: task && task.objective,
        reason: step && (step.goal || step.id)
      }
    };
  }

  function buildActionTelemetry(result, task, step) {
    const field = result && (result.field || (result.changedFields && result.changedFields[0]) || (result.changed_fields && result.changed_fields[0]) || "");
    const patientId = getTelemetryPatientId(task, result);
    const audit = findLatestAudit(patientId, field, task && task.task_id);
    return {
      patientId: patientId || "",
      field: field || "",
      fieldLabel: result && result.fieldLabel || "",
      oldValue: result && result.oldValue,
      newValue: result && result.newValue,
      expectedValue: result && result.expectedValue,
      actualValue: result && result.actualValue,
      changedFields: result && (result.changedFields || result.changed_fields) || [],
      audit_id: result && result.audit_id || audit && audit.audit_id || "",
      audit: result && result.audit || audit || null,
      stepTelemetry: {
        stepId: step && step.id || "",
        source: BACKEND_LLM_SOURCE
      }
    };
  }

  function getTelemetryPatientId(task, result) {
    if (result && result.patientId) return String(result.patientId).toUpperCase();
    const slots = task && task.slots || {};
    if (slots.target_patient_id) return String(slots.target_patient_id).toUpperCase();
    if (slots.resolved_patient && slots.resolved_patient.patientId) return String(slots.resolved_patient.patientId).toUpperCase();
    return "";
  }

  function findLatestAudit(patientId, field, taskId) {
    if (!window.PatientStore || !window.PatientStore.getAuditLog) return null;
    const log = window.PatientStore.getAuditLog(patientId || "");
    return log.slice().reverse().find(function (item) {
      const taskMatches = !taskId || item.task_id === taskId;
      const fieldMatches = !field || item.field === field;
      return taskMatches && fieldMatches;
    }) || null;
  }

  async function markAgentNavigationTarget(page) {
    if (!window.HisUiActionFeedback) return;
    const selectors = {
      dashboard: "[data-his-entry='dashboard'], .nav-item[href='dashboard.html']",
      patientManagement: "[data-his-entry='patient-management'], #patientManagementEntry",
      patientEditor: "[data-his-entry='patient-editor'], #patientEditorEntry",
      agentHistory: "[data-his-entry='agent-history'], #agentHistoryEntry"
    };
    const target = document.querySelector(selectors[page] || "");
    if (target) {
      await window.HisUiActionFeedback.agentClickElement(target, {
        click: false,
        message: "Agent 正在打开：" + page,
        beforeMs: 80,
        pressMs: 90,
        afterMs: 100
      });
    }
  }

  async function markPatientRow(patientId) {
    if (window.HisUiActionFeedback && patientId) {
      window.HisUiActionFeedback.highlightPatientRow(patientId);
      await window.HisUiActionFeedback.sleep(180);
    }
  }

  function extractPatientSelector(args, step, task, options) {
    const settings = options || {};
    const sourceArgs = args || {};
    if (sourceArgs.patientSelector) return sourceArgs.patientSelector;
    if (sourceArgs.patient_selector) return sourceArgs.patient_selector;
    if (sourceArgs.patient) return sourceArgs.patient;
    if (sourceArgs.patientId || sourceArgs.patient_id) return { patientId: sourceArgs.patientId || sourceArgs.patient_id };
    if (sourceArgs.patientName || sourceArgs.patient_name) return { name: sourceArgs.patientName || sourceArgs.patient_name };
    if (sourceArgs.query || sourceArgs.phone || sourceArgs.idNumber || sourceArgs.id_number) return sourceArgs;
    if (sourceArgs.name && settings.allowGenericName !== false) return { name: sourceArgs.name };
    if (step && step.patientSelector) return step.patientSelector;
    if (step && step.patient_selector) return step.patient_selector;
    if (settings.includeTaskSlots !== false && task && task.slots) return task.slots.target_patient || task.slots.patientSelector || task.slots.patient_selector || task.slots.resolved_patient || null;
    return null;
  }

  function ensureResolvedPatient(task, step, args, pageState) {
    task.slots = task.slots || {};
    if (task.slots.resolved_patient && task.slots.resolved_patient.patientId) {
      return { patient: task.slots.resolved_patient, status: "ok", matches: [task.slots.resolved_patient] };
    }
    const selector = extractPatientSelector(args, step, task, { includeTaskSlots: false, allowGenericName: false });
    const direct = resolvePatient(selector, task, step);
    if (direct.patient || direct.status === "ambiguous") return direct;

    const pageResolved = resolvePatientFromPageState(pageState, task, step);
    if (pageResolved.patient || pageResolved.status === "ambiguous") return pageResolved;

    const priorResolved = resolvePatientFromPriorSteps(task, step);
    if (priorResolved.patient || priorResolved.status === "ambiguous") return priorResolved;

    const genericSelector = extractPatientSelector(args, step, task, { includeTaskSlots: false, allowGenericName: true });
    if (genericSelector && safeJson(genericSelector) !== safeJson(selector)) {
      const generic = resolvePatient(genericSelector, task, step);
      if (generic.patient || generic.status === "ambiguous") return generic;
    }
    return direct;
  }

  function rememberResolvedPatient(task, patient, selector) {
    task.slots = task.slots || {};
    task.slots.target_patient = selector || task.slots.target_patient || { patientId: patient.patientId };
    task.slots.resolved_patient = patient;
    task.slots.canonical_patient = { patientId: patient.patientId, name: patient.name || "" };
    task.slots.target_patient_id = patient.patientId;
    addStepLog(task, "已将 patientId=" + patient.patientId + " 写入任务 slots。");
    recordFlowTrace("canonical_patient_remembered", {
      task_id: task.task_id || "",
      task_slots: sanitizeArgs(task.slots || {}),
      resolved_patient: task.slots.canonical_patient
    });
    saveTask(task);
  }

  function patientEditorContext(pageState) {
    const state = pageState || {};
    const activePatient = state.activePatient || state.patient || state.selectedPatient || {};
    const urlPatientId = (function () {
      try {
        return new URLSearchParams(window.location.search || "").get("patientId") || "";
      } catch (error) {
        return "";
      }
    })();
    return {
      urlPatientId: String(urlPatientId || "").toUpperCase(),
      pageStatePatientId: String(state.patientId || activePatient.patientId || "").toUpperCase(),
      pageStatePatientName: activePatient.name || "",
      pageType: state.pageType || getPageType()
    };
  }

  function patientEditorContextMatches(context, patient) {
    if (!context || !patient || !patient.patientId) return false;
    const expectedId = String(patient.patientId || "").toUpperCase();
    const ids = [context.urlPatientId, context.pageStatePatientId].filter(Boolean);
    const idMatches = ids.length > 0 && ids.every(function (id) { return id === expectedId; });
    const name = String(context.pageStatePatientName || "");
    const nameMatches = !name || !patient.name || name === patient.name;
    return idMatches && nameMatches;
  }

  function resolvePatient(selector, task, step) {
    const input = selector || null;
    if (task) addStepLog(task, "patient resolver 输入：" + safeJson(input || {}));
    if (!input) return { patient: null, status: "missing", matches: [] };
    if (selector.kind === "rowIndex") {
      const patients = getPatientStoreSummary();
      const index = Math.max(0, Number(selector.value || 1) - 1);
      return { patient: patients[index] || null, status: patients[index] ? "ok" : "missing", matches: [] };
    }
    if (window.PatientStore && typeof window.PatientStore.resolvePatientSelector === "function") {
      const result = window.PatientStore.resolvePatientSelector(input);
      const candidates = (result.candidates || []).map(function (item) { return item.patientId + " " + item.name; }).join("，") || "无";
      if (task) addStepLog(task, "patient-store 候选：" + candidates);
      if (result.ok && result.patient) {
        if (task) addStepLog(task, "唯一匹配：" + result.patient.patientId + " " + result.patient.name + "（" + result.matchType + "）。");
        rememberResolvedPatient(task, result.patient, input);
        return { patient: result.patient, status: "ok", matches: result.candidates || [result.patient], raw: result };
      }
      if (result.reason === "multiple_matches") return { patient: null, status: "ambiguous", matches: result.candidates || [], raw: result };
      return { patient: null, status: "missing", matches: result.candidates || [], raw: result };
    }
    const patients = getPatientStoreSummary();
    const value = String(input.value || input.name || input.query || "").trim();
    if (!value) return { patient: null, status: "missing", matches: [] };
    const matches = patients.filter(function (patient) {
      return patient.patientId === value.toUpperCase() || patient.name === value || patient.name.includes(value) || value.includes(patient.name);
    });
    if (matches.length === 1) return { patient: matches[0], status: "ok", matches: matches };
    if (matches.length > 1) return { patient: null, status: "ambiguous", matches: matches };
    return { patient: null, status: "missing", matches: [] };
  }

  function resolvePatientFromPageState(pageState, task, step) {
    const state = pageState || {};
    const activePatient = state.activePatient || state.patient || state.selectedPatient || {};
    const patientId = state.patientId || activePatient.patientId || "";
    if (patientId) {
      if (task) addStepLog(task, "复用当前页面患者 patientId=" + String(patientId).toUpperCase() + "。");
      return resolvePatient({ patientId: patientId }, task, step);
    }
    if (activePatient.name) {
      if (task) addStepLog(task, "复用当前页面患者姓名：" + activePatient.name + "。");
      return resolvePatient({ name: activePatient.name }, task, step);
    }
    return { patient: null, status: "missing", matches: [] };
  }

  function resolvePatientFromPriorSteps(task, currentStep) {
    if (!task || !Array.isArray(task.plan)) return { patient: null, status: "missing", matches: [] };
    const currentIndex = task.plan.indexOf(currentStep);
    const end = currentIndex >= 0 ? currentIndex : Number(task.current_step_index || 0);
    const priorSteps = task.plan.slice(0, Math.max(0, end)).reverse();
    for (const priorStep of priorSteps) {
      if (!priorStep || priorStep.status !== "completed") continue;
      const actionType = priorStep.actionType || priorStep.action_type || priorStep.action;
      if (!["find_patient", "select_patient", "open_patient_editor"].includes(actionType)) continue;
      const resultPatientId = priorStep.result && (priorStep.result.patientId || priorStep.result.patient_id);
      const selector = resultPatientId ? { patientId: resultPatientId } : extractPatientSelector(priorStep.args || {}, priorStep, null, { includeTaskSlots: false, allowGenericName: true });
      if (!selector) continue;
      if (task) addStepLog(task, "复用已完成步骤的患者定位：" + (priorStep.goal || priorStep.id || actionType) + "。");
      const resolved = resolvePatient(selector, task, priorStep);
      if (resolved.patient || resolved.status === "ambiguous") return resolved;
    }
    return { patient: null, status: "missing", matches: [] };
  }

  function getPatientStoreSummary() {
    if (!window.PatientStore || !window.PatientStore.getAllPatients) return [];
    if (typeof window.PatientStore.getPatientIndex === "function") return window.PatientStore.getPatientIndex();
    return window.PatientStore.getAllPatients().map(function (patient) {
      return { patientId: patient.patientId, name: patient.name, gender: patient.gender, birthDate: patient.birthDate, phone: patient.phone, idNumber: patient.idNumber, department: patient.department, address: patient.address, chiefComplaint: patient.chiefComplaint };
    });
  }

  function getFullPatientIndex() {
    return getPatientStoreSummary();
  }

  function enrichPageStateWithPatients(pageState, fullPatientIndex) {
    const state = Object.assign({}, pageState || {});
    state.fullPatientIndex = fullPatientIndex || getFullPatientIndex();
    if (!state.visiblePatientList && Array.isArray(state.patientListSummary)) {
      state.visiblePatientList = state.patientListSummary;
    }
    if (!state.activePatient && state.patient) {
      state.activePatient = state.patient;
    }
    return state;
  }

  function buildPlannerPayload(objective, input) {
    const options = input || {};
    const taskContract = normalizeMutationContract(options.taskContract || (options.inputRoute && options.inputRoute.task_contract) || {});
    const plannerTaskContract = compactMutationContractForPlanner(taskContract);
    const inputRoute = compactInputRoute(options.inputRoute || {});
    const pageStateForPrompt = compactPageStateForPrompt(options.pageState || {});
    const isVoiceConfirmedTask = String(options.source || "") === "voice_confirmed_task" || inputRoute.inputType === "voice_session_task";
    const targetPatientId = String(plannerTaskContract && plannerTaskContract.target_patient && plannerTaskContract.target_patient.patientId || "").toUpperCase();
    const activePatientId = String(pageStateForPrompt.patientId || pageStateForPrompt.activePatient && pageStateForPrompt.activePatient.patientId || "").toUpperCase();
    const canUseScopedPatientContext = Boolean(
      isVoiceConfirmedTask &&
      plannerTaskContract &&
      plannerTaskContract.expected_mutations &&
      plannerTaskContract.expected_mutations.length &&
      targetPatientId &&
      activePatientId === targetPatientId &&
      pageStateForPrompt.pageType === "patientEditor"
    );
    const fullPatientIndex = compactPatientIndex(options.fullPatientIndex || getFullPatientIndex());
    const patientIndex = canUseScopedPatientContext
      ? (pageStateForPrompt.activePatient ? [pageStateForPrompt.activePatient] : [])
      : selectPlannerPatientIndex(fullPatientIndex, objective, pageStateForPrompt, plannerTaskContract);
    if (canUseScopedPatientContext) {
      pageStateForPrompt.visiblePatientList = [];
    }
    pageStateForPrompt.visiblePatientList = [];
    if (plannerTaskContract && plannerTaskContract.expected_mutations && plannerTaskContract.expected_mutations.length) {
      inputRoute.task_contract = plannerTaskContract;
    }
    const includeDialogueContext = Boolean(isVoiceConfirmedTask || inputRoute.inputType === "voice_session_task");
    return {
      user_message: String(objective || "").trim(),
      task_origin: String(options.source || ""),
      input_route: inputRoute,
      page_state: pageStateForPrompt,
      active_task: compactActiveTask(options.activeTask || {}),
      conversation_history: includeDialogueContext ? compactAgentMessages(options.agentMessages || []) : [],
      patient_store_summary: patientIndex,
      full_patient_index: [],
      speaker_turns: includeDialogueContext ? compactSpeakerTurns(options.speakerTurns || []) : [],
      task_contract: plannerTaskContract,
      audit_log_summary: getAuditLogSummary(3),
      connection_status: compactConnectionStatus(options.connectionStatus || {})
    };
  }

  function selectPlannerPatientIndex(patients, objective, pageState, contract) {
    const list = Array.isArray(patients) ? patients.filter(Boolean) : [];
    const rawText = String(objective || "");
    const upperText = rawText.toUpperCase();
    const target = contract && contract.target_patient || {};
    const targetId = String(target.patientId || "").toUpperCase();
    const targetName = String(target.name || "");
    const matches = list.filter(function (patient) {
      const patientId = String(patient.patientId || "").toUpperCase();
      const name = String(patient.name || "");
      const phone = String(patient.phone || "");
      return Boolean(
        (targetId && patientId === targetId) ||
        (targetName && name === targetName) ||
        (patientId && upperText.indexOf(patientId) >= 0) ||
        (name && rawText.indexOf(name) >= 0) ||
        (phone && rawText.indexOf(phone) >= 0)
      );
    });
    if (matches.length) return matches.slice(0, 5).map(compactPatientForPlanner).filter(Boolean);
    const activePatientId = String(pageState && (pageState.patientId || pageState.activePatient && pageState.activePatient.patientId) || "").toUpperCase();
    if (activePatientId) {
      const activeMatch = list.find(function (patient) {
        return String(patient.patientId || "").toUpperCase() === activePatientId;
      });
      if (activeMatch) return [compactPatientForPlanner(activeMatch)].filter(Boolean);
    }
    return list.slice(0, 12).map(compactPatientForPlanner).filter(Boolean);
  }

  function compactMutationContractForPlanner(contract) {
    if (!contract || !Array.isArray(contract.expected_mutations) || !contract.expected_mutations.length) return {};
    return {
      target_patient: {
        patientId: contract.target_patient && contract.target_patient.patientId || "",
        name: contract.target_patient && contract.target_patient.name || ""
      },
      expected_mutations: contract.expected_mutations.map(function (item) {
        return {
          field: item.field,
          value: item.value
        };
      }),
      requires_save: contract.requires_save !== false,
      requires_verification: contract.requires_verification !== false,
      source: contract.source || ""
    };
  }

  function buildRepairPayload(task, pageState, failedAction, result) {
    const patientIndex = compactPatientIndex(getFullPatientIndex());
    return {
      active_task: compactActiveTask(task || {}),
      page_state: compactPageStateForPrompt(pageState || {}),
      failed_action: sanitizeAction(failedAction || {}),
      action_result: compactActionResult(result || {}),
      patient_store_summary: patientIndex,
      full_patient_index: patientIndex,
      audit_log_summary: getAuditLogSummary(3)
    };
  }

  function compactPageStateForPrompt(pageState) {
    const state = pageState || {};
    const activePatient = compactPatient(state.activePatient || state.patient || state.selectedPatient);
    return {
      pageType: state.pageType || getPageType(),
      isLoginPage: Boolean(state.isLoginPage || (state.pageType || getPageType()) === "login"),
      isInHisContext: Boolean(state.isInHisContext || state.hisDemoAuthenticated || (state.loginState && (state.loginState.authenticated || state.loginState.isInHisContext))),
      hisDemoAuthenticated: Boolean(state.hisDemoAuthenticated || (state.loginState && state.loginState.authenticated)),
      loginState: state.loginState || null,
      path: state.path || (window.location && window.location.pathname) || "",
      title: state.title || document.title || "",
      patientId: state.patientId || (activePatient && activePatient.patientId) || "",
      activePatient: activePatient,
      selectedPatient: compactPatient(state.selectedPatient),
      currentFilter: state.currentFilter || null,
      visiblePatientList: compactPatientIndex(state.visiblePatientList || state.patientListSummary || []).slice(0, 20),
      fieldSchema: compactFieldSchema(state.fieldSchema),
      llmStatus: state.llmStatus || "",
      agentMode: state.agentMode || "",
      connectionStatus: compactConnectionStatus(state.connectionStatus || {})
    };
  }

  function compactPatientIndex(patients) {
    if (!Array.isArray(patients)) return [];
    return patients.map(compactPatient).filter(Boolean);
  }

  function compactPatient(patient) {
    if (!patient || typeof patient !== "object") return null;
    return {
      patientId: patient.patientId || "",
      name: patient.name || "",
      gender: patient.gender || "",
      age: patient.age || "",
      birthDate: patient.birthDate || "",
      phone: patient.phone || "",
      idNumber: patient.idNumber || "",
      department: patient.department || "",
      visitStatus: patient.visitStatus || "",
      chiefComplaint: truncateText(patient.chiefComplaint || "", 120)
    };
  }

  function compactPatientForPlanner(patient) {
    if (!patient || typeof patient !== "object") return null;
    return {
      patientId: patient.patientId || "",
      name: patient.name || "",
      gender: patient.gender || "",
      age: patient.age || "",
      birthDate: patient.birthDate || "",
      phone: patient.phone || "",
      department: patient.department || "",
      visitStatus: patient.visitStatus || "",
      chiefComplaint: truncateText(patient.chiefComplaint || "", 80)
    };
  }

  function compactFieldSchema(fields) {
    if (!Array.isArray(fields)) return [];
    return fields.map(function (field) {
      return {
        key: field.key || field.field || "",
        label: field.label || field.fieldLabel || "",
        type: field.type || field.fieldType || "",
        editable: field.editable !== false
      };
    }).filter(function (field) { return field.key || field.label; });
  }

  function compactAgentMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.slice(-4).map(function (message) {
      return {
        role: message.role || message.type || "",
        text: truncateText(message.text || message.content || message.message || "", 240)
      };
    }).filter(function (message) { return message.text; });
  }

  function compactSpeakerTurns(turns) {
    if (!Array.isArray(turns)) return [];
    return turns.slice(-8).map(function (turn) {
      return {
        role: turn.role || "",
        role_label: turn.role_label || "",
        text: truncateText(turn.text || "", 240),
        is_final: Boolean(turn.is_final)
      };
    }).filter(function (turn) { return turn.text; });
  }

  function compactActiveTask(task) {
    if (!task || !task.task_id) return {};
    return {
      task_id: task.task_id,
      objective: truncateText(task.objective || "", 300),
      status: task.status || "",
      waitingFor: task.waitingFor || task.waiting_for || (task.slots && task.slots.waitingFor) || "",
      current_step_index: task.current_step_index || 0,
      slots: sanitizeArgs(task.slots || {}),
      clarifications: Array.isArray(task.clarifications) ? task.clarifications.slice(-4) : [],
      precondition: task.precondition || null
    };
  }

  function compactInputRoute(route) {
    const value = route || {};
    const input = value.input || {};
    return {
      route: value.route || "",
      inputType: value.inputType || value.input_type || input.input_type || "",
      reason: value.reason || value.reason_code || "",
      confidence: typeof value.confidence === "number" ? value.confidence : null
    };
  }

  function compactConnectionStatus(status) {
    const value = status || {};
    return {
      backend: value.backend || value.backendStatus || "",
      llm: value.llm || value.llmStatus || "",
      agent: value.agent || value.agentMode || "",
      asr: value.asr || value.asrStatus || "",
      microphone: value.microphone || value.microphoneStatus || "",
      dataSource: value.dataSource || ""
    };
  }

  function compactActionResult(result) {
    if (!result || typeof result !== "object") return result || null;
    return {
      success: Boolean(result.success),
      action_type: result.action_type || result.type || "",
      page_before: result.page_before || "",
      page_after: result.page_after || "",
      changed_fields: result.changed_fields || result.changedFields || [],
      navigation_happened: Boolean(result.navigation_happened || result.navigated),
      error: result.error || result.message || "",
      observation: truncateText(result.observation || result.message || "", 300),
      usage: result.usage || result.usage_total || null,
      oldValue: result.oldValue,
      newValue: result.newValue,
      expectedValue: result.expectedValue,
      actualValue: result.actualValue,
      audit_id: result.audit_id || "",
      audit: result.audit || null,
      timing_breakdown: result.timing_breakdown || null,
      usage_source: result.usage_source || "",
      token_source: result.token_source || "",
      patientId: result.patientId || "",
      field: result.field || "",
      fieldLabel: result.fieldLabel || ""
    };
  }

  function truncateText(text, limit) {
    const value = String(text || "");
    const size = Number(limit || 240);
    return value.length > size ? value.slice(0, size) + "..." : value;
  }

  function addStepLog(task, message) {
    if (!task || !message) return;
    task.step_logs = Array.isArray(task.step_logs) ? task.step_logs : [];
    task.step_logs.push({
      at: new Date().toISOString(),
      message: String(message).slice(0, 500)
    });
    task.step_logs = task.step_logs.slice(-30);
  }

  function startStep(task, step) {
    if (!step.started_at) {
      const startedAtMs = Date.now();
      step.started_at = startedAtMs / 1000;
      step.started_at_ms = startedAtMs;
      step.started_mono_ms = nowMonoMs();
      step.finished_at = null;
      step.finished_at_ms = null;
      step.finished_mono_ms = null;
      step.elapsed_ms = 0;
      step.status = "running";
      ensureStepTiming(step);
      addProgress(task, "开始步骤：" + (step.goal || step.id || step.actionType), { step: compactStep(step) });
      saveTask(task);
    }
  }

  function addProgress(task, text, details) {
    if (!task || !text) return null;
    if (!isTerminalTaskStatus(task.status) && isArchivedTerminalTask(task.task_id)) {
      return null;
    }
    task.progress_messages = Array.isArray(task.progress_messages) ? task.progress_messages : [];
    const entry = {
      task_id: task.task_id || "",
      run_id: task.run_id || "",
      at: new Date().toISOString(),
      elapsed_ms: taskElapsedMs(task),
      text: String(text).slice(0, 600),
      details: details || {}
    };
    task.progress_messages.push(entry);
    task.progress_messages = task.progress_messages.slice(-80);
    dispatchProgress(entry);
    return entry;
  }

  function dispatchProgress(entry) {
    try {
      window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail: entry }));
    } catch (error) {}
  }

  function taskElapsedMs(task) {
    if (!task) return 0;
    if (isTerminalTaskStatus(task.status) && typeof task.elapsed_ms === "number" && task.elapsed_ms > 0) {
      return Math.max(0, Math.round(task.elapsed_ms));
    }
    return runningElapsedMs(task);
  }

  function stepElapsedMsForSummary(step) {
    if (!step) return null;
    const status = String(step.status || "").toLowerCase();
    if (status === "running" || status === "waiting_user") {
      return runningElapsedMs(step);
    }
    if (typeof step.elapsed_ms === "number") {
      return Math.max(0, Math.round(step.elapsed_ms));
    }
    if (step.finished_at_ms && step.started_at_ms) {
      return Math.max(0, Math.round(Number(step.finished_at_ms) - Number(step.started_at_ms)));
    }
    return null;
  }

  function emptyTaskTiming() {
    return TASK_TIMING_KEYS.reduce(function (acc, key) {
      acc[key] = 0;
      return acc;
    }, {});
  }

  function emptyStepBreakdown() {
    return STEP_BREAKDOWN_KEYS.reduce(function (acc, key) {
      acc[key] = 0;
      return acc;
    }, {});
  }

  function ensureTaskTiming(task) {
    if (!task) return emptyTaskTiming();
    const current = task.timing && typeof task.timing === "object" ? task.timing : {};
    task.timing = Object.assign(emptyTaskTiming(), current);
    return task.timing;
  }

  function addTaskTiming(task, key, ms) {
    if (!task || TASK_TIMING_KEYS.indexOf(key) < 0) return;
    const timing = ensureTaskTiming(task);
    timing[key] = Math.max(0, Math.round(Number(timing[key] || 0) + Number(ms || 0)));
    if (key === "observe_ms") {
      timing._base_observe_ms = Math.max(0, Math.round(Number(timing._base_observe_ms || 0) + Number(ms || 0)));
    }
  }

  function ensureStepTiming(step) {
    if (!step) return { breakdown: emptyStepBreakdown() };
    const startedAtMs = Number(step.started_at_ms || Date.now());
    const current = step.timing && typeof step.timing === "object" ? step.timing : {};
    const breakdown = Object.assign(emptyStepBreakdown(), current.breakdown || step.timing_breakdown || {});
    step.timing = Object.assign({}, current, {
      step_id: step.id || step.step_id || "",
      action: step.actionType || step.action_type || step.type || "",
      started_at: current.started_at || step.started_at || (startedAtMs / 1000),
      started_at_ms: current.started_at_ms || startedAtMs,
      started_mono_ms: current.started_mono_ms || step.started_mono_ms || null,
      finished_at: current.finished_at || step.finished_at || null,
      finished_at_ms: current.finished_at_ms || step.finished_at_ms || null,
      finished_mono_ms: current.finished_mono_ms || step.finished_mono_ms || null,
      elapsed_ms: isTerminalTaskStatus(step.status)
        ? (typeof current.elapsed_ms === "number" ? current.elapsed_ms : (typeof step.elapsed_ms === "number" ? step.elapsed_ms : 0))
        : runningElapsedMs(step),
      breakdown: breakdown
    });
    step.timing_breakdown = breakdown;
    return step.timing;
  }

  function addStepBreakdown(step, key, ms) {
    if (!step || STEP_BREAKDOWN_KEYS.indexOf(key) < 0) return;
    const timing = ensureStepTiming(step);
    timing.breakdown[key] = Math.max(0, Math.round(Number(timing.breakdown[key] || 0) + Number(ms || 0)));
    step.timing_breakdown = timing.breakdown;
  }

  function recordActionTiming(step, elapsedMs, result) {
    const breakdown = result && result.timing_breakdown && typeof result.timing_breakdown === "object" ? result.timing_breakdown : null;
    if (breakdown) {
      STEP_BREAKDOWN_KEYS.forEach(function (key) {
        if (typeof breakdown[key] === "number") addStepBreakdown(step, key, breakdown[key]);
      });
      if (typeof breakdown.execute_ms !== "number") {
        addStepBreakdown(step, "execute_ms", Math.max(0, Number(elapsedMs || 0) - Number(breakdown.demo_delay_ms || 0)));
      }
      return;
    }
    addStepBreakdown(step, "execute_ms", elapsedMs);
  }

  function finalizeStepTiming(step) {
    if (!step) return;
    const finishedAtMs = Number(step.finished_at_ms || Date.now());
    const timing = ensureStepTiming(step);
    timing.finished_at = step.finished_at || (finishedAtMs / 1000);
    timing.finished_at_ms = finishedAtMs;
    timing.finished_mono_ms = step.finished_mono_ms || nowMonoMs();
    timing.elapsed_ms = runningElapsedMs(step, finishedAtMs);
    timing.breakdown = Object.assign(emptyStepBreakdown(), timing.breakdown || {});
    step.timing = timing;
    step.timing_breakdown = timing.breakdown;
  }

  function updateTaskTiming(task) {
    if (!task) return;
    const timing = ensureTaskTiming(task);
    const plan = Array.isArray(task.plan) ? task.plan : [];
    let observeMs = Number(timing._base_observe_ms || timing.observe_ms || 0);
    let actionMs = 0;
    let verifyMs = 0;
    let animationMs = 0;
    let pageNavigationMs = 0;
    let waitMs = 0;
    plan.forEach(function (step) {
      const breakdown = step && (step.timing_breakdown || (step.timing && step.timing.breakdown)) || {};
      observeMs += Number(breakdown.before_observe_ms || 0) + Number(breakdown.after_observe_ms || 0);
      actionMs += Number(breakdown.execute_ms || 0);
      verifyMs += Number(breakdown.verify_ms || 0);
      animationMs += Number(breakdown.animation_ms || 0);
      pageNavigationMs += Number(breakdown.page_navigation_ms || 0);
      waitMs += Number(breakdown.wait_ms || 0);
    });
    timing.observe_ms = Math.max(0, Math.round(observeMs));
    timing.action_ms = Math.max(0, Math.round(actionMs));
    timing.verify_ms = Math.max(0, Math.round(verifyMs));
    timing.animation_ms = Math.max(0, Math.round(animationMs));
    timing.ui_animation_ms = timing.animation_ms;
    timing.page_navigation_ms = Math.max(0, Math.round(pageNavigationMs));
    timing.demo_delay_ms = Math.max(0, Math.round(plan.reduce(function (sum, step) {
      const breakdown = step && (step.timing_breakdown || (step.timing && step.timing.breakdown)) || {};
      return sum + Number(breakdown.demo_delay_ms || 0);
    }, 0)));
    timing.total_ms = taskElapsedMs(task);
    if (waitMs && !timing.wait_ms) {
      timing.wait_ms = Math.max(0, Math.round(waitMs));
    }
  }

  function addUsage(task, usage, stage) {
    if (!task || !usage || typeof usage !== "object") {
      if (task) addProgress(task, "后端未返回 token usage", { stage: stage || "" });
      return;
    }
    const next = normalizeUsage(usage);
    task.usage_last = next;
    task.usage_total = sumUsage(task.usage_total, next);
    addProgress(task, "Token：" + formatUsage(next) + " / 累计 " + formatUsage(task.usage_total), { usage: next, usageTotal: task.usage_total, stage: stage || "" });
  }

  function normalizeUsage(usage) {
    return {
      prompt_tokens: Number(usage && usage.prompt_tokens || 0),
      completion_tokens: Number(usage && usage.completion_tokens || 0),
      total_tokens: Number(usage && usage.total_tokens || 0)
    };
  }

  function sumUsage(a, b) {
    const left = normalizeUsage(a);
    const right = normalizeUsage(b);
    return {
      prompt_tokens: left.prompt_tokens + right.prompt_tokens,
      completion_tokens: left.completion_tokens + right.completion_tokens,
      total_tokens: left.total_tokens + right.total_tokens
    };
  }

  function formatUsage(usage) {
    const value = normalizeUsage(usage);
    return String(value.total_tokens);
  }

  function formatElapsed(ms) {
    const value = Math.max(0, Number(ms || 0));
    if (value < 1000) {
      return (value / 1000).toFixed(1) + "s";
    }
    if (value < 60000) {
      return (value / 1000).toFixed(1) + "s";
    }
    const totalSeconds = Math.floor(value / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    const secondText = String(seconds).padStart(2, "0");
    return String(minutes).padStart(2, "0") + ":" + secondText;
  }

  function compactStep(step) {
    return {
      id: step.id,
      goal: step.goal,
      actionType: step.actionType,
      action_type: step.action_type || step.actionType || "",
      requiredPage: step.requiredPage,
      args: sanitizeArgs(step.args || {}),
      status: step.status,
      source: step.source || BACKEND_LLM_SOURCE,
      started_at: step.started_at || null,
      started_at_ms: step.started_at_ms || null,
      started_mono_ms: step.started_mono_ms || null,
      finished_at: step.finished_at || null,
      finished_at_ms: step.finished_at_ms || null,
      finished_mono_ms: step.finished_mono_ms || null,
      elapsed_ms: stepElapsedMsForSummary(step),
      usage: step.usage || null,
      usage_source: step.usage_source || (step.usage ? "backend_llm" : "local_dom"),
      token_source: step.token_source || (step.usage ? "backend_llm" : "local_dom"),
      timing: step.timing || null,
      timing_breakdown: step.timing_breakdown || step.timing && step.timing.breakdown || null,
      error: step.error || "",
      result: compactActionResult(step.result || null)
    };
  }

  function compactAdapterResult(result) {
    if (!result) return null;
    return {
      success: Boolean(result.success),
      code: result.code || "",
      message: result.message || "",
      patientId: result.patientId || "",
      field: result.field || "",
      fieldLabel: result.fieldLabel || "",
      oldValue: result.oldValue,
      newValue: result.newValue,
      audit_id: result.audit_id || "",
      changedFields: result.changedFields || [],
      eventsDispatched: result.eventsDispatched || []
    };
  }

  function sanitizeAction(action) {
    return {
      type: action && action.type,
      source: action && action.source,
      task_id: action && action.task_id,
      step_id: action && action.step_id,
      args: sanitizeArgs(action && action.args ? action.args : {})
    };
  }

  function sanitizeArgs(args) {
    if (!args || typeof args !== "object") return {};
    if (Array.isArray(args)) return args.map(sanitizeArgs);
    const result = {};
    Object.keys(args).forEach(function (key) {
      const value = args[key];
      if (/password|passwd|pwd/i.test(key)) {
        result[key] = value ? "[redacted]" : "";
        return;
      }
      if (value && typeof value === "object") {
        result[key] = sanitizeArgs(value);
        return;
      }
      result[key] = value;
    });
    return result;
  }

  function stringifyValue(value) {
    if (value == null) return "";
    return String(value);
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return "{}";
    }
  }

  function getAuditLogSummary(limit) {
    if (!window.PatientStore || !window.PatientStore.getAuditLog) return [];
    return window.PatientStore.getAuditLog().slice(-Number(limit || 20)).map(function (item) {
      return {
        audit_id: item.audit_id || "",
        patientId: item.patientId || "",
        field: item.field || "",
        fieldLabel: item.fieldLabel || "",
        oldValue: item.oldValue || "",
        newValue: item.newValue || "",
        source: item.source || "",
        timestamp: item.timestamp || ""
      };
    });
  }

  function collectPageState() {
    return typeof window.collectHisPageState === "function" ? window.collectHisPageState() : { pageType: getPageType() };
  }

  function getPageType() {
    if (document.body && document.body.dataset.pageType) return document.body.dataset.pageType;
    const path = window.location.pathname.toLowerCase();
    if (path.endsWith("login.html")) return "login";
    if (path.endsWith("dashboard.html")) return "dashboard";
    if (path.endsWith("patient-management.html")) return "patientManagement";
    return "patientEditor";
  }

  function normalizeBackendUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function isExpired(task) {
    return Date.now() / 1000 - Number(task.updated_at || task.created_at || 0) > TASK_TTL_MS / 1000;
  }

  function retireInactiveTask(task) {
    if (!task) return null;
    if (["completed", "failed", "cancelled", "blocked_no_llm"].includes(task.status)) {
      appendHistory(task, "inactive task retired from current view");
      clearTask();
      return null;
    }
    if (isExpired(task)) {
      task.status = "failed";
      task.lastError = "任务超过 30 分钟未继续，已标记为 stale。";
      task.finished_at = Date.now() / 1000;
      task.finished_at_ms = Date.now();
      task.elapsed_ms = taskElapsedMs(task);
      appendHistory(task, task.lastError);
      clearTask();
      return null;
    }
    return task;
  }

  function loadTask() {
    try {
      const raw = window.localStorage.getItem(TASK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveTask(task) {
    if (!task) return false;
    if (!isTerminalTaskStatus(task.status) && isArchivedTerminalTask(task.task_id)) {
      return false;
    }
    task.updated_at = Date.now() / 1000;
    window.localStorage.setItem(TASK_KEY, JSON.stringify(task));
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ lastTaskId: task.task_id, updated_at: task.updated_at, lastStatus: task.status }));
    return true;
  }

  function clearTask() {
    window.localStorage.removeItem(TASK_KEY);
  }

  function isTerminalTaskStatus(status) {
    return TERMINAL_TASK_STATUSES.has(String(status || "").toLowerCase());
  }

  function isArchivedTerminalTask(taskId) {
    if (!taskId) return false;
    try {
      const history = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
      return history.some(function (item) {
        return item && item.task_id === taskId && isTerminalTaskStatus(item.status);
      });
    } catch (error) {
      return false;
    }
  }

  function isTaskStillActive(task) {
    if (!task || !task.task_id) return false;
    if (isArchivedTerminalTask(task.task_id)) return false;
    const active = loadTask();
    return Boolean(active && active.task_id === task.task_id && !isTerminalTaskStatus(active.status));
  }

  function appendHistory(task, message) {
    try {
      const history = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
      const exists = history.some(function (item) { return item.task_id === task.task_id && item.status === task.status; });
        const item = {
          task_id: task.task_id,
          run_id: task.run_id || "",
          objective: task.objective,
          status: task.status,
          source: task.source || BACKEND_LLM_SOURCE,
          agentMode: task.agentMode || task.mode || "",
          llmStatus: task.llmStatus || task.llm_status || "",
          message: message || "",
          created_at: task.created_at || null,
          created_at_ms: task.created_at_ms || null,
          started_at: task.started_at || task.created_at || null,
          started_at_ms: task.started_at_ms || null,
          started_mono_ms: task.started_mono_ms || null,
          finished_at: task.finished_at || Date.now() / 1000,
          finished_at_ms: task.finished_at_ms || Date.now(),
          finished_mono_ms: task.finished_mono_ms || null,
          elapsed_ms: task.elapsed_ms || taskElapsedMs(task),
          current_step_index: task.current_step_index,
          slots: sanitizeArgs(task.slots || {}),
          task_contract: task.task_contract || null,
          expected_mutations: Array.isArray(task.expected_mutations) ? task.expected_mutations.slice() : [],
          mutation_ledger: task.mutation_ledger || null,
          timing: task.timing || null,
          plan: Array.isArray(task.plan) ? task.plan.map(compactStep) : [],
          progress_messages: Array.isArray(task.progress_messages) ? task.progress_messages.slice(-80) : [],
          step_logs: Array.isArray(task.step_logs) ? task.step_logs.slice(-50) : [],
        usage_total: task.usage_total || null,
        usage_last: task.usage_last || null,
        lastError: task.lastError || ""
      };
      if (exists) {
        const nextHistory = history.map(function (entry) { return entry.task_id === item.task_id ? item : entry; });
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory.slice(-20)));
        return;
      }
      history.push(item);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-20)));
    } catch (error) {}
  }

  function persistTrace(stage, trace, parsed) {
    try {
      const state = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "{}");
      state.lastTrace = { stage: stage, trace: trace, parsed: parsed, at: new Date().toISOString() };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch (error) {}
    recordFlowTrace("backend_trace", {
      route: stage || "",
      action_payload: { stage: stage, trace: trace || {} },
      action_result: parsed || {}
    });
  }

  function recordFlowTrace(event, details) {
    try {
      if (!window.AgentFlowTrace || typeof window.AgentFlowTrace.record !== "function") return null;
      return window.AgentFlowTrace.record(event, details || {});
    } catch (error) {
      return null;
    }
  }

  function makeTaskId() {
    return "task_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function questionFromClarification(clarification) {
    return clarification && clarification.question ? clarification.question : "需要补充信息。";
  }

  function formatPatient(patient) {
    return [patient.patientId, patient.name, patient.gender, patient.department].filter(Boolean).join(" / ");
  }

  window.AgentTaskOrchestrator = {
    startTask: startTask,
    continueWaitingTask: continueWaitingTask,
    planTaskOnly: planTaskOnly,
    executePlannedTask: executePlannedTask,
    resume: resume,
    cancel: cancel,
    cancelActiveTask: cancelActiveTask,
    clearBlockedNoLlmTask: clearBlockedNoLlmTask,
    clearActiveTask: clearActiveTask,
    getTask: getTask,
    getHistory: getHistory,
    getSummary: getSummary,
    checkLlmConnected: checkLlmConnected
  };
})();
