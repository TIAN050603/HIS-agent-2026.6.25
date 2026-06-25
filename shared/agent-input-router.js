(function () {
  "use strict";

  const INPUT_TYPES = [
    "text_task",
    "voice_text",
    "topic_click",
    "button_click",
    "confirmation",
    "clarification",
    "cancellation",
    "voice_session_task"
  ];

  function makeId() {
    return "input_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeInput(input) {
    const raw = input || {};
    const text = String(raw.text || raw.value || "").trim();
    const inputType = INPUT_TYPES.indexOf(raw.input_type) >= 0 ? raw.input_type : inferInputType(text, raw);
    return {
      input_id: raw.input_id || makeId(),
      input_type: inputType,
      text: text,
      source_view: raw.source_view || raw.sourceView || "chatView",
      active_task_id: raw.active_task_id || raw.activeTaskId || null,
      conversation_state: raw.conversation_state || raw.conversationState || "idle",
      created_at: raw.created_at || new Date().toISOString()
    };
  }

  function inferInputType(text, raw) {
    if (raw && raw.kind === "voice_session_task") return "voice_session_task";
    if (raw && raw.kind === "voice_text") return "voice_text";
    if (isCancellation(text)) return "cancellation";
    if (isConfirmation(text)) return "confirmation";
    return "text_task";
  }

  function routeInput(input, context) {
    const normalized = normalizeInput(input);
    const activeTask = context && context.activeTask ? context.activeTask : null;
    const taskStatus = String(activeTask && activeTask.status || "").toLowerCase();

    if (normalized.input_type === "voice_text") {
      return routed(normalized, "fill_input_only", 1, "voice_text_dictation");
    }
    if (normalized.input_type === "voice_session_task") {
      return routed(normalized, "create_voice_task_draft", 1, "voice_session_task");
    }
    if (normalized.input_type === "topic_click" || normalized.input_type === "button_click") {
      return routed(normalized, "manual_navigation", 1, "explicit_ui_action");
    }
    if (isCancellation(normalized.text)) {
      return routed(normalized, "cancel_active_task", 1, "explicit_cancel");
    }

    if (taskStatus === "waiting_user") {
      if (isExplicitNewTask(normalized.text) || isLikelyStandaloneTask(normalized.text, activeTask)) {
        return routed(normalized, "ask_disambiguation", 0.9, "active_task_new_task_conflict");
      }
      if (isConfirmation(normalized.text)) {
        return routed(normalized, "confirm_active_task", 0.9, "active_task_confirmation");
      }
      return routed(normalized, "continue_active_task", 0.85, "active_task_clarification");
    }

    if (taskStatus === "running" || taskStatus === "planning") {
      if (isExplicitNewTask(normalized.text)) {
        return routed(normalized, "ask_disambiguation", 0.9, "running_task_new_task_conflict");
      }
      return routed(normalized, "ask_disambiguation", 0.7, "task_already_running");
    }

    if (!normalized.text) {
      return routed(normalized, "casual_chat", 0.5, "empty_input");
    }

    return routed(normalized, "start_new_task", 0.8, "text_task");
  }

  function routed(input, route, confidence, reason) {
    return {
      input: input,
      route: route,
      confidence: confidence,
      reason_code: reason
    };
  }

  function isCancellation(text) {
    return /^(cancel|stop|no)$/i.test(String(text || "").trim()) || /取消|停止|算了|不要执行|不用了/.test(String(text || ""));
  }

  function isConfirmation(text) {
    return /^(yes|y|ok|continue)$/i.test(String(text || "").trim()) || /^(是|好|好的|可以|继续|确认|执行|使用默认账号|用默认账号)$/.test(String(text || "").trim());
  }

  function isExplicitNewTask(text) {
    return /新任务|重新开始|开始新任务|不管刚才|取消旧任务|另一个任务/.test(String(text || ""));
  }

  function isLikelyStandaloneTask(text, activeTask) {
    const value = String(text || "").trim();
    if (!value || isCancellation(value) || isConfirmation(value)) return false;
    const waitingFor = String(activeTask && (activeTask.waitingFor || activeTask.waiting_for || activeTask.slots && activeTask.slots.waitingFor) || "").toLowerCase();
    const hasPatientRef = /P\d{3}|张伟|李娜|王强|陈敏|赵磊|刘洋|孙芳|周杰|吴敏|郑强|患者/.test(value);
    const hasActionIntent = /修改|改为|改成|更新|保存|打开|登录|生成|记录|填写|补充|删除|新增|设置|写入|执行|change|update|save|login|open/i.test(value);
    if (!hasPatientRef || !hasActionIntent) return false;
    if (value.length <= 18 && (waitingFor === "patient" || waitingFor === "field")) return false;
    return true;
  }

  window.AgentInputRouter = {
    normalizeInput: normalizeInput,
    routeInput: routeInput,
    isCancellation: isCancellation,
    isConfirmation: isConfirmation,
    isExplicitNewTask: isExplicitNewTask,
    isLikelyStandaloneTask: isLikelyStandaloneTask
  };
})();
