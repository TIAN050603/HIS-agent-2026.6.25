(function () {
  "use strict";

  const TRACE_KEY = "hisAgentFlowTrace";
  const MAX_EVENTS = 240;

  function now() {
    return new Date().toISOString();
  }

  function safeClone(value, depth) {
    if (depth > 4) return "[depth_limit]";
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(function (item) {
      return safeClone(item, depth + 1);
    });
    return Object.keys(value).slice(0, 80).reduce(function (result, key) {
      const lower = key.toLowerCase();
      if (lower.indexOf("password") >= 0 || lower.indexOf("token") >= 0 || lower.indexOf("key") >= 0 || lower.indexOf("secret") >= 0) {
        result[key] = value[key] ? "***" : "";
        return result;
      }
      result[key] = safeClone(value[key], depth + 1);
      return result;
    }, {});
  }

  function readEvents() {
    try {
      const raw = window.localStorage.getItem(TRACE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeEvents(events) {
    try {
      window.localStorage.setItem(TRACE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch (error) {}
  }

  function pagePatient() {
    const state = typeof window.collectHisPageState === "function" ? window.collectHisPageState() : {};
    const patient = state.activePatient || state.patient || state.selectedPatient || {};
    const params = new URLSearchParams(window.location.search || "");
    return {
      page_type: state.pageType || (document.body && document.body.dataset.pageType) || "",
      url_patient_id: params.get("patientId") || "",
      page_patient_id: state.patientId || patient.patientId || "",
      page_patient_name: patient.name || "",
      dom_patient_id: textFromSelectors(["[data-patient-id]", "#patientId", "[data-field='patientId']"]),
      dom_patient_name: textFromSelectors(["[data-patient-name]", "#patientName", "[data-field='name']"])
    };
  }

  function textFromSelectors(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const value = node.value != null ? node.value : (node.dataset && (node.dataset.patientId || node.dataset.patientName)) || node.textContent;
      const text = String(value || "").trim();
      if (text) return text.slice(0, 80);
    }
    return "";
  }

  function record(event, details) {
    const payload = details || {};
    const entry = Object.assign({
      at: now(),
      event: event || "",
      task_id: "",
      conversation_state: "",
      route: "",
      page_type: document.body && document.body.dataset.pageType || "",
      url: window.location && window.location.href || "",
      action: "",
      step_id: "",
      task_slots: {},
      resolved_patient: {},
      page_patient: pagePatient(),
      action_payload: {},
      action_result: {},
      view_state: "",
      scroll_state: "",
      error: null
    }, safeClone(payload, 0));
    const events = readEvents();
    events.push(entry);
    writeEvents(events);
    return entry;
  }

  function clear() {
    writeEvents([]);
  }

  function getEvents() {
    return readEvents();
  }

  function latest(filter) {
    const events = readEvents();
    if (!filter) return events[events.length - 1] || null;
    return events.slice().reverse().find(function (item) {
      return item.event === filter || item.action === filter || item.route === filter;
    }) || null;
  }

  window.AgentFlowTrace = {
    record: record,
    clear: clear,
    getEvents: getEvents,
    latest: latest
  };
})();
