(function () {
  "use strict";

  const DEFAULT_FLASH_MS = 1400;
  const DEFAULT_TOAST_MS = 1800;

  function sleep(ms) {
    const duration = isFastMode() ? Math.min(Number(ms || 0), 18) : Number(ms || 0);
    return new Promise(function (resolve) { window.setTimeout(resolve, Math.max(0, duration)); });
  }

  function flashElement(element, type) {
    const node = resolveElement(element);
    if (!node) return warn("flashElement target missing");
    const kind = type || "agent";
    restartClasses(node, ["agent-action-target", "agent-field-changed", "agent-field-saved", "agent-row-highlight", "his-ui-flash", "his-ui-flash-agent", "his-ui-flash-change", "his-ui-flash-verify"]);
    node.classList.add("his-ui-flash", "his-ui-flash-" + kind);
    if (kind === "change") node.classList.add("agent-field-changed", "his-agent-field-flash");
    if (kind === "save") node.classList.add("agent-field-saved", "agent-save-pulse", "his-agent-save-pulse");
    if (kind === "row") node.classList.add("agent-row-highlight", "his-agent-row-flash");
    window.setTimeout(function () {
      node.classList.remove("his-ui-flash", "his-ui-flash-" + kind, "agent-field-changed", "agent-field-saved", "agent-row-highlight", "his-agent-field-flash", "his-agent-row-flash", "agent-save-pulse", "his-agent-save-pulse");
    }, flashDuration());
    return true;
  }

  function pulseElement(element, type) {
    const node = resolveElement(element);
    if (!node) return warn("pulseElement target missing");
    const kind = type || "agent";
    restartClasses(node, ["his-ui-pulse", "his-ui-pulse-" + kind, "agent-action-target"]);
    node.classList.add("his-ui-pulse", "his-ui-pulse-" + kind, "agent-action-target");
    window.setTimeout(function () {
      node.classList.remove("his-ui-pulse", "his-ui-pulse-" + kind, "agent-action-target");
    }, isFastMode() ? 80 : 900);
    return true;
  }

  async function agentClickElement(element, options) {
    const settings = options || {};
    const node = resolveElement(element);
    if (!node) return warn("agentClickElement target missing");
    if (settings.message) showAgentActionToast(settings.message, settings.type || "info");
    node.classList.add("agent-action-target");
    pulseElement(node, "agent");
    await sleep(settings.beforeMs || 90);
    node.classList.add("agent-action-clicking");
    await sleep(settings.pressMs || 90);
    node.classList.remove("agent-action-clicking");
    flashElement(node, settings.type || "agent");
    if (settings.click !== false && typeof node.click === "function") {
      node.click();
    }
    await sleep(settings.afterMs || 120);
    return true;
  }

  async function agentFocusField(element, options) {
    const settings = options || {};
    const node = resolveElement(element);
    if (!node) return warn("agentFocusField target missing");
    const container = fieldContainer(node);
    if (settings.message) showAgentActionToast(settings.message, "info");
    [container, node].filter(Boolean).forEach(function (target) {
      target.classList.add("agent-action-target", "agent-field-editing");
    });
    try {
      if (typeof node.focus === "function") node.focus({ preventScroll: true });
      if (settings.select !== false && typeof node.select === "function") node.select();
    } catch (error) {}
    await sleep(settings.holdMs || 120);
    return true;
  }

  async function agentClearAndType(element, value, options) {
    const settings = options || {};
    const node = resolveElement(element);
    if (!node) return warn("agentClearAndType target missing");
    const nextValue = String(value == null ? "" : value);
    await agentFocusField(node, {
      message: settings.message || ("Agent 正在修改：" + (settings.label || fieldLabel(node))),
      holdMs: settings.holdMs,
      select: true
    });
    node.classList.add("agent-field-editing");
    await sleep(settings.beforeClearMs || 90);
    setControlValue(node, "");
    dispatchControlEvents(node, ["input"]);
    await sleep(settings.afterClearMs || 70);
    const chunks = chunkText(nextValue, settings.chunkSize || (nextValue.length > 48 ? 8 : 2));
    let current = "";
    for (const chunk of chunks) {
      current += chunk;
      setControlValue(node, current);
      dispatchControlEvents(node, ["input"]);
      await sleep(settings.typeDelayMs || 28);
    }
    setControlValue(node, nextValue);
    dispatchControlEvents(node, ["input", "change"]);
    node.classList.remove("agent-field-editing");
    flashElement(node, "change");
    showAgentActionToast("已修改：" + (settings.label || fieldLabel(node)), "success");
    return { updated: true, events: ["input", "change"], visualized: true };
  }

  async function agentSelectOption(selectEl, value, label, options) {
    const settings = options || {};
    const node = resolveElement(selectEl);
    if (!node) return warn("agentSelectOption target missing");
    const text = label || optionLabel(node, value) || String(value == null ? "" : value);
    await agentFocusField(node, {
      message: settings.message || ("Agent 正在选择：" + text),
      holdMs: settings.holdMs || 130,
      select: false
    });
    showAgentActionToast("选择：" + text, "info");
    node.classList.add("agent-field-editing");
    await sleep(settings.beforeSetMs || 160);
    setControlValue(node, value);
    dispatchControlEvents(node, ["input", "change"]);
    node.classList.remove("agent-field-editing");
    flashElement(node, "change");
    showAgentActionToast("已选择：" + text, "success");
    return { updated: true, events: ["input", "change"], visualized: true };
  }

  async function agentSetDate(inputEl, value, options) {
    const settings = options || {};
    const node = resolveElement(inputEl);
    if (!node) return warn("agentSetDate target missing");
    const oldValue = node.value || "";
    const nextValue = String(value == null ? "" : value);
    await agentFocusField(node, {
      message: settings.message || ("Agent 正在修改日期：" + (oldValue || "空") + " -> " + nextValue),
      holdMs: settings.holdMs,
      select: true
    });
    await sleep(settings.beforeClearMs || 90);
    setControlValue(node, "");
    dispatchControlEvents(node, ["input"]);
    await sleep(settings.afterClearMs || 70);
    setControlValue(node, nextValue);
    dispatchControlEvents(node, ["input", "change"]);
    flashElement(node, "change");
    showAgentActionToast("日期已修改：" + nextValue, "success");
    return { updated: true, events: ["input", "change"], visualized: true };
  }

  function markAgentClick(element) {
    const node = resolveElement(element);
    if (!node) return warn("markAgentClick target missing");
    node.classList.add("agent-action-clicking");
    window.setTimeout(function () { node.classList.remove("agent-action-clicking"); }, isFastMode() ? 80 : 260);
    return flashElement(node, "agent");
  }

  function highlightChangedField(fieldName) {
    const field = String(fieldName || "").trim();
    if (!field) return false;
    const target = document.querySelector('[data-field="' + cssEscape(field) + '"]');
    if (!target) return warn("highlightChangedField target missing: " + field);
    const container = fieldContainer(target);
    flashElement(container || target, "change");
    return flashElement(target, "change");
  }

  function highlightPatientRow(patientId) {
    const id = String(patientId || "").toUpperCase();
    if (!id) return false;
    const target = document.querySelector('[data-patient-id="' + cssEscape(id) + '"]');
    if (!target) return warn("highlightPatientRow target missing: " + id);
    const name = target.querySelector("strong") ? target.querySelector("strong").textContent : id;
    showAgentActionToast("Agent 已定位患者：" + id + (name && name !== id ? " " + name : ""), "info");
    return flashElement(target, "row");
  }

  function showAgentActionToast(message, type) {
    const text = String(message || "").trim();
    if (!text) return false;
    let toast = document.getElementById("hisAgentActionToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "hisAgentActionToast";
      toast.className = "agent-action-toast his-agent-action-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.dataset.type = type || "info";
    toast.classList.add("show");
    window.clearTimeout(toast.__hisToastTimer);
    toast.__hisToastTimer = window.setTimeout(function () {
      toast.classList.remove("show");
    }, isFastMode() ? 120 : DEFAULT_TOAST_MS);
    return true;
  }

  function handleFeedbackEvent(event) {
    const detail = event && event.detail ? event.detail : {};
    if (detail.field) highlightChangedField(detail.field);
    if (Array.isArray(detail.changedFields)) {
      detail.changedFields.slice(0, 3).forEach(highlightChangedField);
    }
    if (detail.patientId) highlightPatientRow(detail.patientId);
    if (detail.kind === "patient_saved") {
      flashElement(document.querySelector("#saveButton, [data-agent-action='save-patient'], button[type='submit']"), "save");
      showAgentActionToast("已保存 / 已同步 / 已记录 audit log", "success");
    } else if (detail.kind === "field_updated") {
      showAgentActionToast("已修改：" + (detail.fieldLabel || detail.field || "字段"), "success");
    } else if (detail.kind === "patient_verified") {
      showAgentActionToast("Agent 已完成校验", "success");
    } else if (detail.message) {
      showAgentActionToast(detail.message, detail.type || "info");
    }
  }

  function bindManualClickFeedback() {
    document.addEventListener("click", function (event) {
      const target = event.target.closest("button, .button-link, .btn, .nav-item, [data-his-entry], .his-agent-topic-card");
      if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") return;
      pulseElement(target, "manual");
    }, true);
  }

  function dispatchControlEvents(node, eventNames) {
    const events = [];
    (eventNames || ["input", "change"]).forEach(function (eventName) {
      node.dispatchEvent(new Event(eventName, { bubbles: true }));
      events.push(eventName);
    });
    return events;
  }

  function setControlValue(node, value) {
    if (!node) return;
    if (node.type === "checkbox") {
      node.checked = Boolean(value);
    } else {
      node.value = value;
    }
  }

  function chunkText(text, size) {
    const value = String(text || "");
    const count = Math.max(1, Number(size || 2));
    const chunks = [];
    for (let index = 0; index < value.length; index += count) chunks.push(value.slice(index, index + count));
    return chunks.length ? chunks : [""];
  }

  function fieldContainer(node) {
    return node && node.closest ? node.closest(".field-card, .detail-item, label, td, tr, .module-card") : null;
  }

  function fieldLabel(node) {
    const container = fieldContainer(node);
    const label = container && container.querySelector ? container.querySelector("label, strong") : null;
    return label ? label.textContent.trim() : node.getAttribute("data-field") || "字段";
  }

  function optionLabel(selectEl, value) {
    const options = Array.from(selectEl.options || []);
    const found = options.find(function (option) { return option.value === String(value); });
    return found ? found.textContent.trim() : "";
  }

  function resolveElement(element) {
    if (!element) return null;
    if (typeof element === "string") return document.querySelector(element);
    return element.nodeType === 1 ? element : null;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function restartClasses(node, classes) {
    node.classList.remove.apply(node.classList, classes);
    void node.offsetWidth;
  }

  function flashDuration() {
    return isFastMode() ? 100 : DEFAULT_FLASH_MS;
  }

  function isFastMode() {
    return Boolean(window.__HIS_AGENT_FAST_ANIMATION__);
  }

  function warn(message) {
    if (window.console && typeof window.console.warn === "function") {
      window.console.warn("[HisUiActionFeedback] " + message);
    }
    return false;
  }

  window.HisUiActionFeedback = {
    sleep: sleep,
    flashElement: flashElement,
    pulseElement: pulseElement,
    agentClickElement: agentClickElement,
    agentFocusField: agentFocusField,
    agentClearAndType: agentClearAndType,
    agentSelectOption: agentSelectOption,
    agentSetDate: agentSetDate,
    highlightChangedField: highlightChangedField,
    highlightPatientRow: highlightPatientRow,
    showAgentActionToast: showAgentActionToast,
    markAgentClick: markAgentClick,
    dispatchControlEvents: dispatchControlEvents
  };

  window.addEventListener("his-agent-ui-feedback", handleFeedbackEvent);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindManualClickFeedback, { once: true });
  } else {
    bindManualClickFeedback();
  }
})();
