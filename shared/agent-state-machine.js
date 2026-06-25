(function () {
  "use strict";

  const STATES = [
    "home",
    "idle",
    "chatting",
    "planning",
    "task_running",
    "waiting_user",
    "voice_idle",
    "voice_recording",
    "voice_review",
    "voice_task_draft_ready",
    "confirm_execute",
    "completed",
    "failed",
    "cancelled"
  ];

  const ALLOWED = {
    home: ["idle", "chatting", "voice_idle", "planning", "cancelled"],
    idle: ["home", "chatting", "planning", "voice_idle", "cancelled"],
    chatting: ["home", "planning", "task_running", "waiting_user", "voice_idle", "voice_review", "completed", "failed", "cancelled"],
    planning: ["task_running", "waiting_user", "failed", "completed", "cancelled", "chatting"],
    task_running: ["waiting_user", "completed", "failed", "cancelled", "chatting"],
    waiting_user: ["planning", "task_running", "completed", "failed", "cancelled", "chatting"],
    voice_idle: ["home", "chatting", "voice_recording", "voice_review", "cancelled"],
    voice_recording: ["voice_idle", "voice_review", "voice_task_draft_ready", "failed", "cancelled"],
    voice_review: ["voice_idle", "voice_task_draft_ready", "confirm_execute", "chatting", "cancelled"],
    voice_task_draft_ready: ["confirm_execute", "chatting", "voice_idle", "cancelled"],
    confirm_execute: ["planning", "task_running", "completed", "failed", "cancelled"],
    completed: ["home", "idle", "chatting", "planning"],
    failed: ["home", "idle", "chatting", "planning"],
    cancelled: ["home", "idle", "chatting", "planning"]
  };

  function normalizeState(value) {
    const text = String(value || "home").trim();
    return STATES.indexOf(text) >= 0 ? text : "home";
  }

  function createMachine(options) {
    const settings = options || {};
    let current = normalizeState(settings.initialState || "home");
    let transitions = Array.isArray(settings.transitions) ? settings.transitions.slice(-80) : [];
    const onTransition = typeof settings.onTransition === "function" ? settings.onTransition : null;

    function transition(to, event, details) {
      const next = normalizeState(to);
      const allowed = ALLOWED[current] || [];
      if (next !== current && allowed.indexOf(next) < 0) {
        return {
          ok: false,
          from: current,
          to: next,
          event: String(event || "unknown"),
          reason: "invalid_transition"
        };
      }
      const item = {
        from: current,
        to: next,
        event: String(event || "unknown"),
        task_id: details && details.task_id ? String(details.task_id) : "",
        at: new Date().toISOString()
      };
      current = next;
      transitions.push(item);
      transitions = transitions.slice(-80);
      if (onTransition) {
        onTransition(item, transitions.slice());
      }
      return Object.assign({ ok: true }, item);
    }

    return {
      getState: function () {
        return current;
      },
      setState: function (state, event, details) {
        current = normalizeState(state);
        return transition(current, event || "set_state", details || {});
      },
      transition: transition,
      getTransitions: function () {
        return transitions.slice();
      },
      canTransition: function (to) {
        const next = normalizeState(to);
        return next === current || (ALLOWED[current] || []).indexOf(next) >= 0;
      }
    };
  }

  window.AgentStateMachine = {
    STATES: STATES.slice(),
    ALLOWED: ALLOWED,
    normalizeState: normalizeState,
    createMachine: createMachine
  };
})();
