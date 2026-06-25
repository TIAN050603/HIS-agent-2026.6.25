import { chromium } from "@playwright/test";
import fs from "node:fs/promises";

const baseURL = (process.env.HIS_BASE_URL || "http://10.26.6.8:31681").replace(/\/+$/, "");
const pages = [
  { page: "login", path: "/html/login.html?v=catalog" },
  { page: "dashboard", path: "/html/dashboard.html?v=catalog" },
  { page: "patient-management", path: "/html/patient-management.html?v=catalog" },
  { page: "patient-editor", path: "/html/patient-editor.html?patientId=P001&v=catalog" },
  { page: "agent-history", path: "/html/agent-history.html?v=catalog" },
  { page: "unknown-fixture", path: "/tests/fixtures/unknown-page.html?v=catalog" }
];

function actionForControl(control) {
  const role = control.role || "";
  if (role === "button") return "click";
  if (role === "link") return "click";
  if (role === "textbox" || role === "textarea") return "clear + type";
  if (role === "combobox") return "select_option";
  if (role === "checkbox") return "check / uncheck";
  if (role === "radio") return "check";
  if (role === "date") return "set_date";
  return "read / focus";
}

function riskForControl(control) {
  const text = `${control.accessible_name || ""} ${control.visible_text || ""}`.toLowerCase();
  if (/保存|登录|退出|提交|删除|重置|reset|submit|save|login|logout/.test(text)) return "high";
  if (/编辑|打开|返回|导航|详情/.test(text)) return "medium";
  return "low";
}

function markdownTable(rows) {
  const header = "| 页面 | 控件 | role | 人类操作 | Agent action | 前置条件 | 验证方式 | 自动执行 |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
  return [header].concat(rows.map((row) => {
    return [
      row.page,
      row.name,
      row.role,
      row.humanAction,
      row.agentAction,
      row.precondition,
      row.verifier,
      row.allowed
    ].map((value) => String(value || "").replace(/\|/g, "/")).join(" | ");
  }).map((line) => `| ${line} |`)).join("\n");
}

async function observe(page, target) {
  await page.goto(baseURL + target.path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    if (window.HisAgentBrowser && typeof window.HisAgentBrowser.observeCurrentPage === "function") {
      return window.HisAgentBrowser.observeCurrentPage();
    }
    return {
      page_type: document.body && document.body.dataset.pageType || "",
      controls: Array.from(document.querySelectorAll("button,input,textarea,select,a[href]")).map((node, index) => ({
        element_ref: node.id || node.name || `fallback_${index}`,
        role: node.tagName.toLowerCase(),
        accessible_name: node.getAttribute("aria-label") || node.getAttribute("name") || node.id || "",
        visible_text: node.innerText || node.textContent || "",
        enabled: !node.disabled,
        visible: true
      })),
      forms: [],
      tables: []
    };
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const rows = [];
  const summaries = [];
  try {
    for (const target of pages) {
      const observation = await observe(page, target);
      const controls = Array.isArray(observation.controls) ? observation.controls : [];
      summaries.push({ page: target.page, controls: controls.length, forms: (observation.forms || []).length, tables: (observation.tables || []).length });
      for (const control of controls) {
        const name = control.accessible_name || control.visible_text || control.element_ref || "(unnamed)";
        const action = actionForControl(control);
        const risk = riskForControl(control);
        rows.push({
          page: target.page,
          name: name.slice(0, 80),
          role: control.role || "",
          humanAction: action,
          agentAction: action,
          precondition: risk === "high" ? "需要 LLM plan + allowlist + 页面上下文验证" : "控件 visible/enabled",
          verifier: "execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state",
          allowed: risk === "high" ? "仅明确任务允许" : "允许"
        });
      }
    }
  } finally {
    await browser.close();
  }
  const summaryText = summaries.map((item) => `- ${item.page}: controls=${item.controls}, forms=${item.forms}, tables=${item.tables}`).join("\n");
  const body = [
    "# HIS Human Action Catalog",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Base URL: ${baseURL}`,
    "",
    "## 自动发现摘要",
    "",
    summaryText,
    "",
    "## 操作目录",
    "",
    markdownTable(rows),
    "",
    "## 架构说明",
    "",
    "- 本目录由 `scripts/generate-human-action-catalog.mjs` 通过真实浏览器和 `HisAgentBrowser.observeCurrentPage()` 自动生成。",
    "- Agent 不因目录存在而获得业务特权；高风险动作仍必须来自 backend LLM planner，并经过 allowlist、页面上下文、字段/患者解析和后置条件校验。",
    "- 未命名或低语义控件应优先补 `data-testid`、label 或 accessible name，而不是在 Agent 中写死 nth-child。",
    ""
  ].join("\n");
  await fs.writeFile("HIS_HUMAN_ACTION_CATALOG.md", body, "utf8");
  console.log(`Wrote HIS_HUMAN_ACTION_CATALOG.md with ${rows.length} controls.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
