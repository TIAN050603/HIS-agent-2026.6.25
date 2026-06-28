# 旧网页 Agent 到悬浮 Agent 迁移审计

## 2026-06-22 更新

本轮已迁移/补齐旧网页 Agent 中与医生复盘相关的一部分能力：

- `html/agent-history.html` 现在展示任务总耗时、总 token、prompt/completion token、每步耗时、每步 token、步骤 old/new 值和 audit_id。
- `shared/agent-task-orchestrator.js` 在 activeTask/history 中保留步骤 result、usage、audit、source、slots 等必要审计字段。
- `agent-history.html` 将医生需要看的任务摘要、步骤和 Audit Log 前置展示；raw/debug JSON 继续放在“开发者详情”并默认折叠。
- 该迁移不恢复旧 `/next-action` observe-act 流程，不恢复本地规则 fallback，也不改变 allowlist executor。

仍未迁移或不计划恢复：

- 旧本地自然语言规则 Agent。
- 旧单页 `index.html` 中的常驻测试卡片布局。
- 旧 ASR “直接覆盖任务输入框并立即发送”的形态。

## 1. 审计目的

本轮只做审计，不实现新功能、不删除代码、不重构逻辑。目标是确认旧单页 `index.html` 内嵌 Agent 对话框 / Agent 测试区曾经承担过哪些 UI 入口、任务流程、接口契约、计时、token usage、进度推送、ASR、debug 和本地 fallback 逻辑，并与当前全站悬浮 Agent 对比，列出没有迁移或迁移不完整的部分。

结论先行：

- 旧网页 Agent 的核心能力包括：页面内任务输入、Universal Observe-Act 多轮 `/api/universal-agent/next-action` 循环、每轮 `elapsedMs` 计时、每轮 token usage 累计展示、每轮 action/thought 日志、旧 pageState、旧 action executor、旧本地规则 Agent、旧 ASR 转任务输入框、保存结果预览、后端地址/ASR 地址/模式选择等 debug 功能。
- 当前悬浮 Agent 已迁移：全站入口、任务输入、发送任务、清空/新会话、取消任务、示例任务填入、检查后端/Qwen/ASR、服务地址、语音入口、任务摘要、当前步骤/完成数/失败原因、LLM gate、后端 LLM planner、allowlist executor、跨页面 activeTask、患者数据审计/回滚。
- 当前悬浮 Agent 未完整迁移：旧的每轮进度聊天推送、每步耗时显示、总耗时显示、token usage 当前/累计显示、prompt/completion/total tokens UI、raw response UI、完整 action log、旧保存结果预览入口、旧 pageState 的部分字段形态、旧 `/next-action` 单步 observe-act 接口调用方式、旧 ASR “转写直接填入任务框然后手动发送”的形态。

## 2. 审计范围

已检查当前项目：

- `html/login.html`
- `html/dashboard.html`
- `html/patient-management.html`
- `html/patient-editor.html`
- `shared/agent-widget.js`
- `shared/agent-widget-bootstrap.js`
- `shared/agent-task-orchestrator.js`
- `shared/voice-input-controller.js`
- `shared/patient-store.js`
- `shared/patient-field-schema.js`
- `backend/main.py`
- `asr_service/app/main.py`
- `asr_service/app/websocket.py`
- `voice_client/voice_asr_client.js`，远端当前项目中存在，本地镜像中未包含
- `README.md`
- `IMPLEMENTATION_REPORT.md`
- `DEAD_CODE_REVIEW.md`

已只读检查备份目录：

- `/huaiwenpang/universal_agent_backup_20260610_033528/index.html`
- `/huaiwenpang/universal_agent_backup_20260610_033528/backend/main.py`
- `/huaiwenpang/universal_agent_backup_20260610_033528/backend/agent_worker.py`
- `/huaiwenpang/universal_agent_backup_20260610_033528/voice_client/voice_asr_client.js`
- `/huaiwenpang/universal_agent_backup_20260610_033528/asr_service/app/main.py`
- `/huaiwenpang/universal_agent_backup_20260610_033528/asr_service/app/websocket.py`
- `/huaiwenpang/universal_agent_backup_20260610_033528/README.md`

未修改任何 `universal_agent_backup_*` 目录。

Git 历史：尝试只读执行 `git log --oneline -5` 和 `git status --short`，但当前项目和备份项目都被 Git 的 `dubious ownership` 保护阻止。为了遵守“不改全局配置”的约束，本轮没有执行 `git config --global --add safe.directory ...`，因此 git 历史未确认。

## 3. 检查过的目录和文件

搜索方式：

- 当前本地镜像使用 `rg` 搜索 Agent、observe、next-action、task、progress、step、token、usage、elapsed、duration、timer、startTime、endTime、trace、status、activeTask、pageState、applyAction、voice、asr、fallback、parseCommand、simpleCommand 等关键词。
- 远端备份没有 `rg`，使用 `grep -RInE` 做等价只读搜索。
- 搜索时排除了 `.env`、`.git`、`.venv`，没有打印密钥或环境变量内容。

关键证据位置：

- 旧 UI 入口：备份 `index.html:724-848`
- 旧事件绑定：备份 `index.html:1299-1343`
- 旧任务执行主入口：备份 `index.html:1599-1636`
- 旧 observe-act 循环：备份 `index.html:1636-1745`
- 旧 pageState：备份 `index.html:1775-1819`
- 旧 action executor：备份 `index.html:1909-1975`
- 旧 token/计时格式化：备份 `index.html:2001-2040`
- 旧等待计时器：备份 `index.html:2172-2215`
- 旧本地规则 Agent：备份 `index.html:2217-2561`
- 旧 ASR 客户端：备份 `voice_client/voice_asr_client.js:19-233`
- 旧后端 `/next-action`：备份 `backend/main.py:219-225`、`backend/main.py:1146-1225`
- 当前悬浮框 UI：`shared/agent-widget.js:190-258`
- 当前示例任务和检查连接：`shared/agent-widget.js:390-430`
- 当前发送任务与 LLM gate：`shared/agent-widget.js:659-704`
- 当前任务摘要：`shared/agent-widget.js:533-561`
- 当前任务生命周期：`shared/agent-task-orchestrator.js:61-100`、`123-204`、`477-626`
- 当前后端 task harness：`backend/main.py:1606-1654`
- 当前旧 `/next-action` stub：`backend/main.py:1592-1603`
- 当前 pageState：`html/patient-management.html:178-187`、`html/patient-editor.html:407-415`

## 4. 旧网页 Agent 原始入口

