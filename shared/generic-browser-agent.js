(function () {
  "use strict";

  const MAX_ELEMENTS = 180;
  let refCounter = 0;
  const elementMap = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function makeObservationId() {
    return "obs_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function visibleText(node) {
    return String(node && (node.innerText || node.textContent || "") || "").replace(/\s+/g, " ").trim();
  }

  function valueOf(node) {
    if (!node) return "";
    if (node.type === "checkbox" || node.type === "radio") return node.checked ? "true" : "false";
    if (node.value != null) return String(node.value);
    return visibleText(node);
  }

  function elementRole(node) {
    const explicit = node.getAttribute && node.getAttribute("role");
    if (explicit) return explicit;
    const tag = String(node.tagName || "").toLowerCase();
    const type = String(node.type || "").toLowerCase();
    if (tag === "button" || type === "button" || type === "submit") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textarea";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "date") return "date";
    if (tag === "input") return "textbox";
    if (tag === "tr") return "row";
    return tag || "element";
  }

  function labelFor(node) {
    if (!node) return "";
    const aria = node.getAttribute && (node.getAttribute("aria-label") || node.getAttribute("aria-labelledby"));
    if (aria) return aria.trim();
    const id = node.id || "";
    if (id) {
      const label = document.querySelector('label[for="' + cssEscape(id) + '"]');
      if (label) return visibleText(label);
    }
    const parentLabel = node.closest && node.closest("label");
    if (parentLabel) return visibleText(parentLabel);
    const name = node.getAttribute && (node.getAttribute("name") || node.getAttribute("placeholder") || node.getAttribute("title"));
    if (name) return String(name).trim();
    return visibleText(node).slice(0, 80);
  }

  function stableRef(node) {
    if (!node) return "";
    const existing = node.getAttribute && node.getAttribute("data-his-agent-ref");
    if (existing) {
      elementMap.set(existing, node);
      return existing;
    }
    const preferred = node.getAttribute && (node.getAttribute("data-testid") || node.getAttribute("data-field") || node.id || node.name);
    const ref = "el_" + (++refCounter) + "_" + String(preferred || elementRole(node)).replace(/[^\w-]+/g, "_").slice(0, 48);
    try {
      node.setAttribute("data-his-agent-ref", ref);
    } catch (error) {}
    elementMap.set(ref, node);
    return ref;
  }

  function rectOf(node) {
    const rect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    if (!rect) return {};
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function isEnabled(node) {
    return Boolean(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true";
  }

  function controlRecord(node) {
    const role = elementRole(node);
    const options = role === "combobox"
      ? Array.from(node.options || []).map(function (option) {
        return { value: option.value, label: visibleText(option) || option.label || option.value, selected: Boolean(option.selected) };
      })
      : [];
    return {
      element_ref: stableRef(node),
      role: role,
      accessible_name: labelFor(node),
      visible_text: visibleText(node).slice(0, 160),
      current_value: valueOf(node).slice(0, 500),
      options: options,
      enabled: isEnabled(node),
      visible: isVisible(node),
      required: Boolean(node.required || node.getAttribute("aria-required") === "true"),
      validation_state: node.validationMessage || node.getAttribute("aria-invalid") || "",
      bounding_box: rectOf(node)
    };
  }

  function collectControls() {
    const selector = [
      "button",
      "input",
      "textarea",
      "select",
      "a[href]",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='combobox']",
      "[role='checkbox']",
      "[role='radio']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    return Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .slice(0, MAX_ELEMENTS)
      .map(controlRecord);
  }

  function collectForms() {
    return Array.from(document.querySelectorAll("form")).slice(0, 20).map(function (form) {
      return {
        element_ref: stableRef(form),
        accessible_name: labelFor(form) || form.id || form.name || "",
        controls: Array.from(form.querySelectorAll("input, textarea, select, button")).filter(isVisible).map(function (node) {
          return stableRef(node);
        })
      };
    });
  }

  function collectTables() {
    return Array.from(document.querySelectorAll("table")).slice(0, 12).map(function (table) {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th")).map(visibleText).filter(Boolean);
      const rows = Array.from(table.querySelectorAll("tbody tr, tr")).slice(0, 12).map(function (row) {
        return Array.from(row.children).map(visibleText).filter(Boolean).slice(0, 12);
      }).filter(function (row) { return row.length; });
      return { element_ref: stableRef(table), headers: headers, rows: rows };
    });
  }

  function collectMessages(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(isVisible).slice(-8).map(function (node) {
      return visibleText(node).slice(0, 240);
    }).filter(Boolean);
  }

  function pageType() {
    if (document.body && document.body.dataset.pageType) return document.body.dataset.pageType;
    const path = location.pathname.toLowerCase();
    if (path.includes("login")) return "login";
    if (path.includes("dashboard")) return "dashboard";
    if (path.includes("patient-management")) return "patientManagement";
    if (path.includes("patient-editor")) return "patientEditor";
    if (path.includes("agent-history")) return "agentHistory";
    return "unknown";
  }

  function patientContext(pageState) {
    const state = pageState || {};
    const active = state.activePatient || state.patient || state.selectedPatient || {};
    const params = new URLSearchParams(location.search || "");
    return {
      patient_id: state.patientId || active.patientId || params.get("patientId") || null,
      patient_name: active.name || null
    };
  }

  function observeCurrentPage() {
    elementMap.clear();
    const state = typeof window.collectHisPageState === "function" ? window.collectHisPageState() : {};
    const observation = {
      observation_id: makeObservationId(),
      url: location.href,
      title: document.title || "",
      page_type: pageType(),
      timestamp: nowIso(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      focused_element: document.activeElement && document.activeElement !== document.body ? controlRecord(document.activeElement) : {},
      auth_context: {
        is_login_page: pageType() === "login",
        is_in_his_context: Boolean(state.isInHisContext || state.hisDemoAuthenticated || state.loginState && state.loginState.authenticated),
        demo_authenticated: Boolean(state.hisDemoAuthenticated || state.loginState && state.loginState.authenticated)
      },
      patient_context: patientContext(state),
      forms: collectForms(),
      controls: collectControls(),
      links: [],
      tables: collectTables(),
      dialogs: Array.from(document.querySelectorAll("[role='dialog'], dialog, .modal")).filter(isVisible).map(controlRecord),
      validation_messages: collectMessages(".error, .field-error, [role='alert'], .validation-message"),
      success_messages: collectMessages(".success, .toast-success, #saveStatus"),
      error_messages: collectMessages(".error, .toast-error, [role='alert']"),
      business_state: state || {},
      page_specific_state: {},
      screenshot_available: false
    };
    observation.links = observation.controls.filter(function (item) { return item.role === "link"; });
    if (window.AgentFlowTrace && typeof window.AgentFlowTrace.record === "function") {
      window.AgentFlowTrace.record("observe", { observation_id: observation.observation_id, page_type: observation.page_type });
    }
    return observation;
  }

  function findElement(ref) {
    if (!ref) return null;
    return elementMap.get(ref) || document.querySelector('[data-his-agent-ref="' + cssEscape(ref) + '"]');
  }

  function dispatchInputEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function sleep(ms) {
    await new Promise(function (resolve) { window.setTimeout(resolve, Number(ms || 0)); });
  }

  async function executeAction(action) {
    const before = observeCurrentPage();
    const request = action || {};
    const node = findElement(request.element_ref);
    if (!node && !["navigate", "back", "forward", "reload", "wait", "read"].includes(request.type)) {
      return actionResult(request, "failed", before, observeCurrentPage(), "element_not_found", "未找到 element_ref。");
    }
    if (node && !isEnabled(node)) {
      return actionResult(request, "failed", before, observeCurrentPage(), "element_disabled", "目标控件不可用。");
    }
    try {
      switch (request.type) {
        case "click":
          node.focus();
          node.click();
          break;
        case "double_click":
          node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
          break;
        case "hover":
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          break;
        case "focus":
          node.focus();
          break;
        case "clear":
          node.value = "";
          dispatchInputEvents(node);
          break;
        case "type":
          node.focus();
          node.value = String(request.value == null ? "" : request.value);
          dispatchInputEvents(node);
          break;
        case "select_option":
          node.value = String(request.value == null ? "" : request.value);
          dispatchInputEvents(node);
          break;
        case "set_date":
          node.value = String(request.value == null ? "" : request.value);
          dispatchInputEvents(node);
          break;
        case "check":
        case "uncheck":
          node.checked = request.type === "check";
          dispatchInputEvents(node);
          break;
        case "press_key":
          node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: String(request.value || "Enter") }));
          node.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: String(request.value || "Enter") }));
          break;
        case "scroll":
          (node || window).scrollBy(0, Number(request.value || 320));
          break;
        case "submit":
          if (node.tagName && node.tagName.toLowerCase() === "form") node.requestSubmit ? node.requestSubmit() : node.submit();
          else {
            const form = node.closest && node.closest("form");
            if (form && form.requestSubmit) form.requestSubmit();
            else node.click();
          }
          break;
        case "navigate":
          location.href = String(request.value || request.url || "");
          break;
        case "back":
          history.back();
          break;
        case "forward":
          history.forward();
          break;
        case "reload":
          location.reload();
          break;
        case "wait":
          await sleep(request.timeout_ms || request.value || 300);
          break;
        case "read":
          break;
        default:
          return actionResult(request, "failed", before, observeCurrentPage(), "unsupported_action", "未知通用动作。");
      }
      await sleep(request.settle_ms || 120);
      const after = observeCurrentPage();
      return actionResult(request, "completed", before, after, null, "动作已执行并完成重新观察。");
    } catch (error) {
      return actionResult(request, "failed", before, observeCurrentPage(), "exception", error && error.message || String(error));
    }
  }

  function actionResult(action, status, before, after, errorCode, message) {
    const result = {
      action_id: action && action.action_id || "act_" + Date.now().toString(36),
      status: status,
      before_observation_id: before && before.observation_id || "",
      after_observation_id: after && after.observation_id || "",
      error_code: errorCode || null,
      message: message || "",
      evidence: {
        before_page_type: before && before.page_type || "",
        after_page_type: after && after.page_type || "",
        before_url: before && before.url || "",
        after_url: after && after.url || ""
      },
      before_observation: before,
      after_observation: after
    };
    if (window.AgentFlowTrace && typeof window.AgentFlowTrace.record === "function") {
      window.AgentFlowTrace.record("generic_action", { action_payload: action || {}, action_result: result });
    }
    return result;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  window.HisAgentBrowser = {
    observeCurrentPage: observeCurrentPage,
    executeAction: executeAction,
    _findElement: findElement
  };
  window.observeCurrentPage = observeCurrentPage;
})();
