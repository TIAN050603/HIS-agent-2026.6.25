# DELETE_CANDIDATES_REVIEW

审计时间：2026-06-15

本轮只做旧代码清理确认，不删除、不移动、不归档任何文件，不修改业务逻辑、UI、Agent、ASR，也不修改 `universal_agent_backup_*`。

依据：

- `AGENTS.md`
- `FILE_STRUCTURE_AUDIT.md`
- `OLD_AGENT_MIGRATION_AUDIT.md`
- `DEAD_CODE_REVIEW.md`
- 当前 `/huaiwenpang/universal_agent` 文件树
- 当前页面、测试、文档引用搜索结果

真实运行目录：

```text
/huaiwenpang/universal_agent
```

当前 source of truth：

- 正式页面：`html/`
- 正式 shared：`shared/`
- 正式 E2E：`tests/e2e/`
- 正式 agent cases：`tests/agent-cases/`
- 后端：`backend/`
- ASR：`asr_service/`

归档状态：

- 当前未发现 `/huaiwenpang/universal_agent/archive/` 下已有归档文件。
- 已发现备份目录 `/huaiwenpang/universal_agent_backup_20260610_033528`，本轮只确认名称，未修改。

## A. 必须保留

| 文件路径 | 原用途 | 当前是否引用 | 是否已归档 | 是否可重建 | 删除风险 | 建议 | 是否需要用户确认 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AGENTS.md` | 项目级约束 | 是，后续迭代必须读取 | 否 | 可手写但不应重建 | 高 | 保留 | 是 |
| `.agents/skills/` | 项目级 skills | 是，任务约束来源 | 否 | 可重建但成本高 | 高 | 保留 | 是 |
| `html/login.html` | 正式登录页 | 是，正式 URL `/html/login.html` | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `html/dashboard.html` | 正式工作台 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `html/patient-management.html` | 正式患者管理 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `html/patient-editor.html` | 正式患者编辑 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `html/agent-history.html` | 正式 Agent 执行记录 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `html/index.html` | html 目录入口跳转 | 是，可能被 `/html/` 入口使用 | 否 | 可重建 | 中 | 保留 | 是 |
| `shared/agent-widget.js` | 正式悬浮 Agent 主逻辑 | 是，所有正式页面引用 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/agent-widget-bootstrap.js` | 悬浮按钮硬兜底 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/agent-widget.css` | 正式悬浮框样式 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/runtime-config.js` | 服务地址集中配置 | 是 | 否 | 可重建但易配错 | 高 | 保留 | 是 |
| `shared/voice-input-controller.js` | 正式 ASR/麦克风控制器 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/agent-task-orchestrator.js` | 正式任务链路/计时/token/activeTask | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/patient-store.js` | demo 患者数据和 audit log 逻辑 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/patient-field-schema.js` | 字段 schema/resolver | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `shared/patient-editor-action-adapter.js` | 编辑页结构化 action adapter | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `backend/main.py` | 正式后端 API / LLM planner | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `backend/.env` | 后端运行配置 | 是，含敏感配置 | 否 | 不应重建/打印 | 高 | 保留，不审内容 | 是 |
| `backend/.env.example` | 后端配置模板 | 是，文档用途 | 否 | 可重建 | 中 | 保留 | 是 |
| `backend/pyproject.toml` | 后端项目配置 | 潜在引用 | 否 | 可重建 | 中 | 保留 | 是 |
| `asr_service/app/` | 正式 ASR 服务代码 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `asr_service/.env` | ASR 运行配置 | 是，可能含敏感配置 | 否 | 不应重建/打印 | 高 | 保留，不审内容 | 是 |
| `asr_service/.env.example` | ASR 配置模板 | 是，文档用途 | 否 | 可重建 | 中 | 保留 | 是 |
| `asr_service/requirements.txt` | ASR 依赖声明 | 是 | 否 | 可重建但易漏 | 中 | 保留 | 是 |
| `tests/e2e/his-agent.spec.ts` | 正式 Playwright E2E | 是，`package.json` 脚本使用 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `tests/e2e/playwright.config.ts` | 正式 E2E 配置 | 是 | 否 | 可从 git 恢复 | 高 | 保留 | 是 |
| `tests/e2e/README.md` | E2E 说明 | 是，协作文档 | 否 | 可重建 | 中 | 保留 | 是 |
| `tests/e2e/BROWSER_ENV.md` | 浏览器环境说明 | 是，排查用 | 否 | 可重建 | 中 | 保留 | 是 |
| `tests/agent-cases/his-agent-cases.json` | Agent 验收用例集 | 是，后续自动化依据 | 否 | 可重建但易漏 | 中 | 保留 | 是 |
| `scripts/check-encoding.mjs` | 中文/UTF-8 防回归 | 是，`npm run check:encoding` 使用 | 否 | 可重建 | 高 | 保留 | 是 |
| `scripts/serve-static-utf8.py` | UTF-8 静态服务 | 是，正式服务推荐入口 | 否 | 可重建 | 中 | 保留 | 是 |
| `package.json` | npm 脚本/依赖声明 | 是 | 否 | 可重建 | 高 | 保留 | 是 |
| `package-lock.json` | npm 锁文件 | 是 | 否 | 可重建但可能漂移 | 中 | 保留 | 是 |
| `IMPLEMENTATION_REPORT.md` | 迭代记录 | 是，审计依据 | 否 | 不易完整重建 | 高 | 保留 | 是 |
| `OLD_AGENT_MIGRATION_AUDIT.md` | 旧功能迁移记录 | 是，审计依据 | 否 | 不易完整重建 | 高 | 保留 | 是 |
| `DEAD_CODE_REVIEW.md` | 旧代码审计记录 | 是，审计依据 | 否 | 不易完整重建 | 高 | 保留 | 是 |
| `FILE_STRUCTURE_AUDIT.md` | 文件结构审计记录 | 是，审计依据 | 否 | 不易完整重建 | 高 | 保留 | 是 |
| `PROJECT_BACKLOG.md` | 待办/已知问题 | 是 | 否 | 不易完整重建 | 高 | 保留 | 是 |
| `WIDGET_UI_CODE_MAP.md` | 悬浮框 UI 映射 | 是，后续维护依据 | 否 | 可重建但易漏 | 中 | 保留 | 是 |

## B. 已归档，可观察

| 文件路径 | 原用途 | 当前是否引用 | 是否已归档 | 是否可重建 | 删除风险 | 建议 | 是否需要用户确认 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 暂无 | 当前未发现 `archive/` 下已有归档文件 | 不适用 | 否 | 不适用 | 不适用 | 先不执行归档/删除 | 是 |

## C. 低风险可删，但需确认

这些文件当前未被正式页面、正式 E2E、后端或 ASR 引用；删除前仍建议先归档观察一轮。

| 文件路径 | 原用途 | 当前是否引用 | 是否已归档 | 是否可重建 | 删除风险 | 建议 | 是否需要用户确认 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `agent-widget.css` | 根目录旧/重复悬浮框样式 | 正式页面引用 `shared/agent-widget.css`，不引用根目录副本 | 否 | 可从 `shared/agent-widget.css` 重建 | 低 | 先归档，确认无旧 URL 依赖后可删 | 是 |
| `his-agent.spec.ts` | 根目录旧 E2E 草案 | `package.json` 指向 `tests/e2e/playwright.config.ts`，不引用根目录测试 | 否 | 可从历史/git 重建 | 低 | 先归档，后续可删 | 是 |
| `playwright.config.ts` | 根目录旧 Playwright 配置 | 当前脚本不引用 | 否 | 可从 `tests/e2e/playwright.config.ts` 重建 | 低 | 先归档，后续可删 | 是 |
| `voice_client/voice_asr_client.js.bak` | 旧 ASR 客户端备份副本 | 未发现正式引用；与 `voice_client/voice_asr_client.js` hash 相同 | 否 | 可由同目录文件重建 | 低 | 先归档或直接删前确认 | 是 |
| `logs/*.log` | 运行日志 | 运行时不依赖旧日志 | 否 | 不可重建历史内容 | 低到中 | 可按日期清理；保留最近一轮日志 | 是 |
| `test-results/` | Playwright 运行产物 | E2E 运行会重新生成 | 否 | 可重建，但历史 trace/video 不可重建 | 低 | 确认不需要失败证据后可删 | 是 |
| `backend/__pycache__/` | Python 缓存 | Python 可自动重建 | 否 | 可重建 | 低 | 可删，但非必要 | 是 |
| `asr_service/app/__pycache__/` | Python 缓存 | Python 可自动重建 | 否 | 可重建 | 低 | 可删，但非必要 | 是 |

## D. 中高风险，不建议删

这些文件虽然看起来像旧文件或辅助文件，但直接删除有兼容性、外部引用、历史排查或重建成本风险。

| 文件路径 | 原用途 | 当前是否引用 | 是否已归档 | 是否可重建 | 删除风险 | 建议 | 是否需要用户确认 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `index.html` | 根路径入口/跳转 | 可能被用户直接访问根路径 `/` 或 `/index.html` | 否 | 可重建 | 中 | 保留，或后续改成明确跳转页 | 是 |
| `html/index.html` | html 目录入口/跳转 | 可能被 `/html/` 访问 | 否 | 可重建 | 中 | 保留 | 是 |
| `node_modules/` | npm 依赖 | E2E 依赖本目录 | 否 | 理论可 `npm install` 重建 | 中到高 | 不建议删，除非确认可联网重装 | 是 |
| `backend/agent_worker.py` | 旧/辅助 agent worker | 未发现正式主链路直接引用，但属于后端辅助代码 | 否 | 可重建但需确认行为 | 中 | 暂不删，先查历史用途 | 是 |
| `voice_client/voice_asr_client.js` | 旧单页面 ASR 客户端参考 | `asr_service/README.md` 仍提到；旧 ASR 迁移审计将其作为参考 | 否 | 可从 git/备份恢复 | 中 | 暂保留，等 ASR 彻底稳定后再归档 | 是 |
| `voice_client/voice_asr.css` | 旧 ASR 客户端样式 | 未发现正式引用，但与旧 ASR 客户端成套 | 否 | 可重建但需确认 | 中 | 与 `voice_client/` 一起待确认 | 是 |
| `start_lan_services.ps1` | Windows/LAN 启动脚本 | 可能供本地/历史部署使用 | 否 | 可重建 | 中 | 暂保留，需用户确认是否还用 | 是 |
| `README.md` | 项目说明 | 是，开发/交接用 | 否 | 可重建但易丢信息 | 中 | 保留 | 是 |
| `Universal Observe-Act Agent技术报告/` | 技术报告 | 文档用途，不参与运行 | 否 | 不易重建 | 中 | 保留或后续归档，暂不删 | 是 |
| `.gitignore` | Git 忽略规则 | 是，版本管理用途 | 否 | 可重建 | 中 | 保留 | 是 |

## E. 不确定

这些文件/目录没有足够证据直接判定删除安全，建议先归档或继续确认。

| 文件路径 | 原用途 | 当前是否引用 | 是否已归档 | 是否可重建 | 删除风险 | 建议 | 是否需要用户确认 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `login.html` | 根目录旧登录页 | 正式链路不引用；可被 `/login.html` 直接访问 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `dashboard.html` | 根目录旧工作台 | 正式链路不引用；可被 `/dashboard.html` 直接访问 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `patient-management.html` | 根目录旧患者管理页 | 正式链路不引用；可被 `/patient-management.html` 直接访问；文件内有旧版本号和乱码痕迹 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `patient-editor.html` | 根目录旧患者编辑页 | 正式链路不引用；可被 `/patient-editor.html` 直接访问；文件内有旧版本号和乱码痕迹 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `agent-widget.js` | 根目录旧悬浮 Agent JS | 正式链路不引用；hash 与 `shared/agent-widget.js` 不同 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `agent-widget-bootstrap.js` | 根目录旧 bootstrap | 正式链路不引用；hash 与 `shared/` 版本不同 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `runtime-config.js` | 根目录旧 runtime config | 正式链路不引用；hash 与 `shared/` 版本不同 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `voice-input-controller.js` | 根目录旧 voice controller | 正式链路不引用；hash 与 `shared/` 版本不同 | 否 | 可从 git/备份恢复 | 中 | 先归档观察，不直接删 | 是 |
| `asr_service/README.md` | ASR 服务说明 | 文档引用旧 `voice_client` | 否 | 可重建但需同步更新 | 中 | 暂保留；清理旧客户端前先更新说明 | 是 |

## 结论

### 可以删的低风险候选

需要用户明确批准后，建议先归档再删除：

- `agent-widget.css`
- `his-agent.spec.ts`
- `playwright.config.ts`
- `voice_client/voice_asr_client.js.bak`
- `logs/*.log`
- `test-results/`
- `backend/__pycache__/`
- `asr_service/app/__pycache__/`

### 不能删

- `html/`
- `shared/`
- `backend/main.py`
- `asr_service/app/`
- `tests/e2e/`
- `tests/agent-cases/`
- `scripts/`
- `AGENTS.md`
- `.agents/skills/`
- `package.json`
- `package-lock.json`
- 所有核心审计/报告/待办文档
- `.env` 文件

### 不确定，建议先归档观察

- 根目录 `login.html`
- 根目录 `dashboard.html`
- 根目录 `patient-management.html`
- 根目录 `patient-editor.html`
- 根目录 `agent-widget.js`
- 根目录 `agent-widget-bootstrap.js`
- 根目录 `runtime-config.js`
- 根目录 `voice-input-controller.js`
- `voice_client/voice_asr_client.js`
- `voice_client/voice_asr.css`
- `backend/agent_worker.py`
- `start_lan_services.ps1`
- `Universal Observe-Act Agent技术报告/`

### 推荐下一步

1. 用户确认后，先创建 `archive/root-duplicates-20260615/`，只移动低风险/不确定候选，不删除。
2. 归档后运行默认 E2E。
3. 观察一轮确认没有旧 URL 访问需求，再由用户批准删除归档内容。

本轮未执行任何删除或移动。