| 入口 | 旧文件路径 | DOM id / class / data-testid | 旧绑定函数 | 旧接口 | 当前页面是否还在 | 悬浮框是否已迁移 | 缺失说明 |
|---|---|---|---|---|---|---|---|
| Agent 测试任务区 | 备份 `index.html:724-751` | `.task-list`, `.task-card`, `data-testid=task-card-*` | 静态展示，无直接执行绑定 | 无 | 正式当前页不再常驻 | 部分迁移为悬浮框示例任务 | 旧任务卡片的“测试区”布局未迁移，只迁移示例文本 |
| 自定义任务对话区 | 备份 `index.html:753-765` | `#customAgentSection`, `#agentChatHistory`, `data-testid=agent-chat-history` | `appendChatMessage` | 通过发送任务间接调用 | 正式当前页不再常驻 | 已迁移为 `#hisAgentHistory` | 悬浮框没有旧 data-testid，也不显示同样的 thought/token 格式 |
| 任务输入框 | 备份 `index.html:790-797` | `#agentCommandInput` | `executeAgentCommand` | `/api/universal-agent/next-action` 或本地规则 | 正式当前页不再常驻 | 已迁移为 `#hisAgentInput` | 旧 ASR 会直接写入旧输入框；新语音保存在 turns，可发送会话任务 |
| 发送任务按钮 | 备份 `index.html:819-820`, `1309-1314` | `#sendAgentCommandButton` | `executeAgentCommand` | `/api/universal-agent/next-action` | 不在正式页 | 已迁移为 `#hisAgentSendButton` | 新版先检查 LLM，再走 task harness；不再走旧 observe-act |
| 语音输入按钮 | 备份 `index.html:819`, `voice_asr_client.js:19-46` | `#voiceInputButton` | `initVoiceAsrClient`, `startRecording`, `stopRecording` | ASR `/ws` | 旧入口不在正式页；远端旧客户端文件仍存在 | 已部分迁移为悬浮框 `#hisAgentVoiceButton` 和统一 controller | 新版不再把语音转写直接覆盖任务输入框；改为就诊会话 turns |
| 清空对话按钮 | 备份 `index.html:821`, `1316-1318` | `#clearAgentChatButton` | 直接清空 `agentChatHistory.innerHTML` | 无 | 不在正式页 | 部分迁移为“新会话” | 新版 `新会话` 清空消息/turns/session，但不是同名清空按钮 |
| 填入示例任务按钮 | 备份 `index.html:822`, `1319-1322` | `#fillExampleTaskButton` | 直接填入固定 P004 任务 | 无 | 不在正式页 | 已迁移为示例任务按钮 | 旧单独“填入示例任务”按钮未保留 |
| 五个示例任务按钮 | 备份 `index.html:824-829`, `1323-1327` | `.agent-example-button`, `data-example` | 点击填入旧输入框 | 无 | 不在正式页 | 已迁移到 `#hisAgentExampleTasks` | 示例文本已更新为当前临床字段场景，旧测试卡样式未迁移 |
| Agent 模式选择 | 备份 `index.html:769-773` | `#agentModeSelect` | `executeAgentCommand` 分支 | local 或 universal | 不在正式页 | 未迁移为用户入口 | 当前产品明确不应迁移本地规则模式；如保留只应进开发者面板 |
| 后端地址输入框 | 备份 `index.html:776-784` | `#backendUrlInput` | `getBackendUrl` | 所有 Agent 后端接口 | 不在正式页 | 已迁移到 `#hisAgentBackendUrl` | 已迁移，但属于开发者设置，不应对普通医生突出 |
| 检查后端连接 | 备份 `index.html:787`, `1754-1768` | `#checkBackendButton` | `checkBackend` | `GET /api/health` | 不在正式页 | 已迁移为 `#hisAgentCheckConnectionButton` | 新版额外检查 `/api/qwen/test` 和 ASR `/health` |
| ASR 服务地址输入框 | 备份 `index.html:801-809` | `#asrServiceUrlInput` | `startRecording(urlInput.value)` | ASR `/ws` | 旧入口不在正式页 | 已迁移到 `#hisAgentAsrUrl`，编辑页 dev panel 也有 `#debugAsrUrl` | 旧 `voice_client` 仍存在但不作为正式入口加载 |
| ASR 结果显示区 | 备份 `index.html:814-815`, `voice_asr_client.js:134-152` | `#asrStatusText`, `#asrTranscriptText` | `handleAsrMessage` | ASR `/ws` | 不在正式页 | 部分迁移为就诊会话 turns | 新版显示 turns，不展示旧 `raw:` 转写文本格式 |
| 当前保存结果预览 | 备份 `index.html:837-843` | `#jsonPreview` | `buildSavedSummary`, `read_preview` | 旧 action `read_preview` | 当前临床编辑页没有同等预览块 | 未完整迁移 | 当前有 `saveStatus`、audit log、patient-store，但没有“自然语言保存结果预览” |
| 任务进度显示区 | 备份中通过 `agentChatHistory` 每轮追加 | `#agentChatHistory` | `formatObserveActStep`, `formatFinishedSummary` | `/next-action` | 不在正式页 | 部分迁移为 `#hisAgentTask` | 新版显示 plan 和状态，但不逐轮追加 thought/token/elapsed |
| token 显示区 | 备份中写在每条 chat message | 无独立 DOM | `addUsage`, `formatUsageForDisplay` | 后端 `usage` | 不在正式页 | 未迁移到悬浮框 UI | 后端仍返回 usage，新前端不展示 |
| 计时显示区 | 备份中写在每条 chat message | 无独立 DOM | `performance.now`, `formatLocalElapsedTime` | 前端传 `elapsedMs`，后端回 `elapsedTime` | 不在正式页 | 未迁移到悬浮框 UI | 当前 task 有时间戳但不显示耗时 |

## 5. 旧任务执行流程

旧流程：

1. 用户在 `#agentCommandInput` 输入任务，点击 `#sendAgentCommandButton`。
2. 旧 ASR 如正在录音，先调用 `window.stopVoiceAsrRecording()` 停止录音。
3. `executeAgentCommand(commandText)` 追加用户消息。
4. 如果 `#agentModeSelect` 为 `universal`，进入 `runUniversalObserveActAgent(command)`。
5. 旧代码用 `performance.now()` 记录 `startedAt`，初始化 `totalUsage`。
6. 先追加一条“开始处理任务 / 计时结果 00:00 / 等待 Qwen 返回 token usage”。
7. 进入最多 20 轮的 for 循环。
8. 每轮计算 `elapsedMs`，调用 `collectAgentPageState()`。
9. POST 到旧接口 `/api/universal-agent/next-action`，payload 包含 `command, stepIndex, maxSteps, elapsedMs, pageState, history.slice(-2)`。
10. 后端返回一个 action、`usage`、`elapsedTime`、`rawResponse` 等。
11. 前端校验 `data.llmUsed === true` 且有 `data.usage`，否则停止并显示错误。
12. `addUsage(totalUsage, data.usage)` 累计 token。
13. `formatObserveActStep()` 追加每轮 thought、计时、token 消耗。
14. `applyUniversalActionToCurrentPage(action)` 执行动作。
15. 把 action/result 写入本地 `history`，用于下一轮去重和上下文。
16. 如果 action 失败，显示失败原因、计时和 token，停止。
17. 如果 action 为 `finish` 或保存后页面出现成功/错误提示，调用 `formatFinishedSummary()` 显示总轮次、总耗时、总 token。
18. 如果 `ask_user` 或 `error`，显示最终提示后停止。
19. 否则 `waitForAgentStep(120)` 后进入下一轮 observe-act。
20. 如果达到最大步数，显示达到最大执行步数、token 累计、失败提示。

当前悬浮框的新流程：

1. 用户在 `#hisAgentInput` 输入任务，点击 `#hisAgentSendButton`。
2. `handleCommand()` 调用 `/api/qwen/test` 检查 LLM。
3. LLM 不可用时只显示系统提示，不执行动作。
4. LLM 可用时调用 `AgentTaskOrchestrator.startTask()`。
5. `startTask()` 收集 `pageState, active_task, conversation_history, patient_store_summary, speaker_turns, audit_log_summary, connection_status`。
6. POST 到 `/api/universal-agent/task-plan`，由后端 LLM 一次生成 task plan。
7. 前端将 task 标记为 `backend_llm` 来源，写入 `localStorage.hisAgentActiveTask`。
8. `runTaskLoop()` 在本地按 plan step 执行 allowlist action。
9. 跳转后通过 `resumeStoredTask()` 继续。
10. 执行失败时调用 `/api/universal-agent/task-repair` 请求 LLM 修复或追问。
11. 完成后写入 `hisAgentTaskHistory` 并清空 active task。

差异：

- 旧版是“每轮后端返回一个 next action”；新版是“后端先给 task plan，前端本地按 plan 执行，失败时 repair”。
- 旧版每轮都向用户聊天区推送 thought、elapsed、token；新版只展示任务摘要和最终/错误消息。
- 旧版 `history` 是本次任务内存数组；新版 `activeTask` 持久化在 localStorage，支持跨页面继续，但也带来 stale task/卡死风险。
- 旧版执行器直接在单页 DOM 上执行；新版执行器分为全局 allowlist 和各页面 `window.applyHisAgentAction`。

## 6. 旧进度推送逻辑

旧实现文件：

- 备份 `index.html:1636-1745`
- 备份 `index.html:2007-2040`

旧数据结构：

- `history`: 每轮记录 `{ step, type, field, value, signature, result, message }`
- 后端响应 `data.action`, `data.usage`, `data.elapsedTime`
- `totalUsage`: `{ prompt_tokens, completion_tokens, total_tokens }`

旧 UI 展示方式：

- 每轮调用 `appendChatMessage("agent", formatObserveActStep(...), "agent")`。
- 每轮显示“第 N 轮”“thought”“计时结果”“token 消耗量”。
- 失败时显示 action 失败原因。
- 完成时显示“输出结束”“任务总结”“总轮次”“总耗时”“总 token 消耗”。

是否包含指定能力：

- 当前步骤：旧版以“第 N 轮”展示，后端 action 的 thought 表示当前决策。
- 已完成步骤：旧版通过聊天日志历史隐式展示，每轮日志保留。
- 失败原因：旧版明确追加失败原因。
- 任务完成：旧版 `formatFinishedSummary()` 明确显示。
- streaming/SSE/WebSocket：旧 Agent 任务本身没有发现 SSE/EventSource/WebSocket 流式进度；ASR 使用 WebSocket，但任务进度是前端 for 循环轮询式 POST。
- polling：旧版没有 setInterval 轮询后端任务状态；是前端循环顺序调用 `/next-action`。

当前悬浮框保留情况：

