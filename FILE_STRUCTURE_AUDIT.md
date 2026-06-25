# 文件结构审计报告

审计时间：2026-06-12

更新：2026-06-22，Universal Agent V2 产品化重构新增正式 shared 模块：

- `/huaiwenpang/universal_agent/shared/agent-input-router.js`
- `/huaiwenpang/universal_agent/shared/agent-state-machine.js`
- `/huaiwenpang/universal_agent/shared/agent-task-model.js`
- `/huaiwenpang/universal_agent/shared/agent-scroll-manager.js`

这些文件由正式 `html/` 页面引用，位于 `ui-action-feedback.js` 之后、`agent-task-orchestrator.js` 之前。它们只处理输入路由、状态记录、task schema 和滚动，不执行页面动作，不写 patient-store，不替代 backend LLM planner。

当前端口映射：frontend `5500->31875`，backend `8000->31593`，LLM service `8001->31893`，ASR `8010->31478`。

本轮未新增根目录重复 HTML/JS，未删除或移动任何文件，未修改 `universal_agent_backup_*`。

更新：2026-06-22，本轮仅补充 Agent 历史、Demo 登录态、拖拽区与 UI 反馈相关正式文件；后续同日又扩展 `shared/ui-action-feedback.js` 的字段输入、select、date、按钮点击和患者行高亮能力。未删除、移动、归档任何文件，未修改 `universal_agent_backup_*`，未新增根目录重复 JS。

本轮只做文件结构审计和正式运行文件确认。未删除、未移动、未归档任何文件，未修改业务逻辑、UI、Agent、ASR，也未修改 `universal_agent_backup_*`。

## 1. 当前真实运行目录

真实项目目录：

```text
/huaiwenpang/universal_agent
```

当前静态服务观察结果：

```text
python3 scripts/serve-static-utf8.py --host 0.0.0.0 --port 5500 --directory .
```

静态服务根目录是：

```text
/huaiwenpang/universal_agent
```

因此：

- URL `/html/login.html` 实际读取 `/huaiwenpang/universal_agent/html/login.html`。
- URL `/shared/agent-widget.js` 实际读取 `/huaiwenpang/universal_agent/shared/agent-widget.js`。
- 根目录重复文件，例如 `/login.html`、`/agent-widget.js`，虽然可被 HTTP 直接访问，但不是当前正式页面引用链路。

额外观察：

- 远程曾同时出现一个 `python3 -m http.server 31875 --directory /huaiwenpang/universal_agent` 进程；当前正式前端映射为 `5500->31875`。
- 外部 `http://10.26.6.8:31875/html/login.html` 返回 `Content-type: text/html; charset=utf-8`，与 UTF-8 静态服务一致。
- 两个静态服务根目录都指向 `/huaiwenpang/universal_agent`，不会改变 source of truth 判断。

## 2. 正式运行入口

当前正式入口是 `html/` 下文件，不是根目录同名文件。

| 页面 | 正式文件路径 | 当前访问 URL | 是否被静态服务实际加载 |
| --- | --- | --- | --- |
| login | `/huaiwenpang/universal_agent/html/login.html` | `http://10.26.6.8:31875/html/login.html` | 是，HTTP 200 |
| dashboard | `/huaiwenpang/universal_agent/html/dashboard.html` | `http://10.26.6.8:31875/html/dashboard.html` | 是，HTTP 200 |
| patient-management | `/huaiwenpang/universal_agent/html/patient-management.html` | `http://10.26.6.8:31875/html/patient-management.html` | 是，HTTP 200 |
| patient-editor | `/huaiwenpang/universal_agent/html/patient-editor.html` | `http://10.26.6.8:31875/html/patient-editor.html?patientId=P001` | 是，HTTP 200 |
| agent-history | `/huaiwenpang/universal_agent/html/agent-history.html` | `http://10.26.6.8:31875/html/agent-history.html` | 是，HTTP 200 |

`/huaiwenpang/universal_agent/html/index.html` 与根目录 `/huaiwenpang/universal_agent/index.html` 内容相同，当前作用是跳转到 `html/login.html`。

## 3. 正式 shared 文件

正式 `html/` 页面均引用 `../shared/...`。当前未发现正式页面引用根目录重复 JS/CSS。

