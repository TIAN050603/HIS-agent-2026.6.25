import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, "..", "..");

export function fromRoot(...parts) {
  return join(repoRoot, ...parts);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

export function nowIso() {
  return new Date().toISOString();
}

export function elapsedMs(start) {
  return Date.now() - start;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

export function loadConfig() {
  const config = readJson(fromRoot("loop-engineering", "config.json"));
  const baseUrl = (process.env.HIS_BASE_URL || config.defaultBaseUrl || "").replace(/\/+$/, "");
  const artifactRoot = fromRoot(config.artifactRoot || "loop-engineering/artifacts");
  const health = {
    ...(config.health || {}),
    backendUrl: (process.env.HIS_BACKEND_URL || config.health?.backendUrl || "").replace(/\/+$/, ""),
    asrUrl: (process.env.HIS_ASR_URL || config.health?.asrUrl || "").replace(/\/+$/, ""),
    llmUrl: (process.env.HIS_LLM_URL || config.health?.llmUrl || "").replace(/\/+$/, ""),
    diarizationUrl: (process.env.HIS_DIARIZATION_URL || config.health?.diarizationUrl || "").replace(/\/+$/, "")
  };
  const serviceQueryParams = {};
  if (process.env.HIS_BACKEND_URL) serviceQueryParams.backendUrl = health.backendUrl;
  if (process.env.HIS_ASR_URL) serviceQueryParams.asrUrl = health.asrUrl;
  if (process.env.HIS_LLM_URL) serviceQueryParams.llmUrl = health.llmUrl;
  if (process.env.HIS_DIARIZATION_URL) serviceQueryParams.diarizationUrl = health.diarizationUrl;
  return { ...config, health, baseUrl, artifactRoot, serviceQueryParams };
}

export function makeRunId(mode) {
  const stamp = nowIso().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${mode || "loop"}-${stamp}`;
}

export function pageUrl(config, pageName, tag = "loop") {
  const paths = {
    login: "/html/login.html",
    dashboard: "/html/dashboard.html",
    "patient-management": "/html/patient-management.html",
    "patient-editor": "/html/patient-editor.html?patientId=P001",
    "agent-history": "/html/agent-history.html"
  };
  const path = paths[pageName] || paths.login;
  const params = new URLSearchParams({ v: tag });
  Object.entries(config.serviceQueryParams || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const separator = path.includes("?") ? "&" : "?";
  return `${config.baseUrl}${path}${separator}${params.toString()}`;
}

export function eventId() {
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function normalizeTraceEvent({ iteration, caseId, runId, event, expected = {}, actual = {}, details = {} }) {
  return {
    event_id: eventId(),
    iteration,
    case_id: caseId,
    task_id: details.task_id || "",
    run_id: runId,
    at: nowIso(),
    event,
    conversation_state: details.conversation_state || "",
    input_route: details.input_route || details.route || "",
    page_type: details.page_type || actual.page_type || "",
    url: details.url || actual.url || "",
    action: details.action || "",
    step_id: details.step_id || "",
    expected,
    actual,
    task_slots: details.task_slots || {},
    canonical_patient: details.canonical_patient || {},
    page_patient: details.page_patient || actual.page_patient || {},
    action_payload: redactSecrets(details.action_payload || {}),
    action_result: redactSecrets(details.action_result || {}),
    postcondition: details.postcondition || {},
    error: details.error || null
  };
}

export function redactSecrets(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === "password_matched_requested" || lower === "passwordmatchesrequested") {
      output[key] = Boolean(item);
    } else if (lower.includes("password") || lower.includes("token") || lower.includes("secret") || lower.includes("key")) {
      output[key] = item ? "***" : "";
    } else {
      output[key] = redactSecrets(item);
    }
  }
  return output;
}

export async function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "";
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
}

export async function collectBrowserState(page) {
  return page.evaluate(() => {
    const safeParse = (text, fallback) => {
      try {
        return text ? JSON.parse(text) : fallback;
      } catch (error) {
        return fallback;
      }
    };
    const pageState = typeof window.collectHisPageState === "function" ? window.collectHisPageState() : {};
    const activePatient = pageState.activePatient || pageState.patient || pageState.selectedPatient || {};
    const urlPatientId = (() => {
      try {
        return new URLSearchParams(window.location.search || "").get("patientId") || "";
      } catch (error) {
        return "";
      }
    })();
    const activeTask = safeParse(window.localStorage.getItem("hisAgentActiveTask"), null);
    const history = safeParse(window.localStorage.getItem("hisAgentTaskHistory"), []);
    const patients = safeParse(window.localStorage.getItem("his_demo_patients_v2"), []);
    const audit = safeParse(window.localStorage.getItem("his_demo_patient_audit_v2"), []);
    const latestTask = Array.isArray(history) && history.length ? history[history.length - 1] : null;
    const loginAccountInput = document.querySelector("#loginAccountInput");
    const loginPasswordInput = document.querySelector("#loginPasswordInput");
    const trace = window.AgentFlowTrace && typeof window.AgentFlowTrace.getEvents === "function"
      ? window.AgentFlowTrace.getEvents()
      : [];
    return {
      url: window.location.href,
      page_type: pageState.pageType || document.body?.dataset?.pageType || "",
      auth: window.localStorage.getItem("hisDemoAuthenticated") === "true",
      visible_text: document.body?.innerText?.slice(0, 4000) || "",
      page_state: pageState,
      page_patient: {
        urlPatientId: String(urlPatientId || "").toUpperCase(),
        pageStatePatientId: String(pageState.patientId || activePatient.patientId || "").toUpperCase(),
        pageStatePatientName: activePatient.name || ""
      },
      active_task: activeTask,
      latest_task: latestTask,
      task_history_count: Array.isArray(history) ? history.length : 0,
      patient_count: Array.isArray(patients) ? patients.length : 0,
      patients_compact: Array.isArray(patients)
        ? patients.map((patient) => ({
            patientId: patient.patientId,
            name: patient.name,
            phone: patient.phone,
            chiefComplaint: patient.chiefComplaint,
            presentIllness: patient.presentIllness
          })).slice(0, 30)
        : [],
      audit_count: Array.isArray(audit) ? audit.length : 0,
      login_form: {
        username_value: loginAccountInput ? loginAccountInput.value : "",
        password_filled: loginPasswordInput ? loginPasswordInput.value.length > 0 : false
      },
      flow_trace: Array.isArray(trace) ? trace.slice(-80) : []
    };
  });
}

export async function snapshotDemoState(page, keys) {
  return page.evaluate((storageKeys) => {
    return storageKeys.reduce((result, key) => {
      result[key] = window.localStorage.getItem(key);
      return result;
    }, {});
  }, keys);
}

export async function restoreDemoState(page, snapshot) {
  await page.evaluate((values) => {
    Object.entries(values).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    });
  }, snapshot);
  const restored = await page.evaluate((values) => {
    return Object.entries(values).every(([key, value]) => window.localStorage.getItem(key) === value);
  }, snapshot);
  return restored;
}

export function assertion(name, passed, expected, actual, evidence = "") {
  return { name, passed: Boolean(passed), expected, actual, evidence };
}

export function firstFailedAssertion(assertions) {
  return assertions.find((item) => !item.passed) || null;
}

export async function fetchHealth(url, timeoutMs = 3000) {
  if (!url) return { ok: false, status: 0, error: "missing_url" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      elapsed_ms: Date.now() - started,
      body: text.slice(0, 300)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsed_ms: Date.now() - started,
      error: error.name === "AbortError" ? "timeout" : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}

export function writeCaseArtifacts(artifactDir, caseResult, traceEvents) {
  const tracePath = join(artifactDir, "traces", `${caseResult.case_id}.json`);
  writeJson(tracePath, traceEvents);
  caseResult.trace_file = relative(repoRoot, tracePath).replace(/\\/g, "/");
  return caseResult;
}

export function createCheckpoint(files, checkpointDir) {
  mkdirSync(checkpointDir, { recursive: true });
  const manifest = [];
  for (const file of files) {
    const source = fromRoot(file);
    if (!existsSync(source)) continue;
    const target = join(checkpointDir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    manifest.push({ file, copied_to: relative(repoRoot, target).replace(/\\/g, "/") });
  }
  writeJson(join(checkpointDir, "manifest.json"), {
    created_at: nowIso(),
    files: manifest
  });
  return manifest;
}
