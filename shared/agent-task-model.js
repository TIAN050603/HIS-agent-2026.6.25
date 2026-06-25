(function () {
  "use strict";

  const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "blocked_no_llm"];

  function normalizeUsage(usage) {
    if (!usage || typeof usage !== "object") return null;
    return {
      prompt_tokens: Number(usage.prompt_tokens || 0),
      completion_tokens: Number(usage.completion_tokens || 0),
      total_tokens: Number(usage.total_tokens || 0)
    };
  }

  function normalizeTask(task, options) {
    const source = task || {};
    const settings = options || {};
    const now = Date.now();
    const startedAtMs = Number(source.started_at_ms || 0) || (source.started_at ? Math.round(Number(source.started_at) * 1000) : 0);
    const createdAtMs = Number(source.created_at_ms || 0) || (source.created_at ? Math.round(Number(source.created_at) * 1000) : now);
    const normalized = Object.assign({}, source, {
      task_id: source.task_id || settings.task_id || makeTaskId(),
      objective: source.objective || settings.objective || "",
      source: source.source || settings.source || "backend_llm",
      status: source.status || "planning",
      waitingFor: source.waitingFor || source.waiting_for || (source.slots && source.slots.waitingFor) || null,
      slots: source.slots && typeof source.slots === "object" ? source.slots : {},
      clarifications: Array.isArray(source.clarifications) ? source.clarifications : [],
      related_patient: source.related_patient || source.relatedPatient || null,
      created_at: source.created_at || createdAtMs / 1000,
      created_at_ms: createdAtMs,
      started_at: source.started_at || (startedAtMs ? startedAtMs / 1000 : null),
      started_at_ms: startedAtMs || null,
      finished_at: source.finished_at || null,
      finished_at_ms: source.finished_at_ms || null,
      elapsed_ms: Number(source.elapsed_ms || 0),
      usage_last: normalizeUsage(source.usage_last),
      usage_total: normalizeUsage(source.usage_total),
      plan: Array.isArray(source.plan) ? source.plan.map(normalizeStep) : [],
      audit_ids: Array.isArray(source.audit_ids) ? source.audit_ids.slice() : [],
      last_error: source.last_error || source.lastError || null
    });
    if (!normalized.elapsed_ms && normalized.started_at_ms) {
      const end = normalized.finished_at_ms || now;
      normalized.elapsed_ms = Math.max(0, end - normalized.started_at_ms);
    }
    return normalized;
  }

  function normalizeStep(step, index) {
    const source = step || {};
    return Object.assign({}, source, {
      step_id: source.step_id || source.id || ("step_" + (Number(index || 0) + 1)),
      id: source.id || source.step_id || ("step_" + (Number(index || 0) + 1)),
      title: source.title || source.goal || source.actionType || source.action || "",
      action: source.action || source.actionType || source.action_type || "",
      page: source.page || source.requiredPage || "",
      status: source.status || "pending",
      started_at: source.started_at || null,
      started_at_ms: source.started_at_ms || null,
      finished_at: source.finished_at || null,
      finished_at_ms: source.finished_at_ms || null,
      elapsed_ms: typeof source.elapsed_ms === "number" ? source.elapsed_ms : null,
      usage: normalizeUsage(source.usage),
      oldValue: source.oldValue === undefined ? null : source.oldValue,
      newValue: source.newValue === undefined ? null : source.newValue,
      audit_id: source.audit_id || null,
      error: source.error || null,
      details: source.details || {}
    });
  }

  function isTerminal(task) {
    return TERMINAL_STATUSES.indexOf(String(task && task.status || "")) >= 0;
  }

  function makeTaskId() {
    return "task_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  window.AgentTaskModel = {
    TERMINAL_STATUSES: TERMINAL_STATUSES.slice(),
    normalizeTask: normalizeTask,
    normalizeStep: normalizeStep,
    normalizeUsage: normalizeUsage,
    isTerminal: isTerminal
  };
})();
