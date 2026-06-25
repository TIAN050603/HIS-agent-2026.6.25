# ROOT_CLEANUP_REPORT

日期：2026-06-15

本轮目标：整理 `/huaiwenpang/universal_agent` 根目录，归档旧副本和运行产物。未删除业务源码，未修改业务逻辑、UI、Agent、ASR，未修改 `universal_agent_backup_*`。

## 1. 根目录保留

当前根目录保留：

- `.agents/`
- `.git/`
- `archive/`
- `asr_service/`
- `backend/`
- `html/`
- `logs/`
- `node_modules/`
- `scripts/`
- `shared/`
- `tests/`
- `.gitignore`
- `AGENTS.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `index.html`
- `DEAD_CODE_REVIEW.md`
- `DELETE_CANDIDATES_REVIEW.md`
- `FILE_STRUCTURE_AUDIT.md`
- `IMPLEMENTATION_REPORT.md`
- `OLD_AGENT_MIGRATION_AUDIT.md`
- `PROJECT_BACKLOG.md`
- `WIDGET_UI_CODE_MAP.md`

## 2. 归档内容

### `archive/root-duplicates-20260615/`

根目录旧副本，正式链路不引用：

- `login.html`
- `dashboard.html`
- `patient-management.html`
- `patient-editor.html`
- `agent-widget.js`
- `agent-widget-bootstrap.js`
- `agent-widget.css`
- `runtime-config.js`
- `voice-input-controller.js`
- `his-agent.spec.ts`
- `playwright.config.ts`

### `archive/legacy-voice-client-20260615/`

旧单页面 ASR 客户端参考代码：

- `voice_client/`

### `archive/reports-20260615/`

历史技术报告：

- `Universal Observe-Act Agent技术报告/`

### `archive/legacy-start-scripts-20260615/`

旧本地/LAN 启动脚本：

- `start_lan_services.ps1`

### `archive/run-artifacts-20260615/`

运行产物：

- 旧日志文件
- 旧 `test-results/`
- 本轮 E2E 后新生成的 `test-results/`
- `backend/__pycache__/`
- `asr_service/app/__pycache__/`

说明：`logs/` 目录仍保留当前服务正在写入的三份运行日志：

- `frontend-5500.log`
- `backend-8000.log`
- `asr-8010.log`

## 3. 验证

- 服务检查通过：
  - `http://127.0.0.1:5500/html/login.html` 返回 200
  - `http://127.0.0.1:8000/api/health` 返回 200
  - `http://127.0.0.1:8010/health` 返回 200
- `npm run check:encoding` 通过。
- 默认 E2E 通过：
  - `HIS_BASE_URL=http://10.26.6.8:31300 npm run test:e2e -- --reporter=list`
  - 29 passed / 3 skipped / 0 failed

## 4. 后续建议

先观察一轮。如果确认没有任何旧 URL 或旧脚本依赖，再由用户明确批准删除 `archive/root-duplicates-20260615/` 和部分运行产物归档。
