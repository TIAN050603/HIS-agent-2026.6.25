(function () {
  "use strict";

  async function applyPatientEditorAction(action, context) {
    const settings = context || {};
    const currentPatientId = String(settings.patientId || getCurrentPatientId()).toUpperCase();
    if (!action || !action.type) return adapterResult(false, "empty_action", "缺少结构化 action。");

    if (action.type === "update_patient_field" || action.type === "set_field" || action.type === "set_select" || action.type === "set_input" || action.type === "set_radio" || action.type === "set_checkbox") {
      const fieldInput = getActionField(action);
      const value = getActionValue(action);
      return await updatePatientEditorField(currentPatientId, fieldInput, value, Object.assign({}, settings, { action: action }));
    }
    if (action.type === "update_patient_fields") {
      const updates = Array.isArray((action.args || {}).updates) ? (action.args || {}).updates : [];
      const changed = [];
      for (const update of updates) {
        const result = await updatePatientEditorField(currentPatientId, update.field || update.fieldLabel || update.query, update.value, Object.assign({}, settings, { action: action }));
        if (!result.success) return result;
        changed.push(result.field);
      }
      return adapterResult(true, "updated_fields", "已更新 " + changed.length + " 个字段。", { changedFields: changed });
    }
    if (action.type === "save_patient" || action.type === "click_button" || action.type === "save") {
      return await saveCurrentPatientFromEditor(currentPatientId, Object.assign({}, settings, { action: action }));
    }
    if (action.type === "verify_patient_field" || action.type === "verify_patient_store") {
      const args = action.args || {};
      const expectedValue = args.value !== undefined
        ? args.value
        : (args.expectedValue !== undefined ? args.expectedValue : args.expected_value);
      return verifyPatientEditorField(currentPatientId, args.field || args.fieldLabel || args.query, expectedValue, settings);
    }
    if (action.type === "read_preview") {
      return adapterResult(true, "read_preview", buildPatientEditResultSummary(currentPatientId, []), { preview: buildPatientEditResultSummary(currentPatientId, []) });
    }
    return adapterResult(false, "unsupported_action", "编辑页 adapter 不支持该 action：" + action.type);
  }

  async function updatePatientEditorField(patientId, fieldSelector, value, options) {
    const settings = options || {};
    const field = resolveField(fieldSelector);
    if (!field.ok) {
      return adapterResult(false, field.reason || "field_not_found", "未找到可编辑字段：" + field.query, { fieldResolver: field });
    }
    const patient = getPatient(patientId);
    if (!patient) {
      return adapterResult(false, "patient_not_found", "未找到患者：" + patientId, { fieldResolver: field });
    }
    const normalized = normalizeValue(field, value);
    if (!normalized.ok) {
      return adapterResult(false, "invalid_value", normalized.message, { fieldResolver: field });
    }
    const oldValue = patient[field.field];
    const dom = await updateDomField(field, normalized.value);
      if (dom.updated) {
        emitUiFeedback("field_changed", {
          patientId: patient.patientId,
          field: field.field,
          fieldLabel: field.fieldLabel,
          oldValue: oldValue,
          newValue: normalized.value,
          changedFields: [field.field]
        });
      }
      return adapterResult(Boolean(dom.updated), dom.updated ? "field_changed" : "dom_update_failed", dom.updated ? ("已填写" + field.fieldLabel + "，等待保存。") : ("未能填写" + field.fieldLabel + "。"), {
        patientId: patient.patientId,
        field: field.field,
        fieldLabel: field.fieldLabel,
        oldValue: oldValue,
        newValue: normalized.value,
        audit_id: "",
        audit: null,
        domUpdated: dom.updated,
        eventsDispatched: dom.events,
        changedFields: [field.field],
        fieldResolver: field
      });
  }

  async function saveCurrentPatientFromEditor(patientId, options) {
    const patient = getPatient(patientId);
    if (!patient) return adapterResult(false, "patient_not_found", "保存前未找到患者：" + patientId);
    const before = cloneValue(getPatient(patientId));
    const beforeAuditIds = getAuditIds(patientId);
    const meta = buildAuditMeta(Object.assign({}, options || {}, { action: (options || {}).action || {} }));
    window.__pendingHisAgentSaveMeta = meta;
    await visualizeSave(patient, true);
    const outcome = await waitForSaveOutcome(patientId, before, beforeAuditIds, options, 1200);
    const after = outcome.after;
    const afterAudit = outcome.afterAudit;
    const statusText = outcome.statusText;
    const changedFields = outcome.changedFields;
    if (typeof (options || {}).refresh === "function") {
      options.refresh(after || patient);
    }
    emitUiFeedback("patient_saved", {
      patientId: patient.patientId,
      changedFields: changedFields,
      audit_id: afterAudit && afterAudit.audit_id || ""
    });
    const ok = Boolean(after && /已同步|已记录|保存/.test(statusText));
    return adapterResult(ok, ok ? "saved" : "save_failed", ok ? "页面保存流程已完成。" : (statusText || "页面保存流程未确认成功。"), {
      patientId: patient.patientId,
      changedFields: changedFields,
      audit_id: afterAudit && afterAudit.audit_id || "",
      audit: afterAudit || null,
      saveStatus: statusText
    });
  }

  function verifyPatientEditorField(patientId, fieldSelector, expectedValue) {
    const field = resolveField(fieldSelector);
    if (!field.ok) return adapterResult(false, field.reason || "field_not_found", "校验字段不存在：" + field.query, { fieldResolver: field });
    const patient = getPatient(patientId);
    if (!patient) return adapterResult(false, "patient_not_found", "校验前未找到患者：" + patientId, { fieldResolver: field });
      const actual = String(patient[field.field] == null ? "" : patient[field.field]);
      const expected = String(expectedValue == null ? "" : expectedValue);
      const actualNormalized = normalizeComparableText(actual);
      const expectedNormalized = normalizeComparableText(expected);
      const ok = actualNormalized === expectedNormalized;
      if (ok) {
        emitUiFeedback("patient_verified", {
          patientId: patient.patientId,
          field: field.field,
          fieldLabel: field.fieldLabel
        });
      }
      return adapterResult(ok, ok ? "verified" : "verify_failed", ok ? "已确认" + field.fieldLabel + "为：" + expected : field.fieldLabel + "校验失败，当前为：" + actual, {
        patientId: patient.patientId,
        field: field.field,
        fieldLabel: field.fieldLabel,
        expectedValue: expected,
      actualValue: actual,
      expectedNormalized: expectedNormalized,
      actualNormalized: actualNormalized,
      fieldResolver: field
    });
  }

  function normalizeComparableText(value) {
    let text = String(value == null ? "" : value);
    if (typeof text.normalize === "function") {
      text = text.normalize("NFKC");
    }
    return text
      .replace(/\s+/g, "")
      .replace(/[。；;，,]+$/g, "")
      .trim();
  }

  function buildPatientEditResultSummary(patientId, changes) {
    const patient = getPatient(patientId);
    if (!patient) return "未找到患者：" + patientId;
    const changedText = (changes || []).length ? "；修改字段：" + changes.join("、") : "";
    return "患者 " + patient.patientId + " " + patient.name + " 已同步到 patient-store" + changedText + "。";
  }

  function getActionField(action) {
    const args = action.args || {};
    return args.field || args.fieldLabel || args.query || args.name || (action.target && (action.target.field || action.target.fieldLabel || action.target.selector)) || action.field || "";
  }

  function getActionValue(action) {
    const args = action.args || {};
    if (args.value !== undefined) return args.value;
    if (args.expectedValue !== undefined) return args.expectedValue;
    if (args.expected_value !== undefined) return args.expected_value;
    if (action.value !== undefined) return action.value;
    return "";
  }

  function resolveField(selector) {
    if (!window.PatientFieldSchema || typeof window.PatientFieldSchema.resolvePatientField !== "function") {
      return { ok: false, reason: "field_schema_missing", query: String(selector || "") };
    }
    return window.PatientFieldSchema.resolvePatientField(selector);
  }

  function normalizeValue(field, value) {
    let next = value == null ? "" : String(value).trim();
    if (!next && field.fieldType !== "checkbox") return { ok: false, message: field.fieldLabel + "不能为空。" };
    if (field.fieldType === "select" && field.options && field.options.length && !field.options.includes(next)) {
      return { ok: false, message: field.fieldLabel + "的值不在可选项内：" + next };
    }
    if (field.field === "phone" || field.field === "emergencyPhone") {
      const compact = next.replace(/\s+/g, "");
      if (!/^1\d{10}$/.test(compact)) return { ok: false, message: field.fieldLabel + "必须是 11 位手机号。" };
      next = compact;
    }
    return { ok: true, value: next };
  }

  async function updateDomField(field, value) {
    const fieldName = field && field.field ? field.field : String(field || "");
    const control = findCurrentFieldControl(fieldName);
    if (!control) return { updated: false, events: [] };
    const visual = window.HisUiActionFeedback;
    if (visual) {
      try {
        if (control.tagName === "SELECT" || field.fieldType === "select") {
          const result = await visual.agentSelectOption(control, value, value, { label: field.fieldLabel });
          const events = mergeEvents(result && result.events, dispatchControlEvents(control, ["input", "change"]), ensureCurrentFieldValue(fieldName, value, control));
          return Object.assign({}, result || {}, { updated: true, events: events });
        }
        if (control.type === "date" || field.fieldType === "date" || fieldName.toLowerCase().includes("date")) {
          const result = await visual.agentSetDate(control, value, { label: field.fieldLabel });
          const events = mergeEvents(result && result.events, ensureCurrentFieldValue(fieldName, value, control));
          return Object.assign({}, result || {}, { updated: true, events: events.length ? events : ["input", "change"] });
        }
        if (control.type === "checkbox") {
          await visual.agentFocusField(control, { message: "Agent 正在修改：" + field.fieldLabel, select: false });
          control.checked = Boolean(value);
          const events = visual.dispatchControlEvents ? visual.dispatchControlEvents(control, ["input", "change"]) : dispatchControlEvents(control, ["input", "change"]);
          visual.flashElement(control, "change");
          return { updated: true, events: events, visualized: true };
        }
        const result = await visual.agentClearAndType(control, value, { label: field.fieldLabel });
        const events = mergeEvents(result && result.events, ensureCurrentFieldValue(fieldName, value, control));
        return Object.assign({}, result || {}, { updated: true, events: events.length ? events : ["input", "change"] });
      } catch (error) {
        if (window.console && window.console.warn) window.console.warn("[PatientEditorActionAdapter] visual feedback failed", error);
      }
    }
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value;
    return { updated: true, events: dispatchControlEvents(control, ["input", "change"]) };
  }

  function findCurrentFieldControl(fieldName) {
    const controls = Array.from(document.querySelectorAll('[data-field="' + cssEscape(fieldName) + '"]'));
    return controls.find(function (item) { return !item.disabled; }) || controls[0] || null;
  }

  function ensureCurrentFieldValue(fieldName, value, originalControl) {
    const current = findCurrentFieldControl(fieldName);
    if (!current || current === originalControl) return [];
    if (current.type === "checkbox") current.checked = Boolean(value);
    else current.value = value;
    return dispatchControlEvents(current, ["input", "change"]);
  }

  function mergeEvents() {
    const result = [];
    Array.from(arguments).forEach(function (events) {
      (events || []).forEach(function (eventName) {
        result.push(eventName);
      });
    });
    return result;
  }

  function dispatchControlEvents(control, eventNames) {
    const events = [];
    (eventNames || ["input", "change"]).forEach(function (eventName) {
      control.dispatchEvent(new Event(eventName, { bubbles: true }));
      events.push(eventName);
    });
    return events;
  }

  function getCurrentPatientId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("patientId") || "";
  }

  function getPatient(patientId) {
    if (!window.PatientStore || typeof window.PatientStore.getPatientById !== "function") return null;
    return window.PatientStore.getPatientById(patientId);
  }

  function buildAuditMeta(options) {
    const action = (options || {}).action || {};
    const audit = action.audit || (options || {}).audit || {};
    return Object.assign({
      actor: "agent",
      source: "backend_llm",
      task_id: action.task_id || audit.task_id || "",
      pageType: "patientEditor",
      instruction: audit.instruction || "后端 LLM action 修改字段",
      reason: audit.reason || "",
      canRollback: true
    }, audit || {});
  }

    function adapterResult(success, code, message, extra) {
      return Object.assign({
        handled: true,
        success: Boolean(success),
      code: code,
      message: message || "",
      adapter: "patient-editor-action-adapter"
      }, extra || {});
    }

    function getLatestAudit(patientId, field, options) {
      if (!window.PatientStore || typeof window.PatientStore.getAuditLog !== "function") return null;
      const taskId = options && options.action && (options.action.task_id || options.action.taskId);
      const log = window.PatientStore.getAuditLog(patientId || "");
      return log.slice().reverse().find(function (item) {
        const taskMatches = !taskId || item.task_id === taskId;
        const fieldMatches = !field || item.field === field;
        return taskMatches && fieldMatches;
      }) || null;
    }

    function getAuditIds(patientId) {
      if (!window.PatientStore || typeof window.PatientStore.getAuditLog !== "function") return [];
      return window.PatientStore.getAuditLog(patientId || "").map(function (item) { return item.audit_id; }).filter(Boolean);
    }

    function getLatestNewAudit(patientId, beforeIds, options) {
      if (!window.PatientStore || typeof window.PatientStore.getAuditLog !== "function") return null;
      const known = new Set(beforeIds || []);
      const taskId = options && options.action && (options.action.task_id || options.action.taskId);
      const log = window.PatientStore.getAuditLog(patientId || "");
      return log.slice().reverse().find(function (item) {
        const isNew = item && item.audit_id && !known.has(item.audit_id);
        const taskMatches = !taskId || item.task_id === taskId;
        return isNew && taskMatches;
      }) || null;
    }

    function changedFieldsBetween(before, after) {
      if (!before || !after || !window.PatientFieldSchema || typeof window.PatientFieldSchema.getEditableFields !== "function") return [];
      return window.PatientFieldSchema.getEditableFields().filter(function (field) {
        return before[field.key] !== after[field.key];
      }).map(function (field) { return field.key; });
    }

    async function waitForSaveOutcome(patientId, before, beforeAuditIds, options, timeoutMs) {
      const started = Date.now();
      let last = {
        after: cloneValue(getPatient(patientId)),
        afterAudit: getLatestNewAudit(patientId, beforeAuditIds, options),
        statusText: readSaveStatusText(),
        changedFields: []
      };
      last.changedFields = changedFieldsBetween(before, last.after);
      while (Date.now() - started < Number(timeoutMs || 1000)) {
        if ((last.changedFields.length || last.afterAudit) && /已同步|已记录|保存/.test(last.statusText)) return last;
        await sleep(60);
        last = {
          after: cloneValue(getPatient(patientId)),
          afterAudit: getLatestNewAudit(patientId, beforeAuditIds, options),
          statusText: readSaveStatusText(),
          changedFields: []
        };
        last.changedFields = changedFieldsBetween(before, last.after);
      }
      return last;
    }

    function readSaveStatusText() {
      const status = document.getElementById("saveStatus");
      return status ? String(status.textContent || "") : "";
    }

    function cloneValue(value) {
      if (value == null) return value;
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (error) {
        return Object.assign({}, value);
      }
    }

    function sleep(ms) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, Number(ms || 0));
      });
    }

    async function visualizeSave(patient, click) {
      const button = document.getElementById("saveButton");
      if (!window.HisUiActionFeedback) {
        if (button && click) {
          button.click();
          return true;
        }
        return false;
      }
      try {
        window.HisUiActionFeedback.showAgentActionToast("正在保存 / 同步：" + patient.patientId + " " + patient.name, "info");
        if (button) {
          button.classList.add("agent-field-saved", "agent-save-pulse", "his-agent-save-pulse");
          await window.HisUiActionFeedback.agentClickElement(button, { click: Boolean(click), message: "正在保存 / 同步", type: "save", afterMs: 150 });
          window.setTimeout(function () {
            button.classList.remove("agent-field-saved", "agent-save-pulse", "his-agent-save-pulse");
          }, window.__HIS_AGENT_FAST_ANIMATION__ ? 120 : 1400);
        } else {
          await window.HisUiActionFeedback.sleep(160);
        }
      } catch (error) {
        if (window.console && window.console.warn) window.console.warn("[PatientEditorActionAdapter] save feedback failed", error);
      }
      return true;
    }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function emitUiFeedback(kind, detail) {
    const payload = Object.assign({
      kind: kind,
      at: Date.now(),
      source: "agent"
    }, detail || {});
    try {
      window.dispatchEvent(new CustomEvent("his-agent-ui-feedback", { detail: payload }));
    } catch (error) {}
    try {
      window.localStorage.setItem("hisAgentUiFeedback", JSON.stringify(payload));
    } catch (error) {}
  }

  window.PatientEditorActionAdapter = {
    applyPatientEditorAction: applyPatientEditorAction,
    updatePatientEditorField: updatePatientEditorField,
    saveCurrentPatientFromEditor: saveCurrentPatientFromEditor,
    verifyPatientEditorField: verifyPatientEditorField,
    buildPatientEditResultSummary: buildPatientEditResultSummary
  };
})();
