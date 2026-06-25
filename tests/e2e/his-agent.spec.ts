import { expect, test } from "@playwright/test";

const pages = [
  { name: "login", path: "/html/login.html?v=e2e" },
  { name: "dashboard", path: "/html/dashboard.html?v=e2e" },
  { name: "patient-management", path: "/html/patient-management.html?v=e2e" },
  { name: "patient-editor", path: "/html/patient-editor.html?patientId=P001&v=e2e" },
  { name: "agent-history", path: "/html/agent-history.html?v=e2e" }
];

const mojibakePattern = /\?{2,}|Ã|å|é|è|鐩|婚|榇|淇|鍖|閿|閻|脙|�|锟/;
const localServiceQuery = "backendUrl=http%3A%2F%2F127.0.0.1%3A8000&asrUrl=http%3A%2F%2F127.0.0.1%3A8010&diarizationUrl=http%3A%2F%2F127.0.0.1%3A8000";

async function expectNoMojibake(page) {
  await expect(page.locator("body")).not.toContainText(mojibakePattern);
}

async function openAgent(page) {
  await page.locator("#hisAgentLauncher").click();
  await expect(page.locator("#hisAgentPanel")).toHaveClass(/open/);
}

async function openVoicePanel(page) {
  await ensureAgentOpen(page);
  const voicePanel = page.locator("[data-agent-panel='voice']");
  if (await voicePanel.isVisible().catch(() => false)) {
    return;
  }
  await page.evaluate(() => document.querySelector("#hisAgentTabVoice")?.click());
  await expect(voicePanel).toBeVisible();
}

async function ensureAgentOpen(page) {
  const panel = page.locator("#hisAgentPanel");
  const isOpen = await panel.evaluate((node) => node.classList.contains("open")).catch(() => false);
  if (!isOpen) {
    await page.locator("#hisAgentLauncher").click();
  }
  await expect(panel).toHaveClass(/open/);
}

async function simulateNoLlm(page) {
  await page.route(/\/api\/(llm|qwen)\/test$/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "e2e simulated no llm" })
    });
  });
  await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "e2e simulated no llm" })
    });
  });
}

async function simulateLlmPlanner(page, plan, slots = {}, taskId = "e2e_login_precondition_task") {
  await page.route(/\/api\/(llm|qwen)\/test$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: "e2e", model: "mock-llm", content: "ok" })
    });
  });
  await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
    const request = route.request();
    let body = {};
    try {
      body = request.postDataJSON();
    } catch (error) {
      body = {};
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        mode: "task-oriented-harness",
        llmUsed: true,
        provider: "e2e",
        model: "mock-llm",
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        response: {
          kind: "task",
          message: "mock task planned",
          task: {
            task_id: taskId,
            objective: body.user_message || "e2e task",
            status: "running",
            slots,
            plan,
            current_step_index: 0,
            created_at: Date.now() / 1000,
            updated_at: Date.now() / 1000
          }
        },
        trace: { e2e: true }
      })
    });
  });
}

async function simulateConnectedLlm(page) {
  await page.route(/\/api\/(llm|qwen)\/test$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: "e2e", model: "mock-llm", content: "ok" })
    });
  });
}

async function installFakeVoiceRuntime(page) {
  await page.addInitScript(() => {
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url) {
        this.url = String(url);
        this.readyState = FakeWebSocket.OPEN;
        this.binaryType = "";
        this.sent = [];
        window.__e2eVoiceSockets = window.__e2eVoiceSockets || [];
        window.__e2eVoiceSockets.push(this);
        setTimeout(() => {
          if (this.onopen) this.onopen({ target: this });
        }, 0);
      }
      send(data) {
        this.sent.push(data);
      }
      close() {
        this.readyState = FakeWebSocket.CLOSED;
        if (this.onclose) this.onclose({ target: this });
      }
      emit(data) {
        if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
      }
    }
    Object.defineProperty(window, "WebSocket", { value: FakeWebSocket, configurable: true });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          const track = { stopped: false, stop() { this.stopped = true; } };
          window.__e2eMicTrack = track;
          return { getTracks: () => [track] };
        }
      },
      configurable: true
    });
    class FakeAudioContext {
      constructor() {
        this.sampleRate = 16000;
        this.destination = {};
        this.state = "running";
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createScriptProcessor() {
        const node = { onaudioprocess: null, connect() {}, disconnect() {} };
        window.__e2eAudioProcessor = node;
        return node;
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, "AudioContext", { value: FakeAudioContext, configurable: true });
    Object.defineProperty(window, "webkitAudioContext", { value: FakeAudioContext, configurable: true });
  });
  await page.route(/:8010\/health$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "asr" }) });
  });
  await page.route(/\/diarization\/health$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, provider: "diart_local", active_provider: "diart_local", status: "available" }) });
  });
}

async function mockVoiceTaskText(page, taskText, onRequest = () => {}) {
  await page.route(/\/api\/voice\/turns-to-agent-task$/, async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON();
    } catch (error) {
      body = {};
    }
    await onRequest(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        task_text: taskText,
        usage: { prompt_tokens: 18, completion_tokens: 12, total_tokens: 30 },
        provider: "e2e",
        model: "mock-llm"
      })
    });
  });
}

async function mockVoiceTaskResult(page, result, onRequest = () => {}) {
  await page.route(/\/api\/voice\/turns-to-agent-task$/, async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON();
    } catch (error) {
      body = {};
    }
    await onRequest(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result_type: result.result_type || "explicit_action",
        task_text: result.task_text || "",
        proposed_fields: result.proposed_fields || [],
        expected_mutations: result.expected_mutations || [],
        task_contract: result.task_contract || null,
        reason_summary: result.reason_summary || "",
        usage: { prompt_tokens: 18, completion_tokens: 12, total_tokens: 30 },
        provider: "e2e",
        model: "mock-llm"
      })
    });
  });
}

const demoStorageKeys = [
  "his_demo_patients_v2",
  "his_demo_patients_v1",
  "his_demo_patient_audit_v2",
  "his_demo_patient_audit_v1",
  "hisAgentActiveTask",
  "hisAgentTaskHistory",
  "hisAgentFlowTrace",
  "hisAgentTaskStepsUiV2",
  "hisAgentInputDraftV2",
  "hisAgentScrollRestoreV2"
];

async function snapshotDemoStorage(page) {
  return page.evaluate((keys) => {
    return keys.reduce((result, key) => {
      result[key] = window.localStorage.getItem(key);
      return result;
    }, {});
  }, demoStorageKeys);
}

async function restoreDemoStorage(page, snapshot) {
  await page.evaluate(({ keys, values }) => {
    keys.forEach((key) => {
      if (values[key] === null || values[key] === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, values[key]);
      }
    });
  }, { keys: demoStorageKeys, values: snapshot });
}

async function readPatientField(page, patientId, field) {
  return page.evaluate(({ patientId: id, field: key }) => {
    return window.PatientStore?.getPatientById(id)?.[key] || "";
  }, { patientId, field });
}

async function waitForPatientField(page, patientId, field, expected) {
  await expect.poll(async () => {
    return page.evaluate(({ patientId: id, field: key }) => {
      return window.PatientStore?.getPatientById(id)?.[key] || "";
    }, { patientId, field }).catch(() => "");
  }, { timeout: 90_000 }).toBe(expected);
}

async function hasAuditEntry(page, patientId, field, value) {
  return page.evaluate(({ patientId: id, field: key, value: expected }) => {
    const log = window.PatientStore?.getAuditLog(id) || [];
    return log.some((item) => item.field === key && String(item.newValue) === String(expected));
  }, { patientId, field, value });
}