- 已保留：任务状态、当前步骤、完成步数、失败提示、plan 列表。
- 部分保留：每步状态以 `#hisAgentTask` 文本显示，不再每轮追加聊天日志。
- 未保留：每步 thought、每步 token、每步 elapsed、总耗时、总 token、raw response 展示、每轮 action/result 详细日志。

## 7. 旧计时逻辑

旧功能存在。

旧位置：

- `runUniversalObserveActAgent()` 使用 `const startedAt = performance.now()`，备份 `index.html:1636-1640`。
- 每轮用 `performance.now() - startedAt` 生成 `elapsedMs`，备份 `index.html:1654-1667`。
- 后端 `UniversalNextActionRequest.elapsedMs` 接收该值，备份 `backend/main.py:219-225`。
- 后端 `format_elapsed_time(elapsed_ms)` 转成 `MM:SS`，备份 `backend/main.py:245-250`。
- 前端 `formatObserveActStep()` 显示 `data.elapsedTime`，备份 `index.html:2007-2013`。
- 完成时 `formatFinishedSummary()` 显示“总耗时”，备份 `index.html:2032-2039`。
- 另有 `startBackendAgentElapsedTimer()` 每 10 秒显示等待后端返回 token usage，备份 `index.html:2172-2184`。这段更像旧后端长任务计时工具，当前未确认仍有入口调用。

旧功能从点击发送后、进入 Universal Observe-Act 前开始计时。

当前保留情况：

- 当前 orchestrator 有 `created_at`、`updated_at`、`finished_at`，但用于生命周期和 TTL，不等同于用户可见耗时。
- 当前 `#hisAgentTask` 不显示任务开始时间、每步耗时、总耗时。
- 当前后端 task harness 不要求前端传 `elapsedMs`。

结论：旧“从发送指令开始计时、每步/完成时显示耗时”没有完整迁移到悬浮框。旧逻辑可以从备份 `index.html` 找到。

## 8. 旧 token usage 逻辑

旧功能存在。

旧位置：

- 前端初始化并累计 `totalUsage`：备份 `index.html:1641-1645`。
- 每轮要求 `data.usage` 存在，否则视为异常：备份 `index.html:1680-1687`。
- `addUsage()` 累计 `prompt_tokens, completion_tokens, total_tokens`：备份 `index.html:2001-2005`。
- `formatUsageForDisplay()` 展示 current/total：备份 `index.html:2024-2030`。
- `formatFinishedSummary()` 展示总 token：备份 `index.html:2032-2039`。
- 旧后端 `/next-action` 返回 `usage` 和默认字段：备份 `backend/main.py:1210-1225`。

token usage 来源：

- 不是前端估算。
- 来源是后端调用 Qwen 后读取响应里的 `usage`。
- 字段名为 `prompt_tokens`, `completion_tokens`, `total_tokens`。

当前保留情况：

- 当前后端 `/api/universal-agent/task-plan`、`task-next-step`、`task-repair` 都返回 `usage`，见 `backend/main.py:1618`、`1636`、`1654`。
- 当前 `callBackend()` 会把完整 raw data 暂存在返回值里，但 `persistTrace()` 只保存 `trace` 和 parsed `response`，不保存或展示 `usage/rawResponse`。
- 当前悬浮框 UI 不显示 current usage、total usage、prompt tokens、completion tokens、total tokens。

结论：token usage 后端返回能力仍在，但悬浮框 UI 和任务摘要没有迁移展示。若恢复，需要修改：

- `backend/main.py`：确认 task-plan/repair 的 `usage` 稳定进入响应。
- `shared/agent-task-orchestrator.js`：保存每次后端调用的 `usage`，累计到 active task / history。
- `shared/agent-widget.js`：在 `renderTaskSummary()` 或独立 debug 面板展示 current/total token。

## 9. 旧后端接口契约

| 接口 | 方法 | 旧 payload | 旧响应 | action | progress | token usage | elapsed | trace/raw | 当前状态 | 悬浮框是否调用 | 建议 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/health` | GET | 无 | `{ok,message}` | 否 | 否 | 否 | 否 | 否 | 仍存在 | 是，检查连接 | 保留 |
| `/api/qwen/test` | GET | 无 | Qwen 可用状态 | 否 | 否 | 间接无 | 否 | 错误信息 | 仍存在 | 是，LLM gate 和检查连接 | 保留 |
| `/api/universal-agent/next-action` | POST | `{command,stepIndex,maxSteps,elapsedMs,pageState,history}` | `{ok,mode,llmUsed,usage,elapsedTime,action,rawResponse}` | 是，单个 action | 由前端循环形成 | 是 | 是 | 是 | 当前返回 410 deprecated stub | 否 | 保留 stub 或按外部调用确认后删除 |
| `/api/universal-agent/plan` | POST | `{command,targetUrl,elapsedMs}` | `{ok,plan,usage,rawResponse}` | 返回 plan | 否 | 是 | payload 有 elapsedMs | 是 | 仍存在兼容路径 | 当前悬浮框不调用 | 可放兼容或后续清理 |
| `/api/universal-agent/run` | POST | 同 `AgentRunRequest` | 同旧 plan | 返回 plan | 否 | 是 | payload 有 elapsedMs | 是 | 仍存在兼容路径 | 当前悬浮框不调用 | 可放兼容或后续清理 |
| `/api/universal-agent/task-plan` | POST | `{user_message,page_state,active_task,conversation_history,patient_store_summary,speaker_turns,audit_log_summary,connection_status}` | `{ok,mode,llmUsed,usage,response,rawResponse,trace}` | 返回 task plan | 不是逐步 progress | 是但 UI 未展示 | 否 | 是 | 现行主接口 | 是 | 必须保留 |
| `/api/universal-agent/task-next-step` | POST | `NextStepRequest` | `{ok,usage,response,rawResponse,trace}` | 返回下一步 action/clarification | 可用于未来逐步 | 是但 UI 未展示 | 否 | 是 | 存在 | 当前未发现悬浮框调用 | 不确定，需确认是否作为后续迁移旧进度的接口 |
| `/api/universal-agent/task-repair` | POST | `{active_task,page_state,failed_action,action_result,...}` | `{ok,usage,response,rawResponse,trace}` | 返回 corrected_action/clarification/finish | 修复失败步骤 | 是但 UI 未展示 | 否 | 是 | 现行修复接口 | 是 | 保留 |
| ASR `/health` | GET | 无 | ASR 状态 | 否 | 否 | 否 | 否 | 否 | 仍存在 | 是，检查连接 | 保留 |
| ASR `/ws` | WebSocket | PCM audio / `{type:end}` | `{type,rawText,normalizedText,turns,...}` | 否 | ASR 转写流 | 否 | 否 | rawText | 仍存在 | 是，通过统一语音 controller | 保留 |

旧 `/api/agent`、`/api/agent/act`、`/api/agent/chat`：本轮搜索当前和备份代码未确认这些路径存在。

## 10. 旧 action schema 与 executor

| action | 旧 payload 结构 | 旧执行函数 | 支持页面元素 | validation | 当前 executor 支持 | 迁移判断 |
|---|---|---|---|---|---|---|
| `select_patient` | `value` 或 `target.value/patientId` | `applyUniversalActionToCurrentPage` | `#patientSelect` | 检查 option 是否存在 | 支持为 `select_patient` / `open_patient_editor` | 已迁移但页面结构变为列表/编辑页 |
| `set_field` | `{target:{field/selector}, value}` | `updateFormField` | 文本字段 | 字段映射、事件派发 | 当前改为 `update_patient_field(s)` | 部分迁移，旧 action 名不直接支持 |
| `set_select` | 同上 | `updateFormField` | select 字段 | option 范围校验 | 当前内部会将部分字段转成 `set_select` 再交页面；正式 allowlist 不含旧名 | 部分迁移 |
| `set_radio` | 同上 | `updateFormField` | visitType radio | option 存在校验 | 当前改为字段更新，不保留 radio 形态 | 部分迁移 |
| `set_checkbox` | 同上 | `updateFormField` | hasAllergy checkbox | 布尔归一 | 当前新 clinical schema 没有同名字段主路径 | 不确定，需用户决定是否保留旧过敏史 checkbox 语义 |
| `click_button` | `{target:{field/selector/label}}` | `applyUniversalActionToCurrentPage` | `#saveButton` 等按钮 | selector/button 是否存在 | 当前改为 `save_patient` / 页面 handler | 部分迁移 |
| `read_preview` | 无或 target | `applyUniversalActionToCurrentPage` | `#jsonPreview` | 预览是否有文本 | 当前没有等价入口 | 未迁移 |
| `finish` | `{value,reason}` | `applyUniversalActionToCurrentPage` | 无 DOM | 直接完成 | 当前 `finish_task` | 已迁移但 schema 名不同 |
| `ask_user` | `{value,reason}` | `applyUniversalActionToCurrentPage` | 无 DOM | 直接提示 | 当前 `ask_clarification` | 已迁移但 waiting_user 生命周期更明确 |
| `error` | `{value,reason}` | `applyUniversalActionToCurrentPage` | 无 DOM | 直接提示 | 当前失败/repair 流程 | 部分迁移 |
| 本地规则 plan | `{patient,updates,shouldSave}` | `applyAgentPlan` | 单页表单 | 本地 regex/alias | 当前明确禁用自然语言本地 fallback | 应废弃，不迁移 |

