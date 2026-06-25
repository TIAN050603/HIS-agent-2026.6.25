(function () {
  "use strict";

  const STORAGE_KEY = "his_demo_patients_v2";
  const LEGACY_STORAGE_KEY = "his_demo_patients_v1";
  const AUDIT_KEY = "his_demo_patient_audit_v2";
  const LEGACY_AUDIT_KEY = "his_demo_patient_audit_v1";
  const CHANNEL_NAME = "his_demo_patient_store";

  const schema = window.PatientFieldSchema || { fields: [], getFieldLabel: function (key) { return key; } };
  const editableFields = new Set((schema.fields || []).filter(function (field) { return field.editable; }).map(function (field) { return field.key; }));
  const allFields = new Set((schema.fields || []).map(function (field) { return field.key; }));

  const demoPatients = [
    makePatient("P001", "张伟", "男", 38, "呼吸内科", "初诊", "就诊中", "城镇职工医保", "咳嗽一周，夜间加重，偶有低热。", "近一周出现咳嗽、咽痒，活动后无明显气促。", "无明确慢性病史。", "无", "T 37.3C，P 82次/分，BP 122/78mmHg", "上呼吸道感染待排", "暂未完善", "多饮水，必要时复诊。", "Demo 数据，仅用于 HIS 原型演示。"),
    makePatient("P002", "李娜", "女", 29, "皮肤科", "复诊", "就诊中", "城乡居民医保", "皮肤红疹伴瘙痒一周。", "前臂和颈部红疹反复，夜间瘙痒明显。", "季节性皮炎史。", "青霉素类药物过敏。", "生命体征平稳", "皮炎复诊记录", "暂未完善", "皮肤护理宣教。", "请关注过敏诱因。"),
    makePatient("P003", "王强", "男", 45, "骨科", "初诊", "待就诊", "商业保险", "左肩疼痛，活动受限。", "搬重物后左肩疼痛，外展时加重。", "右膝旧伤史。", "无", "生命体征平稳", "肩关节损伤待排", "建议影像检查占位", "暂未开立", "建议完善影像检查。"),
    makePatient("P004", "陈敏", "女", 34, "心血管内科", "初诊", "就诊中", "自费", "胸口不适半天。", "偶发心悸，无明显胸痛放射。", "偶发心悸，未长期用药。", "无", "BP 118/76mmHg", "心悸原因待查", "心电图占位", "暂未开立", "多字段编辑测试患者。"),
    makePatient("P005", "赵磊", "男", 52, "神经内科", "复诊", "就诊中", "城镇职工医保", "头晕，睡眠质量下降。", "近三天头晕，伴入睡困难。", "高血压病史五年。", "海鲜过敏。", "BP 142/88mmHg", "头晕待查", "暂未完善", "复诊随访", "用于手机号错误校验测试。"),
    makePatient("P006", "刘洋", "男", 31, "消化内科", "初诊", "就诊中", "城镇职工医保", "上腹部不适三天。", "餐后上腹胀痛，偶有反酸，无呕血黑便。", "慢性胃炎史。", "无", "腹软，上腹轻压痛", "胃炎待排", "胃镜检查占位", "清淡饮食，按需复诊。", "用于消化内科筛选测试。"),
    makePatient("P007", "孙芳", "女", 41, "内分泌科", "复诊", "就诊中", "城乡居民医保", "血糖控制不稳一月。", "近一月空腹血糖波动，偶有口干。", "2 型糖尿病史三年。", "无", "BP 126/80mmHg，空腹血糖偏高", "糖尿病复诊", "糖化血红蛋白占位", "饮食运动宣教。", "关注慢病随访。"),
    makePatient("P008", "周杰", "男", 27, "耳鼻喉科", "初诊", "待就诊", "自费", "咽痛伴鼻塞两天。", "咽痛、流涕，夜间鼻塞明显，无明显发热。", "无特殊病史。", "无", "咽部充血", "急性咽炎待排", "暂未完善", "多饮水，观察症状。", "普通门诊测试患者。"),
    makePatient("P009", "吴敏", "女", 36, "妇科", "初诊", "就诊中", "城镇职工医保", "下腹隐痛一周。", "下腹隐痛，活动后加重，无明显发热。", "无明确慢性病史。", "头孢类药物过敏。", "生命体征平稳", "盆腔炎待排", "超声检查占位", "完善检查后复诊。", "过敏史测试患者。"),
    makePatient("P010", "郑强", "男", 58, "呼吸内科", "复诊", "就诊中", "城镇职工医保", "慢性咳嗽加重。", "咳嗽咳痰多年，近三天痰量增加。", "慢阻肺病史。", "无", "SpO2 96%，双肺呼吸音粗", "慢阻肺复诊", "胸片占位", "规律吸入治疗，避免受凉。", "呼吸内科复诊样例。"),
    makePatient("P011", "马丽", "女", 24, "眼科", "初诊", "待就诊", "商业保险", "右眼红痒一天。", "右眼异物感，轻度流泪，无明显视力下降。", "无特殊病史。", "无", "右眼结膜充血", "结膜炎待排", "裂隙灯检查占位", "注意眼部卫生。", "眼科样例。"),
    makePatient("P012", "胡斌", "男", 49, "泌尿外科", "初诊", "就诊中", "城乡居民医保", "尿频尿急三天。", "尿频尿急，排尿不适，无肉眼血尿。", "前列腺增生史。", "无", "下腹轻压痛", "尿路感染待排", "尿常规占位", "完善尿检后处理。", "泌尿外科样例。"),
    makePatient("P013", "郭静", "女", 33, "口腔科", "复诊", "就诊中", "自费", "牙龈肿痛复查。", "牙龈肿痛较前缓解，仍有咀嚼不适。", "牙周炎史。", "无", "牙龈轻度红肿", "牙周炎复诊", "口腔影像占位", "继续口腔护理。", "口腔科样例。"),
    makePatient("P014", "何伟", "男", 62, "心血管内科", "复诊", "就诊中", "城镇职工医保", "血压波动复诊。", "家庭血压记录波动，偶有头胀。", "高血压病史十年。", "无", "BP 148/86mmHg", "高血压复诊", "心电图占位", "调整生活方式，监测血压。", "慢病管理样例。"),
    makePatient("P015", "高倩", "女", 30, "产科", "初诊", "就诊中", "城乡居民医保", "孕早期建档咨询。", "停经后自测阳性，轻度恶心，无腹痛出血。", "无特殊病史。", "无", "生命体征平稳", "早孕建档", "产检项目占位", "预约产检。", "产科样例。"),
    makePatient("P016", "梁峰", "男", 40, "急诊科", "初诊", "已完成", "自费", "发热伴乏力一天。", "体温最高 38.5C，伴全身乏力，无明显胸闷。", "无明确慢性病史。", "无", "T 38.1C，P 96次/分", "发热待查", "血常规占位", "退热处理后观察。", "急诊已完成样例。"),
    makePatient("P017", "宋佳", "女", 47, "康复医学科", "复诊", "待就诊", "商业保险", "腰痛康复复查。", "腰痛较前缓解，久坐后仍有不适。", "腰椎间盘突出史。", "无", "腰部活动轻度受限", "腰痛康复复诊", "康复评估占位", "继续康复训练。", "康复科样例。"),
    makePatient("P018", "潘宇", "男", 22, "感染科", "初诊", "就诊中", "城乡居民医保", "腹泻两天。", "腹泻水样便，每日约五次，轻度腹痛。", "无特殊病史。", "无", "腹软，肠鸣音活跃", "急性胃肠炎待排", "便常规占位", "补液观察。", "感染科样例。"),
    makePatient("P019", "杜娟", "女", 55, "肿瘤科", "复诊", "就诊中", "城镇职工医保", "术后复查咨询。", "术后复查，无明显新发不适。", "乳腺术后随访史。", "碘造影剂过敏。", "生命体征平稳", "肿瘤术后随访", "影像复查占位", "按期复查。", "肿瘤科随访样例。"),
    makePatient("P020", "袁浩", "男", 37, "普外科", "初诊", "待就诊", "城镇职工医保", "右下腹疼痛半天。", "右下腹持续隐痛，活动后加重，轻度恶心。", "无明确慢性病史。", "无", "右下腹压痛", "腹痛待查", "腹部超声占位", "完善检查后处理。", "P020 回归测试患者。")
  ];
  const demoPatientIds = new Set(demoPatients.map(function (patient) { return patient.patientId; }));

  let channel = null;
  const subscribers = new Set();

  function makePatient(id, name, gender, age, department, visitType, visitStatus, insuranceType, chiefComplaint, presentIllness, pastHistory, allergyHistory, vitalSigns, diagnosis, examSummary, orders, note) {
    const birthYear = 2026 - Number(age || 0);
    const serial = id.replace(/\D/g, "").padStart(3, "0");
    return {
      patientId: id,
      name: name,
      gender: gender,
      age: age,
      birthDate: birthYear + "-03-12",
      phone: "13810010" + serial,
      idType: "身份证",
      idNumber: "IDTEST" + birthYear + "0312" + serial,
      address: "Demo 地址 " + serial + " 号",
      emergencyContact: name.slice(0, 1) + "家属",
      emergencyPhone: "13820010" + serial,
      insuranceType: insuranceType,
      encounterId: "E20260611" + serial,
      visitDate: "2026-06-11",
      department: department,
      doctor: "演示医生",
      visitType: visitType,
      visitStatus: visitStatus,
      chiefComplaint: chiefComplaint,
      presentIllness: presentIllness,
      pastHistory: pastHistory,
      allergyHistory: allergyHistory,
      vitalSigns: vitalSigns,
      diagnosis: diagnosis,
      examSummary: examSummary,
      orders: orders,
      note: note,
      dataSource: "localStorage Demo",
      lastModifiedAt: "",
      lastModifiedSource: ""
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizePatient(patient) {
    const base = {};
    (schema.fields || []).forEach(function (field) {
      base[field.key] = patient && patient[field.key] !== undefined ? patient[field.key] : "";
    });
    base.patientId = String(base.patientId || "").toUpperCase();
    base.name = base.name || "未命名患者";
    base.dataSource = patient && patient.dataSource ? patient.dataSource : "localStorage Demo";
    base.lastModifiedAt = patient && patient.lastModifiedAt ? patient.lastModifiedAt : "";
    base.lastModifiedSource = patient && patient.lastModifiedSource ? patient.lastModifiedSource : "";
    if (!base.chiefComplaint && patient && patient.symptoms) base.chiefComplaint = patient.symptoms;
    if (!base.pastHistory && patient && patient.medicalHistory) base.pastHistory = patient.medicalHistory;
    if (!base.allergyHistory && patient && patient.allergyNote) base.allergyHistory = patient.allergyNote;
    if (!base.note && patient && patient.remark) base.note = patient.remark;
    return base;
  }

  function mergeWithDemoSeed(patients) {
    const source = Array.isArray(patients) ? patients : [];
    const byId = new Map();
    source.forEach(function (patient) {
      const patientId = String(patient && patient.patientId || "").toUpperCase();
      if (patientId) byId.set(patientId, patient);
    });
    const merged = demoPatients.map(function (seed) {
      const existing = byId.get(seed.patientId);
      return existing ? normalizePatient(Object.assign({}, seed, existing, { patientId: seed.patientId })) : clone(seed);
    });
    source.forEach(function (patient) {
      const patientId = String(patient && patient.patientId || "").toUpperCase();
      if (patientId && !demoPatientIds.has(patientId)) {
        merged.push(normalizePatient(patient));
      }
    });
    return merged;
  }

  function shouldPersistMergedPatients(original, merged) {
    return JSON.stringify((original || []).map(normalizePatient)) !== JSON.stringify(merged);
  }

  function readPatients() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const merged = mergeWithDemoSeed(parsed);
          if (shouldPersistMergedPatients(parsed, merged)) writePatients(merged, { silent: true });
          return merged;
        }
      }
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        if (Array.isArray(parsedLegacy)) {
          const migrated = mergeWithDemoSeed(parsedLegacy);
          writePatients(migrated, { silent: true });
          return migrated;
        }
      }
    } catch (error) {
      console.warn("patient-store read failed", error);
    }
    writePatients(demoPatients, { silent: true });
    return clone(demoPatients);
  }

  function writePatients(patients, options) {
    const next = clone(patients || []).map(normalizePatient);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (!options || !options.silent) notify(next);
    return next;
  }

  function readAuditLog() {
    try {
      const saved = window.localStorage.getItem(AUDIT_KEY) || window.localStorage.getItem(LEGACY_AUDIT_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeAuditLog(entries) {
    const next = clone(entries || []).slice(-500);
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
    return next;
  }

  function appendAudit(entry) {
    const log = readAuditLog();
    const item = Object.assign({
      audit_id: "audit_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      patientId: "",
      patientName: "",
      field: "",
      fieldLabel: "",
      oldValue: "",
      newValue: "",
      actor: "user",
      source: "manual",
      task_id: "",
      pageType: "",
      instruction: "",
      reason: "",
      canRollback: false
    }, entry || {});
    item.fieldLabel = item.fieldLabel || schema.getFieldLabel(item.field);
    log.push(item);
    writeAuditLog(log);
    return clone(item);
  }

  function recordFieldAudits(before, after, fields, meta) {
    const settings = meta || {};
    (fields || []).forEach(function (field) {
      if (!before || !after || before[field] === after[field]) return;
      appendAudit({
        patientId: after.patientId,
        patientName: after.name,
        field: field,
        fieldLabel: schema.getFieldLabel(field),
        oldValue: before[field],
        newValue: after[field],
        actor: settings.actor || "user",
        source: settings.source || "manual",
        task_id: settings.task_id || "",
        pageType: settings.pageType || "patientEditor",
        instruction: settings.instruction || "",
        reason: settings.reason || "",
        canRollback: Boolean(settings.canRollback)
      });
    });
  }

  function notify(patients, options) {
    const settings = options || {};
    const next = clone(patients || readPatients());
    subscribers.forEach(function (callback) {
      try { callback(next); } catch (error) { console.warn("patient-store subscriber failed", error); }
    });
    if (channel && !settings.silentBroadcast) {
      channel.postMessage({ type: "patients_changed", patients: next });
    }
  }

  function getAllPatients() {
    return clone(readPatients());
  }

  function getPatientById(patientId) {
    const id = String(patientId || "").toUpperCase();
    return clone(readPatients().find(function (patient) { return patient.patientId === id; }) || null);
  }

  function compactText(value, limit) {
    const text = String(value == null ? "" : value).trim();
    const max = Number(limit || 80);
    return text.length > max ? text.slice(0, max) + "..." : text;
  }

  function normalizeLookup(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function compactPatientForIndex(patient) {
    return {
      patientId: patient.patientId,
      name: patient.name,
      gender: patient.gender,
      age: patient.age,
      birthDate: patient.birthDate,
      phone: patient.phone,
      idType: patient.idType,
      idNumber: patient.idNumber,
      department: patient.department,
      visitType: patient.visitType,
      insuranceType: patient.insuranceType,
      address: compactText(patient.address, 60),
      chiefComplaint: compactText(patient.chiefComplaint, 80),
      presentIllness: compactText(patient.presentIllness, 100),
      allergyHistory: compactText(patient.allergyHistory, 80),
      medicalHistory: compactText(patient.medicalHistory || patient.pastHistory, 80),
      pastHistory: compactText(patient.pastHistory || patient.medicalHistory, 80)
    };
  }

  function getPatientIndex() {
    return readPatients().map(compactPatientForIndex);
  }

  function uniquePatients(matches) {
    const seen = new Set();
    const result = [];
    (matches || []).forEach(function (patient) {
      if (!patient || !patient.patientId || seen.has(patient.patientId)) return;
      seen.add(patient.patientId);
      result.push(patient);
    });
    return result;
  }

  function buildResolveResult(matches, matchType, reason) {
    const unique = uniquePatients(matches);
    const candidates = unique.map(compactPatientForIndex);
    if (unique.length === 1) {
      return {
        ok: true,
        matchType: matchType || "unique_match",
        patient: compactPatientForIndex(unique[0]),
        candidates: candidates
      };
    }
    return {
      ok: false,
      reason: reason || (unique.length > 1 ? "multiple_matches" : "not_found"),
      matchType: matchType || "",
      patient: null,
      candidates: candidates
    };
  }

  function resolvePatientSelector(selector, options) {
    const settings = options || {};
    let input = selector;
    if (input && typeof input === "object" && input.patientSelector && typeof input.patientSelector === "object") {
      input = input.patientSelector;
    }
    if (typeof input === "string") {
      input = { query: input };
    }
    input = input && typeof input === "object" ? input : {};
    const patients = Array.isArray(settings.patients) ? settings.patients.map(normalizePatient) : readPatients();
    const patientId = normalizeLookup(input.patientId || input.patient_id || input.id);
    const phone = normalizeLookup(input.phone || input.mobile);
    const idNumber = normalizeLookup(input.idNumber || input.id_number || input.identityNumber);
    const name = String(input.name || input.patientName || input.patient_name || "").trim();
    const query = String(input.query || input.value || input.text || "").trim();
    const queryKey = normalizeLookup(query);

    if (patientId) {
      return buildResolveResult(patients.filter(function (patient) {
        return normalizeLookup(patient.patientId) === patientId;
      }), "exact_patientId");
    }
    if (phone) {
      return buildResolveResult(patients.filter(function (patient) {
        return normalizeLookup(patient.phone) === phone;
      }), "exact_phone");
    }
    if (idNumber) {
      return buildResolveResult(patients.filter(function (patient) {
        return normalizeLookup(patient.idNumber) === idNumber;
      }), "exact_idNumber");
    }
    if (name) {
      const exactName = patients.filter(function (patient) { return patient.name === name; });
      if (exactName.length) return buildResolveResult(exactName, "exact_name");
      return buildResolveResult(patients.filter(function (patient) {
        return patient.name.includes(name) || name.includes(patient.name);
      }), "partial_name");
    }
    if (queryKey) {
      const exactQuery = patients.filter(function (patient) {
        return normalizeLookup(patient.patientId) === queryKey ||
          normalizeLookup(patient.phone) === queryKey ||
          normalizeLookup(patient.idNumber) === queryKey ||
          normalizeLookup(patient.name) === queryKey;
      });
      if (exactQuery.length) return buildResolveResult(exactQuery, "exact_query");
      return buildResolveResult(patients.filter(function (patient) {
        return patient.name.includes(query) ||
          query.includes(patient.name) ||
          normalizeLookup(patient.patientId).includes(queryKey) ||
          normalizeLookup(patient.phone).includes(queryKey) ||
          normalizeLookup(patient.idNumber).includes(queryKey);
      }), "partial_query");
    }
    return buildResolveResult([], "", "missing_selector");
  }

  function updatePatient(patientId, patch, meta) {
    const id = String(patientId || "").toUpperCase();
    const patients = readPatients();
    const index = patients.findIndex(function (patient) { return patient.patientId === id; });
    if (index < 0) return { success: false, message: "未找到患者 " + id };
    const before = clone(patients[index]);
    const changedFields = [];
    Object.keys(patch || {}).forEach(function (field) {
      if (!editableFields.has(field)) return;
      patients[index][field] = patch[field];
      changedFields.push(field);
    });
    if (!changedFields.length) return { success: true, patient: clone(patients[index]), message: "没有可更新字段。" };
    patients[index].lastModifiedAt = new Date().toISOString();
    patients[index].lastModifiedSource = (meta && meta.source) || "manual";
    writePatients(patients);
    recordFieldAudits(before, patients[index], changedFields, Object.assign({ canRollback: true }, meta || {}));
    return { success: true, patient: clone(patients[index]), changedFields: changedFields, message: "患者信息已更新。" };
  }

  function replacePatient(patientId, nextPatient, meta) {
    const id = String(patientId || "").toUpperCase();
    const patch = {};
    Object.keys(nextPatient || {}).forEach(function (key) {
      if (editableFields.has(key)) patch[key] = nextPatient[key];
    });
    return updatePatient(id, patch, Object.assign({ canRollback: false }, meta || {}));
  }

  function rollbackAudit(auditId) {
    const audit = readAuditLog().find(function (item) { return item.audit_id === auditId; });
    if (!audit || !audit.canRollback || audit.source !== "backend_llm" || !audit.patientId || !audit.field) {
      return { success: false, message: "该审计记录不可撤销。" };
    }
    const result = updatePatient(audit.patientId, Object.fromEntries([[audit.field, audit.oldValue]]), {
      actor: "user",
      source: "manual",
      task_id: audit.task_id || "",
      pageType: audit.pageType || "patientEditor",
      instruction: "撤销最近一次 Agent 修改",
      reason: "rollback:" + audit.audit_id,
      canRollback: false
    });
    if (result.success) {
      appendAudit({
        patientId: audit.patientId,
        patientName: audit.patientName,
        field: audit.field,
        fieldLabel: audit.fieldLabel || schema.getFieldLabel(audit.field),
        oldValue: audit.newValue,
        newValue: audit.oldValue,
        actor: "user",
        source: "manual",
        task_id: audit.task_id || "",
        pageType: audit.pageType || "patientEditor",
        instruction: "撤销 Agent 修改",
        reason: "rollback:" + audit.audit_id,
        canRollback: false
      });
    }
    return result;
  }

  function getLastAgentRollbackCandidate(patientId) {
    const id = String(patientId || "").toUpperCase();
    return clone(readAuditLog().slice().reverse().find(function (item) {
      return item.patientId === id && item.actor === "agent" && item.source === "backend_llm" && item.canRollback;
    }) || null);
  }

  function getAuditLog(patientId) {
    const id = String(patientId || "").toUpperCase();
    const log = readAuditLog();
    return clone(id ? log.filter(function (item) { return item.patientId === id; }) : log);
  }

  function subscribePatientChanges(callback) {
    subscribers.add(callback);
    return function () { subscribers.delete(callback); };
  }

  function resetDemoPatients() {
    return writePatients(demoPatients);
  }

  function findPatients(query) {
    const text = String(query || "").trim().toLowerCase();
    if (!text) return getAllPatients();
    return getAllPatients().filter(function (patient) {
      return Array.from(allFields).some(function (key) {
        return String(patient[key] || "").toLowerCase().includes(text);
      });
    });
  }

  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = function (event) {
      if (event.data && event.data.type === "patients_changed") {
        notify(event.data.patients, { silentBroadcast: true });
      }
    };
  }

  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY) notify(readPatients(), { silentBroadcast: true });
  });

  window.PatientStore = {
    getAllPatients: getAllPatients,
    getPatientById: getPatientById,
    getPatientIndex: getPatientIndex,
    resolvePatientSelector: resolvePatientSelector,
    updatePatient: updatePatient,
    replacePatient: replacePatient,
    subscribePatientChanges: subscribePatientChanges,
    resetDemoPatients: resetDemoPatients,
    findPatients: findPatients,
    getAuditLog: getAuditLog,
    appendAudit: appendAudit,
    rollbackAudit: rollbackAudit,
    getLastAgentRollbackCandidate: getLastAgentRollbackCandidate,
    getFieldLabel: schema.getFieldLabel,
    getEditableFields: function () { return Array.from(editableFields); }
  };
})();