| 模块 | 正式路径 | 被哪些页面引用 | HTTP 状态 |
| --- | --- | --- | --- |
| agent-widget | `/huaiwenpang/universal_agent/shared/agent-widget.js` | login、dashboard、patient-management、patient-editor | 200 |
| agent-widget-bootstrap | `/huaiwenpang/universal_agent/shared/agent-widget-bootstrap.js` | login、dashboard、patient-management、patient-editor | 200 |
| agent-widget.css | `/huaiwenpang/universal_agent/shared/agent-widget.css` | login、dashboard、patient-management、patient-editor | 200 |
| ui-action-feedback | `/huaiwenpang/universal_agent/shared/ui-action-feedback.js` | login、dashboard、patient-management、patient-editor、agent-history | 200 |
| runtime-config | `/huaiwenpang/universal_agent/shared/runtime-config.js` | login、dashboard、patient-management、patient-editor | 200 |
| voice-input-controller | `/huaiwenpang/universal_agent/shared/voice-input-controller.js` | login、dashboard、patient-management、patient-editor | 200 |
| agent-task-orchestrator | `/huaiwenpang/universal_agent/shared/agent-task-orchestrator.js` | login、dashboard、patient-management、patient-editor | 200 |
| agent-input-router | `/huaiwenpang/universal_agent/shared/agent-input-router.js` | login、dashboard、patient-management、patient-editor、agent-history | 200 |
| agent-state-machine | `/huaiwenpang/universal_agent/shared/agent-state-machine.js` | login、dashboard、patient-management、patient-editor、agent-history | 200 |
| agent-task-model | `/huaiwenpang/universal_agent/shared/agent-task-model.js` | login、dashboard、patient-management、patient-editor、agent-history | 200 |
| agent-scroll-manager | `/huaiwenpang/universal_agent/shared/agent-scroll-manager.js` | login、dashboard、patient-management、patient-editor、agent-history | 200 |
| patient-store | `/huaiwenpang/universal_agent/shared/patient-store.js` | login、dashboard、patient-management、patient-editor | 200 |
| patient-field-schema | `/huaiwenpang/universal_agent/shared/patient-field-schema.js` | login、dashboard、patient-management、patient-editor | 200 |
| patient-editor-action-adapter | `/huaiwenpang/universal_agent/shared/patient-editor-action-adapter.js` | patient-editor | 200 |

正式页面当前引用示例：

```html
<link rel="stylesheet" href="../shared/agent-widget.css?...">
<script src="../shared/runtime-config.js?..."></script>
<script src="../shared/patient-field-schema.js?..."></script>
<script src="../shared/patient-store.js?..."></script>
<script src="../shared/voice-input-controller.js?..."></script>
<script src="../shared/agent-task-orchestrator.js?..."></script>
<script src="../shared/agent-widget-bootstrap.js?..."></script>
<script src="../shared/agent-widget.js?..."></script>
```

`patient-editor.html` 额外引用：

```html
<script src="../shared/patient-editor-action-adapter.js?..."></script>
```

## 4. 疑似重复文件