当前 allowlist：`fill_input`, `fill_login_form`, `submit_login`, `logout`, `open_page`, `navigate_internal`, `find_patient`, `select_patient`, `open_patient_editor`, `update_patient_field`, `update_patient_fields`, `verify_patient_field`, `verify_patient_store`, `save_patient`, `create_structured_draft`, `write_clinical_note_field`, `ask_clarification`, `finish_task`, `cancel_task`, `noop`。

## 11. 旧 pageState 逻辑

旧 pageState 函数：`collectAgentPageState()`，备份 `index.html:1775-1819`。

旧收集内容：

- `selectedPatient.value/text`
- `selectedPatient.note`
- `currentFormValues`
- `patientOptions`: select option 文本数组
- `fields`: `name, gender, age, birthDate, phone, idType, idNumber, address, emergencyContact, emergencyPhone, department, visitType, insuranceType, hasAllergy, allergyNote, medicalHistory, symptoms, remark`
- 每个字段包含当前 value，select/radio 包含 options
- `messages.errors/success`

当前 pageState：

- 患者管理页：`pageType, url, patientListSummary, fieldSchema`，其中 `patientListSummary` 当前包含 `patientId, name, phone, department, chiefComplaint`。
- 患者编辑页：`pageType, patientId, patient, draft, fieldSchema, auditLog`。
- 全局 orchestrator 另外传 `patient_store_summary`，但只包含 `patientId, name, gender, birthDate, phone, department, address`。

迁移差异：

- 旧版按 DOM 字段快照和 option 列表组织，更适合单页表单观察。
- 新版按页面类型、患者数据、field schema、audit log 组织，更适合多页面 task harness。
- 旧 `patientOptions` 是完整下拉选项文本；新 `patientListSummary` 受当前过滤和字段选择影响。
- 新 `patient_store_summary` 不含 `chiefComplaint`、`presentIllness` 等临床字段，也不含旧 `symptoms/medicalHistory/allergyNote` 名称。

与“张伟识别失败”的可能关系：

- 旧版直接从 `patientOptions` 和当前 select 中提供 P001 张伟；新版本如果当前页面不在患者管理或 `patientListSummary` 被过滤，LLM/执行器可能只能依赖 `patient_store_summary`。
- 当前 `resolvePatient()` 支持 patientId、姓名精确/包含匹配，但 `patient_store_summary` 字段较少；如果 LLM planner 没生成标准 `patientSelector`，可能导致匹配缺口。
- 本轮只分析，不修复。

## 12. 旧 ASR / 语音输入逻辑

旧入口：

- 旧 HTML：`#voiceInputButton`, `#asrServiceUrlInput`, `#asrStatusText`, `#asrTranscriptText`, `#clearVoiceTextButton`
- 旧 JS：`voice_client/voice_asr_client.js`

旧流程：

1. `initVoiceAsrClient()` 查找旧 DOM。
2. 点击 `#voiceInputButton` 后连接 ASR WebSocket。
3. 获取麦克风并下采样到 16k。
4. ASR 返回 partial/final 后写入 `#asrTranscriptText`。
5. 同时把转写文本写入 `#agentCommandInput`。
6. 用户说完后手动点击“发送任务”；发送前会自动停止录音。
7. `clearVoiceTextButton` 清空 transcript 和任务输入框。
8. 错误通过 ASR 状态区和 Agent 消息展示。

当前迁移：

- 新增统一 `shared/voice-input-controller.js`。
- 悬浮框语音入口 `#hisAgentVoiceButton` 调用统一 controller。
- 编辑页开发者调试按钮也调用统一 controller。
- 当前 ASR 结果进入 `speakerTurns` / “就诊会话”，可通过“发送给 Agent”“生成结构化草稿”“写入病历字段”等按钮交给 LLM。

未完整迁移：

- 旧“语音结果直接填入任务输入框”的体验没有保留。
- 旧 `raw:` 显示没有完整保留。
- 旧“清空语音文本”独立按钮没有迁移，当前用新会话/turns 形态替代。
- 旧 `voice_client/voice_asr_client.js` 仍在远端当前项目，但正式 HTML 不再直接加载；属于历史参考/残留代码。

## 13. 旧 Debug / Developer 功能

| 功能 | 旧入口 | 当前状态 | 建议 |
|---|---|---|---|
| 后端地址输入 | `#backendUrlInput` | 悬浮框 `#hisAgentBackendUrl` 已有 | 放服务地址折叠面板，不应主界面突出 |
| ASR 地址输入 | `#asrServiceUrlInput` | 悬浮框 `#hisAgentAsrUrl`，编辑页 `#debugAsrUrl` | 放服务地址/开发者面板 |
| Agent 模式选择 | `#agentModeSelect` | 未迁移 | 不迁移给普通用户；如保留仅作开发文档说明 |
| 检查后端连接 | `#checkBackendButton` | 已迁移并增强 | 保留在悬浮框或服务地址附近 |
| 示例任务 | `#fillExampleTaskButton`, `.agent-example-button` | 已迁移到悬浮框示例任务 | 保留但点击只填入，不自动执行 |
| 原始响应 rawResponse | 旧后端返回，旧错误 formatter 可显示 | 当前后端返回，前端不展示 | 移到开发者调试面板 |
| pageState debug | 旧 pageState 可从代码和后端请求观察 | 当前没有显式 UI | 移到 debug 面板或 debug.html |
| 保存结果预览 | `#jsonPreview` | 当前没有等价块 | 业务上如需要可迁移为病历摘要/变更预览 |
| action log | 旧 chat history 每步隐式展示 | 当前只在 trace/localStorage 中部分保存 | 需要开发者面板或悬浮框详细模式 |
| token log | 旧 chat history 展示 | 当前 UI 未展示 | 开发者面板或任务摘要 |
| 错误日志 | 旧 chat history 展示 | 当前系统消息 + task lastError | 保留，建议增加详细模式 |

医生/普通用户不应看到：Agent 模式选择、本地规则 Agent、raw response、pageState JSON、token raw JSON、后端地址频繁改动入口。

## 14. 本地 fallback / 关键词规则残留

旧版存在本地 fallback / 关键词规则：

- `#agentModeSelect` 允许选择“本地规则 Agent（仅用于调试）”。
- `executeAgentCommand()` 在非 universal 模式下调用 `parseAgentCommand()`。
- `parseAgentCommand()` 通过 patientId / 姓名识别患者。
- `parseFieldUpdates()` 使用正则 `(?:将|把)(.+?)(?:修改为|改为|改成|设置为)(.+)$` 提取字段和值。
- `parseAllergyCommand()` 用正则判断过敏史。
- `getAgentFieldConfigs()` 内置字段 alias/options。
- `applyAgentPlan()` 本地选择患者、修改字段、点击保存。

当前状态：

- 当前业务路径已经禁用本地自然语言 fallback。
- 当前 `shared/agent-task-orchestrator.js` 是 allowlist executor 和 task-state 层，不是本地自然语言 planner。
- 当前仍有一些包含 “fallback” 字样的代码，但语义不同：
  - `agent-widget.js` 的 recovery launcher 是 widget 初始化失败时显示按钮，不执行业务 action。
  - `voice-input-controller.js` 的 `fallbackTurn()` 是 ASR 无 turns 时构造默认 turn，不解析自然语言页面动作。
  - `normalizeSavedServiceUrl(value, fallback)` 是服务地址默认值。

绝对不应迁移到悬浮框的旧能力：

- 无 LLM 时本地解析自然语言任务。
- 根据关键词/正则直接登录、导航、修改字段、保存。
- mock/local agent 替代后端 LLM planner。

## 15. 删除旧网页 Agent 对话框后会失去入口的功能

