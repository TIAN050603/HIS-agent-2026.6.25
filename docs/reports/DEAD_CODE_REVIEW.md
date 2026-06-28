# Dead Code Review - 2026-06-11

## Scope

This review covers the current `universal_agent` project only. Backup directories named `universal_agent_backup_*` were not modified or reviewed for deletion.

Reviewed areas:

- `html/*.html`
- `shared/agent-widget.js`
- `shared/agent-task-orchestrator.js`
- `shared/patient-store.js`
- `backend/main.py`

Search keywords used:

- `fallback`
- `localFallback`
- `local_fallback`
- `local agent`
- `本地 Agent`
- `本地规则`
- `keyword`
- `regex`
- `parseCommand`
- `parseLocal`
- `simpleCommand`
- `next-action`
- `handleLocal`
- `executeLocal`
- `mock agent`
- `safe fallback`
- `rule-based`
- `includes(`

## Confirmed Removed

### `backend/main.py` old observe-act next-action implementation

Removed code:

- `infer_page_intent`
- `is_login_submit_intent`
- `is_login_page_state`
- `build_login_submit_action`
- `build_next_action_prompt`
- `call_qwen_for_next_action`
- `compact_next_action_page_state`
- `compact_next_action_history`
- unreachable implementation body under `/api/universal-agent/next-action`

Reason:

These functions belonged to the old single-step observe-act path. They included local keyword or page-shape intent inference for login-like tasks and are no longer part of the product architecture. Current Agent execution must go through the LLM task planner and then the local allowlist executor.

Verification:

- `python -m py_compile work\harness-refactor\backend\main.py`
- `rg` confirms removed function names no longer exist in `backend/main.py`.

### `html/patient-editor.html` local rule Agent path

Already removed in the previous hardening round and rechecked in this round:

- `parseAgentCommand`
- `applyAgentPlan`
- old `/api/universal-agent/next-action` observe-act frontend loop

Reason:

The embedded page Agent must not parse natural language locally. It now delegates to `AgentTaskOrchestrator`, which requires LLM availability and backend LLM source metadata before action execution.

Verification:

- `rg` confirms the old frontend function names are absent.

## Kept Intentionally

### `shared/agent-task-orchestrator.js`

Kept:

- task state management
- `blocked_no_llm`
- LLM connectivity checks
- pageState collection
- allowlist action executor
- patient matching helpers
- action normalization
- audit metadata creation

Reason:

This module is not a local fallback planner. It is the required local allowlist executor and task-state layer for actions returned by the backend LLM planner. It must remain.

### `shared/agent-widget.js`

Kept:

- floating widget UI
- no-LLM status rendering
- task summary display
- voice / visit-session UI
- cancellation and session controls
- recovery launcher

Reason:

The floating Agent must remain visible even when LLM is unavailable. The widget displays state and accepts user input, but page actions are blocked unless LLM is connected.

### `shared/patient-store.js`

Kept:

- patient data store
- manual page update support
- audit log
- rollback for recorded Agent edits

Reason:

Manual page operations must keep working without LLM. Agent edits, when allowed, must write audit metadata.

### `backend/main.py` `/api/universal-agent/next-action` route

Kept as safe stub:

- `/api/universal-agent/next-action`
- `UniversalNextActionRequest`

Reason:

The endpoint may still be hit by an old browser page or an external test. It now returns HTTP `410` with a deprecated message and never executes actions. This is safer than deleting the route without knowing all external callers.

## Suspected But Not Deleted

### `html/patient-editor.html` action application helpers

Examples:

- `applyUniversalActionToCurrentPage`
- `normalizeAgentFieldKey`
- `normalizeAgentValue`
- field option matching helpers using `includes`

Reason not deleted:

These functions are still used by `window.applyHisAgentAction`, which is the page-level executor called by `AgentTaskOrchestrator` after backend LLM planning and allowlist validation. They do not independently parse user natural language from the floating widget.

### `shared/agent-task-orchestrator.js` patient matching helpers

Examples:

- `resolvePatient`
- patient name / id matching using `includes`

Reason not deleted:

These helpers resolve LLM-provided task slots against local demo patient data. They are executor support logic, not a no-LLM natural-language planner.

### `html/patient-management.html` table search

Example:

- `String(value || "").toLowerCase().includes(query)`

Reason not deleted:

This is manual page search/filter behavior, not Agent execution.

### `shared/patient-store.js` search helpers

Reason not deleted:

These support manual page and executor data lookup. They are not a local fallback planner.

## Core Modules Explicitly Preserved

- Local allowlist executor
- action schema / allowlist validation
- pageState collection
- `AgentWidget`
- `AgentTaskOrchestrator`
- patient-store
- audit log
- ASR transcription and visit-session UI
- doctor/patient label correction UI
- connection status center
- manual page buttons, forms, routes, and save logic
- backend Qwen / LLM endpoints
- `/api/qwen/test`

## Validation Results

Passed:

- `node --check work\harness-refactor\shared\agent-widget.js`
- `node --check work\harness-refactor\shared\agent-task-orchestrator.js`
- `python -m py_compile work\harness-refactor\backend\main.py`

Pending / manual:

- Browser visual verification of all four pages. The in-app browser automation was blocked by the local desktop sandbox in this run, so final visual confirmation should use the live URL with cache-busting query string.

## Follow-Up Suggestions

- If no external caller needs `/api/universal-agent/next-action`, delete the 410 stub in a later cleanup round.
- Add a small browser-based smoke test in the project for the four HTML pages once a stable browser automation environment is available.
## 2026-06-11 问诊病历修订与语音入口统一

- `voice_client/voice_asr_client.js`：本轮不再由 `html/patient-editor.html` 直接加载，正式语音入口改为 `shared/voice-input-controller.js`。该旧文件可能仍可作为历史 ASR 客户端参考，暂不删除。
- 旧编辑页内的 Agent 测试任务区：正式页面已移除常驻 UI；“检查后端连接”和五个示例任务已迁移到 `shared/agent-widget.js` 悬浮 Agent。旧页面级发送任务控件未保留为正式入口。
- 开发者调试面板：`html/patient-editor.html` 仅保留后端地址、ASR 地址和统一语音调试按钮，默认关闭。若后续确认不再需要页面级调试入口，可再清理。
- 本轮没有重新启用本地关键词 fallback；不确定用途的旧 ASR 客户端代码未删除。