async function browserFetchLlmTest(page) {
  return page.evaluate(async () => {
    const backendUrl = window.__HIS_AGENT_WIDGET_DEBUG__?.backendUrl ||
      document.querySelector("#hisAgentBackendUrl")?.value ||
      window.HisRuntimeConfig?.serviceUrls?.().backendUrl ||
      "http://10.26.6.8:30663";
    const base = String(backendUrl || "http://10.26.6.8:30663").replace(/\/+$/, "");
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${base}/api/llm/test`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      return {
        ok: response.ok,
        status: response.status,
        backendUrl: base,
        elapsedMs: Date.now() - startedAt,
        body
      };
    } catch (error) {
      const message = String(error?.message || error);
      return {
        ok: false,
        status: error && error.name === "AbortError" ? 598 : 0,
        backendUrl: base,
        elapsedMs: Date.now() - startedAt,
        error: error && error.name === "AbortError" ? "LLM test timeout after 20000ms" : message
      };
    } finally {
      window.clearTimeout(timer);
    }
  });
}

async function isRealLlmAvailable(page) {
  try {
    await page.waitForFunction(() => {
      return Boolean(window.__HIS_AGENT_WIDGET_DEBUG__?.backendUrl || document.querySelector("#hisAgentBackendUrl")?.value);
    }, null, { timeout: 5_000 }).catch(() => null);
    const result = await browserFetchLlmTest(page);
    return Boolean(result.ok && result.body && result.body.ok !== false);
  } catch (error) {
    return false;
  }
}

test.describe("HIS floating Agent visibility", () => {
  for (const item of pages) {
    test(`${item.name} shows launcher`, async ({ page }) => {
      await page.goto(item.path);
      await expect(page.locator("#hisAgentLauncher")).toBeVisible();
    });
  }
});

test.describe("Chinese text encoding", () => {
  test("login page renders Chinese copy without mojibake", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-encoding-login");
    await expect(page.locator("body")).toContainText("医院信息系统 HIS Demo");
    await expect(page.locator("body")).toContainText("用户登录");
    await expectNoMojibake(page);
  });

  test("patient-management renders Chinese copy and P001 Zhang Wei without mojibake", async ({ page }) => {
    await page.goto("/html/patient-management.html?v=e2e-encoding-management");
    await expect(page.locator("body")).toContainText("患者管理");
    await expect(page.locator("body")).toContainText("患者列表");
    await expect(page.locator("body")).toContainText("P001");
    await expect(page.locator("body")).toContainText("张伟");
    await expectNoMojibake(page);
  });

  test("patient-editor renders clinical Chinese copy without mojibake", async ({ page }) => {
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-encoding-editor");
    await expect(page.locator("body")).toContainText("患者摘要");
    await expect(page.locator("body")).toContainText("主诉");
    await expect(page.locator("body")).toContainText("现病史");
    await expectNoMojibake(page);
  });
});

test.describe("Backend CORS and LLM connectivity", () => {
  test.describe.configure({ timeout: 120_000 });

  test("frontend browser context can fetch backend LLM test", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-cors-llm&" + localServiceQuery);
    const result = await browserFetchLlmTest(page);
    expect(result.status, JSON.stringify(result)).not.toBe(0);
    expect(result.error || "", JSON.stringify(result)).not.toMatch(/failed to fetch|cors/i);
    if (!result.ok) {
      expect(JSON.stringify(result.body || {}) + " " + (result.error || ""), JSON.stringify(result)).toMatch(/LLM|model|failed|timeout|error|quota|insufficient_quota|配额不足/i);
      return;
    }
    expect(result.body?.ok, JSON.stringify(result)).not.toBe(false);

    await openAgent(page);
    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='connection']").first().click();
    await expect.poll(async () => {
      return page.evaluate(() => window.__HIS_AGENT_WIDGET_DEBUG__?.llmStatus || "");
    }, { timeout: 30_000 }).toMatch(/^(connected|slow)$/);
  });

  test("manual page load and page switch do not probe LLM automatically", async ({ page }) => {
    let llmProbeCount = 0;
    await page.route("**/api/llm/test", async (route) => {
      llmProbeCount += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, model: "mock-llm" }) });
    });
    await page.goto("/html/login.html?v=e2e-no-auto-llm-login&" + localServiceQuery);
    await ensureAgentOpen(page);
    await page.waitForTimeout(500);
    expect(llmProbeCount).toBe(0);

    await page.goto("/html/patient-management.html?v=e2e-no-auto-llm-management&" + localServiceQuery);
    await ensureAgentOpen(page);
    await page.waitForTimeout(500);
    expect(llmProbeCount).toBe(0);

    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='connection']").first().click();
    await expect.poll(() => llmProbeCount, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("diarization health is explicit and does not fake diart availability", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-diarization-health&" + localServiceQuery);
    const result = await page.evaluate(async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch("http://127.0.0.1:8000/diarization/health", { signal: controller.signal });
        return { ok: response.ok, status: response.status, data: await response.json() };
      } catch (error) {
        return {
          ok: true,
          status: 0,
          data: {
            ok: false,
            provider: "diart_local",
            active_provider: "manual",
            status: "unavailable_timeout",
            error: error && error.name ? error.name : "fetch_error"
          }
        };
      } finally {
        window.clearTimeout(timer);
      }
    });
    expect(result.ok).toBe(true);
    expect(result.data.provider).toBeTruthy();
    expect(result.data.status).toBeTruthy();
    if (result.data.status === "available") {
      expect(result.data.provider).toBe("diart_local");
      expect(result.data.active_provider).toBe("diart_local");
      expect(result.data.ok).toBe(true);
    } else {
      expect(result.data.ok).toBe(false);
      expect(result.data.active_provider).toBe("manual");
      expect(result.data.status).toMatch(/unavailable_|error|disconnected/);
    }
  });
});

test.describe("Floating Agent task display", () => {
  test("home view uses four topic cards and chat view keeps conversation separate", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-topic-carousel&" + localServiceQuery);
    await openAgent(page);
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentChatView")).toBeHidden();
    await expect(page.locator("#hisAgentStatusView")).toBeHidden();
    await expect(page.locator("#hisAgentExamplesView")).toBeHidden();
    await expect(page.locator("#hisAgentVoiceView")).toBeHidden();
    await expect(page.locator("#hisAgentHome")).toContainText("你好，我是 HIS 系统助手");
    await expect(page.locator("#hisAgentTopicGrid")).toBeVisible();
    await expect(page.locator("#hisAgentOpenChatButton")).toBeVisible();
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await expect(page.locator("#hisAgentHomeView")).toBeHidden();
    await expect(page.locator("#hisAgentHistory")).toContainText("Agent 对话与任务工作台");
    await expect(page.locator("#hisAgentSendButton")).toHaveText("发送");
    await expect(page.locator("#hisAgentCancelTaskButton")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();
    await page.locator("#hisAgentViewBackButton").click();
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    const inputHeight = await page.locator("#hisAgentInput").evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(inputHeight).toBeLessThanOrEqual(70);
    const navColors = await page.evaluate(() => {
      const prev = window.getComputedStyle(document.querySelector("#hisAgentTopicPrevButton")).backgroundColor;
      const next = window.getComputedStyle(document.querySelector("#hisAgentTopicNextButton")).backgroundColor;
      const viewport = window.getComputedStyle(document.querySelector(".his-agent-topic-viewport"));
      const nav = window.getComputedStyle(document.querySelector(".his-agent-topic-nav"));
      return { prev, next, viewportPadding: viewport.paddingTop, navOverflow: nav.overflow };
    });
    expect(navColors.prev).toBe(navColors.next);
    expect(navColors.prev).toBe("rgb(255, 255, 255)");
    expect(navColors.navOverflow).toBe("visible");
    expect(Number.parseFloat(navColors.viewportPadding)).toBeGreaterThanOrEqual(4);
    const nextButton = page.locator("#hisAgentTopicNextButton");
    await nextButton.hover();
    await expect(nextButton).toHaveCSS("background-color", "rgb(37, 99, 235)");
    await page.mouse.down();
    await expect(nextButton).toHaveCSS("background-color", "rgb(29, 78, 216)");
    await page.mouse.up();
    for (let index = 0; index < 4; index += 1) {
      const currentPage = await page.locator("#hisAgentTopicGrid").getAttribute("data-topic-page");
      if (currentPage === "0") break;
      await page.locator("#hisAgentTopicPrevButton").click();
    }
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "0");
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)")).toHaveCount(4);
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='patient-management']")).toBeVisible();
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='connection']").first()).toBeVisible();
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='voice']")).toHaveCount(0);
    await expect(page.locator("#hisAgentTabVoice")).not.toBeVisible();
    await page.locator("#hisAgentTopicNextButton").click();
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "1");
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='history']")).toBeVisible();
    await page.locator("#hisAgentTopicPrevButton").click();
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "0");
    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='patient-management']").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("是否要跳转到患者管理页面");
    await expect(page.locator("#hisAgentHomeView")).toBeHidden();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await expect(page.locator("#hisAgentViewBackButton")).toBeVisible();
    await expect(page.locator("#hisAgentChatBackButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentBackToHomeButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentTopicGrid")).toBeHidden();
    await page.locator("#hisAgentViewBackButton").click();
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentChatView")).toBeHidden();
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "0");
    await page.locator("#hisAgentTopicNextButton").click();
    await page.locator("#hisAgentTopicNextButton").click();
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='examples']")).toBeVisible();
    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='examples']").click();
    await expect(page.locator("#hisAgentExamplesView")).toBeVisible();
    await expect(page.locator("#hisAgentChatView")).toBeHidden();
    await expect(page.locator(".his-agent-example-card")).toHaveCount(5);
    await page.locator("#hisAgentNewSessionButton").click();
    await expect(page.locator("#hisAgentHistory")).toBeEmpty();
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentTopicGrid")).toBeVisible();
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "0");
    await expect(page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='patient-management']")).toBeVisible();
    await page.locator("#hisAgentTopicPrevButton").click();
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "3");
    await page.locator("#hisAgentTopicNextButton").click();
    await expect(page.locator("#hisAgentTopicGrid")).toHaveAttribute("data-topic-page", "0");
  });

  test("connection topic renders a dedicated status view", async ({ page }) => {
    await page.route("**/api/health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route("**/api/llm/test", async (route) => {
      await page.waitForTimeout(200);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, model: "mock-llm" }) });
    });
    await page.route("**/health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "asr" }) });
    });
    await page.goto("/html/login.html?v=e2e-connection-topic&" + localServiceQuery);
    await openAgent(page);
    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='connection']").first().click();
    await expect(page.locator("#hisAgentHomeView")).toBeHidden();
    await expect(page.locator("#hisAgentChatView")).toBeHidden();
    await expect(page.locator("#hisAgentStatusView")).toBeVisible();
    await expect(page.locator(".his-agent-status-row")).toHaveCount(7);
    await expect(page.locator(".his-agent-status-row").first()).toContainText("后端服务");
    await expect(page.locator(".his-agent-developer-foldout")).not.toHaveAttribute("open", "");
    await page.locator("#hisAgentRefreshStatusButton").click();
    await expect(page.locator("#hisAgentRefreshStatusButton")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#hisAgentRefreshStatusButton")).toContainText("刷新中...");
    await expect(page.locator(".his-agent-status-row")).toHaveCount(7);
    await expect(page.locator("#hisAgentRefreshStatusButton")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#hisAgentRefreshStatusButton")).toContainText("刷新状态");
  });

  test("connection refresh returns quickly when LLM test is slow", async ({ page }) => {
    await page.route("**/api/health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route("**/api/llm/test", async (route) => {
      await page.waitForTimeout(5300);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, model: "slow-mock" }) }).catch(() => null);
    });
    await page.route("**/health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "asr" }) });
    });
    await page.goto("/html/login.html?v=e2e-connection-fast-timeout&" + localServiceQuery);
    await openAgent(page);

    const startedAt = Date.now();
    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='connection']").first().click();
    await expect(page.locator("#hisAgentStatusView")).toBeVisible();
    await expect(page.locator("#hisAgentRefreshStatusButton")).toHaveAttribute("aria-busy", "false", { timeout: 7000 });
    expect(Date.now() - startedAt).toBeLessThan(8000);
    await expect(page.locator(".his-agent-status-row").nth(1)).toContainText("响应较慢");
    await expect(page.locator(".his-agent-status-row").nth(2)).toContainText("执行前检测");
    await page.waitForTimeout(500);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("footer voice input dictates into main input without entering visit session", async ({ page }) => {
    await installFakeVoiceRuntime(page);
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-main-dictation&" + localServiceQuery);
    await openAgent(page);
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentSendButton")).toBeVisible();
    await expect(page.locator("#hisAgentVoiceButton")).toHaveText("语音输入");
    await expect(page.locator("#hisAgentVisitSessionButton")).toHaveText("就诊会话");
    await expect(page.locator("#hisAgentNewSessionButton")).toHaveText("新会话");

    await page.locator("#hisAgentVoiceButton").click();
    await expect(page.locator("#hisAgentVoiceButton")).toHaveText("停止录音");
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentVoiceView")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__e2eVoiceSockets?.length || 0)).toBe(1);
    await page.evaluate(() => {
      const socket = window.__e2eVoiceSockets[0];
      socket.emit({ type: "partial", normalizedText: "把主诉改成胸闷" });
      socket.emit({ type: "final", normalizedText: "把主诉改成胸闷半天" });
    });
    await expect(page.locator("#hisAgentInput")).toHaveValue(/胸闷半天/);
    const turnsWhileDictating = await page.evaluate(() => window.HisAgentWidget?.getConversationTurns?.().length || 0);
    expect(turnsWhileDictating).toBe(0);
    await page.locator("#hisAgentVoiceButton").click();
    await expect(page.locator("#hisAgentVoiceButton")).toHaveText("语音输入");
    const stopped = await page.evaluate(() => ({
      recording: window.HisVoiceInputController?.getState?.().recording,
      streamTrackCount: window.__HIS_AGENT_VOICE_DEBUG__?.dump?.().streamTrackCount,
      trackStopped: window.__e2eMicTrack?.stopped
    }));
    expect(stopped.recording).toBe(false);
    expect(stopped.streamTrackCount).toBe(0);
    expect(stopped.trackStopped).toBe(true);
  });

  test("visit session opens without microphone and records only after start button", async ({ page }) => {
    await installFakeVoiceRuntime(page);
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-visit-session-start-stop&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentVisitSessionButton").click();
    await expect(page.locator("#hisAgentVoiceView")).toBeVisible();
    let voiceState = await page.evaluate(() => ({
      recording: window.HisVoiceInputController?.getState?.().recording,
      debug: window.__HIS_AGENT_VOICE_DEBUG__?.dump?.()
    }));
    expect(voiceState.recording).toBe(false);
    expect(voiceState.debug.didCallGetUserMedia).toBe(false);
    expect(voiceState.debug.streamTrackCount).toBe(0);
    const visibleVoiceStatus = await page.locator("#hisAgentVoiceStatusCard").evaluate((node) => node.innerText);
    expect(visibleVoiceStatus).not.toMatch(/ASR WebSocket|Diarization WS|provider=|mic policy|speaker_0|speaker_1|llm_enabled/);
    await expect(page.locator(".his-agent-voice-dev-summary")).not.toHaveAttribute("open", "");
    await page.locator("#hisAgentStartVoiceButton").click();
    await expect.poll(() => page.evaluate(() => window.__e2eVoiceSockets?.length || 0)).toBeGreaterThanOrEqual(1);
    voiceState = await page.evaluate(() => ({
      recording: window.HisVoiceInputController?.getState?.().recording,
      debug: window.__HIS_AGENT_VOICE_DEBUG__?.dump?.()
    }));
    expect(voiceState.recording).toBe(true);
    expect(voiceState.debug.streamTrackCount).toBe(1);
    await page.locator("#hisAgentStopVoiceButton").click();
    voiceState = await page.evaluate(() => ({
      recording: window.HisVoiceInputController?.getState?.().recording,
      debug: window.__HIS_AGENT_VOICE_DEBUG__?.dump?.()
    }));
    expect(voiceState.recording).toBe(false);
    expect(voiceState.debug.streamTrackCount).toBe(0);
    expect(await page.evaluate(() => window.__e2eMicTrack?.stopped)).toBe(true);
    await page.locator("#hisAgentMockTurnsButton").click();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeVisible();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeEnabled();
  });

  test("v2 input router state machine and task model expose safe contracts", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-agent-v2-modules&" + localServiceQuery);
    await openAgent(page);
    const contracts = await page.evaluate(() => {
      const waiting = window.AgentInputRouter.routeInput(
        { text: "其实应该是张伟", input_type: "text_task", source_view: "chatView", conversation_state: "waiting_user" },
        { activeTask: { task_id: "task_old", status: "waiting_user" } }
      );
      const cancel = window.AgentInputRouter.routeInput(
        { text: "取消", input_type: "text_task", source_view: "chatView", conversation_state: "waiting_user" },
        { activeTask: { task_id: "task_old", status: "waiting_user" } }
      );
      const voiceText = window.AgentInputRouter.routeInput({ text: "胸闷半天", input_type: "voice_text" }, {});
      const machine = window.AgentStateMachine.createMachine({ initialState: "home" });
      const first = machine.transition("chatting", "send_text");
      const second = machine.transition("planning", "llm_planning", { task_id: "task_old" });
      const task = window.AgentTaskModel.normalizeTask({
        task_id: "task_old",
        status: "waiting_user",
        slots: { waitingFor: "clarify_patient" },
        plan: [{ actionType: "find_patient", requiredPage: "patientManagement" }]
      });
      const traceEntry = window.AgentFlowTrace.record("e2e_contract_probe", {
        task_id: "task_old",
        route: "contract_test",
        view_state: "chat"
      });
      return {
        waitingRoute: waiting.route,
        waitingReason: waiting.reason_code,
        cancelRoute: cancel.route,
        voiceRoute: voiceText.route,
        firstTransition: first.ok,
        secondTransition: second.ok,
        state: machine.getState(),
        taskId: task.task_id,
        waitingFor: task.waitingFor,
        stepId: task.plan[0].step_id,
        stepAction: task.plan[0].action,
        traceApi: Boolean(window.AgentFlowTrace?.record && window.AgentFlowTrace?.getEvents),
        traceEvent: traceEntry?.event || "",
        traceTaskId: traceEntry?.task_id || ""
      };
    });
    expect(contracts.waitingRoute).toBe("continue_active_task");
    expect(contracts.waitingReason).toBe("active_task_clarification");
    expect(contracts.cancelRoute).toBe("cancel_active_task");
    expect(contracts.voiceRoute).toBe("fill_input_only");
    expect(contracts.firstTransition).toBe(true);
    expect(contracts.secondTransition).toBe(true);
    expect(contracts.state).toBe("planning");
    expect(contracts.taskId).toBe("task_old");
    expect(contracts.waitingFor).toBe("clarify_patient");
    expect(contracts.stepId).toBe("step_1");
    expect(contracts.stepAction).toBe("find_patient");
    expect(contracts.traceApi).toBe(true);
    expect(contracts.traceEvent).toBe("e2e_contract_probe");
    expect(contracts.traceTaskId).toBe("task_old");
  });

  test("generic observation layer exposes controls forms tables and auth context", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-generic-observation&" + localServiceQuery);
    const observation = await page.evaluate(() => window.HisAgentBrowser.observeCurrentPage());
    expect(observation.observation_id).toMatch(/^obs_/);
    expect(observation.page_type).toBe("login");
    expect(observation.auth_context.is_login_page).toBe(true);
    expect(observation.forms.length).toBeGreaterThanOrEqual(1);
    expect(observation.controls.some((item) => item.role === "textbox" && /账号|account|login/i.test(item.accessible_name + item.visible_text))).toBeTruthy();
    expect(observation.controls.some((item) => item.role === "button" && /登录/.test(item.accessible_name + item.visible_text))).toBeTruthy();
    expect(observation.controls.every((item) => item.element_ref)).toBeTruthy();
  });

  test("generic browser action space works on unknown page fixture", async ({ page }) => {
    await page.goto("/tests/fixtures/unknown-page.html?v=e2e-generic-action");
    const result = await page.evaluate(async () => {
      const browser = window.HisAgentBrowser;
      const observe = () => browser.observeCurrentPage();
      let obs = observe();
      const byTestId = (id) => obs.controls.find((item) => item.element_ref.includes(id));
      await browser.executeAction({ type: "type", element_ref: byTestId("fixture-name").element_ref, value: "张伟" });
      obs = observe();
      await browser.executeAction({ type: "type", element_ref: byTestId("fixture-note").element_ref, value: "通用动作备注" });
      obs = observe();
      await browser.executeAction({ type: "select_option", element_ref: byTestId("fixture-department").element_ref, value: "呼吸内科" });
      obs = observe();
      await browser.executeAction({ type: "set_date", element_ref: byTestId("fixture-date").element_ref, value: "2026-06-24" });
      obs = observe();
      await browser.executeAction({ type: "check", element_ref: byTestId("fixture-consent").element_ref });
      obs = observe();
      await browser.executeAction({ type: "check", element_ref: byTestId("fixture-urgent").element_ref });
      obs = observe();
      const submit = byTestId("fixture-submit");
      const actionResult = await browser.executeAction({ type: "click", element_ref: submit.element_ref });
      return {
        beforePage: actionResult.evidence.before_page_type,
        afterPage: actionResult.evidence.after_page_type,
        status: actionResult.status,
        resultText: document.querySelector("#result").textContent,
        controlCount: observe().controls.length,
        tableCount: observe().tables.length
      };
    });
    expect(result.status).toBe("completed");
    expect(result.beforePage).toBe("unknownFixture");
    expect(result.afterPage).toBe("unknownFixture");
    expect(result.resultText).toContain("张伟");
    expect(result.resultText).toContain("通用动作备注");
    expect(result.resultText).toContain("呼吸内科");
    expect(result.resultText).toContain("consented");
    expect(result.controlCount).toBeGreaterThanOrEqual(8);
    expect(result.tableCount).toBeGreaterThanOrEqual(1);
  });

  test("waiting_user clarification keeps original task id and uses backend planner", async ({ page }) => {
    await simulateConnectedLlm(page);
    let plannerPayload: any = null;
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      plannerPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          llmUsed: true,
          usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
          response: {
            kind: "ask_clarification",
            message: "请继续补充字段。",
            clarification: { question: "请继续补充字段。", reason: "clarify_field", options: [] }
          },
          trace: { e2e: "continuation" }
        })
      });
    });
    await page.goto("/html/login.html?v=e2e-agent-v2-continuation&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "task_waiting_original",
        objective: "把不存在患者 ABC 的手机号改成 13800138000",
        status: "waiting_user",
        source: "backend_llm",
        slots: { waitingFor: "clarify_patient" },
        created_at: now / 1000,
        started_at: now / 1000,
        started_at_ms: now,
        current_step_index: 0,
        plan: [{ id: "step_find", goal: "确认患者", actionType: "find_patient", source: "backend_llm", status: "waiting_user" }],
        progress_messages: [],
        step_logs: []
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("其实应该是张伟");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("hisAgentActiveTask") || "{}").clarifications?.length || 0)).toBe(1);
    const result = await page.evaluate(() => {
      const task = JSON.parse(window.localStorage.getItem("hisAgentActiveTask") || "{}");
      return {
        taskId: task.task_id,
        status: task.status,
        waitingFor: task.waitingFor,
        clarification: task.clarifications && task.clarifications[0] && task.clarifications[0].text
      };
    });
    expect(result.taskId).toBe("task_waiting_original");
    expect(result.status).toBe("waiting_user");
    expect(result.waitingFor).toBe("clarify_field");
    expect(result.clarification).toBe("其实应该是张伟");
    expect(plannerPayload.user_message).toContain("原任务");
    expect(plannerPayload.user_message).toContain("用户补充：其实应该是张伟");
    expect(plannerPayload.active_task.task_id).toBe("task_waiting_original");
  });

  test("message scroll manager preserves user scroll and shows unread prompt", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-agent-v2-scroll&" + localServiceQuery);
    await openAgent(page);
    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='patient-management']").click();
    await page.evaluate(() => {
      for (let index = 0; index < 24; index += 1) {
        window.HisAgentWidget.addMessage("agent", "滚动测试消息 " + index, "agent");
      }
      const body = document.querySelector("#hisAgentBody");
      body.scrollTop = 0;
      body.dispatchEvent(new Event("scroll"));
      window.HisAgentWidget.addMessage("agent", "底部新增消息", "agent");
    });
    await expect(page.locator("#hisAgentNewMessagesButton")).toBeVisible();
    const beforeClick = await page.locator("#hisAgentBody").evaluate((node) => node.scrollTop);
    expect(beforeClick).toBeLessThan(80);
    await page.locator("#hisAgentNewMessagesButton").click();
    await expect(page.locator("#hisAgentNewMessagesButton")).toBeHidden();
    await expect.poll(async () => {
      const top = await page.locator("#hisAgentBody").evaluate((node) => node.scrollTop);
      return top > beforeClick + 1000;
    }).toBe(true);
    const scrollState = await page.evaluate(() => window.HisAgentWidget?.getV2State?.().scroll);
    expect(scrollState?.unreadMessageCount).toBe(0);
  });

  test("task progress updates current card without mirroring every step as chat messages", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-agent-v2-progress-card&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "task_progress_card",
        objective: "修改患者 P001 的手机号并保存",
        status: "running",
        source: "backend_llm",
        current_step_index: 0,
        created_at: now / 1000,
        started_at: now / 1000,
        started_at_ms: now,
        plan: [
          { id: "step_1", goal: "确认患者", actionType: "find_patient", source: "backend_llm", status: "running" },
          { id: "step_2", goal: "保存", actionType: "save_patient", source: "backend_llm", status: "pending" }
        ],
        progress_messages: [],
        step_logs: []
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await page.evaluate(() => {
      ["开始步骤：确认患者", "完成步骤：确认患者", "Token：10 / 累计 10"].forEach((text, index) => {
        window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
          detail: { task_id: "task_progress_card", elapsed_ms: 1000 + index, text, details: { index } }
        }));
      });
    });
    await expect(page.locator("#hisAgentCurrentTaskCard")).toBeVisible();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("Agent：");
    await expect(page.locator("#hisAgentCurrentTaskCard .his-agent-current-steps")).not.toHaveAttribute("open", "");
    await expect(page.locator("#hisAgentTaskList")).toBeHidden();
    await expect(page.locator("#hisAgentSendButton")).toHaveText("取消任务");
    await expect(page.locator("#hisAgentCancelTaskButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentHistory")).not.toContainText("开始步骤：确认患者");
    await expect(page.locator("#hisAgentHistory")).not.toContainText("完成步骤：确认患者");
    const progressMessages = await page.locator("#hisAgentHistory .his-agent-message.progress-summary").count();
    expect(progressMessages).toBe(0);
  });

  test("task progress does not force the user back into chat view after returning home", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-agent-v2-return-home-stable&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "task_return_home_stable",
        objective: "修改患者 P001 的手机号并保存",
        status: "running",
        source: "backend_llm",
        current_step_index: 0,
        created_at: now / 1000,
        started_at_ms: now,
        plan: [
          { id: "step_1", goal: "确认患者", actionType: "find_patient", source: "backend_llm", status: "running" },
          { id: "step_2", goal: "保存", actionType: "save_patient", source: "backend_llm", status: "pending" }
        ],
        progress_messages: [],
        step_logs: []
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await page.locator("#hisAgentViewBackButton").click();
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentChatView")).toBeHidden();
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
        detail: { task_id: "task_return_home_stable", elapsed_ms: 1200, text: "完成步骤：确认患者" }
      }));
    });
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await expect(page.locator("#hisAgentChatView")).toBeHidden();
    const trace = await page.evaluate(() => window.AgentFlowTrace?.getEvents?.().map((item) => item.event) || []);
    expect(trace).toContain("view_return_home");
    expect(trace).toContain("task_progress");
  });

  test("chat workspace can be opened directly and keeps the recent task checklist", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-direct-chat-workspace&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentTaskHistory", JSON.stringify([
        {
          task_id: "e2e_recent_completed_task",
          objective: "修改患者 P001 的手机号并保存",
          status: "completed",
          source: "backend_llm",
          created_at: now / 1000 - 30,
          started_at_ms: now - 30000,
          finished_at_ms: now - 25000,
          elapsed_ms: 5000,
          plan: [
            { id: "step_find", goal: "确认患者 P001", actionType: "find_patient", source: "backend_llm", status: "completed", elapsed_ms: 1200 },
            { id: "step_update", goal: "修改手机号", actionType: "update_patient_field", source: "backend_llm", status: "completed", elapsed_ms: 1800 },
            { id: "step_save", goal: "保存患者", actionType: "save_patient", source: "backend_llm", status: "completed", elapsed_ms: 900 }
          ],
          progress_messages: [],
          step_logs: []
        }
      ]));
    });
    await openAgent(page);
    await expect(page.locator("#hisAgentTaskPlanButton")).toBeHidden();
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toBeVisible();
    await expect(page.locator("#hisAgentTaskPlanButton")).toBeVisible();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toHaveClass(/minimized/);
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("最近任务计划");
    await page.locator("#hisAgentTaskPlanButton").click();
    await expect(page.locator("#hisAgentCurrentTaskCard")).not.toHaveClass(/minimized/);
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("任务已完成");
    await expect(page.locator("#hisAgentCurrentTaskCard .his-agent-current-steps")).not.toHaveAttribute("open", "");
    await expect(page.locator("#hisAgentTaskList")).toBeHidden();
    await page.locator("#hisAgentCurrentTaskCard [data-agent-action='minimize-task-panel']").click();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toHaveClass(/minimized/);
    await page.locator("#hisAgentCurrentTaskCard [data-agent-action='expand-task-panel']").click();
    await expect(page.locator("#hisAgentCurrentTaskCard")).not.toHaveClass(/minimized/);
    await page.locator("#hisAgentCurrentTaskCard .his-agent-current-steps > summary").click();
    await expect(page.locator("#hisAgentTaskList")).toContainText("completed");
    await expect(page.locator("#hisAgentCurrentTaskCard [data-agent-action='cancel-task']")).toHaveCount(0);
    await expect(page.locator("#hisAgentSendButton")).toHaveText("发送");
    await expect(page.locator("#hisAgentCancelTaskButton")).toHaveCount(0);
  });

  test("primary footer button becomes cancel only while a task is running", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-primary-button-task-state&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_running_primary_button",
        objective: "修改患者 P001 的手机号并保存",
        status: "running",
        source: "backend_llm",
        current_step_index: 0,
        created_at: now / 1000,
        started_at_ms: now,
        plan: [{ id: "step_find", goal: "确认患者", actionType: "find_patient", source: "backend_llm", status: "running" }],
        progress_messages: [],
        step_logs: []
      }));
    });
    await openAgent(page);
    await expect(page.locator("#hisAgentSendButton")).toHaveText("取消任务");
    await expect(page.locator("#hisAgentCancelTaskButton")).toHaveCount(0);
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentSendButton")).toHaveText("发送");
    expect(await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();

    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_waiting_primary_button",
        objective: "修改患者 P001 的手机号并保存",
        status: "waiting_user",
        source: "backend_llm",
        current_step_index: 0,
        created_at: now / 1000,
        started_at_ms: now,
        slots: { waitingFor: "clarify_patient" },
        plan: [{ id: "step_find", goal: "确认患者", actionType: "find_patient", source: "backend_llm", status: "waiting_user" }],
        progress_messages: [],
        step_logs: []
      }));
    });
    await page.reload();
    await ensureAgentOpen(page);
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("waiting_user");
    await expect(page.locator("#hisAgentSendButton")).toHaveText("发送");
    await expect(page.locator("#hisAgentCancelTaskButton")).toHaveCount(0);
  });

  test("sending a task moves messages into chat view without home cards", async ({ page }) => {
    await simulateNoLlm(page);
    await page.goto("/html/login.html?v=e2e-chat-view-send&" + localServiceQuery);
    await openAgent(page);
    await expect(page.locator("#hisAgentHomeView")).toBeVisible();
    await page.locator("#hisAgentInput").fill("修改 P001 手机号为 13800138000 并保存");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await expect(page.locator("#hisAgentHomeView")).toBeHidden();
    await expect(page.locator("#hisAgentTopicGrid")).toBeHidden();
    await expect(page.locator("#hisAgentHistory")).toContainText("修改 P001 手机号");
    await expect(page.locator("#hisAgentViewBackButton")).toBeVisible();
    const activeTask = await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"));
    expect(activeTask).toBeNull();
  });

  test("renders compact current task list with collapsed optional panels", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-task-display&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_task_display",
        objective: "修改患者 P001 的手机号为 13800138000 并保存",
        status: "waiting_user",
        source: "backend_llm",
        current_step_index: 1,
        created_at: now / 1000,
        updated_at: now / 1000,
        started_at_ms: now - 3000,
        usage_total: null,
        plan: [
          {
            id: "step_find_patient",
            goal: "确认目标患者：P001 张伟",
            requiredPage: "patientManagement",
            actionType: "find_patient",
            source: "backend_llm",
            status: "completed",
            started_at_ms: now - 3000,
            finished_at_ms: now - 2000,
            elapsed_ms: 1000,
            args: { patientSelector: { patientId: "P001" } },
            result: { success: true, action_type: "find_patient", observation: "已匹配 P001 张伟" }
          },
          {
            id: "step_update_phone",
            goal: "修改手机号字段为 13800138000",
            requiredPage: "patientEditor",
            actionType: "update_patient_field",
            source: "backend_llm",
            status: "running",
            started_at_ms: now - 1000,
            args: { patientSelector: { patientId: "P001" }, field: "phone", value: "13800138000" }
          },
          {
            id: "step_save",
            goal: "保存患者修改",
            requiredPage: "patientEditor",
            actionType: "save_patient",
            source: "backend_llm",
            status: "pending",
            args: { patientSelector: { patientId: "P001" } }
          }
        ],
        progress_messages: [
          { elapsed_ms: 1000, text: "完成步骤：确认目标患者：P001 张伟", details: { step: { id: "step_find_patient" } } }
        ],
        step_logs: [{ at: new Date(now).toISOString(), message: "patient resolver: P001 -> 张伟" }]
      }));
    });
    await page.reload();
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await page.evaluate(() => {
      const task = JSON.parse(window.localStorage.getItem("hisAgentActiveTask") || "{}");
      window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
        detail: {
          task_id: task.task_id,
          elapsed_ms: 1000,
          text: "LLM 返回任务计划",
          details: { summary: "e2e progress trigger" }
        }
      }));
    });

    await expect(page.locator("#hisAgentCurrentTaskCard")).toBeVisible();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("running");
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText(/\/3/);
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText(/\d+\.\ds/);
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText(/token:/);
    await expect(page.locator("#hisAgentTaskPlanButton")).toBeVisible();
    await expect(page.locator("#hisAgentCurrentTaskCard [data-agent-action='history']")).toBeVisible();
    await expect(page.locator("#hisAgentCurrentTaskCard [data-agent-action='cancel-task']")).toBeVisible();
    await expect(page.locator("#hisAgentTask")).toBeHidden();
    await expect(page.locator("#hisAgentHistory")).not.toContainText("current_step_index");
    await expect(page.locator("#hisAgentCurrentTaskCard .his-agent-current-steps")).not.toHaveAttribute("open", "");
    await expect(page.locator("#hisAgentTaskList")).toBeHidden();
    await page.locator("#hisAgentCurrentTaskCard .his-agent-current-steps > summary").click();
    await expect(page.locator("#hisAgentTaskList")).toBeVisible();
    await expect(page.locator("#hisAgentTaskList")).toContainText("completed");
    await expect(page.locator("#hisAgentTaskList")).toContainText("running");
    await expect(page.locator("#hisAgentTaskList")).toContainText("pending");
    await expect(page.locator("#hisAgentTaskList")).toContainText("token: 本地执行");
    await expect(page.locator("details.his-agent-task-detail-panel")).toHaveCount(0);
    await page.locator("#hisAgentCurrentTaskCard [data-agent-action='history']").click();
    await expect(page).toHaveURL(/agent-history\.html\?taskId=e2e_task_display/);
    await expect(page.locator("body")).toContainText("结构化任务步骤");
    await expect(page.locator(".step-item.completed .mark")).toContainText("✓");
    await expect(page.locator(".step-item.completed")).toContainText("completed");
    await expect(page.locator(".step-item.running")).toContainText("running");
    await expect(page.locator(".step-item.pending")).toContainText("pending");
    await expect(page.locator(".step-list")).toContainText(/\d+\.\ds/);
    await expect(page.locator(".step-list")).toContainText("token: 未返回");
    await expect(page.locator("details.debug").filter({ hasText: "开发者详情" })).not.toHaveAttribute("open", "");
  });

  test("agent history shows elapsed token patient source and audit details", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-history-seed");
    await page.evaluate(() => {
      const now = Date.now();
      window.localStorage.setItem("hisAgentTaskHistory", JSON.stringify([
        {
          task_id: "e2e_history_rich_task",
          objective: "修改患者 P001 的手机号为 13800138000 并保存",
          status: "completed",
          source: "backend_llm",
          slots: { target_patient_id: "P001" },
          created_at_ms: now - 4000,
          started_at_ms: now - 3500,
          finished_at_ms: now - 500,
          elapsed_ms: 3000,
          usage_total: { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 },
          plan: [
            {
              id: "step_update_phone",
              goal: "修改手机号字段",
              requiredPage: "patientEditor",
              actionType: "update_patient_field",
              status: "completed",
              source: "backend_llm",
              elapsed_ms: 1200,
              usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
              args: { patientSelector: { patientId: "P001" }, field: "phone", value: "13800138000" },
              result: {
                success: true,
                action_type: "update_patient_field",
                patientId: "P001",
                field: "phone",
                fieldLabel: "手机号",
                oldValue: "13900000001",
                newValue: "13800138000",
                audit_id: "audit_e2e_history"
              }
            }
          ],
          progress_messages: [],
          step_logs: [{ at: new Date(now).toISOString(), message: "patient resolver 输入：P001" }]
        }
      ]));
      window.localStorage.setItem("his_demo_patient_audit_v2", JSON.stringify([
        {
          audit_id: "audit_e2e_history",
          timestamp: new Date(now).toISOString(),
          patientId: "P001",
          patientName: "张伟",
          field: "phone",
          fieldLabel: "手机号",
          oldValue: "13900000001",
          newValue: "13800138000",
          actor: "agent",
          source: "backend_llm",
          task_id: "e2e_history_rich_task"
        }
      ]));
    });
    await page.goto("/html/agent-history.html?taskId=e2e_history_rich_task&v=e2e-history-rich");
    await expect(page.locator("#taskList")).toContainText("患者：P001");
    await expect(page.locator("#taskList")).toContainText("来源：backend_llm");
    await expect(page.locator("#summaryGrid")).toContainText("总 token");
    await expect(page.locator("#summaryGrid")).toContainText("30");
    await expect(page.locator("#summaryGrid")).toContainText("21 / 9");
    await expect(page.locator(".step-item.completed")).toContainText("1.2s");
    await expect(page.locator(".step-item.completed")).toContainText("13800138000");
    await expect(page.locator(".step-item.completed")).toContainText("audit_e2e_history");
    await expect(page.locator(".audit-list")).toContainText("audit_e2e_history");
    await expect(page.locator("details.debug").filter({ hasText: "开发者详情" })).not.toHaveAttribute("open", "");
  });

  test("agent history marks old tasks without timing as not recorded", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-history-old-timing");
    await page.evaluate(() => {
      localStorage.setItem("hisAgentTaskHistory", JSON.stringify([{
        task_id: "e2e_old_no_timing",
        objective: "旧任务没有 timing 字段",
        status: "completed",
        source: "backend_llm",
        plan: [
          { id: "step_old", goal: "旧步骤", actionType: "noop", status: "completed", source: "backend_llm" }
        ],
        progress_messages: [],
        step_logs: []
      }]));
    });
    await page.goto("/html/agent-history.html?taskId=e2e_old_no_timing&v=e2e-history-old-timing");
    await expect(page.locator("#summaryGrid")).toContainText("未记录");
    await expect(page.locator(".step-item.completed")).toContainText("未记录");
    await expect(page.locator(".step-item.completed")).not.toContainText("00:00");
  });

  test("login-only prefilled task skips retyping and records DOM timing", async ({ page }) => {
    await simulateLlmPlanner(page, [
      { id: "step_fill_login", goal: "确认登录表单账号密码", requiredPage: "login", actionType: "fill_login_form", args: { username: "123", password: "123" } },
      { id: "step_submit_login", goal: "点击登录", requiredPage: "login", actionType: "submit_login", args: { username: "123", password: "123" } }
    ], {}, "e2e_login_prefilled_timing");
    await page.goto("/html/login.html?v=e2e-login-prefilled-timing&" + localServiceQuery);
    await page.locator("#loginAccountInput").fill("123");
    await page.locator("#loginPasswordInput").fill("123");
    await page.evaluate(() => {
      localStorage.setItem("e2eLoginInputEvents", JSON.stringify({ username: 0, password: 0 }));
      const bump = (key) => {
        const current = JSON.parse(localStorage.getItem("e2eLoginInputEvents") || "{}");
        current[key] = Number(current[key] || 0) + 1;
        localStorage.setItem("e2eLoginInputEvents", JSON.stringify(current));
      };
      document.querySelector("#loginAccountInput")?.addEventListener("input", () => bump("username"));
      document.querySelector("#loginPasswordInput")?.addEventListener("input", () => bump("password"));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("输入账户为123，密码为123，然后登录");
    await page.locator("#hisAgentSendButton").click();
    await expect(page).toHaveURL(/dashboard\.html/, { timeout: 15_000 });
    await expect.poll(async () => page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
      return history.some((item) => item.task_id === "e2e_login_prefilled_timing" && item.status === "completed");
    }), { timeout: 10_000 }).toBe(true);
    const result = await page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
      const task = history.find((item) => item.task_id === "e2e_login_prefilled_timing");
      return {
        events: JSON.parse(localStorage.getItem("e2eLoginInputEvents") || "{}"),
        task,
        fill: task?.plan?.find((step) => step.id === "step_fill_login"),
        submit: task?.plan?.find((step) => step.id === "step_submit_login")
      };
    });
    expect(result.events.username).toBe(0);
    expect(result.events.password).toBe(0);
    expect(result.fill?.result?.observation || "").toContain("跳过重复输入");
    expect(result.fill?.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(result.fill?.timing?.breakdown || result.fill?.timing_breakdown).toBeTruthy();
    expect(result.fill?.usage_source).toBe("local_dom");
    expect(result.submit?.timing?.breakdown?.verify_ms || result.submit?.timing_breakdown?.verify_ms || 0).toBeGreaterThan(0);
  });

  test("floating panel header is a larger drag region", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-drag-region");
    await openAgent(page);
    const region = page.locator('[data-testid="his-agent-drag-region"]');
    await expect(region).toBeVisible();
    const cursor = await region.evaluate((node) => getComputedStyle(node).cursor);
    expect(cursor).toContain("grab");
  });

  test("dashboard links to Agent execution history page", async ({ page }) => {
    await page.goto("/html/dashboard.html?v=e2e-agent-history-entry");
    await expect(page.getByRole("link", { name: "修改历史" })).toBeVisible();
    await expect(page.locator("#agentHistoryEntry")).toContainText("打开执行记录");
    await page.locator("#agentHistoryEntry").click();
    await expect(page).toHaveURL(/agent-history\.html/);
    await expect(page.locator("body")).toContainText("修改历史 / Agent 执行记录");
  });

  test("dashboard logout returns to login without clearing history or audit", async ({ page }) => {
    await page.goto("/html/dashboard.html?v=e2e-logout-seed");
    await page.evaluate(() => {
      window.localStorage.setItem("hisAgentTaskHistory", JSON.stringify([{ task_id: "e2e_keep_history", status: "completed", plan: [] }]));
      window.localStorage.setItem("his_demo_patient_audit_v2", JSON.stringify([{ audit_id: "audit_keep", patientId: "P001" }]));
    });
    await page.locator("#logoutButton").click();
    await expect(page).toHaveURL(/login\.html/);
    const state = await page.evaluate(() => ({
      auth: window.localStorage.getItem("hisDemoAuthenticated"),
      history: window.localStorage.getItem("hisAgentTaskHistory"),
      audit: window.localStorage.getItem("his_demo_patient_audit_v2")
    }));
    expect(state.auth).toBe("false");
    expect(state.history || "").toContain("e2e_keep_history");
    expect(state.audit || "").toContain("audit_keep");
  });

  test("shows concise service status chips and expandable diagnostics", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-service-status");
    await openAgent(page);

    await expect(page.locator("#hisAgentBackendStatus")).toContainText("Backend");
    await expect(page.locator("#hisAgentBackendStatus")).toContainText("LLM");
    await expect(page.locator("#hisAgentBackendStatus")).toContainText("Agent");
    await expect(page.locator("#hisAgentAsrStatus")).toContainText("ASR 服务");
    await expect(page.locator("#hisAgentAsrStatus")).toContainText("麦克风");
    await expect(page.locator("#hisAgentAsrStatus")).toContainText("说话人分离");
    await expect(page.locator("#hisAgentAsrStatus")).toContainText("Data");

    const settings = page.locator("details.his-agent-settings").filter({ hasText: "服务地址" });
    await expect(settings).toBeHidden();

    await page.locator(".his-agent-topic-card:not(.his-agent-topic-card-clone)[data-agent-topic='connection']").first().click();
    await expect(page.locator("#hisAgentStatusView")).toBeVisible();
    await expect(page.locator(".his-agent-developer-foldout")).not.toHaveAttribute("open", "");
    await page.locator(".his-agent-developer-foldout summary").click();
    await expect(page.locator("#hisAgentStatusView .his-agent-service-diagnostics")).toContainText("Backend health");
    await expect(page.locator("#hisAgentStatusView .his-agent-service-diagnostics")).toContainText("/api/health");
    await expect(page.locator("#hisAgentStatusView .his-agent-service-diagnostics")).toContainText("LLM test");
    await expect(page.locator("#hisAgentStatusView .his-agent-service-diagnostics")).toContainText("ASR health");
  });

  test("voice page is focused and microphone debug remains separated from ASR service", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
      Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    });
    await page.route(/:8010\/health$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "asr" }) });
    });
    await page.route(/\/diarization\/health$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, provider: "manual", active_provider: "manual", status: "manual" }) });
    });
    await page.goto("/html/login.html?v=e2e-voice-focused&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await expect(page.locator("#hisAgentViewBackButton")).toBeVisible();
    await expect(page.locator("#hisAgentChatBackButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentBackToHomeButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentVoiceView")).toBeVisible();
    await expect(page.locator("#hisAgentVoiceStatusCard")).toBeVisible();
    await expect(page.locator("#hisAgentCheckMicrophoneButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentForceProbeButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentPasteTurnsButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentCopyTurnsButton")).toHaveCount(0);
    await expect(page.locator("details.his-agent-voice-debug-panel")).not.toHaveAttribute("open", "");

    await page.locator("#hisAgentStartVoiceButton").click();
    await expect(page.locator("#hisAgentAsrStatus")).toContainText("connected");
    const debug = await page.evaluate(() => window.__HIS_AGENT_VOICE_DEBUG__?.dump?.());
    expect(debug.asrHealthStatus).toBe("connected");
    expect(debug.microphoneStatus).toBe("unavailable_api");
    expect(debug.didCallGetUserMedia).toBe(false);
  });

  test("optional fake microphone recording @mic", async ({ page }) => {
    test.skip(process.env.RUN_MIC_E2E !== "1", "RUN_MIC_E2E=1 enables Chromium fake microphone args.");
    await page.route(/:8010\/health$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "asr" }) });
    });
    await page.goto("/html/login.html?v=e2e-voice-fake-mic&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    const beforeProbe = await page.evaluate(() => window.__HIS_AGENT_VOICE_DEBUG__?.dump?.());
    test.skip(!beforeProbe?.hasGetUserMedia, "Chromium fake media did not expose getUserMedia for this origin.");
    await page.locator("#hisAgentStartVoiceButton").click();
    const debug = await page.evaluate(() => window.__HIS_AGENT_VOICE_DEBUG__?.dump?.());
    expect(["recording", "available", "permission_granted"]).toContain(debug.microphoneStatus);
    expect(debug.didCallGetUserMedia).toBe(true);
  });

  test("voice controller normalizes Diart speaker metadata before turns", async ({ page }) => {
    await page.addInitScript(() => {
      class FakeWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        constructor(url) {
          this.url = String(url);
          this.readyState = FakeWebSocket.OPEN;
          this.binaryType = "";
          this.sent = [];
          window.__e2eVoiceSockets = window.__e2eVoiceSockets || [];
          window.__e2eVoiceSockets.push(this);
          setTimeout(() => {
            if (this.onopen) this.onopen({ target: this });
          }, 0);
        }
        send(data) {
          this.sent.push(data);
        }
        close() {
          this.readyState = FakeWebSocket.CLOSED;
          if (this.onclose) this.onclose({ target: this });
        }
        emit(data) {
          if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
        }
      }
      Object.defineProperty(window, "WebSocket", { value: FakeWebSocket, configurable: true });
      Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() {} }]
          })
        },
        configurable: true
      });
      class FakeAudioContext {
        constructor() {
          this.sampleRate = 16000;
          this.destination = {};
          this.state = "running";
        }
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createScriptProcessor() {
          const node = { onaudioprocess: null, connect() {}, disconnect() {} };
          window.__e2eAudioProcessor = node;
          return node;
        }
        close() {
          this.state = "closed";
          return Promise.resolve();
        }
      }
      Object.defineProperty(window, "AudioContext", { value: FakeAudioContext, configurable: true });
      Object.defineProperty(window, "webkitAudioContext", { value: FakeAudioContext, configurable: true });
    });
    await page.route(/:8010\/health$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, service: "asr" })
      });
    });
    await page.route(/\/diarization\/health$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, provider: "diart_local", active_provider: "diart_local", status: "available" })
      });
    });
    await page.goto("/html/login.html?v=e2e-speaker-normalize&" + localServiceQuery);

    const rules = await page.evaluate(() => {
      const normalize = window.HisVoiceInputController.normalizeSpeakerId;
      return {
        speaker0: normalize("speaker0"),
        speaker1: normalize("speaker1"),
        speaker_0: normalize("speaker_0"),
        speaker_1: normalize("speaker_1"),
        upper: normalize("SPEAKER_0"),
        spk0: normalize("spk0"),
        empty: normalize("")
      };
    });
    expect(rules).toEqual({
      speaker0: "speaker_0",
      speaker1: "speaker_1",
      speaker_0: "speaker_0",
      speaker_1: "speaker_1",
      upper: "speaker_0",
      spk0: "speaker_0",
      empty: null
    });

    const result = await page.evaluate(async () => {
      const voice = await window.HisVoiceInputController.start({
        asrUrl: "http://127.0.0.1:8010",
        diarizationUrl: "http://127.0.0.1:8000",
        llmStatus: "disconnected"
      });
      const sockets = window.__e2eVoiceSockets || [];
      const asr = sockets.find((socket) => !socket.url.includes("/ws/diarization"));
      const diarization = sockets.find((socket) => socket.url.includes("/ws/diarization"));
      asr.emit({
        type: "partial",
        session_id: "e2e_session",
        normalizedText: "待确认",
        turns: [{ turn_id: "e2e_unknown", text: "待确认", is_final: false }]
      });
      diarization.emit({
        type: "speaker_segment",
        session_id: "e2e_session",
        speaker_id: "speaker1",
        source: "diart_local",
        automatic: true,
        start_ms: 100,
        end_ms: 450,
        confidence: 0.91,
        is_final: true
      });
      asr.emit({
        type: "partial",
        session_id: "e2e_session",
        normalizedText: "我头疼",
        turns: [{ turn_id: "e2e_patient", raw_speaker_id: "speaker1", text: "我头疼", is_final: false }]
      });
      diarization.emit({
        type: "speaker_segment",
        session_id: "e2e_session",
        speaker_id: "speaker0",
        source: "diart_local",
        automatic: true,
        start_ms: 500,
        end_ms: 900,
        confidence: 0.88,
        is_final: true
      });
      asr.emit({
        type: "final",
        session_id: "e2e_session",
        normalizedText: "哪里不舒服",
        turns: [{ turn_id: "e2e_doctor", raw_speaker_id: "speaker0", text: "哪里不舒服", is_final: true }]
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const snapshot = window.HisVoiceInputController.getState();
      await window.HisVoiceInputController.stop();
      return { started: voice.recording, snapshot };
    });

    expect(result.started).toBe(true);
    const patientTurn = result.snapshot.turns.find((turn) => turn.turn_id === "e2e_patient");
    expect(patientTurn.raw_speaker_id).toBe("speaker1");
    expect(patientTurn.speaker_id).toBe("speaker_1");
    expect(patientTurn.role).toBe("patient");
    expect(patientTurn.role_label).toBe("患者");
    expect(patientTurn.source).toBe("diart_local");
    expect(patientTurn.diarization_source).toBe("diart_local");
    expect(patientTurn.automatic).toBe(true);
    expect(patientTurn.automatic_diarization).toBe(true);
    expect(patientTurn.diarization_start_ms).toBe(100);
    expect(patientTurn.diarization_end_ms).toBe(450);
    expect(patientTurn.diarization_confidence).toBe(0.91);

    const doctorTurn = result.snapshot.turns.find((turn) => turn.turn_id === "e2e_doctor");
    expect(doctorTurn.raw_speaker_id).toBe("speaker0");
    expect(doctorTurn.speaker_id).toBe("speaker_0");
    expect(doctorTurn.role).toBe("doctor");
    expect(doctorTurn.role_label).toBe("医生");
    expect(doctorTurn.source).toBe("diart_local");
    expect(doctorTurn.automatic_diarization).toBe(true);

    const unknownTurn = result.snapshot.turns.find((turn) => turn.turn_id === "e2e_unknown");
    expect(unknownTurn.speaker_id).toBeNull();
    expect(unknownTurn.role).toBe("unknown");
    expect(unknownTurn.role_label).toBe("未确认");
    expect(unknownTurn.source).toBe("asr_text_only_default_role");
    expect(unknownTurn.automatic_diarization).toBe(false);
  });

  test("voice UI preserves Diart metadata through manual correction and role swap", async ({ page }) => {
    await page.addInitScript(() => {
      class FakeWebSocket {
        static OPEN = 1;
        constructor(url) {
          this.url = String(url);
          this.readyState = FakeWebSocket.OPEN;
          this.sent = [];
          window.__e2eVoiceSockets = window.__e2eVoiceSockets || [];
          window.__e2eVoiceSockets.push(this);
          setTimeout(() => {
            if (this.onopen) this.onopen({ target: this });
          }, 0);
        }
        send(data) {
          this.sent.push(data);
        }
        close() {
          this.readyState = 3;
          if (this.onclose) this.onclose({ target: this });
        }
        emit(data) {
          if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
        }
      }
      Object.defineProperty(window, "WebSocket", { value: FakeWebSocket, configurable: true });
      Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() {} }]
          })
        },
        configurable: true
      });
      class FakeAudioContext {
        constructor() {
          this.sampleRate = 16000;
          this.destination = {};
          this.state = "running";
        }
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createScriptProcessor() {
          return { onaudioprocess: null, connect() {}, disconnect() {} };
        }
        close() {
          this.state = "closed";
          return Promise.resolve();
        }
      }
      Object.defineProperty(window, "AudioContext", { value: FakeAudioContext, configurable: true });
      Object.defineProperty(window, "webkitAudioContext", { value: FakeAudioContext, configurable: true });
    });
    await page.route(/:8010\/health$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, service: "asr" })
      });
    });
    await page.route(/\/diarization\/health$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, provider: "diart_local", active_provider: "diart_local", status: "available" })
      });
    });
    await page.goto("/html/login.html?v=e2e-speaker-manual-preserve&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await page.locator("#hisAgentStartVoiceButton").click();
    await expect.poll(async () => {
      return page.evaluate(() => window.__e2eVoiceSockets?.length || 0);
    }, { timeout: 10_000 }).toBe(2);

    await page.evaluate(() => {
      const sockets = window.__e2eVoiceSockets || [];
      const asr = sockets.find((socket) => !socket.url.includes("/ws/diarization"));
      const diarization = sockets.find((socket) => socket.url.includes("/ws/diarization"));
      diarization.emit({
        type: "speaker_segment",
        session_id: "e2e_ui_session",
        speaker_id: "speaker1",
        source: "diart_local",
        automatic: true,
        start_ms: 120,
        end_ms: 640,
        confidence: 0.93,
        is_final: true
      });
      asr.emit({
        type: "partial",
        session_id: "e2e_ui_session",
        normalizedText: "我头疼",
        turns: [{ turn_id: "e2e_ui_patient", raw_speaker_id: "speaker1", text: "我头疼", is_final: false }]
      });
    });

    await expect(page.locator("#hisAgentTurns")).toContainText("患者");
    const beforeManual = await page.evaluate(() => window.HisAgentWidget.getConversationTurns()[0]);
    expect(beforeManual.raw_speaker_id).toBe("speaker1");
    expect(beforeManual.speaker_id).toBe("speaker_1");
    expect(beforeManual.source).toBe("diart_local");
    expect(beforeManual.diarization_source).toBe("diart_local");
    expect(beforeManual.automatic_diarization).toBe(true);

    await page.locator(".his-agent-turn select").first().selectOption("doctor");
    const afterManual = await page.evaluate(() => window.HisAgentWidget.getConversationTurns()[0]);
    expect(afterManual.raw_speaker_id).toBe("speaker1");
    expect(afterManual.speaker_id).toBe("speaker_1");
    expect(afterManual.source).toBe("diart_local");
    expect(afterManual.diarization_source).toBe("diart_local");
    expect(afterManual.role).toBe("doctor");
    expect(afterManual.role_label).toBe("医生");
    expect(afterManual.role_source).toBe("manual_corrected");

    await page.locator("#hisAgentSwapRolesButton").click();
    const afterSwap = await page.evaluate(() => window.HisAgentWidget.getConversationTurns()[0]);
    expect(afterSwap.raw_speaker_id).toBe("speaker1");
    expect(afterSwap.speaker_id).toBe("speaker_1");
    expect(afterSwap.source).toBe("diart_local");
    expect(afterSwap.diarization_source).toBe("diart_local");
    expect(afterSwap.role).toBe("patient");
    expect(afterSwap.role_label).toBe("患者");
    expect(afterSwap.role_source).toBe("manual_swapped");
  });

  test("voice visit session supports focused turns, role correction, and removed duplicate controls", async ({ page }) => {
    let taskPlanCalls = 0;
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      taskPlanCalls += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "mock only should not submit" }) });
    });
    await page.goto("/html/login.html?v=e2e-voice-focused-turns&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await expect(page.locator("#hisAgentVoiceStatusCard")).toBeVisible();
    await expect(page.locator("#hisAgentFillVoiceInputButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentFillAgentInputButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentSendTurnsButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentDraftButton")).toHaveCount(0);
    await expect(page.locator("#hisAgentWriteDraftButton")).toHaveCount(0);

    await page.locator("#hisAgentMockTurnsButton").click();
    await expect(page.locator("#hisAgentTurns")).toContainText("P001");
    await expect(page.locator(".his-agent-turn")).toHaveCount(4);
    await expect(page.locator(".his-agent-meta-details")).toHaveCount(4);
    await expect(page.locator(".his-agent-meta-details").first()).not.toHaveAttribute("open", "");
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeVisible();

    const firstRole = page.locator(".his-agent-turn select").first();
    await firstRole.selectOption("patient");
    await expect(page.locator(".his-agent-turn select").first()).toHaveValue("patient");
    await page.locator("#hisAgentSwapRolesButton").click();
    await expect(page.locator(".his-agent-turn select").first()).toHaveValue("doctor");
    expect(taskPlanCalls).toBe(0);
    const activeTask = await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"));
    expect(activeTask).toBeNull();
  });

  test("voice task drafting is blocked when LLM is unavailable", async ({ page }) => {
    let voiceTaskCalls = 0;
    await simulateNoLlm(page);
    await page.route(/\/api\/voice\/turns-to-agent-task$/, async (route) => {
      voiceTaskCalls += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    await page.goto("/html/login.html?v=e2e-voice-task-no-llm&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await page.locator("#hisAgentMockTurnsButton").click();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeVisible();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeEnabled();
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("LLM 未连接", { timeout: 10_000 });
    expect(voiceTaskCalls).toBe(0);
    const activeTask = await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"));
    expect(activeTask).toBeNull();
  });

  test("voice task drafting accepts doctor-only final turn without patient turn", async ({ page }) => {
    let voicePayload = null;
    await simulateConnectedLlm(page);
    await mockVoiceTaskText(page, "请将患者 P001 张伟的备注更新为医生口述内容，并保存。", (body) => {
      voicePayload = body;
    });
    await page.addInitScript(() => {
      localStorage.setItem("his_agent_widget_state_v1", JSON.stringify({
        open: false,
        activeTab: "voice",
        viewMode: "voice",
        llmStatus: "connected",
        agentMode: "llm_enabled",
        speakerTurns: [
          {
            turn_id: "doctor_only_unknown_final",
            role: "unknown",
            role_label: "未确认",
            text: "记录 P001 张伟咳嗽两天伴低热，夜间加重，少量白痰，并保存。",
            is_final: true,
            automatic: false,
            automatic_diarization: false
          }
        ],
        history: []
      }));
    });
    await page.goto("/html/login.html?v=e2e-voice-doctor-only-task&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeVisible();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeEnabled();
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("[data-voice-task-editor='1']")).toBeVisible({ timeout: 15_000 });
    expect(voicePayload).toBeTruthy();
    expect(voicePayload.turns).toHaveLength(1);
    expect(voicePayload.turns[0]).toMatchObject({
      role: "doctor",
      role_label: "医生",
      is_final: true
    });
    expect(voicePayload.turns[0].text).toContain("咳嗽两天伴低热");
    expect(voicePayload.turns[0].raw_speaker_id).toBeUndefined();
    expect(voicePayload.turns[0].source).toBeUndefined();
  });

  test("voice conversation drafts editable task and cancel does not execute", async ({ page }) => {
    let taskPlanCalls = 0;
    let voicePayload = null;
    await simulateConnectedLlm(page);
    await mockVoiceTaskText(page, "请将患者 P004 的主诉改为胸闷半天，现病史补充为活动后加重，并保存。", (body) => {
      voicePayload = body;
    });
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      taskPlanCalls += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "cancel should not execute" }) });
    });
    await page.goto("/html/login.html?v=e2e-voice-task-cancel&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await page.locator("#hisAgentMockTurnsButton").click();
    const before = await page.evaluate(() => ({
      p004: {
        chiefComplaint: window.PatientStore.getPatientById("P004")?.chiefComplaint,
        presentIllness: window.PatientStore.getPatientById("P004")?.presentIllness
      },
      audit: JSON.stringify(window.PatientStore.getAuditLog()),
      turns: window.HisAgentWidget.getConversationTurns().length
    }));
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeEnabled({ timeout: 10_000 });
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("已根据就诊会话整理出以下任务，请确认或编辑后执行", { timeout: 15_000 });
    await expect(page.locator("[data-voice-task-editor='1']")).toHaveValue(/请将患者 P004/);
    expect(voicePayload).toBeTruthy();
    expect(voicePayload.page_state).toBeUndefined();
    expect(voicePayload.patient_store_summary).toBeUndefined();
    expect(voicePayload.conversation_history).toBeUndefined();
    expect(voicePayload.turns.length).toBeGreaterThan(0);
    expect(voicePayload.turns[0].raw_speaker_id).toBeUndefined();
    expect(voicePayload.turns[0].source).toBeUndefined();
    await page.locator("[data-agent-action='voice-task-cancel']").click();
    expect(taskPlanCalls).toBe(0);
    const after = await page.evaluate(() => ({
      p004: {
        chiefComplaint: window.PatientStore.getPatientById("P004")?.chiefComplaint,
        presentIllness: window.PatientStore.getPatientById("P004")?.presentIllness
      },
      audit: JSON.stringify(window.PatientStore.getAuditLog()),
      turns: window.HisAgentWidget.getConversationTurns().length
    }));
    expect(after).toEqual(before);
    const activeTask = await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"));
    expect(activeTask).toBeNull();
  });

  test("voice conversation executes edited task through existing taskflow", async ({ page }) => {
    let plannerRequest = null;
    await simulateConnectedLlm(page);
    await mockVoiceTaskText(page, "请将患者 P004 的主诉改为胸闷半天，并保存。");
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      plannerRequest = route.request().postDataJSON();
      const body = plannerRequest || {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          mode: "task-oriented-harness",
          llmUsed: true,
          provider: "e2e",
          model: "mock-llm",
          usage: { prompt_tokens: 14, completion_tokens: 9, total_tokens: 23 },
          response: {
            kind: "task",
            message: "mock confirmed voice task planned",
            task: {
              task_id: "e2e_voice_confirmed_write_task",
              objective: body.user_message || "e2e confirmed voice task",
              status: "running",
              source: "backend_llm",
              slots: { voiceConfirmedTask: true },
              plan: [
                {
                  id: "step_update_fields",
                  goal: "按医生确认后的语音任务更新主诉和现病史",
                  requiredPage: "patientEditor",
                  actionType: "update_patient_fields",
                  args: {
                    patientSelector: { patientId: "P004", name: "陈敏" },
                    updates: [
                      { field: "chiefComplaint", value: "胸闷半天" },
                      { field: "presentIllness", value: "活动后加重" }
                    ]
                  },
                  status: "pending",
                  source: "backend_llm"
                },
                {
                  id: "step_save",
                  goal: "保存患者修改",
                  requiredPage: "patientEditor",
                  actionType: "save_patient",
                  args: { patientSelector: { patientId: "P004", name: "陈敏" } },
                  status: "pending",
                  source: "backend_llm"
                }
              ],
              current_step_index: 0,
              created_at: Date.now() / 1000,
              updated_at: Date.now() / 1000
            }
          },
          trace: { e2e: true }
        })
      });
    });
    await page.goto("/html/patient-editor.html?patientId=P004&v=e2e-voice-task-execute&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await page.locator("#hisAgentMockTurnsButton").click();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeEnabled({ timeout: 10_000 });
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("[data-voice-task-editor='1']")).toBeVisible({ timeout: 15_000 });
    const editedTask = "请打开 P004 陈敏的编辑页，把主诉改为胸闷半天，现病史补充活动后加重，并保存。";
    await page.locator("[data-voice-task-editor='1']").fill(editedTask);
    await page.locator("[data-agent-action='voice-task-execute']").click();
    await expect(page.locator("#hisAgentHistory")).toContainText(editedTask);
    await expect.poll(async () => plannerRequest?.user_message || "", { timeout: 10_000 }).toBe(editedTask);
    expect(plannerRequest.task_origin).toBe("voice_confirmed_task");
    expect(plannerRequest.input_route?.inputType).toBe("voice_session_task");
    expect(plannerRequest.page_state).toBeTruthy();
    expect(plannerRequest.speaker_turns.length).toBeGreaterThan(0);
    await waitForPatientField(page, "P004", "chiefComplaint", "胸闷半天");
    await waitForPatientField(page, "P004", "presentIllness", "活动后加重");
    await expect.poll(async () => hasAuditEntry(page, "P004", "chiefComplaint", "胸闷半天"), { timeout: 20_000 }).toBe(true);
    await expect(page.locator("[data-clinical-draft-editor='1']")).toHaveCount(0);
  });

  test("voice conversation with no operation intent does not create an executable task", async ({ page }) => {
    let taskPlanCalls = 0;
    await simulateConnectedLlm(page);
    await mockVoiceTaskText(page, "未发现明确需要执行的页面操作。可以选择生成病历草稿，或继续补充说明。");
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      taskPlanCalls += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    await page.goto("/html/login.html?v=e2e-voice-task-no-action&" + localServiceQuery);
    await openAgent(page);
    await openVoicePanel(page);
    await page.locator("#hisAgentMockTurnsButton").click();
    await expect(page.locator("#hisAgentPlanVoiceTaskButton")).toBeEnabled({ timeout: 10_000 });
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("未发现明确需要执行的页面操作", { timeout: 15_000 });
    await expect(page.locator("[data-voice-task-editor='1']")).toHaveCount(0);
    await expect(page.locator("[data-agent-action='voice-task-execute']")).toHaveCount(0);
    expect(taskPlanCalls).toBe(0);
    const activeTask = await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"));
    expect(activeTask).toBeNull();
  });

});

test.describe("Manual HIS pages", () => {
  test("patient-management shows 20 demo patients and reset keeps 20", async ({ page }) => {
    await page.goto("/html/patient-management.html?v=e2e-patients20");
    await expect(page.locator("#patientCountMeta")).toContainText("共 20 人");
    await expect(page.locator("body")).toContainText("P001");
    await expect(page.locator("body")).toContainText("张伟");
    await expect(page.locator("body")).toContainText("P020");
    await expect(page.locator("#patientTableBody tr")).toHaveCount(20);

    await page.locator("#patientSearchInput").fill("张伟");
    await expect(page.locator("#patientCountMeta")).toContainText("当前显示 1 人 / 共 20 人");
    await page.locator("#clearFiltersButton").click();
    await expect(page.locator("#patientCountMeta")).toContainText("当前显示 20 人 / 共 20 人");

    await page.locator("#resetPatientsButton").click();
    await expect(page.locator("#patientCountMeta")).toContainText("当前显示 20 人 / 共 20 人");
    const afterReset = await page.evaluate(() => ({
      count: window.PatientStore.getAllPatients().length,
      p020: window.PatientStore.getPatientById("P020")?.patientId
    }));
    expect(afterReset).toEqual({ count: 20, p020: "P020" });
  });

  test("patient-store migrates 5-patient localStorage to 20 while preserving edits and audit", async ({ page }) => {
    await page.addInitScript(() => {
      const legacyFive = [
        { patientId: "P001", name: "张伟", gender: "男", age: 38, phone: "13999999999", department: "呼吸内科", visitStatus: "就诊中", chiefComplaint: "旧数据修改保留" },
        { patientId: "P002", name: "李娜", gender: "女", age: 29, phone: "13810010002", department: "皮肤科", visitStatus: "就诊中" },
        { patientId: "P003", name: "王强", gender: "男", age: 45, phone: "13810010003", department: "骨科", visitStatus: "待就诊" },
        { patientId: "P004", name: "陈敏", gender: "女", age: 34, phone: "13810010004", department: "心血管内科", visitStatus: "就诊中" },
        { patientId: "P005", name: "赵磊", gender: "男", age: 52, phone: "13810010005", department: "神经内科", visitStatus: "就诊中" }
      ];
      window.localStorage.setItem("his_demo_patients_v2", JSON.stringify(legacyFive));
      window.localStorage.setItem("his_demo_patient_audit_v2", JSON.stringify([
        { audit_id: "audit_e2e_keep", patientId: "P001", field: "phone", oldValue: "13810010001", newValue: "13999999999" }
      ]));
    });
    await page.goto("/html/patient-management.html?v=e2e-patients20-migrate");
    await expect(page.locator("#patientCountMeta")).toContainText("共 20 人");
    const migrated = await page.evaluate(() => ({
      count: window.PatientStore.getAllPatients().length,
      ids: window.PatientStore.getAllPatients().map((patient) => patient.patientId),
      p001Phone: window.PatientStore.getPatientById("P001")?.phone,
      p020: window.PatientStore.getPatientById("P020")?.patientId,
      auditCount: window.PatientStore.getAuditLog("P001").length,
      auditKept: window.PatientStore.getAuditLog("P001").some((item) => item.audit_id === "audit_e2e_keep")
    }));
    expect(migrated.count).toBe(20);
    expect(migrated.ids).toEqual(Array.from({ length: 20 }, (_, index) => "P" + String(index + 1).padStart(3, "0")));
    expect(migrated.p001Phone).toBe("13999999999");
    expect(migrated.p020).toBe("P020");
    expect(migrated.auditCount).toBe(1);
    expect(migrated.auditKept).toBe(true);
  });

  test("patient-editor without patientId shows empty state", async ({ page }) => {
    await page.goto("/html/patient-editor.html?v=e2e-empty-editor");
    await expect(page.locator("body")).toContainText("未选择就诊人");
    await expect(page.getByRole("link", { name: "返回患者管理", exact: true })).toBeVisible();
  });

  test("patient-editor P001 shows Zhang Wei summary", async ({ page }) => {
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-editor-p001");
    await expect(page.locator("#summaryBar")).toContainText("P001");
    await expect(page.locator("#summaryBar")).toContainText("张伟");
    await expect(page.locator("#statusList")).toContainText(/LLM 后端|Agent 状态/);
  });
  test("Agent UI feedback highlights edited field and patient row", async ({ page }) => {
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-ui-feedback-editor");
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("his-agent-ui-feedback", {
        detail: { kind: "field_updated", patientId: "P001", field: "phone", at: Date.now() }
      }));
    });
    await expect(page.locator('[data-field="phone"]').first()).toHaveClass(/his-agent-field-flash/);
    await page.evaluate(() => {
      window.localStorage.setItem("hisAgentUiFeedback", JSON.stringify({
        kind: "field_updated",
        patientId: "P001",
        field: "phone",
        at: Date.now()
      }));
    });
    await page.goto("/html/patient-management.html?v=e2e-ui-feedback-management");
    await expect(page.locator('tr[data-patient-id="P001"]').first()).toHaveClass(/his-agent-row-flash/);
  });

  test("Agent field visualization keeps input change select date and save semantics", async ({ page }) => {
    await page.addInitScript(() => {
      window.__HIS_AGENT_FAST_ANIMATION__ = true;
    });
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-agent-field-visualization");
    const result = await page.evaluate(async () => {
      const phone = document.querySelector('[data-field="phone"]');
      const events = { phoneInput: 0, phoneChange: 0, genderChange: 0, dateChange: 0 };
      phone.addEventListener("input", () => { events.phoneInput += 1; });
      phone.addEventListener("change", () => { events.phoneChange += 1; });

      const phoneResult = await window.PatientEditorActionAdapter.updatePatientEditorField("P001", "phone", "13800138000", {
        action: { task_id: "e2e_visual_phone", audit: { task_id: "e2e_visual_phone", reason: "e2e visual phone" } }
      });
      const phoneClass = phone.className;
      const gender = document.querySelector('[data-field="gender"]');
      gender.addEventListener("change", () => { events.genderChange += 1; });
      const genderResult = await window.PatientEditorActionAdapter.updatePatientEditorField("P001", "gender", "女", {
        action: { task_id: "e2e_visual_gender", audit: { task_id: "e2e_visual_gender", reason: "e2e visual gender" } }
      });
      const genderClass = gender.className;
      const birthDate = document.querySelector('[data-field="birthDate"]');
      birthDate.addEventListener("change", () => { events.dateChange += 1; });
      const dateResult = await window.PatientEditorActionAdapter.updatePatientEditorField("P001", "birthDate", "1989-01-01", {
        action: { task_id: "e2e_visual_date", audit: { task_id: "e2e_visual_date", reason: "e2e visual date" } }
      });
      const birthDateClass = birthDate.className;
      const auditBeforeSave = window.PatientStore.getAuditLog("P001").length;
      const saveResult = await window.PatientEditorActionAdapter.saveCurrentPatientFromEditor("P001", {
        action: { task_id: "e2e_visual_save", audit: { task_id: "e2e_visual_save", reason: "e2e visual save" } }
      });
      const saveClass = document.querySelector("#saveButton")?.className || "";
      const patient = window.PatientStore.getPatientById("P001");
      const audit = window.PatientStore.getAuditLog("P001");
      return {
        phoneResult,
        genderResult,
        dateResult,
        saveResult,
        events,
        values: {
          phone: phone.value,
          gender: gender.value,
          birthDate: birthDate.value,
          storePhone: patient.phone,
          storeGender: patient.gender,
          storeBirthDate: patient.birthDate
        },
        classes: {
          phone: phoneClass,
          gender: genderClass,
          birthDate: birthDateClass,
          save: saveClass
        },
        auditBeforeSave,
        audit: {
          phone: audit.some((item) => item.task_id === "e2e_visual_save" && item.field === "phone" && item.oldValue && item.newValue === "13800138000"),
          gender: audit.some((item) => item.task_id === "e2e_visual_save" && item.field === "gender" && item.newValue === "女"),
          birthDate: audit.some((item) => item.task_id === "e2e_visual_save" && item.field === "birthDate" && item.newValue === "1989-01-01")
        }
      };
    });

    expect(result.phoneResult.success).toBe(true);
    expect(result.genderResult.success).toBe(true);
    expect(result.dateResult.success).toBe(true);
    expect(result.saveResult.success).toBe(true);
    expect(result.events.phoneInput).toBeGreaterThan(0);
    expect(result.events.phoneChange).toBeGreaterThan(0);
    expect(result.events.genderChange).toBeGreaterThan(0);
    expect(result.events.dateChange).toBeGreaterThan(0);
    expect(result.values).toMatchObject({
      phone: "13800138000",
      gender: "女",
      birthDate: "1989-01-01",
      storePhone: "13800138000",
      storeGender: "女",
      storeBirthDate: "1989-01-01"
    });
    expect(result.classes.phone).toMatch(/agent-field-changed|his-agent-field-flash/);
    expect(result.classes.gender).toMatch(/agent-field-changed|his-agent-field-flash/);
    expect(result.classes.birthDate).toMatch(/agent-field-changed|his-agent-field-flash/);
    expect(result.classes.save).toMatch(/agent-save-pulse|his-agent-save-pulse|agent-field-saved/);
    expect(result.auditBeforeSave).toBe(0);
    expect(result.audit).toEqual({ phone: true, gender: true, birthDate: true });
  });

  test("Agent navigation feedback highlights patient row and dashboard entry card", async ({ page }) => {
    await page.addInitScript(() => {
      window.__HIS_AGENT_FAST_ANIMATION__ = true;
    });
    await page.goto("/html/patient-management.html?v=e2e-agent-row-visualization");
    await page.evaluate(async () => {
      window.HisUiActionFeedback.highlightPatientRow("P001");
      await window.HisUiActionFeedback.sleep(20);
    });
    await expect(page.locator('tr[data-patient-id="P001"]').first()).toHaveClass(/agent-row-highlight|his-agent-row-flash/);

    await page.goto("/html/dashboard.html?v=e2e-agent-dashboard-visualization");
    await page.evaluate(async () => {
      const target = document.querySelector("#patientManagementEntry")?.closest(".module-card") || document.querySelector("#patientManagementEntry");
      await window.HisUiActionFeedback.agentClickElement(target, { click: false, message: "Agent 正在打开患者管理" });
    });
    await expect(page.locator("#patient-management")).toHaveClass(/agent-action-target|his-ui-flash/);
  });
});

test.describe("No LLM guard", () => {
  test("login task is not executed by Agent when LLM is unavailable", async ({ page }) => {
    await simulateNoLlm(page);
    await page.goto("/html/login.html?v=e2e-no-llm");
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("登录");
    await page.locator("#hisAgentSendButton").click();
    await expect(page).toHaveURL(/login\.html/);
    await expect(page.locator("#hisAgentHistory")).toContainText(/LLM|未连接|无法/);
  });

  test("patient-store is not changed by Agent when LLM is unavailable", async ({ page }) => {
    await simulateNoLlm(page);
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-no-llm-store");
    const before = await page.evaluate(() => window.PatientStore.getPatientById("P001").phone);
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("修改患者 P001 的手机号为 13800138000 并保存");
    await page.locator("#hisAgentSendButton").click();
    const after = await page.evaluate(() => window.PatientStore.getPatientById("P001").phone);
    expect(after).toBe(before);
  });

  test("manual login still works when LLM is unavailable", async ({ page }) => {
    await simulateNoLlm(page);
    await page.goto("/html/login.html?v=e2e-manual-login");
    await page.locator("#loginAccountInput").fill("123");
    await page.locator("#loginPasswordInput").fill("123");
    await page.locator("#loginButton").click();
    await expect(page).toHaveURL(/dashboard\.html/);
  });
});

test.describe("Login page task precondition", () => {
  test("internal HIS pages report authenticated context so tasks do not request demo login again", async ({ page }) => {
    await page.goto("/html/dashboard.html?v=e2e-auth-context");
    const dashboardState = await page.evaluate(() => window.__HIS_AGENT_WIDGET_DEBUG__?.collectPageState?.() || window.collectHisPageState?.());
    expect(dashboardState.pageType).toBe("dashboard");
    expect(dashboardState.isInHisContext).toBe(true);
    expect(dashboardState.hisDemoAuthenticated).toBe(true);
    expect(dashboardState.loginState.authenticated).toBe(true);

    await page.goto("/html/login.html?v=e2e-auth-login-context");
    const loginState = await page.evaluate(() => window.__HIS_AGENT_WIDGET_DEBUG__?.collectPageState?.() || window.collectHisPageState?.());
    expect(loginState.pageType).toBe("login");
    expect(loginState.isLoginPage).toBe(true);
    expect(loginState.isInHisContext).toBe(false);
    expect(loginState.hisDemoAuthenticated).toBe(false);
  });

  test("patient edit task on login waits for login confirmation and does not mutate patient-store", async ({ page }) => {
    await simulateLlmPlanner(page, [
      {
        id: "step_find_patient",
        goal: "定位张伟",
        requiredPage: "patientManagement",
        actionType: "find_patient",
        args: { patientSelector: { name: "张伟" } }
      },
      {
        id: "step_update_phone",
        goal: "修改手机号",
        requiredPage: "patientEditor",
        actionType: "update_patient_field",
        args: { patientSelector: { name: "张伟" }, field: "phone", value: "13800138000" }
      },
      {
        id: "step_save",
        goal: "保存患者",
        requiredPage: "patientEditor",
        actionType: "save_patient",
        args: { patientSelector: { name: "张伟" } }
      }
    ]);
    await page.goto("/html/login.html?v=e2e-login-precondition");
    const before = await page.evaluate(() => window.PatientStore.getPatientById("P001").phone);
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("把张伟的手机号改成 13800138000");
    await page.locator("#hisAgentSendButton").click();
    await expect(page).toHaveURL(/login\.html/);
    await expect(page.locator("#hisAgentHistory")).toContainText(/需要先登录|Demo 默认账号密码|123\/123/);
    const after = await page.evaluate(() => window.PatientStore.getPatientById("P001").phone);
    expect(after).toBe(before);
    const activeTask = await page.evaluate(() => JSON.parse(localStorage.getItem("hisAgentActiveTask") || "null"));
    expect(activeTask?.status).toBe("waiting_user");
    expect(activeTask?.precondition?.requiresLogin).toBe(true);
  });

  test("single Chinese confirmation resumes login precondition task", async ({ page }) => {
    await simulateLlmPlanner(page, [
      {
        id: "step_find_patient",
        goal: "定位张伟",
        requiredPage: "patientManagement",
        actionType: "find_patient",
        args: { patientSelector: { name: "张伟" } }
      },
      {
        id: "step_update_phone",
        goal: "修改手机号",
        requiredPage: "patientEditor",
        actionType: "update_patient_field",
        args: { patientSelector: { name: "张伟" }, field: "phone", value: "13800138000" }
      }
    ]);
    await page.goto("/html/login.html?v=e2e-login-precondition-confirm");
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("把张伟的手机号改成 13800138000");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText(/需要先登录|Demo 默认账号密码|123\/123/);

    await page.locator("#hisAgentInput").fill("是");
    await page.locator("#hisAgentSendButton").click();
    await expect(page).not.toHaveURL(/login\.html/, { timeout: 10_000 });
    await expect(page.locator("#hisAgentHistory")).not.toContainText("请选择继续当前任务或取消旧任务");
    await expect.poll(async () => {
      return page.evaluate(() => {
        const activeTask = JSON.parse(localStorage.getItem("hisAgentActiveTask") || "null");
        return activeTask && activeTask.status || "";
      }).catch(() => "navigating");
    }, { timeout: 10_000 }).not.toBe("waiting_user");
  });

  test("pre-filled demo login is submitted without clearing and retyping credentials", async ({ page }) => {
    await simulateLlmPlanner(page, [
      {
        id: "step_open_patient_management",
        goal: "打开患者管理",
        requiredPage: "patientManagement",
        actionType: "open_page",
        args: { page: "patientManagement" }
      }
    ]);
    await page.goto("/html/login.html?v=e2e-login-prefilled-no-retype&" + localServiceQuery);
    await page.waitForFunction(() => Boolean(window.HisUiActionFeedback?.agentClearAndType));
    await expect(page.locator("#loginAccountInput")).toHaveValue("123");
    await expect(page.locator("#loginPasswordInput")).toHaveValue("123");
    await page.evaluate(() => {
      window.__e2eClearTypeCalls = [];
      window.localStorage.setItem("__e2eClearTypeCalls", "[]");
      const original = window.HisUiActionFeedback.agentClearAndType.bind(window.HisUiActionFeedback);
      window.HisUiActionFeedback.agentClearAndType = async function (input, value, options) {
        const item = { id: input && input.id, value: String(value || ""), label: options && options.label };
        window.__e2eClearTypeCalls.push(item);
        window.localStorage.setItem("__e2eClearTypeCalls", JSON.stringify(window.__e2eClearTypeCalls));
        return original(input, value, options);
      };
    });
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("打开患者管理");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText(/需要先登录|Demo 默认账号密码|123\/123/);
    await page.locator("#hisAgentInput").fill("是");
    await page.locator("#hisAgentSendButton").click();
    await expect(page).not.toHaveURL(/login\.html/, { timeout: 10_000 });
    const clearTypeCalls = await page.evaluate(() => JSON.parse(window.localStorage.getItem("__e2eClearTypeCalls") || "[]"));
    expect(clearTypeCalls).toEqual([]);
  });

  test("manual wrong login and Agent wrong login both fail without authenticating", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-login-manual-wrong&" + localServiceQuery);
    await page.locator("#loginAccountInput").fill("1234");
    await page.locator("#loginPasswordInput").fill("123");
    await page.locator("#loginButton").click();
    await expect(page).toHaveURL(/login\.html/);
    await expect(page.locator("#loginMessage")).toContainText("账号或密码错误");
    const manualState = await page.evaluate(() => ({
      username: document.querySelector("#loginAccountInput")?.value,
      auth: localStorage.getItem("hisDemoAuthenticated"),
      pageType: window.collectHisPageState?.().pageType
    }));
    expect(manualState).toEqual({ username: "1234", auth: "false", pageType: "login" });

    await simulateLlmPlanner(page, [
      {
        id: "step_fill_login",
        goal: "填写错误账号密码",
        requiredPage: "login",
        actionType: "fill_login_form",
        args: { username: "1234", password: "123" }
      },
      {
        id: "step_submit_login",
        goal: "点击登录",
        requiredPage: "login",
        actionType: "submit_login",
        args: { username: "1234", password: "123" }
      }
    ], {}, "e2e_wrong_login_task");
    await page.goto("/html/login.html?v=e2e-login-agent-wrong&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("输入账户为1234，密码为123，然后登录");
    await page.locator("#hisAgentSendButton").click();
    await expect(page).toHaveURL(/login\.html/);
    await expect(page.locator("#loginMessage")).toContainText("账号或密码错误");
    await expect(page.locator("#hisAgentHistory")).toContainText("登录失败，账号或密码不正确，请检查后重试。");
    const agentState = await page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
      const task = history.find((item) => item.task_id === "e2e_wrong_login_task");
      return {
        username: document.querySelector("#loginAccountInput")?.value,
        auth: localStorage.getItem("hisDemoAuthenticated"),
        pageType: window.collectHisPageState?.().pageType,
        activeTask: JSON.parse(localStorage.getItem("hisAgentActiveTask") || "null"),
        task,
        historyText: JSON.stringify(history)
      };
    });
    expect(agentState.username).toBe("1234");
    expect(agentState.auth).toBe("false");
    expect(agentState.pageType).toBe("login");
    expect(agentState.activeTask).toBeNull();
    expect(agentState.task?.status).toBe("failed");
    expect(agentState.task?.plan?.find((step) => step.actionType === "submit_login")?.status).toBe("failed");
    expect(agentState.historyText).not.toContain('"password":"123"');
    expect(agentState.historyText).toContain("[redacted]");
  });

  test("Agent login success and failed credential variants match page validation", async ({ page }) => {
    async function runLoginPlan(username: string, password: string, taskId: string) {
      await page.unroute(/\/api\/(llm|qwen)\/test$/).catch(() => {});
      await page.unroute(/\/api\/universal-agent\/task-plan$/).catch(() => {});
      await simulateLlmPlanner(page, [
        {
          id: "step_fill_login",
          goal: "填写账号密码",
          requiredPage: "login",
          actionType: "fill_login_form",
          args: { username, password }
        },
        {
          id: "step_submit_login",
          goal: "点击登录",
          requiredPage: "login",
          actionType: "submit_login",
          args: { username, password }
        }
      ], {}, taskId);
      await page.goto("/html/login.html?v=" + encodeURIComponent(taskId) + "&" + localServiceQuery);
      await ensureAgentOpen(page);
      await page.locator("#hisAgentInput").fill("输入账户为" + username + "，密码已提供，然后登录");
      await page.locator("#hisAgentSendButton").click();
    }

    await runLoginPlan("123", "123", "e2e_login_success_task");
    await expect(page).not.toHaveURL(/login\.html/, { timeout: 10_000 });
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("hisDemoAuthenticated"))).toBe("true");
    await expect.poll(async () => page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
      const task = history.find((entry) => entry.task_id === "e2e_login_success_task");
      return task && task.status || "";
    }), { timeout: 10_000 }).toBe("completed");

    for (const item of [
      { username: "123", password: "1234", taskId: "e2e_wrong_password_task" },
      { username: "", password: "123", taskId: "e2e_empty_username_task" },
      { username: "123", password: "", taskId: "e2e_empty_password_task" }
    ]) {
      await runLoginPlan(item.username, item.password, item.taskId);
      await expect(page).toHaveURL(/login\.html/);
      await expect(page.locator("#loginMessage")).toContainText("账号或密码错误");
      const result = await page.evaluate((taskId) => {
        const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
        const task = history.find((entry) => entry.task_id === taskId);
        return {
          taskStatus: task && task.status,
          auth: localStorage.getItem("hisDemoAuthenticated"),
          pageType: window.collectHisPageState?.().pageType,
          username: document.querySelector("#loginAccountInput")?.value
        };
      }, item.taskId);
      expect(result.taskStatus).toBe("failed");
      expect(result.auth).toBe("false");
      expect(result.pageType).toBe("login");
      expect(result.username).toBe(item.username);
    }
  });
});

test.describe("Patient and field resolver contracts", () => {
  test("patient-management contains P001 Zhang Wei and resolvers work", async ({ page }) => {
    await page.goto("/html/patient-management.html?v=e2e-resolver");
    await expect(page.locator("body")).toContainText("P001");
    await expect(page.locator("body")).toContainText("张伟");
    const result = await page.evaluate(() => ({
      count: window.PatientStore.getAllPatients().length,
      byId: window.PatientStore.resolvePatientSelector({ patientId: "P001" }).patient?.patientId,
      byName: window.PatientStore.resolvePatientSelector({ name: "张伟" }).patient?.patientId,
      byP020: window.PatientStore.resolvePatientSelector({ patientId: "P020" }).patient?.patientId,
      phoneField: window.PatientFieldSchema.resolvePatientField("手机号字段").field,
      genderField: window.PatientFieldSchema.resolvePatientField("性别").field,
      pastHistoryAliases: ["既往史", "既往病史", "既往病史内容", "past history", "past medical history", "medical history", "medicalHistory"].map((item) => window.PatientFieldSchema.resolvePatientField(item).field)
    }));
    expect(result).toEqual({
      count: 20,
      byId: "P001",
      byName: "P001",
      byP020: "P020",
      phoneField: "phone",
      genderField: "gender",
      pastHistoryAliases: Array(7).fill("pastHistory")
    });
  });

  test("missing patient task shows explicit not found message without mutation", async ({ page }) => {
    await simulateLlmPlanner(page, [
      {
        id: "step_missing_patient",
        goal: "定位不存在患者ABC",
        requiredPage: "patientManagement",
        actionType: "find_patient",
        args: { patientSelector: { name: "不存在患者ABC" } }
      }
    ]);
    await page.goto("/html/patient-management.html?v=e2e-missing-patient-message");
    const before = await page.evaluate(() => ({
      phone: window.PatientStore.getPatientById("P001").phone,
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("把不存在患者ABC的手机号改成 13800138000");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("没有找到匹配患者，请提供 patientId、姓名、手机号或返回患者管理确认。");
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("没有找到匹配患者");
    const after = await page.evaluate(() => ({
      phone: window.PatientStore.getPatientById("P001").phone,
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    expect(after).toEqual(before);
  });

  test("patient context carries from Liu Yang lookup into later update steps", async ({ page }) => {
    await simulateLlmPlanner(page, [
      {
        id: "step_find_liuyang",
        goal: "查找刘洋的患者信息",
        requiredPage: "patientManagement",
        actionType: "find_patient",
        args: { patientSelector: { name: "刘洋" } }
      },
      {
        id: "step_open_liuyang",
        goal: "打开刘洋的患者编辑页面",
        requiredPage: "patientEditor",
        actionType: "open_patient_editor",
        args: {}
      },
      {
        id: "step_update_liuyang_birth_date",
        goal: "更新刘洋的生日字段",
        requiredPage: "patientEditor",
        actionType: "update_patient_field",
        args: { field: "birthDate", name: "生日字段", value: "1995-05-06" }
      },
      {
        id: "step_save_liuyang",
        goal: "保存刘洋的患者信息",
        requiredPage: "patientEditor",
        actionType: "save_patient",
        args: {}
      }
    ]);
    await page.goto("/html/patient-management.html?v=e2e-liuyang-context-carry&" + localServiceQuery);
    const before = await readPatientField(page, "P006", "birthDate");
    expect(before).not.toBe("1995-05-06");
    await openAgent(page);
    await page.locator("#hisAgentInput").fill("查找刘洋并把生日改为 1995-05-06 后保存");
    await page.locator("#hisAgentSendButton").click();

    await waitForPatientField(page, "P006", "birthDate", "1995-05-06");
    const result = await page.evaluate(() => ({
      activeTask: window.localStorage.getItem("hisAgentActiveTask"),
      p006BirthDate: window.PatientStore.getPatientById("P006")?.birthDate,
      p006Audit: window.PatientStore.getAuditLog("P006").some((item) => item.field === "birthDate" && item.newValue === "1995-05-06"),
      url: window.location.href,
      pageState: window.collectHisPageState?.() || {},
      trace: window.AgentFlowTrace?.getEvents?.() || [],
      history: JSON.parse(window.localStorage.getItem("hisAgentTaskHistory") || "[]")
    }));
    expect(result.activeTask).toBeNull();
    expect(result.url).toContain("patient-editor.html");
    expect(result.url).toContain("patientId=P006");
    expect(result.pageState.patientId || result.pageState.activePatient?.patientId).toBe("P006");
    expect(result.p006BirthDate).toBe("1995-05-06");
    expect(result.p006Audit).toBe(true);
    expect(result.trace.some((item) => item.event === "canonical_patient_remembered" && item.resolved_patient?.patientId === "P006")).toBe(true);
    expect(result.trace.some((item) => item.event === "action_executed" && item.action === "open_patient_editor" && item.action_result?.expected_patient?.patientId === "P006")).toBe(true);
    expect(result.trace.some((item) => item.event === "action_selected" && item.action === "noop" && item.action_payload?.args?.verifiedPatient?.patientId === "P006" && item.action_payload?.args?.pagePatient?.urlPatientId === "P006")).toBe(true);
    expect(result.history.some((item) => item.task_id === "e2e_login_precondition_task" && item.slots?.canonical_patient?.patientId === "P006")).toBe(true);
  });
});

test.describe("LLM task happy path @llm", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(process.env.RUN_LLM_E2E !== "1", "Set RUN_LLM_E2E=1 to run real LLM task flow because it mutates demo patient data.");

  test("updates P001 phone with visible progress when LLM is connected @llm", async ({ page }) => {
    await page.goto("/html/patient-management.html?v=e2e-llm-phone-task&" + localServiceQuery);
    test.skip(!(await isRealLlmAvailable(page)), "Real LLM backend is unavailable.");
    const snapshot = await snapshotDemoStorage(page);
    const originalPhone = await readPatientField(page, "P001", "phone");
    try {
      await openAgent(page);
      await page.locator("#hisAgentInput").fill("修改患者 P001 的手机号为 13800138000 并保存");
      await page.locator("#hisAgentSendButton").click();
      await waitForPatientField(page, "P001", "phone", "13800138000");
      await ensureAgentOpen(page);
      await expect(page.locator("#hisAgentPanel")).toContainText(/token|耗时|查看完整记录/, { timeout: 20_000 });
      await expect.poll(async () => hasAuditEntry(page, "P001", "phone", "13800138000"), { timeout: 20_000 }).toBe(true);
    } finally {
      await restoreDemoStorage(page, snapshot);
      await page.goto("/html/patient-management.html?v=e2e-llm-phone-restore&" + localServiceQuery);
      await waitForPatientField(page, "P001", "phone", originalPhone);
    }
  });

  test("updates Zhang Wei gender without patient not found @llm", async ({ page }) => {
    await page.goto("/html/patient-management.html?v=e2e-llm-gender-task&" + localServiceQuery);
    test.skip(!(await isRealLlmAvailable(page)), "Real LLM backend is unavailable.");
    const snapshot = await snapshotDemoStorage(page);
    const originalGender = await readPatientField(page, "P001", "gender");
    try {
      await openAgent(page);
      await page.locator("#hisAgentInput").fill("把张伟的性别改成女");
      await page.locator("#hisAgentSendButton").click();
      await waitForPatientField(page, "P001", "gender", "女");
      await ensureAgentOpen(page);
      await expect(page.locator("#hisAgentHistory")).not.toContainText("没有找到唯一匹配患者", { timeout: 20_000 });
      await expect(page.locator("#hisAgentHistory")).not.toContainText("字段或患者无效", { timeout: 20_000 });
      await expect.poll(async () => hasAuditEntry(page, "P001", "gender", "女"), { timeout: 20_000 }).toBe(true);
    } finally {
      await restoreDemoStorage(page, snapshot);
      await page.goto("/html/patient-management.html?v=e2e-llm-gender-restore&" + localServiceQuery);
      await waitForPatientField(page, "P001", "gender", originalGender);
    }
  });
});

test.describe("activeTask lifecycle", () => {
  test("failed task is retired and new session clears active task", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-active-task");
    await page.evaluate(() => {
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_failed_task",
        objective: "old failed task",
        status: "failed",
        source: "backend_llm",
        plan: [{ id: "step_1", status: "failed", source: "backend_llm" }],
        current_step_index: 0,
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        lastError: "e2e"
      }));
    });
    await page.reload();
    const summary = await page.evaluate(() => window.AgentTaskOrchestrator.getSummary());
    expect(summary.hasActiveTask).toBe(false);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]"));
    expect(history.some((item) => item.task_id === "e2e_failed_task")).toBe(true);
    await openAgent(page);
    await page.locator("#hisAgentNewSessionButton").click();
    const task = await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"));
    expect(task).toBeNull();
  });
});

test.describe("Agent state close-loop regressions", () => {
  test("running task and step timers increment live then freeze after completion", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-live-task-timer&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_live_timer_task",
        objective: "验证运行中计时实时递增",
        status: "running",
        source: "backend_llm",
        plan: [
          { id: "step_timer", goal: "正在计时", actionType: "noop", status: "running", source: "backend_llm", started_at_ms: now - 120 }
        ],
        current_step_index: 0,
        created_at: now / 1000,
        started_at: (now - 120) / 1000,
        started_at_ms: now - 120,
        updated_at: now / 1000
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    const readTaskElapsed = async () => {
      const text = await page.locator("#hisAgentCurrentTaskCard .his-agent-current-meta").textContent();
      const match = String(text || "").match(/耗时：([0-9.]+)s/);
      return match ? Number(match[1]) : 0;
    };
    const first = await readTaskElapsed();
    await page.waitForTimeout(650);
    const second = await readTaskElapsed();
    expect(second).toBeGreaterThan(first);
    await page.evaluate(() => {
      const now = Date.now();
      const started = now - 1500;
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_live_timer_task",
        objective: "验证运行中计时实时递增",
        status: "completed",
        source: "backend_llm",
        plan: [
          { id: "step_timer", goal: "正在计时", actionType: "noop", status: "completed", source: "backend_llm", started_at_ms: started, finished_at_ms: now, elapsed_ms: 1500, usage_source: "local_dom" }
        ],
        current_step_index: 1,
        created_at: started / 1000,
        started_at: started / 1000,
        started_at_ms: started,
        finished_at: now / 1000,
        finished_at_ms: now,
        elapsed_ms: 1500,
        updated_at: now / 1000
      }));
    });
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").some((item) => item.task_id === "e2e_live_timer_task" && item.elapsed_ms === 1500))).toBe(true);
    await page.waitForTimeout(1200);
    const frozen = await page.evaluate(() => JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_live_timer_task")?.elapsed_ms);
    expect(frozen).toBe(1500);
  });

  test("current task step expansion survives progress re-render and reload", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-task-expand-persist&" + localServiceQuery);
    await page.evaluate(() => {
      localStorage.removeItem("hisAgentTaskStepsUiV2");
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_expand_task",
        objective: "验证展开步骤不会被刷新折叠",
        status: "running",
        source: "backend_llm",
        plan: [
          { id: "step_1", goal: "第一步", status: "running", source: "backend_llm" },
          { id: "step_2", goal: "第二步", status: "pending", source: "backend_llm" }
        ],
        current_step_index: 0,
        created_at: Date.now() / 1000,
        started_at: Date.now() / 1000,
        started_at_ms: Date.now(),
        updated_at: Date.now() / 1000
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    const details = page.locator("#hisAgentCurrentTaskCard details.his-agent-current-steps");
    await expect(details).toBeVisible();
    await page.locator("#hisAgentCurrentTaskCard details.his-agent-current-steps > summary").click();
    await expect.poll(() => details.evaluate((node) => node.open)).toBe(true);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
        detail: { task_id: "e2e_expand_task", elapsed_ms: 1000, text: "等待用户之外的普通进度" }
      }));
    });
    await expect.poll(() => details.evaluate((node) => node.open)).toBe(true);
    await page.reload();
    await ensureAgentOpen(page);
    await expect.poll(() => page.locator("#hisAgentCurrentTaskCard details.his-agent-current-steps").evaluate((node) => node.open)).toBe(true);
  });

  test("expanded current task step list keeps scroll position during progress refresh", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-task-step-scroll-stable&" + localServiceQuery);
    await page.evaluate(() => {
      const plan = Array.from({ length: 40 }, (_, index) => ({
        id: `step_${index + 1}`,
        goal: `滚动稳定性验证步骤 ${index + 1}`,
        actionType: index === 34 ? "update_patient_field" : "noop",
        requiredPage: "patientEditor",
        status: index < 34 ? "completed" : index === 34 ? "running" : "pending",
        source: "backend_llm"
      }));
      localStorage.removeItem("hisAgentTaskStepsUiV2");
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_step_scroll_task",
        objective: "验证展开步骤滚动条不会被进度刷新拉回顶部",
        status: "running",
        source: "backend_llm",
        plan,
        current_step_index: 34,
        progress_messages: [],
        created_at: Date.now() / 1000,
        started_at: (Date.now() - 4500) / 1000,
        started_at_ms: Date.now() - 4500,
        updated_at: Date.now() / 1000
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    const expandPanelButton = page.locator("#hisAgentCurrentTaskCard [data-agent-action='expand-task-panel']");
    if (await expandPanelButton.isVisible()) {
      await expandPanelButton.click();
    }
    const details = page.locator("#hisAgentCurrentTaskCard details.his-agent-current-steps");
    if (!(await details.evaluate((node) => node.open))) {
      await page.locator("#hisAgentCurrentTaskCard details.his-agent-current-steps > summary").click();
    }
    const taskList = page.locator("#hisAgentTaskList");
    await expect.poll(() => taskList.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(taskList.locator(".his-agent-task-item.current-step.agent-step-pulse")).toContainText("滚动稳定性验证步骤 35");
    await expect.poll(() => taskList.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await taskList.evaluate((node) => {
      node.scrollTop = Math.min(180, node.scrollHeight - node.clientHeight);
      node.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const before = await taskList.evaluate((node) => node.scrollTop);
    expect(before).toBeGreaterThan(0);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
        detail: { task_id: "e2e_step_scroll_task", elapsed_ms: 5000, text: "进度刷新不应重置步骤滚动条" }
      }));
    });
    await expect.poll(() => taskList.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(before - 2);
  });

  test("demo pacing is configurable but disabled by fast animation mode", async ({ page }) => {
    await page.addInitScript(() => {
      window.__HIS_AGENT_FAST_ANIMATION__ = true;
      localStorage.setItem("his_agent_demo_pacing", JSON.stringify({ enabled: true, fieldDelayMs: 1000, clickDelayMs: 1000, stepDelayMs: 1000 }));
    });
    await simulateLlmPlanner(page, [
      {
        id: "step_update_fields",
        goal: "快速更新两个字段",
        requiredPage: "patientEditor",
        actionType: "update_patient_fields",
        args: {
          patientSelector: { patientId: "P001", name: "张伟" },
          updates: [
            { field: "chiefComplaint", value: "E2E 快速演示主诉" },
            { field: "presentIllness", value: "E2E 快速演示现病史" }
          ]
        }
      }
    ], {}, "e2e_fast_pacing_task");
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-fast-pacing&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    const started = Date.now();
    await page.locator("#hisAgentInput").fill("快速演示节奏测试");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => {
      return JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_fast_pacing_task")?.status || "";
    }), { timeout: 10_000 }).toBe("completed");
    expect(Date.now() - started).toBeLessThan(2200);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_fast_pacing_task"));
    expect(history?.timing?.demo_delay_ms || 0).toBe(0);
  });

  test("minimized task plan survives progress refresh and reopens from chat header", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-task-minimized-stable&" + localServiceQuery);
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_minimized_task",
        objective: "验证任务计划最小化不会被进度刷新重置",
        status: "running",
        source: "backend_llm",
        plan: [
          { id: "step_1", goal: "第一步", status: "completed", source: "backend_llm", elapsed_ms: 320, usage_source: "local_dom" },
          { id: "step_2", goal: "第二步", status: "running", source: "backend_llm", started_at_ms: now - 600, usage_source: "local_dom" }
        ],
        current_step_index: 1,
        created_at: now / 1000,
        started_at_ms: now - 1200,
        updated_at: now / 1000
      }));
    });
    await openAgent(page);
    await expect(page.locator("#hisAgentTaskPlanButton")).toBeHidden();
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentChatView")).toBeVisible();
    await expect(page.locator("#hisAgentTaskPlanButton")).toBeVisible();
    await page.locator("#hisAgentCurrentTaskCard [data-agent-action='minimize-task-panel']").click();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toHaveClass(/minimized/);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
        detail: { task_id: "e2e_minimized_task", elapsed_ms: 1600, text: "进度刷新不应展开任务卡" }
      }));
    });
    await expect(page.locator("#hisAgentCurrentTaskCard")).toHaveClass(/minimized/);
    await page.locator("#hisAgentTaskPlanButton").click();
    await expect(page.locator("#hisAgentCurrentTaskCard")).not.toHaveClass(/minimized/);
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("第二步");
  });

  test("new task planning card does not flash the previous completed task", async ({ page }) => {
    await simulateConnectedLlm(page);
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          response: {
            kind: "task",
            message: "mock planned",
            task: {
              task_id: "e2e_new_atomic_task",
              objective: body.user_message,
              status: "running",
              source: "backend_llm",
              plan: [{ id: "step_done", goal: "结束", actionType: "finish_task", status: "pending", source: "backend_llm" }],
              current_step_index: 0
            }
          },
          usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 }
        })
      });
    });
    await page.goto("/html/login.html?v=e2e-new-task-atomic&" + localServiceQuery);
    await page.evaluate(() => {
      localStorage.setItem("hisAgentTaskHistory", JSON.stringify([{
        task_id: "e2e_old_completed_task",
        objective: "旧任务不应该闪现",
        status: "completed",
        plan: [{ id: "old_step", goal: "旧步骤", status: "completed", source: "backend_llm" }],
        current_step_index: 0,
        started_at_ms: Date.now() - 10000,
        finished_at_ms: Date.now() - 5000
      }]));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("新的任务：只验证规划占位");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentCurrentTaskCard")).toContainText("新的任务：只验证规划占位");
    await expect(page.locator("#hisAgentCurrentTaskCard")).not.toContainText("旧任务不应该闪现");
    await expect(page.locator("#hisAgentSendButton")).toHaveText("取消任务");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();
    await expect(page.locator("#hisAgentSendButton")).toHaveText("发送");
  });

  test("unsent input draft survives page switch and clears after accepted send", async ({ page }) => {
    await simulateLlmPlanner(page, [
      { id: "step_finish", goal: "结束测试任务", requiredPage: "login", actionType: "finish_task", args: {} }
    ], {}, "e2e_draft_clear_task");
    await page.goto("/html/login.html?v=e2e-input-draft-restore&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("这是未发送草稿");
    await page.waitForTimeout(180);
    await page.goto("/html/dashboard.html?v=e2e-input-draft-target&" + localServiceQuery);
    await ensureAgentOpen(page);
    await expect(page.locator("#hisAgentInput")).toHaveValue("这是未发送草稿");
    await page.locator("#hisAgentInput").fill("执行一个可完成测试任务");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentInput")).toHaveValue("");
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("hisAgentInputDraftV2"))).toBeNull();
    await expect(page.locator("#hisAgentSendButton")).toHaveText("取消任务");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();
  });

  test("cancel clears active task, freezes timer, and ignores late progress", async ({ page }) => {
    await page.goto("/html/login.html?v=e2e-cancel-freeze&" + localServiceQuery);
    await page.evaluate(() => {
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_cancel_task",
        objective: "需要取消的任务",
        status: "running",
        source: "backend_llm",
        plan: [{ id: "step_1", goal: "正在执行", status: "running", source: "backend_llm" }],
        current_step_index: 0,
        created_at: Date.now() / 1000,
        started_at: (Date.now() - 3500) / 1000,
        started_at_ms: Date.now() - 3500,
        updated_at: Date.now() / 1000
      }));
    });
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await expect(page.locator("#hisAgentSendButton")).toHaveText("取消任务");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();
    await expect(page.locator("#hisAgentSendButton")).toHaveText("发送");
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("his-agent-task-progress", {
        detail: { task_id: "e2e_cancel_task", elapsed_ms: 99999, text: "晚到进度：不应复活旧任务" }
      }));
    });
    await expect(page.locator("#hisAgentCurrentTaskCard")).toBeHidden();
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]"));
    const cancelled = history.find((item) => item.task_id === "e2e_cancel_task");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.finished_at_ms).toBeTruthy();
    expect(cancelled?.elapsed_ms).toBeGreaterThanOrEqual(0);

    await page.evaluate(() => {
      localStorage.setItem("hisAgentActiveTask", JSON.stringify({
        task_id: "e2e_cancel_phrase_task",
        objective: "等待用户取消短语",
        status: "waiting_user",
        source: "backend_llm",
        plan: [{ id: "step_1", goal: "等待补充", status: "waiting_user", source: "backend_llm" }],
        current_step_index: 0,
        created_at: Date.now() / 1000,
        started_at_ms: Date.now(),
        updated_at: Date.now() / 1000
      }));
    });
    await page.reload();
    await ensureAgentOpen(page);
    await page.locator("#hisAgentInput").fill("我发错了，先不改");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();
  });

  test("chat scroll restores instantly from saved snapshot", async ({ page }) => {
    await page.addInitScript(() => {
      const history = Array.from({ length: 45 }, (_, index) => ({
        role: index % 2 ? "agent" : "user",
        type: index % 2 ? "agent" : "user",
        text: `滚动恢复消息 ${index + 1}`,
        at: new Date().toISOString()
      }));
      localStorage.setItem("his_agent_widget_state_v1", JSON.stringify({
        open: true,
        agentSessionId: "e2e_scroll_session",
        asrSessionId: "e2e_asr_session",
        history,
        speakerTurns: [],
        activeTab: "agent",
        viewMode: "chat",
        conversationState: "chatting"
      }));
      localStorage.setItem("hisAgentScrollRestoreV2", JSON.stringify({
        sessionId: "e2e_scroll_session",
        viewMode: "chat",
        nearBottom: true,
        scrollTop: 100000,
        scrollHeight: 100000,
        clientHeight: 700,
        updatedAt: Date.now()
      }));
    });
    await page.goto("/html/login.html?v=e2e-scroll-restore-open&" + localServiceQuery);
    await expect(page.locator("#hisAgentPanel")).toHaveClass(/open/);
    await expect(page.locator("#hisAgentHistory")).toContainText("滚动恢复消息 45");
    await expect.poll(async () => page.evaluate(() => {
      const body = document.querySelector("#hisAgentBody");
      return body.scrollHeight - body.scrollTop - body.clientHeight;
    }), { timeout: 2_000 }).toBeLessThan(12);
    const restored = await page.evaluate(() => {
      const body = document.querySelector("#hisAgentBody");
      return { visibility: window.getComputedStyle(body).visibility };
    });
    expect(restored.visibility).not.toBe("hidden");
  });

  test("voice turns become confirmable executable tasks without page mutation before confirmation", async ({ page }) => {
    let sentPayload = null;
    await simulateConnectedLlm(page);
    await mockVoiceTaskResult(page, {
      result_type: "explicit_action",
      task_text: "请将患者 P001 张伟的主诉更新为咳嗽2天伴低热，现病史更新为夜间加重、少量白痰，并保存。",
      proposed_fields: [
        { field: "chiefComplaint", label: "主诉", value: "咳嗽2天伴低热" },
        { field: "presentIllness", label: "现病史", value: "夜间加重、少量白痰" }
      ],
      reason_summary: "医生已要求记录就诊内容，整理为确认后可执行任务。"
    }, (body) => {
      sentPayload = body;
    });
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-voice-executable-task&" + localServiceQuery);
    const before = await page.evaluate(() => ({
      patient: window.PatientStore.getPatientById("P001"),
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    await openAgent(page);
    await page.locator("#hisAgentVisitSessionButton").click();
    await page.locator("#hisAgentMockTurnsButton").click();
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("[data-voice-task-editor='1']")).toBeVisible();
    await expect(page.locator("[data-voice-task-editor='1']")).toHaveValue(/主诉更新为咳嗽2天伴低热/);
    expect(Object.keys(sentPayload || {}).sort()).toEqual(["current_page_type", "current_patient_id", "patient_context", "turns"].sort());
    expect(sentPayload.patient_context).toMatchObject({ patientId: "P001", patientName: "张伟", pageType: "patientEditor" });
    expect(JSON.stringify(sentPayload.patient_context)).not.toContain("医院信息系统 HIS Demo");
    expect(JSON.stringify(sentPayload)).not.toContain("pageState");
    expect(JSON.stringify(sentPayload)).not.toContain("raw");
    const pendingVoiceDetails = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("his_agent_widget_state_v1") || "{}");
      const item = (state.history || []).find((entry) => entry.kind === "voice-task-review");
      return item?.details || null;
    });
    expect(pendingVoiceDetails?.proposed_fields).toEqual([
      { field: "chiefComplaint", label: "主诉", value: "咳嗽2天伴低热" },
      { field: "presentIllness", label: "现病史", value: "夜间加重、少量白痰" }
    ]);
    await page.locator("button[data-agent-action='voice-task-cancel']").click();
    const after = await page.evaluate(() => ({
      patient: window.PatientStore.getPatientById("P001"),
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    expect(after).toEqual(before);
  });

  test("mutation task with update save verify changes patient-store and audit", async ({ page }) => {
    const contract = {
      target_patient: { patientId: "P001", name: "张伟" },
      expected_mutations: [
        { field: "chiefComplaint", value: "咳嗽两天伴低热" },
        { field: "presentIllness", value: "患者近两天咳嗽，有少量白痰，夜间咳嗽更明显，伴低热" },
        { field: "pastHistory", value: "无明确慢性病史" }
      ],
      requires_save: true,
      requires_verification: true
    };
    await simulateLlmPlanner(page, [
      { id: "step_find", goal: "查找 P001 张伟", requiredPage: "patientManagement", actionType: "find_patient", args: { patientSelector: { patientId: "P001", name: "张伟" } } },
      { id: "step_open", goal: "打开 P001 张伟编辑页", requiredPage: "patientManagement", actionType: "open_patient_editor", args: { patientSelector: { patientId: "P001", name: "张伟" } } },
      { id: "step_update_fields", goal: "更新主诉、现病史和既往病史", requiredPage: "patientEditor", actionType: "update_patient_fields", args: { patientSelector: { patientId: "P001", name: "张伟" }, updates: contract.expected_mutations.map((item) => ({ field: item.field, value: item.value })) } },
      { id: "step_save", goal: "保存患者记录", requiredPage: "patientEditor", actionType: "save_patient", args: { patientSelector: { patientId: "P001", name: "张伟" } } },
      { id: "step_verify_chief", goal: "核对主诉", requiredPage: "patientEditor", actionType: "verify_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "chiefComplaint", value: contract.expected_mutations[0].value } },
      { id: "step_verify_present", goal: "核对现病史", requiredPage: "patientEditor", actionType: "verify_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "presentIllness", value: contract.expected_mutations[1].value } },
      { id: "step_verify_past", goal: "核对既往病史", requiredPage: "patientEditor", actionType: "verify_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "pastHistory", value: contract.expected_mutations[2].value } },
      { id: "step_verify_store", goal: "核对 patient-store", requiredPage: "patientEditor", actionType: "verify_patient_store", args: { patientSelector: { patientId: "P001", name: "张伟" } } }
    ], { task_contract: contract, expected_mutations: contract.expected_mutations }, "e2e_mutation_contract_success");
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-mutation-contract-success&" + localServiceQuery);
    const beforeAuditCount = await page.evaluate(() => window.PatientStore.getAuditLog("P001").length);
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("将张伟的主诉更新为‘咳嗽两天伴低热’，现病史更新为‘患者近两天咳嗽，有少量白痰，夜间咳嗽更明显，伴低热’，既往病史更新为‘无明确慢性病史’，并保存。");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => {
      const patient = window.PatientStore.getPatientById("P001");
      return {
        chiefComplaint: patient.chiefComplaint,
        presentIllness: patient.presentIllness,
        pastHistory: patient.pastHistory,
        auditCount: window.PatientStore.getAuditLog("P001").length,
        historyStatus: JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_mutation_contract_success")?.status || ""
      };
    }), { timeout: 45_000 }).toMatchObject({
      chiefComplaint: contract.expected_mutations[0].value,
      presentIllness: contract.expected_mutations[1].value,
      pastHistory: contract.expected_mutations[2].value,
      historyStatus: "completed"
    });
    const after = await page.evaluate(() => ({
      auditCount: window.PatientStore.getAuditLog("P001").length,
      history: JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_mutation_contract_success")
    }));
    expect(after.auditCount).toBeGreaterThan(beforeAuditCount);
    expect(after.history?.mutation_ledger?.applied_mutations?.map((item) => item.field).sort()).toEqual(["chiefComplaint", "pastHistory", "presentIllness"]);
    expect(after.history?.mutation_ledger?.verified_mutations?.map((item) => item.field).sort()).toEqual(["chiefComplaint", "pastHistory", "presentIllness"]);
    expect(after.history?.mutation_ledger?.save?.audit_id).toBeTruthy();
  });

  test("verify patient field completes when current value equals expectedValue", async ({ page }) => {
    let repairCalls = 0;
    await page.route(/\/api\/universal-agent\/task-repair$/, async (route) => {
      repairCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "repair should not be called" })
      });
    });
    await simulateLlmPlanner(page, [
      {
        id: "step_verify_chief_expected_value",
        goal: "核对 P001 张伟主诉当前值",
        requiredPage: "patientEditor",
        actionType: "verify_patient_field",
        args: {
          patientSelector: { patientId: "P001", name: "张伟" },
          field: "chiefComplaint",
          expectedValue: "咳嗽一周，夜间加重，偶有低热。"
        }
      }
    ], {}, "e2e_verify_expected_value_completed");
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-verify-expected-value&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("核对 P001 张伟主诉当前值是否正确。");
    await page.locator("#hisAgentSendButton").click();
    await expect.poll(async () => page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
      const task = history.find((item) => item.task_id === "e2e_verify_expected_value_completed");
      const step = task?.plan?.[0];
      return {
        status: task?.status || "",
        stepStatus: step?.status || "",
        patientId: step?.result?.patientId || "",
        field: step?.result?.field || "",
        fieldLabel: step?.result?.fieldLabel || "",
        expectedValue: step?.result?.expectedValue || "",
        actualValue: step?.result?.actualValue || ""
      };
    }), { timeout: 20_000 }).toMatchObject({
      status: "completed",
      stepStatus: "completed",
      patientId: "P001",
      field: "chiefComplaint",
      fieldLabel: "主诉",
      expectedValue: "咳嗽一周，夜间加重，偶有低热。",
      actualValue: "咳嗽一周，夜间加重，偶有低热。"
    });
    expect(repairCalls).toBe(0);
  });

  test("mutation contract rejects incomplete find open save plan before page actions", async ({ page }) => {
    const contract = {
      target_patient: { patientId: "P001", name: "张伟" },
      expected_mutations: [
        { field: "chiefComplaint", value: "咳嗽两天伴低热" },
        { field: "presentIllness", value: "夜间咳嗽明显" }
      ],
      requires_save: true,
      requires_verification: true
    };
    await simulateLlmPlanner(page, [
      { id: "step_find", goal: "查找患者", requiredPage: "patientManagement", actionType: "find_patient", args: { patientSelector: { patientId: "P001", name: "张伟" } } },
      { id: "step_open", goal: "打开患者编辑页", requiredPage: "patientManagement", actionType: "open_patient_editor", args: { patientSelector: { patientId: "P001", name: "张伟" } } },
      { id: "step_save", goal: "保存患者记录", requiredPage: "patientEditor", actionType: "save_patient", args: { patientSelector: { patientId: "P001", name: "张伟" } } }
    ], { task_contract: contract, expected_mutations: contract.expected_mutations }, "e2e_mutation_contract_rejected");
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-mutation-contract-reject&" + localServiceQuery);
    const before = await page.evaluate(() => ({
      patient: window.PatientStore.getPatientById("P001"),
      auditCount: window.PatientStore.getAuditLog("P001").length,
      url: location.href
    }));
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("将张伟的主诉更新为‘咳嗽两天伴低热’，现病史更新为‘夜间咳嗽明显’，并保存。");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("任务计划缺少必要修改步骤，尚未执行保存。", { timeout: 20_000 });
    const after = await page.evaluate(() => ({
      patient: window.PatientStore.getPatientById("P001"),
      auditCount: window.PatientStore.getAuditLog("P001").length,
      history: JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_mutation_contract_rejected"),
      url: location.href
    }));
    expect(after.patient).toEqual(before.patient);
    expect(after.auditCount).toBe(before.auditCount);
    expect(after.url).toBe(before.url);
    expect(after.history?.status).toBe("failed");
    expect(after.history?.plan?.every((step) => step.status !== "completed")).toBeTruthy();
  });

  test("voice confirmed task forwards expected mutations and executes normal taskflow", async ({ page }) => {
    const contract = {
      target_patient: { patientId: "P001", name: "张伟" },
      expected_mutations: [
        { field: "chiefComplaint", value: "咳嗽2天伴低热" },
        { field: "presentIllness", value: "患者近两天咳嗽，有少量白痰，夜间明显，伴低热" }
      ],
      requires_save: true,
      requires_verification: true,
      source: "voice_turns_to_agent_task"
    };
    let plannerPayload: any = null;
    await simulateConnectedLlm(page);
    await mockVoiceTaskResult(page, {
      result_type: "explicit_action",
      task_text: "请将患者 P001 张伟的主诉更新为咳嗽2天伴低热，现病史更新为患者近两天咳嗽，有少量白痰，夜间明显，伴低热，并保存。",
      proposed_fields: [
        { field: "chiefComplaint", label: "主诉", value: contract.expected_mutations[0].value },
        { field: "presentIllness", label: "现病史", value: contract.expected_mutations[1].value }
      ],
      expected_mutations: contract.expected_mutations,
      task_contract: contract,
      reason_summary: "医生要求保存问诊内容。"
    });
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      const body = route.request().postDataJSON();
      plannerPayload = body;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          mode: "task-oriented-harness",
          llmUsed: true,
          provider: "e2e",
          model: "mock-llm",
          usage: { prompt_tokens: 20, completion_tokens: 16, total_tokens: 36 },
          response: {
            kind: "task",
            message: "mock voice task planned",
            task: {
              task_id: "e2e_voice_mutation_contract_execute",
              objective: body.user_message,
              status: "running",
              source: "backend_llm",
              slots: { task_contract: body.task_contract, expected_mutations: body.task_contract.expected_mutations },
              plan: [
                { id: "step_update_chief", goal: "更新主诉", requiredPage: "patientEditor", actionType: "update_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "chiefComplaint", value: contract.expected_mutations[0].value } },
                { id: "step_update_present", goal: "更新现病史", requiredPage: "patientEditor", actionType: "update_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "presentIllness", value: contract.expected_mutations[1].value } },
                { id: "step_save", goal: "保存患者记录", requiredPage: "patientEditor", actionType: "save_patient", args: { patientSelector: { patientId: "P001", name: "张伟" } } },
                { id: "step_verify_chief", goal: "核对主诉", requiredPage: "patientEditor", actionType: "verify_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "chiefComplaint", value: contract.expected_mutations[0].value } },
                { id: "step_verify_present", goal: "核对现病史", requiredPage: "patientEditor", actionType: "verify_patient_field", args: { patientSelector: { patientId: "P001", name: "张伟" }, field: "presentIllness", value: contract.expected_mutations[1].value } },
                { id: "step_verify_store", goal: "核对 patient-store", requiredPage: "patientEditor", actionType: "verify_patient_store", args: { patientSelector: { patientId: "P001", name: "张伟" } } }
              ],
              current_step_index: 0,
              created_at: Date.now() / 1000,
              updated_at: Date.now() / 1000
            }
          },
          trace: { e2e: true }
        })
      });
    });
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-voice-mutation-contract-execute&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentVisitSessionButton").click();
    await page.locator("#hisAgentMockTurnsButton").click();
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("[data-voice-task-editor='1']")).toBeVisible();
    await page.locator("button[data-agent-action='voice-task-execute']").click();
    await expect.poll(async () => page.evaluate(() => {
      const patient = window.PatientStore.getPatientById("P001");
      return {
        chiefComplaint: patient.chiefComplaint,
        presentIllness: patient.presentIllness,
        status: JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]").find((item) => item.task_id === "e2e_voice_mutation_contract_execute")?.status || ""
      };
    }), { timeout: 25_000 }).toMatchObject({
      chiefComplaint: contract.expected_mutations[0].value,
      presentIllness: contract.expected_mutations[1].value,
      status: "completed"
    });
    expect(plannerPayload?.task_contract?.expected_mutations).toEqual(contract.expected_mutations);
    expect(plannerPayload?.input_route?.inputType).toBe("voice_session_task");
    expect(plannerPayload?.patient_store_summary?.map((item) => item.patientId)).toEqual(["P001"]);
    expect(plannerPayload?.full_patient_index).toEqual([]);
    expect(JSON.stringify(plannerPayload)).not.toContain("P020");
  });

  test("voice no_action result shows guidance and no editable execution box", async ({ page }) => {
    await simulateConnectedLlm(page);
    await mockVoiceTaskResult(page, {
      result_type: "no_action",
      task_text: "未发现明确需要执行的页面操作",
      proposed_fields: [],
      reason_summary: "未发现医生操作意图。"
    });
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-voice-no-action&" + localServiceQuery);
    await openAgent(page);
    await page.locator("#hisAgentVisitSessionButton").click();
    await page.locator("#hisAgentMockTurnsButton").click();
    await page.locator("#hisAgentPlanVoiceTaskButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("未发现明确需要执行的页面操作");
    await expect(page.locator("[data-voice-task-editor='1']")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("hisAgentActiveTask"))).toBeNull();
  });

  test("structured medical draft action creates Agent draft output without field verification error", async ({ page }) => {
    await simulateLlmPlanner(page, [
      {
        id: "step_find",
        goal: "定位 P001 张伟",
        requiredPage: "patientEditor",
        actionType: "find_patient",
        args: { patientSelector: { patientId: "P001", name: "张伟" } }
      },
      {
        id: "step_draft",
        goal: "生成 P001 张伟的病历草稿",
        requiredPage: "patientEditor",
        actionType: "create_structured_draft",
        args: {
          patientSelector: { patientId: "P001", name: "张伟" },
          field: "note",
          draftText: "病历草稿：患者张伟，咳嗽 2 天伴低热，夜间加重，少量白痰。"
        }
      },
      {
        id: "step_finish",
        goal: "完成草稿任务",
        requiredPage: "patientEditor",
        actionType: "finish_task",
        args: {}
      }
    ], {}, "e2e_structured_draft_task");
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-structured-draft-action&" + localServiceQuery);
    const before = await page.evaluate(() => ({
      patient: window.PatientStore.getPatientById("P001"),
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("为 P001 张伟生成病历草稿：咳嗽2天伴低热，夜间加重，少量白痰。");
    await page.locator("#hisAgentSendButton").click();
    await expect(page.locator("#hisAgentHistory")).toContainText("已生成病历草稿", { timeout: 20_000 });
    await expect(page.locator("#hisAgentHistory")).not.toContainText("校验字段不存在");
    await expect.poll(async () => page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem("hisAgentTaskHistory") || "[]");
      return history.find((item) => item.task_id === "e2e_structured_draft_task")?.status || "";
    }), { timeout: 20_000 }).toBe("completed");
    const after = await page.evaluate(() => ({
      patient: window.PatientStore.getPatientById("P001"),
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    expect(after).toEqual(before);
  });

  test("structured medical draft review requires doctor confirmation before writing patient-store", async ({ page }) => {
    await simulateConnectedLlm(page);
    await page.route(/\/api\/universal-agent\/task-plan$/, async (route) => {
      const body = route.request().postDataJSON();
      const isWrite = String(body.user_message || "").includes("字段更新为以下病历草稿");
      const editedDraft = "编辑后的病历草稿：患者张伟，咳嗽 2 天伴低热，夜间加重，少量白痰。";
      const plan = isWrite ? [
        {
          id: "step_write",
          goal: "确认后写入备注字段",
          requiredPage: "patientEditor",
          actionType: "write_clinical_note_field",
          args: {
            patientSelector: { patientId: "P001", name: "张伟" },
            field: "note",
            draftText: editedDraft
          },
          status: "pending",
          source: "backend_llm"
        },
        {
          id: "step_save",
          goal: "保存备注字段",
          requiredPage: "patientEditor",
          actionType: "save_patient",
          args: {
            patientSelector: { patientId: "P001", name: "张伟" }
          },
          status: "pending",
          source: "backend_llm"
        },
        {
          id: "step_finish",
          goal: "完成确认写入",
          requiredPage: "patientEditor",
          actionType: "finish_task",
          args: {},
          status: "pending",
          source: "backend_llm"
        }
      ] : [
        {
          id: "step_draft",
          goal: "生成 P001 张伟的病历草稿，等待医生确认",
          requiredPage: "patientEditor",
          actionType: "create_structured_draft",
          args: {
            patientSelector: { patientId: "P001", name: "张伟" },
            field: "note",
            draftText: "病历草稿：患者张伟，咳嗽 2 天伴低热，夜间加重，少量白痰。"
          },
          status: "pending",
          source: "backend_llm"
        }
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          mode: "task-oriented-harness",
          llmUsed: true,
          provider: "e2e",
          model: "mock-llm",
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
          response: {
            kind: "task",
            message: isWrite ? "mock write planned" : "mock draft planned",
            task: {
              task_id: isWrite ? "e2e_confirm_draft_write_task" : "e2e_confirm_draft_review_task",
              objective: body.user_message || "e2e clinical draft",
              status: "running",
              source: "backend_llm",
              slots: {},
              plan,
              current_step_index: 0,
              created_at: Date.now() / 1000,
              updated_at: Date.now() / 1000
            }
          },
          trace: { e2e: true }
        })
      });
    });
    await page.goto("/html/patient-editor.html?patientId=P001&v=e2e-structured-draft-confirm-write&" + localServiceQuery);
    const before = await page.evaluate(() => ({
      note: window.PatientStore.getPatientById("P001").note,
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    await openAgent(page);
    await page.locator("#hisAgentOpenChatButton").click();
    await page.locator("#hisAgentInput").fill("为 P001 张伟生成病历草稿：咳嗽2天伴低热，夜间加重，少量白痰。");
    await page.locator("#hisAgentSendButton").click();
    const draftEditor = page.locator("[data-clinical-draft-editor='1']");
    await expect(draftEditor).toBeVisible({ timeout: 20_000 });
    await expect(draftEditor).toHaveValue(/咳嗽 2 天伴低热/);
    const afterDraftOnly = await page.evaluate(() => ({
      note: window.PatientStore.getPatientById("P001").note,
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    expect(afterDraftOnly).toEqual(before);
    await draftEditor.fill("编辑后的病历草稿：患者张伟，咳嗽 2 天伴低热，夜间加重，少量白痰。");
    await page.locator("button[data-agent-action='clinical-draft-confirm']").click();
    await expect.poll(async () => page.evaluate(() => window.PatientStore.getPatientById("P001").note), { timeout: 20_000 }).toContain("编辑后的病历草稿");
    await expect(page.locator("#hisAgentHistory")).not.toContainText("校验字段不存在");
    const afterWrite = await page.evaluate(() => ({
      note: window.PatientStore.getPatientById("P001").note,
      auditCount: window.PatientStore.getAuditLog("P001").length
    }));
    expect(afterWrite.auditCount).toBeGreaterThan(before.auditCount);
  });
});