| 功能 | 原始 UI 入口 | 原始函数 | 当前是否还被调用 | 悬浮框等价入口 | 标记 | 建议 |
|---|---|---|---|---|---|---|
| 每轮 thought + token + elapsed 聊天日志 | `#agentChatHistory` | `formatObserveActStep` | 旧页删除后否 | 无完整等价 | 未迁移，删除旧对话框后将失去入口 | 必须迁移或放详细模式 |
| 总耗时/总 token 完成摘要 | `#agentChatHistory` | `formatFinishedSummary` | 旧页删除后否 | 无完整等价 | 未迁移，删除旧对话框后将失去入口 | 必须迁移 |
| raw response 展示 | 旧错误/成功 formatter | `formatBackendAgentSuccess/Error` | 不确定，旧页删除后基本无入口 | 无 UI | 未迁移，删除旧对话框后将失去入口 | 放开发者面板 |
| 旧保存结果自然语言预览 | `#jsonPreview` | `buildSavedSummary/read_preview` | 当前临床页无同等入口 | 无 | 未迁移，删除旧对话框后将失去入口 | 需用户决定 |
| 旧本地规则 Agent | `#agentModeSelect=local` | `parseAgentCommand/applyAgentPlan` | 当前业务不应调用 | 无 | 不迁移 | 废弃 |
| 旧 ASR 直接填入任务框 | `#voiceInputButton + #agentCommandInput` | `voice_asr_client.js` | 正式页不加载 | 部分等价：就诊会话 turns | 部分迁移 | 需决定是否恢复“语音转任务框” |
| 旧 ASR raw 转写显示 | `#asrTranscriptText` | `handleAsrMessage` | 正式页不加载 | 无完整等价 | 未迁移 | 可放开发者面板 |
| pageState debug 可视化 | 无独立 UI，随请求/日志 | `collectAgentPageState` | 当前无 UI | 无完整等价 | 代码存在但无入口 | 放开发者面板 |
| `/api/universal-agent/next-action` 单步调用 | 旧发送任务按钮 | `runUniversalObserveActAgent` | 当前悬浮框不调用 | task-plan/repair 新路径 | 接口存在但未接入悬浮框 | 保留 stub 或确认后废弃 |
| 每 10 秒等待计时提示 | chat history | `startBackendAgentElapsedTimer` | 未确认旧页是否仍调用 | 无 | 不确定，需用户决定 | 可迁移为长任务状态 |

## 16. 旧功能与当前悬浮框对比矩阵

| 编号 | 旧功能名称 | 旧 UI 入口 | 旧文件路径 | 旧函数 / 接口 | 旧功能说明 | 当前悬浮框是否已有 | 当前对应文件 / 函数 | 迁移状态 | 风险等级 | 建议 | 是否需要用户决定 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F01 | 发送任务 | `#sendAgentCommandButton` | 备份 `index.html` | `executeAgentCommand` | 发送文本任务 | 有 | `agent-widget.js/sendCurrentInput` | 已迁移 | P0 | 保留 | 否 |
| F02 | 任务开始计时 | chat 消息 | 备份 `index.html` | `performance.now` | 从发送后计时 | 无用户可见 | 仅 task 时间戳 | 未迁移 | P0 | 迁移 | 否 |
| F03 | 每步耗时显示 | chat 消息 | 备份 `index.html` | `elapsedMs/elapsedTime` | 每轮显示耗时 | 无 | 无 | 未迁移 | P0 | 迁移 | 否 |
| F04 | 总耗时显示 | chat 消息 | 备份 `index.html` | `formatFinishedSummary` | 完成时显示总耗时 | 无 | 无 | 未迁移 | P0 | 迁移 | 否 |
| F05 | token usage 显示 | chat 消息 | 备份 `index.html` | `formatUsageForDisplay` | 每轮 current/total | 无 | 后端返回但 UI 不用 | 未迁移 | P0 | 迁移 | 否 |
| F06 | prompt tokens | chat JSON | 备份 `index.html` | `addUsage` | 显示 prompt_tokens | 无 | 后端 `usage` | 未迁移 | P1 | 迁移到详细模式 | 否 |
| F07 | completion tokens | chat JSON | 备份 `index.html` | `addUsage` | 显示 completion_tokens | 无 | 后端 `usage` | 未迁移 | P1 | 迁移到详细模式 | 否 |
| F08 | total tokens | chat JSON | 备份 `index.html` | `addUsage` | 显示 total_tokens | 无 | 后端 `usage` | 未迁移 | P0 | 迁移 | 否 |
| F09 | 每步进度推送 | `#agentChatHistory` | 备份 `index.html` | `formatObserveActStep` | 每轮追加日志 | 部分有 | `renderTaskSummary` | 部分迁移 | P0 | 迁移详细日志 | 否 |
| F10 | 当前步骤展示 | chat 第 N 轮 | 备份 `index.html` | `formatObserveActStep` | 显示第 N 轮 | 有 | `renderTaskSummary` | 已迁移 | P0 | 保留 | 否 |
| F11 | 已完成步骤展示 | 历史消息 | 备份 `index.html` | chat history | 已完成轮次隐式保留 | 有但简化 | plan marker `✓` | 部分迁移 | P1 | 增强 | 否 |
| F12 | 失败原因展示 | chat 错误 | 备份 `index.html` | action fail formatter | 失败时显示原因 | 有 | `lastError`/系统消息 | 已迁移 | P0 | 保留 | 否 |
| F13 | 任务完成状态 | chat finished | 备份 `index.html` | `formatFinishedSummary` | 输出结束 | 有 | `finishSuccess` | 部分迁移 | P0 | 增加完成摘要 | 否 |
| F14 | activeTask 状态 | 无持久 activeTask | 备份 `index.html` | `history` 内存数组 | 仅本轮历史 | 有 | `hisAgentActiveTask` | 新实现 | P0 | 保留并修生命周期 | 否 |
| F15 | waiting_user 状态 | ask_user 消息 | 备份 `index.html` | `ask_user` | 需要用户补充 | 有 | `waitStep` | 已迁移 | P0 | 保留 | 否 |
| F16 | 取消任务 | 无明确旧按钮 | 备份未确认 | 不确定 | 不确定 | 有 | `cancel()` | 新增/不确定 | P1 | 保留 | 是 |
| F17 | 清空对话 | `#clearAgentChatButton` | 备份 `index.html` | 清空 innerHTML | 清空旧聊天 | 有但形态变更 | `newSession` | 部分迁移 | P1 | 保留新会话 | 否 |
| F18 | 示例任务填入 | `#fillExampleTaskButton` | 备份 `index.html` | click handler | 填 P004 示例 | 有 | `renderExampleTasks` | 已迁移 | P2 | 保留 | 否 |
| F19 | 示例任务按钮 | `.agent-example-button` | 备份 `index.html` | click handler | 五个示例 | 有 | `EXAMPLE_TASKS` | 已迁移 | P2 | 保留 | 否 |
| F20 | 语音输入 | `#voiceInputButton` | 备份 `voice_asr_client.js` | `startRecording` | ASR 转文字 | 有 | `voice-input-controller` | 部分迁移 | P1 | 保留统一入口 | 否 |
| F21 | ASR 地址配置 | `#asrServiceUrlInput` | 备份 `index.html` | `startRecording(url)` | 配置 ASR | 有 | `#hisAgentAsrUrl` | 已迁移 | P2 | 放开发者面板 | 否 |
| F22 | ASR 结果显示 | `#asrTranscriptText` | 备份 `voice_asr_client.js` | `handleAsrMessage` | partial/final/raw | 部分有 | turns UI | 部分迁移 | P1 | 决定是否保留 raw | 是 |
| F23 | 后端地址配置 | `#backendUrlInput` | 备份 `index.html` | `getBackendUrl` | 配置后端 | 有 | `#hisAgentBackendUrl` | 已迁移 | P2 | 放服务地址面板 | 否 |
| F24 | 检查后端连接 | `#checkBackendButton` | 备份 `index.html` | `checkBackend` | 检查 `/api/health` | 有且增强 | `checkBackendConnection` | 已迁移 | P1 | 保留 | 否 |
| F25 | Agent 模式选择 | `#agentModeSelect` | 备份 `index.html` | universal/local 分支 | 选择本地规则 | 无 | 无 | 未迁移 | P3 | 不迁移给用户 | 否 |
| F26 | pageState 收集 | 无 UI | 备份 `index.html` | `collectAgentPageState` | DOM 快照 | 有新实现 | `collectHisPageState` | 部分迁移 | P0 | 补齐关键字段 | 否 |
| F27 | observe-act 循环 | 发送任务 | 备份 `index.html` | `/next-action` for loop | 每轮 observe/action | 新实现不同 | `task-plan + runTaskLoop` | 部分迁移 | P0 | 保留新 harness，补进度 | 否 |
| F28 | action 执行器 | 无独立 UI | 备份 `index.html` | `applyUniversalActionToCurrentPage` | 旧 DOM action | 有 | `executeHarnessAction`/页面 handler | 已迁移但 schema 改 | P0 | 保留 allowlist | 否 |
| F29 | 保存结果预览 | `#jsonPreview` | 备份 `index.html` | `buildSavedSummary/read_preview` | 自然语言预览 | 无 | 无 | 未迁移 | P1 | 需决定 | 是 |
| F30 | debug 日志 | chat + backend debug | 备份 `index.html/backend` | `debug/rawResponse` | 调试输出 | 部分后端有 | `trace/localStorage` | 部分迁移 | P1 | 放开发者面板 | 否 |
| F31 | 错误展示 | chat error | 备份 `index.html` | `formatBackendAgentError` | 失败消息 | 有 | 系统消息/lastError | 已迁移 | P0 | 保留 | 否 |
| F32 | raw response 展示 | chat/debug | 备份 `backend/main.py` | `rawResponse` | 原始 LLM 输出 | 后端有，UI 无 | 无 | 未迁移 | P1 | 放开发者面板 | 否 |
| F33 | 本地 fallback 逻辑 | `#agentModeSelect=local` | 备份 `index.html` | `parseAgentCommand` | regex 解析 | 无 | 无 | 应废弃 | P3 | 不迁移 | 否 |
| F34 | 旧接口契约 | `/next-action` | 备份 `backend/main.py` | `UniversalNextActionRequest` | 单步 action | stub 存在 | 410 deprecated | 部分保留 | UNKNOWN | 保留 stub 待确认 | 是 |
| F35 | token/计时后端返回字段 | `/next-action` | 备份/current backend | `usage/elapsedTime` | 返回用量和耗时 | usage 有，elapsed 无 | task-* response | 部分迁移 | P0 | usage UI + elapsed 设计 | 否 |
| F36 | 任务历史记录 | chat history | 备份 `index.html` | DOM 历史 | 当前会话历史 | 有 | `hisAgentTaskHistory` | 部分迁移 | P1 | 增加查看入口 | 是 |
| F37 | 多轮对话历史 | `agentChatHistory` | 备份 `index.html` | `appendChatMessage` | 用户/Agent 消息 | 有 | `state.history` | 已迁移 | P1 | 保留 | 否 |
| F38 | 页面操作日志 | 每轮 chat/history | 备份 `index.html` | `history.push` | action/result | 部分有 | audit log / trace | 部分迁移 | P1 | 放调试面板 | 否 |
| F39 | 撤销 / 回滚 | 旧版未确认 | 备份未发现明确入口 | 不确定 | 不确定 | 有 | `rollbackAgentButton`/PatientStore | 新增 | UNKNOWN | 保留但确认产品边界 | 是 |
| F40 | 患者数据同步 | 单页内存 patients | 备份 `index.html` | `saveCurrentPatient` | 保存表单并预览 | 有新实现 | `PatientStore` | 已迁移且增强 | P0 | 保留 | 否 |