| 文件路径 | 与哪个正式文件重复 | 是否被页面引用 | 是否被 E2E 引用 | 是否被后端引用 | 是否可删除 | 风险等级 | 建议 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/huaiwenpang/universal_agent/login.html` | `html/login.html` | 否。正式页面不引用；直接访问 `/login.html` 可打开旧页 | 否 | 未发现 | 需确认后才可删 | 中 | 后续归档 |
| `/huaiwenpang/universal_agent/dashboard.html` | `html/dashboard.html` | 否。正式页面不引用；直接访问 `/dashboard.html` 可打开旧页 | 否 | 未发现 | 需确认后才可删 | 中 | 后续归档 |
| `/huaiwenpang/universal_agent/patient-management.html` | `html/patient-management.html` | 否。正式页面不引用；直接访问 `/patient-management.html` 可打开旧页 | 否 | 未发现 | 需确认后才可删 | 中 | 后续归档 |
| `/huaiwenpang/universal_agent/patient-editor.html` | `html/patient-editor.html` | 否。正式页面不引用；直接访问 `/patient-editor.html` 可打开旧页 | 否 | 未发现 | 需确认后才可删 | 中 | 后续归档 |
| `/huaiwenpang/universal_agent/index.html` | `html/index.html` | 根路径入口可能使用 | 否 | 未发现 | 不建议直接删 | 中 | 保留或待确认 |
| `/huaiwenpang/universal_agent/agent-widget.js` | `shared/agent-widget.js` | 否 | 否 | 未发现 | 需确认后才可删 | 低 | 后续归档 |
| `/huaiwenpang/universal_agent/agent-widget.css` | `shared/agent-widget.css` | 否；内容与正式 CSS 相同 | 否 | 未发现 | 需确认后才可删 | 低 | 后续删除候选 |
| `/huaiwenpang/universal_agent/agent-widget-bootstrap.js` | `shared/agent-widget-bootstrap.js` | 否 | 否 | 未发现 | 需确认后才可删 | 低 | 后续归档 |
| `/huaiwenpang/universal_agent/runtime-config.js` | `shared/runtime-config.js` | 否 | 否 | 未发现 | 需确认后才可删 | 中 | 后续归档 |
| `/huaiwenpang/universal_agent/voice-input-controller.js` | `shared/voice-input-controller.js` | 否 | 否 | 未发现 | 需确认后才可删 | 中 | 后续归档 |
| `/huaiwenpang/universal_agent/his-agent.spec.ts` | `tests/e2e/his-agent.spec.ts` | 否 | 否。`package.json` 指向 `tests/e2e/playwright.config.ts` | 未发现 | 需确认后才可删 | 低 | 后续归档 |
| `/huaiwenpang/universal_agent/playwright.config.ts` | `tests/e2e/playwright.config.ts` | 否 | 否。`package.json` 指向 `tests/e2e/playwright.config.ts` | 未发现 | 需确认后才可删 | 低 | 后续归档 |

对比结论：

- 根目录 `login.html`、`dashboard.html`、`patient-management.html`、`patient-editor.html` 与 `html/` 下正式页面 hash 不同。
- 根目录旧 HTML 中可见旧版本号 `20260612-taskui-status`，并出现乱码文案迹象；正式 `html/` 文件才是当前运行链路。
- 根目录 `agent-widget.js`、`agent-widget-bootstrap.js`、`runtime-config.js`、`voice-input-controller.js` 与 `shared/` 正式文件 hash 不同。
- 根目录 `agent-widget.css` 与 `shared/agent-widget.css` hash 相同。
- 根目录 `index.html` 与 `html/index.html` hash 相同。
- 根目录测试文件 `his-agent.spec.ts`、`playwright.config.ts` 与 `tests/e2e/` 下正式文件 hash 不同。

## 5. 绝对不能删的文件

以下文件或目录不应删除：

- `AGENTS.md`
- `.agents/skills/`
- `html/login.html`
- `html/dashboard.html`
- `html/patient-management.html`
- `html/patient-editor.html`
- `shared/agent-widget.js`
- `shared/agent-widget-bootstrap.js`
- `shared/agent-widget.css`
- `shared/runtime-config.js`
- `shared/voice-input-controller.js`
- `shared/agent-task-orchestrator.js`
- `shared/patient-store.js`
- `shared/patient-field-schema.js`
- `shared/patient-editor-action-adapter.js`
- `backend/`
- `asr_service/`
- `scripts/check-encoding.mjs`
- `scripts/serve-static-utf8.py`
- `tests/e2e/`
- `tests/agent-cases/`
- `package.json`
- `package-lock.json`
- `IMPLEMENTATION_REPORT.md`
- `OLD_AGENT_MIGRATION_AUDIT.md`
- `PROJECT_BACKLOG.md`
- `DEAD_CODE_REVIEW.md`
- 任何 `.env` 文件和敏感配置文件
- patient-store 与 audit log 相关代码和浏览器数据

## 6. 可以后续归档的候选

只列候选，本轮不执行归档。

- `login.html`
- `dashboard.html`
- `patient-management.html`
- `patient-editor.html`
- `agent-widget.js`
- `agent-widget-bootstrap.js`
- `runtime-config.js`
- `voice-input-controller.js`
- `his-agent.spec.ts`
- `playwright.config.ts`
- `logs/*.log`
- `test-results/`

建议归档方式：

- 新建例如 `archive/root-duplicates-YYYYMMDD/`。
- 归档前再跑一次 `grep` / E2E，确认没有引用。
- 归档后保留一轮观察期，再考虑删除。

## 7. 可以后续删除的候选

只列候选，本轮不执行删除。所有删除都需要用户明确确认。

- `agent-widget.css`：与 `shared/agent-widget.css` 内容完全相同，当前正式页面不引用根目录副本。
- `test-results/`：Playwright 运行产物，可在确认不需要 trace / video 后清理。
- `logs/` 中历史日志：运行产物，可在确认不需要排查历史问题后清理。

不建议直接删除根目录 HTML / JS / TS；它们虽疑似旧副本，但仍可被直接 URL 访问，建议先归档观察。

## 8. 不确定，需要用户决定

- 根目录 `index.html` 是否保留：它与 `html/index.html` 相同，当前用于跳转到 `html/login.html`，建议保留或改为唯一根入口，不建议直接删除。
- 根目录旧 HTML 是否仍被某些外部书签使用：当前正式链路不用，但用户或平台可能曾访问过 `/login.html`、`/dashboard.html` 等旧路径。
- 是否需要把根目录旧 HTML 改成跳转到 `html/`：这属于行为变更，本轮未做。
- 是否需要移除根目录旧 JS / TS：当前未发现引用，但建议先归档，不建议直接删除。
- `logs/` 和 `test-results/` 保留周期：需要用户决定。
- `node_modules/` 是否可重建：依赖目录通常可通过 `npm install` 重建，但当前 E2E 已依赖它，清理前需要确认网络和安装权限。

## 9. 后续建议

建议分三步清理，避免误删：

1. 第一轮只归档根目录旧页面和旧 JS / TS，不删除。
2. 跑默认 E2E：

```bash
HIS_BASE_URL=http://10.26.6.8:31875 npm run test:e2e -- --reporter=list
```

3. 观察确认无外部旧 URL 依赖后，再由用户明确批准删除候选。

建议的正式 source of truth：

- 页面：只使用 `html/`。
- 共享前端模块：只使用 `shared/`。
- E2E：只使用 `tests/e2e/`。
- Agent cases：只使用 `tests/agent-cases/`。
- 后端：只使用 `backend/`。
- ASR：只使用 `asr_service/`。
