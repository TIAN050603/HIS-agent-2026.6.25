(function () {
  "use strict";

  const fieldSchema = [
    { key: "patientId", label: "就诊人ID", group: "基础信息", type: "text", editable: false, aliases: ["患者ID", "就诊人ID"], showInManagement: true, showInEditor: true },
    { key: "name", label: "姓名", group: "基础信息", type: "text", editable: true, aliases: ["姓名", "名字"], showInManagement: true, showInEditor: true },
    { key: "gender", label: "性别", group: "基础信息", type: "select", editable: true, options: ["男", "女", "其他"], aliases: ["性别"], showInManagement: true, showInEditor: true },
    { key: "age", label: "年龄", group: "基础信息", type: "number", editable: true, aliases: ["年龄"], showInManagement: true, showInEditor: true },
    { key: "birthDate", label: "出生日期", group: "基础信息", type: "date", editable: true, aliases: ["出生日期", "生日"], showInManagement: false, showInEditor: true },
    { key: "phone", label: "手机号", group: "基础信息", type: "text", editable: true, aliases: ["手机号", "手机号字段", "手机", "电话", "联系电话", "联系号码"], showInManagement: true, showInEditor: true },
    { key: "idType", label: "证件类型", group: "基础信息", type: "select", editable: true, options: ["身份证", "护照", "港澳通行证", "其他"], aliases: ["证件类型"], showInManagement: false, showInEditor: true },
    { key: "idNumber", label: "证件号码", group: "基础信息", type: "text", editable: true, aliases: ["证件号码", "身份证号"], showInManagement: false, showInEditor: true },
    { key: "address", label: "地址", group: "基础信息", type: "text", editable: true, aliases: ["地址", "住址", "居住地址"], showInManagement: false, showInEditor: true },
    { key: "emergencyContact", label: "紧急联系人", group: "基础信息", type: "text", editable: true, aliases: ["紧急联系人"], showInManagement: false, showInEditor: true },
    { key: "emergencyPhone", label: "紧急联系人电话", group: "基础信息", type: "text", editable: true, aliases: ["紧急电话", "紧急联系人电话"], showInManagement: false, showInEditor: true },
    { key: "insuranceType", label: "医保类型", group: "基础信息", type: "select", editable: true, options: ["城镇职工医保", "城乡居民医保", "商业保险", "自费", "其他"], aliases: ["医保", "医保类型"], showInManagement: false, showInEditor: true },
    { key: "encounterId", label: "就诊ID", group: "本次就诊", type: "text", editable: false, aliases: ["就诊ID", "visitId"], showInManagement: false, showInEditor: true },
    { key: "visitDate", label: "就诊日期", group: "本次就诊", type: "date", editable: true, aliases: ["就诊日期"], showInManagement: false, showInEditor: true },
    { key: "department", label: "就诊科室", group: "本次就诊", type: "select", editable: true, options: ["呼吸内科", "消化内科", "心血管内科", "神经内科", "骨科", "皮肤科", "儿科", "眼科", "耳鼻喉科", "急诊科"], aliases: ["科室", "就诊科室"], showInManagement: true, showInEditor: true },
    { key: "doctor", label: "接诊医生", group: "本次就诊", type: "text", editable: true, aliases: ["医生", "接诊医生"], showInManagement: false, showInEditor: true },
    { key: "visitType", label: "就诊类型", group: "本次就诊", type: "select", editable: true, options: ["初诊", "复诊", "急诊"], aliases: ["就诊类型"], showInManagement: false, showInEditor: true },
    { key: "visitStatus", label: "就诊状态", group: "本次就诊", type: "select", editable: true, options: ["待就诊", "就诊中", "已完成"], aliases: ["就诊状态"], showInManagement: true, showInEditor: true },
    { key: "chiefComplaint", label: "主诉", group: "问诊病历", type: "textarea", editable: true, aliases: ["主诉", "症状描述"], showInManagement: true, showInEditor: true },
    { key: "presentIllness", label: "现病史", group: "问诊病历", type: "textarea", editable: true, aliases: ["现病史", "当前病史"], showInManagement: false, showInEditor: true },
    { key: "pastHistory", label: "既往史", group: "问诊病历", type: "textarea", editable: true, aliases: ["既往史", "既往病史"], showInManagement: false, showInEditor: true },
    { key: "medicalHistory", label: "既往病史", group: "兼容字段", type: "textarea", editable: true, aliases: ["病史", "既往病史旧字段"], showInManagement: false, showInEditor: false },
    { key: "allergyHistory", label: "过敏史", group: "问诊病历", type: "textarea", editable: true, aliases: ["过敏史", "过敏说明"], showInManagement: false, showInEditor: true },
    { key: "vitalSigns", label: "生命体征", group: "问诊病历", type: "textarea", editable: true, aliases: ["生命体征", "体征"], showInManagement: false, showInEditor: true },
    { key: "diagnosis", label: "诊断", group: "问诊病历", type: "textarea", editable: true, aliases: ["诊断"], showInManagement: false, showInEditor: true },
    { key: "examSummary", label: "检查检验", group: "问诊病历", type: "textarea", editable: true, aliases: ["检查检验", "检查", "检验"], showInManagement: false, showInEditor: true },
    { key: "orders", label: "医嘱/处方", group: "问诊病历", type: "textarea", editable: true, aliases: ["医嘱", "处方"], showInManagement: false, showInEditor: true },
    { key: "note", label: "备注", group: "问诊病历", type: "textarea", editable: true, aliases: ["备注", "说明"], showInManagement: false, showInEditor: true }
  ];

  const byKey = Object.fromEntries(fieldSchema.map(function (field) { return [field.key, field]; }));
  const aliasToKey = {};
  fieldSchema.forEach(function (field) {
    [field.key, field.label].concat(field.aliases || []).forEach(function (alias) {
      const key = normalizeFieldText(alias);
      if (key) aliasToKey[key] = field.key;
    });
  });
  aliasToKey[normalizeFieldText("既往史")] = "pastHistory";
  aliasToKey[normalizeFieldText("既往病史")] = "pastHistory";
  aliasToKey[normalizeFieldText("既往病史内容")] = "pastHistory";
  aliasToKey[normalizeFieldText("病史")] = "pastHistory";
  aliasToKey[normalizeFieldText("past history")] = "pastHistory";
  aliasToKey[normalizeFieldText("past medical history")] = "pastHistory";
  aliasToKey[normalizeFieldText("medical history")] = "pastHistory";
  aliasToKey[normalizeFieldText("medicalHistory")] = "pastHistory";

  function getField(key) {
    return byKey[key] || null;
  }

  function getEditableFields() {
    return fieldSchema.filter(function (field) { return field.editable; });
  }

  function getFieldLabel(key) {
    const field = getField(key);
    return field ? field.label : key;
  }

  function normalizeFieldText(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[：:]/g, "")
      .replace(/\s+/g, "")
      .replace(/字段$/g, "");
  }

  function resolvePatientField(selector) {
    let input = selector;
    if (input && typeof input === "object") {
      input = input.field || input.fieldKey || input.fieldLabel || input.label || input.query || input.name || input.value || "";
    }
    const query = String(input == null ? "" : input).trim();
    const normalized = normalizeFieldText(query);
    if (!normalized) {
      return { ok: false, reason: "field_not_found", query: query, candidates: candidateFields() };
    }
    if (aliasToKey[normalized] && byKey[aliasToKey[normalized]] && byKey[aliasToKey[normalized]].editable) {
      return fieldResult(byKey[aliasToKey[normalized]], aliasToKey[normalized] === query ? "key" : "alias", query);
    }
    if (byKey[query] && byKey[query].editable && byKey[query].showInEditor !== false) {
      return fieldResult(byKey[query], "key", query);
    }
    const partial = fieldSchema.filter(function (field) {
      if (!field.editable) return false;
      const names = [field.key, field.label].concat(field.aliases || []).map(normalizeFieldText);
      return names.some(function (name) { return name && (name.includes(normalized) || normalized.includes(name)); });
    });
    if (partial.length === 1) {
      return fieldResult(partial[0], "partial_alias", query);
    }
    return {
      ok: false,
      reason: partial.length > 1 ? "multiple_fields" : "field_not_found",
      query: query,
      candidates: (partial.length ? partial : fieldSchema.filter(function (field) { return field.editable; })).map(function (field) {
        return { field: field.key, fieldLabel: field.label, aliases: field.aliases || [] };
      }).slice(0, 20)
    };
  }

  function fieldResult(field, matchType, query) {
    return {
      ok: true,
      field: field.key,
      fieldLabel: field.label,
      fieldType: field.type,
      options: field.options || [],
      matchType: matchType,
      query: query
    };
  }

  function candidateFields() {
    return fieldSchema.filter(function (field) { return field.editable; }).map(function (field) {
      return { field: field.key, fieldLabel: field.label, aliases: field.aliases || [] };
    }).slice(0, 20);
  }

  function getManagementColumns() {
    return ["patientId", "name", "gender", "age", "phone", "department", "visitStatus", "chiefComplaint", "lastModifiedAt"];
  }

  window.PatientFieldSchema = {
    fields: fieldSchema.slice(),
    byKey: byKey,
    getField: getField,
    getEditableFields: getEditableFields,
    getFieldLabel: getFieldLabel,
    resolvePatientField: resolvePatientField,
    getManagementColumns: getManagementColumns
  };
})();