## 17. 必须迁移到悬浮框的功能

- 任务开始计时。
- 每步耗时显示。
- 总耗时显示。
- token usage 显示。
- prompt/completion/total tokens 详细展示。
- 每步进度推送或可展开步骤日志。
- 当前步骤、已完成步骤、失败原因、任务完成摘要。
- action/result 操作日志。
- raw trace 的开发者可见入口。
- pageState 中对患者识别必要的 patientList/patientStore 字段。

## 18. 可以调整形态后迁移的功能

- 示例任务：已迁移，可继续按当前医疗场景更新文本。
- 清空对话：旧“清空对话”可保留为当前“新会话”，也可加更明确命名。
- 语音输入：当前“就诊会话”是合理新形态，但是否保留“转写直接填任务框”需要用户决定。
- 后端状态检查：已迁移，可保持在折叠区。
- 保存结果预览：可改成“本次修订摘要 / 保存后患者摘要”，不一定保留旧 JSON preview。
- 任务历史记录：可以从 localStorage history 做查看入口。

## 19. 应移动到开发者调试面板的功能

- Agent 后端地址。
- ASR 服务地址。
- raw response。
- pageState debug。
- trace debug。
- token JSON 明细。
- action log。
- 旧接口兼容状态。
- ASR raw 转写。

## 20. 应废弃或删除但本轮不删除的功能

- `#agentModeSelect` 的“本地规则 Agent”用户入口。
- `parseAgentCommand()`、`parseFieldUpdates()`、`applyAgentPlan()` 这类本地自然语言规则 planner。
- 无 LLM 时通过关键词/正则直接执行登录、导航、修改字段、保存。
- 旧 `/api/universal-agent/next-action` 如果确认无外部调用，后续可删除；本轮只记录它当前是 410 stub。

## 21. 不确定、需要用户决定的功能

- 是否恢复“ASR 转写直接填入任务输入框”的旧体验，还是继续只保留“就诊会话 turns”。
- 是否保留旧 `#jsonPreview` 类似的自然语言保存结果预览。
- 是否给普通用户显示 token usage，还是仅放开发者面板。
- 是否保留 `/api/universal-agent/plan` 和 `/api/universal-agent/run` 兼容接口。
- 是否使用现有但未接入悬浮框的 `/api/universal-agent/task-next-step` 来恢复逐步 LLM 决策。
- 是否为任务历史记录提供 UI 入口。
- 旧 `startBackendAgentElapsedTimer()` 是否有历史外部调用；本轮未确认。
- 当前远端 `voice_client/voice_asr_client.js` 是否只作为历史参考保留；本轮未删除。
- 撤销/回滚是当前新增能力，旧版未确认有等价入口；需要确认是否作为正式产品能力保留。

## 22. 与当前问题的关系

张伟识别失败可能相关点：

- 旧 pageState 直接提供 `patientOptions` 全量文本和当前 `selectedPatient`。
- 当前患者管理页提供 `patientListSummary`，但受当前过滤和字段选择影响。
- 当前 orchestrator 的 `patient_store_summary` 只包含部分字段；如果 planner 没返回标准 `patientSelector`，`resolvePatient()` 可能无法定位。
- 新临床字段 schema 与旧 `symptoms/medicalHistory/allergyNote` 字段名不同，可能影响 LLM 对旧任务语义的映射。
- 本轮只分析，不修复。

activeTask 卡死可能相关点：

- 旧版没有跨页面持久 `activeTask`，任务在单页循环中完成或失败即结束。
- 当前新版把 task 存入 `localStorage.hisAgentActiveTask`，有 `running/waiting_user/blocked_no_llm/failed/completed` 等状态。
- 当前 `finishTask()` 完成后会 `clearTask()`，但 `waiting_user`、`blocked_no_llm`、导航中断、页面不接收 action 等状态更复杂。
- 当前 `TASK_TTL_MS` 为 30 分钟，过期才自动失败；如果页面刷新/跳转后没有正确 resume，可能表现为 activeTask 卡住。
- 本轮只分析，不修复。

token/计时缺失可能相关点：

- 旧版 progress 文案由前端每轮构造，天然把 `elapsedTime` 和 `usage` 拼进 chat。
- 新版 task-plan 接口返回 `usage`，但前端没有把 usage 累计进 activeTask，也没有在 UI 渲染。
- 新版 task 生命周期有时间戳，但没有前端任务计时器和后端 `elapsedTime` 响应字段。
- 如果要恢复，应在 task model 中补 `started_at/step_started_at/usage_total/step_logs`，并在悬浮框 UI 渲染；本轮不执行。

## 23. 建议下一步修复顺序

1. 先迁移“任务可观测性”：每步日志、当前步骤、已完成步骤、失败原因、完成摘要。
2. 再迁移“计时”：发送时 startedAt、每步 elapsed、完成 total elapsed。
3. 再迁移“token usage”：后端 usage 进入 task，前端累计 current/total，并放入开发者可见详细区。
4. 补 pageState/patient summary：确保患者管理和编辑页都能提供稳定 patientId/name/alias/临床字段摘要。
5. 处理 activeTask 生命周期：明确 running/waiting_user/blocked_no_llm/navigated/failed/completed 的恢复和清理规则。
6. 决定旧 ASR 形态：是否需要语音直接填入任务框。
7. 决定保存结果预览：是否以“修订摘要”替代旧 `jsonPreview`。
8. 最后清理：确认 `/next-action`、`/plan`、`/run`、`voice_client`、本地规则 Agent 是否仍有外部依赖，再决定废弃或保留 stub。

本轮没有执行上述修复。

## 24. 2026-06-11 患者检索链路修复结果

- 已补 `PatientStore.getPatientIndex()`，全量患者索引来自统一 patient-store，不依赖当前 DOM 表格或患者管理页过滤结果。
- 已补 `PatientStore.resolvePatientSelector(selector)`，支持 `patientId/name/phone/idNumber/query`。
- 已补 task-plan payload 的 `full_patient_index`，并在 pageState 中保留 `fullPatientIndex/visiblePatientList/activePatient/selectedPatient/currentFilter/fieldSchema`。
- 已修后端 normalizer 丢失顶层 `patientSelector/field/value` 的问题。
- 已让 `find_patient/select_patient/open_patient_editor/update_patient_field/update_patient_fields/save_patient/verify_patient_field/verify_patient_store` 在有结构化 patientSelector 时先走 resolver。
- 已在 `activeTask.step_logs` 和悬浮框任务摘要中显示 resolver 输入、候选、唯一匹配、写入 slots 的调试日志。
- 已确认 `resolvePatientSelector({name:"张伟"})`、`{query:"张伟"}`、`{patientId:"P001"}`、`{phone:"13810010001"}` 均唯一匹配 P001 张伟。
- 已确认无 LLM 时同样任务不会执行页面 action。
- 未恢复旧本地关键词 fallback。
- 未迁移 token usage、旧计时、完整 activeTask 生命周期。
## 24. 2026-06-11 taskflow 迁移结果补充

本轮围绕悬浮 Agent 任务链路和旧编辑逻辑迁移，只追加审计结论，不删除既有审计内容。

### 已迁移或等价迁移

- 任务进度显示：
  - 旧入口：`#agentChatHistory`、`formatObserveActStep()`。
  - 新入口：`shared/agent-task-orchestrator.js` 的 `addProgress()` 和 `his-agent-task-progress` 事件。
  - 新展示：`shared/agent-widget.js` 消息流、详细步骤、开发者详情。
  - 状态：已迁移到悬浮框，不再固定显示为顶部大块 task dump。
- 计时：
  - 旧能力：发送任务后计时、每轮 elapsed、完成时 total elapsed。
  - 新能力：`activeTask.started_at_ms`、`step.started_at_ms`、`finished_at_ms`、`elapsed_ms`。
  - 状态：已迁移。无 LLM 时不启动业务任务计时。
- token usage：
  - 旧能力：`addUsage()`、`formatUsageForDisplay()`、`formatFinishedSummary()`。
  - 新能力：planner/repair 返回 usage 时写入 `usage_last/usage_total`，消息流和开发者详情展示 prompt/completion/total。
  - 状态：已迁移。后端未返回 usage 时显示“后端未返回 token usage”，不伪造 0 token。
- 旧编辑页结构化 action 执行逻辑：
  - 旧等价能力：`updateFormField`、`saveCurrentPatient`、`validatePatientForm`、`read_preview/buildSavedSummary`。
  - 新位置：`shared/patient-editor-action-adapter.js`。
  - 新接口：`applyPatientEditorAction()`、`updatePatientEditorField()`、`saveCurrentPatientFromEditor()`、`verifyPatientEditorField()`、`buildPatientEditResultSummary()`。
  - 状态：已迁移为结构化 action adapter；只接受后端 LLM 已返回的 action，不解析自然语言。
- activeTask 生命周期：
  - 新规则：`completed/failed/cancelled/blocked_no_llm` 归档到 `hisAgentTaskHistory`，不再作为当前任务展示。
  - 新任务会生成新 `task_id`，不继承旧任务 step logs/current_step/error。
  - 状态：已完成本轮基础修复。
- field resolver：
  - 新位置：`shared/patient-field-schema.js`。
  - 支持别名：手机号/手机号字段/电话/联系电话、性别、科室/就诊科室、主诉、现病史、既往史、过敏史、地址/住址、紧急联系人、紧急联系人电话。
  - 状态：已迁移为统一 schema 入口。

### 明确没有迁移

- `parseAgentCommand()`。
- `parseFieldUpdates()`。
- `applyAgentPlan()`。
- `agentModeSelect=local` 本地规则 Agent。
- 无 LLM 时通过关键词或正则直接执行登录、导航、选择患者、修改字段、保存。
- 旧 `/api/universal-agent/next-action` 作为主任务入口。

这些能力不迁移是产品边界要求：自然语言理解必须由后端 LLM 完成；本地只允许执行 `source === "backend_llm"` 的结构化 action。

### 展示位置变化

- 原页面内 Agent 对话/测试区不恢复。
- 任务开始、步骤进度、字段修改结果、保存结果、失败原因进入悬浮框消息流。
- resolver debug、raw action、adapter result、token JSON 进入单条消息详情或“开发者详情”折叠区。
- 历史任务进入“任务历史”折叠区。

### 本轮验证状态

- 字段 resolver VM 测试通过。
- adapter VM 测试通过，P001 手机号结构化更新、input/change、patient-store、audit log 均通过。
- activeTask failed 归档测试通过。
- 31875 实际返回 taskflow 版本资源。
- 后端 `/api/llm/test` 使用 `openai/gpt-5.5` 返回 ok。
- planner 对 P001 手机号任务和张伟性别任务均返回包含 `update_patient_field` 的结构化计划。
- 未完成真实浏览器自动点击/Console 验证，原因是本轮没有可用 Browser 控制工具；需人工或后续工具恢复后补验。
## 2026-06-11 开发方法建设结果

本轮没有继续迁移或修改业务逻辑，只补齐后续迁移工作的开发方法基础设施：

- 新增 `AGENTS.md`，把旧 Agent 功能迁移规则、LLM gate、备份目录保护、必跑验收写成项目规则。
- 新增 `.agents/skills/` 下 5 个项目级 skills，用于约束后续 Codex 迭代。
- 新增 `tests/e2e/` Playwright 测试草案，用于后续真实浏览器回归。
- 新增 `tests/agent-cases/his-agent-cases.json`，把旧功能迁移后的关键 Agent 任务固化成验收用例。
- 新增 `PROJECT_BACKLOG.md`，记录“登录页任务前置状态判断”已知问题，本轮不修复。

本轮明确没有迁移或恢复：

- 旧本地自然语言 fallback。
- `parseAgentCommand()`。
- `parseFieldUpdates()`。
- `applyAgentPlan()`。
- 无 LLM 时通过本地规则执行页面动作。
## 2026-06-11 编辑页 HIS 化与旧 debug 归位结果

### 本轮结论

- `patient-editor.html` 已进一步定位为“当前患者 + 本次就诊编辑页”，不再把页面内旧 Agent 测试区作为正式业务入口。
- 右下角全站悬浮 Agent 仍是正式 Agent 入口。
- 旧调试能力没有删除，改为默认隐藏的开发者调试面板。

### 正式页面保留内容

- 顶部 HIS 全局栏：医院信息系统、当前用户、当前科室、当前时间、Demo 登录、退出登录。
- 面包屑：`首页 / 患者管理 / P001 张伟 / 本次就诊`。
- 患者摘要条：patientId、姓名、性别、年龄、科室、就诊类型、就诊状态、数据源、LLM 状态。
- 左侧病历导航。
- 中间病历编辑表单，继续复用 `patient-store` 和 `patient-editor-action-adapter`。
- 右侧临床上下文区：Agent 状态简卡、最近就诊摘要、过敏/风险提示、检查检验占位、待确认修改建议、最近修改记录。

### 旧 debug 归位

默认医生视角不再显示：

- Agent 模式选择。
- Universal Agent 后端地址。
- ASR 服务地址。
- 页面内 Agent 任务输入框。
- 发送任务按钮。
- 语音输入调试按钮。
- raw response。
- pageState JSON。
- 旧保存结果预览 debug 块。

当前开发者入口：

- URL 增加 `debug=1` 后显示开发者调试面板。
- 示例：`patient-editor.html?patientId=P001&debug=1&v=20260611-precondition-his`。

### 未迁移 / 未删除

- 未删除旧调试相关代码，只做默认隐藏。
- 未恢复页面内旧自然语言 fallback Agent。
- 未把旧 `/api/universal-agent/next-action` 重新设为主入口。
- 未深改 ASR / 就诊会话。

### 回归状态

- Playwright E2E 已覆盖 `patient-editor.html` 无 `patientId` 空状态。
- Playwright E2E 已覆盖 `patient-editor.html?patientId=P001` 显示 P001 张伟摘要条与 Agent 状态。
- Playwright E2E 已覆盖四个核心页面悬浮 Agent 可见。

## 2026-06-11 悬浮 Agent 任务展示与真实 LLM E2E 补充

### 任务展示迁移状态

- 悬浮框新增“当前任务”卡片和 `#hisAgentTaskList` 结构化步骤列表。
- 旧式顶部大块 task dump 不再作为主展示；`#hisAgentTask` 保留为兼容节点但默认隐藏。
- 任务步骤显示状态、耗时和 token：
  - completed：绿色完成标识。
  - running：运行中高亮。
  - pending：显示 `--:--` 和 `token: -`。
  - failed / waiting_user：显示错误或等待状态。
  - 当前任务级 usage 缺失时显示 `token: 未返回`，不伪造 token。
- 每个步骤可展开查看结构化详情：action JSON、resolver logs、adapter result、audit、error、usage。
- 消息流只保留关键摘要，普通 step progress 不再以大消息卡刷屏。
- 示例任务、服务地址、开发者详情、任务历史保持折叠，避免挤占输入区。

### 未改变的边界

- 没有恢复 `parseAgentCommand()` / `parseFieldUpdates()` / 本地关键词 fallback。
- 无 LLM 时仍只显示状态，不执行登录、跳转、字段修改或保存。
- 页面手动登录、手动表单保存、路由和 patient-store 规则不依赖 LLM。
- 任务执行仍只接受 `source=backend_llm` 的结构化 action。

### E2E 补充

- 新增默认 E2E：注入 activeTask，验证任务列表、状态、耗时 `MM:SS`、token 占位、折叠面板。
- 新增真实 LLM E2E fixture：快照并恢复 `his_demo_patients_*`、`his_demo_patient_audit_*`、`hisAgentActiveTask`、`hisAgentTaskHistory`。
- 真实 LLM 用例覆盖：
  - `修改患者 P001 的手机号为 13800138000 并保存`
  - `把张伟的性别改成女`
- `tests/agent-cases/his-agent-cases.json` 已标记 `mutatesDemoData` 和 `restoreFixture: localStorageSnapshot`。

### 验证结果

- 默认 E2E：`13 passed / 2 skipped / 0 failed`。
- `RUN_LLM_E2E=1` 全量 E2E：`15 passed / 0 skipped / 0 failed`。
- 后端 LLM 探针：`/api/llm/test` 返回 `provider=openai`、`model=gpt-5.5`、`content=ok`。

## 2026-06-12 悬浮框任务列表 UI 重构结果

本轮只做展示层修复，不改变业务执行逻辑。

- 顶部状态区从混合文本改为简洁 chip：`Backend`、`LLM`、`Agent`、`ASR`、`Data`。
- 任务列表标题显示 `任务：<objective>`，步骤以可展开 `<details>` 呈现。
- 步骤状态统一为 `completed`、`running`、`pending`、`failed`、`waiting_user`、`skipped`。
- 步骤耗时统一使用 `MM:SS`；pending/skipped 显示 `--:--`。
- 每个步骤显示 token 字段；无 usage 显示 `token: -`。
- 任务总 usage 未返回时继续显示 `token: 未返回`，不伪造 0 token。
- 展开详情只展示结构化 action、resolver/adapter 过程、audit、error、usage，不展示原始完整思考链。
- 服务地址折叠区新增诊断信息，展示 backend health、LLM test、ASR health 的实际 URL、状态和错误。
- 示例任务、服务地址、开发者详情、任务历史仍默认折叠。
- 未恢复本地关键词 fallback；无 LLM 时仍不执行页面动作。

## 2026-06-12 ASR/widget status audit addendum

ASR service is currently running on container port 8010 and exposed at `http://10.26.6.8:31478`.
The widget separates ASR service health from browser microphone capability. Current real browser diagnosis: ASR health connected, WebSocket open succeeds, microphone API unavailable because the page is served from plain `http://10.26.6.8` and the browser context does not expose `navigator.mediaDevices.getUserMedia`.
No ASR recognition business logic was changed in this round.
## 2026-06-12 Agent 执行记录页面迁移结果

本轮没有恢复旧本地自然语言 fallback，也没有改动业务执行器、resolver 或 patient-store。

迁移结果：

- 新增 `html/agent-history.html` 作为“修改历史 / Agent 执行记录”正式页面。
- 悬浮框中的结构化步骤详情、开发者详情、任务历史和 raw debug 信息迁移到该页面展示。
- 悬浮框只保留当前任务摘要和“查看完整记录”入口，避免旧调试信息长期堆在主交互区域。
- `agent-history.html` 读取当前 activeTask、历史任务、audit log 和相关患者摘要，作为只读审计视图。
- 每个步骤保留状态、耗时、token、结构化 action、resolver 日志、adapter 结果和错误详情，但不展示完整原始思考链。
## 2026-06-12 ASR / 就诊会话迁移结果

本轮继续只迁移正式链路，不恢复旧页面内 Agent 输入框，不恢复本地自然语言 fallback。

迁移结果：

- 悬浮框“就诊会话”模块承接旧 ASR 体验。
- ASR 转写不再自动进入 Agent 输入框；用户点击“填入 Agent 输入框”后才填入，且不会自动发送。
- 新增模拟就诊会话、粘贴文本转 turns、复制转写、清空记录、手动修正医生/患者、一键交换医生/患者。
- ASR 服务状态和麦克风状态分开展示；当前 HTTP 非安全上下文导致麦克风不可用时，不再误报 ASR 服务 disconnected。
- raw ASR 信息、speaker turns、WebSocket 状态和最后错误进入 ASR 开发者详情折叠区。
- 发送给 Agent、生成结构化草稿、写入病历字段继续受 LLM gate 约束；无 LLM 时仅允许转写展示和本地 turns 整理。
- “写入病历字段”采用确认式入口：先填入 Agent 输入框，用户确认发送后才可能走 backend_llm action 和 audit log。
- 当前仍未实现真实自动说话人区分，默认 speaker_0 为医生，用户可手动修正；自动 diarization 另列后续任务。
## 2026-06-12 ASR / visit-session acceptance fix

This addendum records the acceptance fix only. No old local natural-language fallback was restored.

- Migrated ASR behavior now lives in the floating widget visit-session tab, not in root duplicate pages.
- ASR service health, browser microphone capability, and ASR WebSocket state are tracked separately.
- Microphone unavailable / insecure context / permission denied does not mark ASR health as disconnected.
- Since the backup page can use the microphone, the current page must not pre-block voice only because `window.isSecureContext` is false. The controller now tries `getUserMedia` whenever the API is exposed and reports the real browser error if startup fails.
- Transcription and mock visit turns can be displayed, role-corrected, copied, and filled into the Agent input without auto-send.
- The "整理到输入框" action is local transcript organization only and does not execute page actions.
- Structured draft generation requires LLM connected.
- Field writing still requires explicit user send and backend LLM action; audit log is written only by the existing adapter / patient-store save path after confirmed execution.
- No real automatic speaker diarization is claimed. Current turns use ASR-provided turns when present, otherwise default/manual doctor/patient mapping.
- FunASR / Diart / pyannote speaker diarization remains a separate follow-up investigation.
## 2026-06-12 old single-page microphone ASR flow migration

Reviewed old files:
- `voice_client/voice_asr_client.js`
- old `index.html` voice controls around `voiceInputButton`, `asrServiceUrlInput`, `asrTranscriptText`, and `agentCommandInput`

Migrated to current formal flow:
- User click starts the real microphone request path.
- `getUserMedia({ audio: true })` is attempted when the browser exposes it.
- ASR WebSocket connection uses the same `http -> ws` / `https -> wss` conversion.
- Audio is captured with `AudioContext`, `MediaStreamSource`, and `ScriptProcessor(4096, 1, 1)`.
- Audio frames are downsampled to 16 kHz and sent as binary buffers.
- ASR `partial` and `final` events are consumed by the visit-session turns UI.
- Stop flow disconnects audio nodes, stops tracks, closes `AudioContext`, sends `{ type: "end" }`, and closes WebSocket.

Product adaptation:
- Old final transcript used to overwrite the task input directly.
- Current final transcript enters doctor/patient turns first.
- `整理到输入框` copies turns into the Agent input only; it does not send or execute.
- Page actions still require backend LLM action, allowlist, adapter, and user workflow.

Not migrated by design:
- FunASR / Diart / pyannote speaker diarization.
- Local natural-language fallback.
- ASR backend recognition changes.
## 2026-06-17 Diart 说话人分离迁移结果

新增独立 `diarization_service/`，ASR 继续保留为独立转写服务。浏览器复用同一麦克风音频流，将音频并行发送给 ASR 和 Diarization WebSocket。当前 Diart 自动分离因 torchaudio ABI 不匹配未启用，系统只返回明确标记为 manual/provisional 的说话人元数据，不伪造自动分离结果。

已迁移/保留：

- ASR 转写链路继续可用。
- 就诊会话 turns 继续展示医生/患者角色与可手动修正。
- 新增 speaker_id/source/automatic/provisional 元数据展示。
- 无 LLM 时语音和转写不会执行页面动作。

未完成：

- 真实 Diart streaming 输出。
- 真实自动说话人区分。
- HF token 注入和 pyannote 模型授权验证。
