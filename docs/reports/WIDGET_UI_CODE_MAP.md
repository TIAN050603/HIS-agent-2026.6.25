# 悬浮 Agent UI 代码地图

本文件只记录当前悬浮框 UI 的真实代码分布，供后续小步修改和 E2E 回归使用。不要把这里当作新功能需求清单。

## 2026-06-26 计时刷新与演示 pacing

- `shared/agent-widget.js`
  - `TASK_SUMMARY_TICK_MS = 100`：悬浮框任务耗时 0.1s 采样。
  - `startTaskSummaryTicker()`：active task 与 planning task 都会刷新；100ms tick 只刷新 `.his-agent-current-elapsed`，结构卡片保持低频重绘以免打断步骤列表点击/滚动。
  - `refreshCurrentTaskElapsed()`：直接更新当前任务卡中的耗时文本。
  - `handleCommand()`：正式任务计时起点在 LLM 预检完成后、调用 orchestrator 前设置。
- `shared/agent-task-orchestrator.js`
  - `demoPacingConfig()`：真实页面默认启用 1s pacing；`demoPacing=0/1` 或 `agentPacing=0/1` 写入 session override，跨页面跳转保持。
  - `waitDemoPacingAfterAction()` / `applyDemoPacingAfterStep()`：成功页面动作后统一按 step/action pacing 取较大值等待，并写入 `timing_breakdown.demo_delay_ms`。
- `tests/e2e/his-agent.spec.ts`
  - `localServiceQuery` 默认带 `demoPacing=0`，让自动化测试不被真实演示节奏拖慢。
  - 覆盖 planning 计时实时刷新、pacing 计入 timing、展开步骤滚动不跳顶。

## 2026-06-25 语音任务既往病史字段链路

- `shared/agent-widget.js`
  - `endVoiceConversationAndDraftTask()`：仍只请求 `/api/voice/turns-to-agent-task` 并渲染可编辑任务框；整理阶段不执行页面动作。
  - `executePendingVoiceTask()`：医生点击“执行任务”后，把编辑后的自然语言文本和 `pendingVoicePlan.taskContract/expectedMutations` 交给 `handleCommand(..., "voice_confirmed_task")`。
- `backend/main.py`
  - `/api/voice/turns-to-agent-task`：返回 `task_text` 给医生编辑，同时保留结构化 `proposed_fields`；其中既往病史标准字段为 `pastHistory`。
  - `parse_voice_task_result()`：把 `{ field, label, value }` 形式的 `proposed_fields` 转成 `expected_mutations`。
  - `normalize_harness_field()` / `normalize_contract_field()`：`medicalHistory` 和英文/中文 past-history aliases 都归一到 `pastHistory`。
- `shared/patient-field-schema.js`
  - `resolvePatientField("既往病史")`、`resolvePatientField("past medical history")` 和 `resolvePatientField("medicalHistory")` 均返回 `pastHistory`。
  - 隐藏 legacy `medicalHistory` 不再是 editable 字段。
- `html/patient-editor.html`
  - 正式可编辑 DOM 是 `[data-field="pastHistory"]`；不需要切 tab，页面已有病历导航锚点 `#pastHistory`。
- `shared/patient-editor-action-adapter.js`
  - 未改业务规则；修复后通过 existing resolver 找到 `pastHistory` 控件，触发 `input/change`，保存仍走真实页面保存流程。
- `tests/e2e/his-agent.spec.ts`
  - resolver aliases、普通 mutation contract、voice confirmed taskflow 均覆盖 `pastHistory`。

## 2026-06-24 草稿确认写入与医生单人 turn 整理

- 2026-06-24 追加：语音整理确认后直接执行页面任务。
  - `backend/main.py`
    - `/api/voice/turns-to-agent-task` 现在要求输出医生确认后可执行的自然语言任务，不再输出“生成草稿等待确认”的二次确认任务。
    - `TaskPlannerRequest.task_origin/input_route` 让后端 planner 区分普通聊天任务和 `voice_confirmed_task`。
    - planner contract 要求语音确认任务使用 `update_patient_fields + save_patient`，或自由文本记录时 `write_clinical_note_field + save_patient`，不再用 `create_structured_draft` 生成第二个确认卡。
  - `shared/agent-task-orchestrator.js`
    - `buildPlannerPayload()` 透传 `task_origin`、`input_route`。
    - `compactInputRoute()` 兼容 `AgentInputRouter` 的 `input.input_type`。
  - `shared/agent-widget.js`
    - `scriptsVersion`：`20260624-voice-confirm-execute`。
  - `tests/e2e/his-agent.spec.ts`
    - 覆盖“整理阶段不写 patient-store”和“医生点击执行任务后直接更新字段并保存，不出现病历草稿二次确认框”。

- `shared/agent-widget.js`
  - `renderClinicalDraftReviewMessage()`：渲染“已生成以下病历草稿，请编辑并确认是否写入”的可编辑确认卡。
  - `appendClinicalDraftReviewFromProgress()` / `maybeAppendClinicalDraftReviewFromSummary()`：从 `create_structured_draft` progress、最近任务 summary 和 `slots.structured_draft` 幂等补出确认卡。
  - `extractClinicalDraftFromProgress()`：只接受 `create_structured_draft` 来源，避免 `write_clinical_note_field` 写入结果再次生成确认卡。
  - `confirmClinicalDraftWrite()`：读取医生编辑后的草稿，构造成自然语言写入任务，再进入现有 `handleCommand()` / backend planner / allowlist executor。
  - `finalSpeakerTurns()`：接受任意 final 文本 turn；未确认角色在整理 payload 中按医生口述传给 LLM，原始 UI turn 不改为 automatic。
- `shared/agent-task-orchestrator.js`
  - `executeStructuredDraftAction()`：把草稿写入 `task.slots.structured_draft`，供任务完成后 UI 补出确认卡。
  - `executeClinicalNoteFieldAction()`：医生确认后才写入 schema 内临床字段，并由 patient editor adapter 写 audit。
- `tests/e2e/his-agent.spec.ts`
  - 覆盖草稿确认前不改 patient-store、确认后写入并产生 audit。
  - 覆盖只有医生单人 final turn 时也能显示“结束对话并整理任务”，且 payload 不包含 raw speaker/source/debug 字段。

安全边界：确认卡本身不执行页面动作；只有“确认写入/执行任务”后的自然语言任务才进入正式 Agent taskflow。

## 2026-06-23 当前任务步骤滚动与病历草稿 action

- `shared/agent-widget.js`
  - `runtime.currentTaskStepsScroll`：记录当前任务步骤列表的局部滚动位置。
  - `captureCurrentTaskStepsScroll()` / `restoreCurrentTaskStepsScroll()`：`renderCurrentTaskCard()` 重绘前后保持 `#hisAgentTaskList.scrollTop`，避免 progress render 把“展开步骤”拉回顶部。
  - `shouldMirrorProgress()`：将“已生成病历草稿 / 正在写入病历字段”纳入聊天流可见进度摘要。
- `shared/agent-widget.css`
  - `.his-agent-current-steps[open] .his-agent-task-list`：是“展开步骤”的局部滚动容器，使用 `overscroll-behavior: contain` 和 `scroll-behavior: auto`。
- `backend/main.py`
  - `ALLOWED_HARNESS_ACTIONS` 和 `task_prompt_contract()` 明确允许 `create_structured_draft` / `write_clinical_note_field`。
  - `normalize_harness_step()` 归一化草稿内容 `draftText/content/text` 和目标临床字段，禁止把“输出 / 草稿”当成校验字段。
- `shared/agent-task-orchestrator.js`
  - `executeStructuredDraftAction()`：只生成 Agent 草稿输出，写入 task slots，不修改 patient-store。
  - `executeClinicalNoteFieldAction()`：明确写入临床字段时才调用患者编辑 adapter。
- `tests/e2e/his-agent.spec.ts`
  - 覆盖步骤列表滚动保持和“生成病历草稿”不触发“校验字段不存在”。
- `shared/runtime-config.js`
  - 当前新容器默认端口：frontend `31824`，backend `31351`，ASR `31411`，LLM `31189`；前端页面自身 origin 仍优先作为 frontendUrl。

## 2026-06-23 Agent 状态闭环代码点

- `shared/agent-widget.js`
  - `TASK_STEPS_UI_KEY = hisAgentTaskStepsUiV2`：按 taskId 保存“展开步骤”开关，`renderCurrentTaskCard()` 重建 DOM 时恢复 `details.open`。
  - `INPUT_DRAFT_KEY = hisAgentInputDraftV2`：保存未发送底部输入；`sendCurrentInput()` 只在任务接受或取消后清空。
  - `SCROLL_RESTORE_KEY = hisAgentScrollRestoreV2`：页面切换前保存 `#hisAgentBody` 滚动快照，初始化时隐藏容器并先恢复 scrollTop。
  - `runtime.planningTask / activeRunId`：新任务发送后的原子 planning 占位，避免旧历史任务闪现。
  - `isCancelTaskCommand()`：识别“取消、停止、算了、我发错了、先不改、不改了”等元指令，转为取消当前任务。
  - `endVoiceConversationAndDraftTask()`：处理后端 `result_type`，`explicit_action / clinical_draft` 进入可编辑确认框，`no_action / needs_clarification` 只提示不执行。
- `shared/agent-task-orchestrator.js`
  - `cancelActiveTask()`：冻结当前 task，归档历史，清除 activeTask。
  - `isArchivedTerminalTask()` / `saveTask()` guard：阻止取消后的异步回调重新写回 running activeTask。
  - progress event 带 `run_id`，前端可忽略非当前 run 的晚到事件。
- `backend/main.py`
  - `/api/voice/turns-to-agent-task` 返回 `result_type`、`task_text`、`proposed_fields`、`reason_summary`，仍不返回页面 action。
- `tests/e2e/his-agent.spec.ts`
  - `Agent state close-loop regressions` 覆盖展开状态、新任务规划、草稿、取消、滚动、语音整理分类。

## 2026-06-22 Agent V2 产品化结构

- `shared/agent-input-router.js`
  - 入口：`window.AgentInputRouter.routeInput()`。
  - 用途：把输入归类为 `start_new_task`、`continue_active_task`、`ask_disambiguation`、`cancel_active_task`、`create_voice_task_draft`、`fill_input_only` 等。
  - 约束：只做元路由，不解析患者字段业务语义，不执行页面动作。
- `shared/agent-state-machine.js`
  - 入口：`window.AgentStateMachine.create()`。
  - 用途：记录 home/chat/planning/running/waiting_user/voice/completed/failed 等状态及 transition。
- `shared/agent-task-model.js`
  - 入口：`window.AgentTaskModel.normalizeTask()` / `normalizeStep()`。
  - 用途：统一 task / step schema，保留 usage、audit、elapsed、waitingFor、clarifications。
- `shared/agent-scroll-manager.js`
  - 入口：`window.AgentScrollManager.create()`。
  - 用途：管理 `#hisAgentBody` 的自动跟随、用户上滑保护和 `#hisAgentNewMessagesButton` 未读提示。
- `shared/agent-task-orchestrator.js`
  - 新增 `continueWaitingTask()`：waiting_user 下医生补充会保留原 task_id，再调用 backend LLM planner。
- `shared/agent-widget.js`
  - `window.HisAgentWidget.getV2State()` 可读取 conversationState、state transitions、scroll state 和 lastRoute。
  - `scriptsVersion`：`20260622-agent-v2-productization`。

正式页面当前加载顺序中，`ui-action-feedback.js` 之后、`agent-task-orchestrator.js` 之前加载四个 V2 辅助模块；`agent-widget.js` 仍是最终 UI 入口。

新增 DOM：

| DOM ID | 用途 |
| --- | --- |
| `#hisAgentBody` | 悬浮框唯一主滚动容器 |
| `#hisAgentNewMessagesButton` | 用户离开底部时的新消息提示 |

安全边界：V2 模块不替代 backend planner、不替代 allowlist executor、不恢复 fallback、不写 patient-store。

## 2026-06-22 Agent 对话工作台与主按钮状态

- `shared/agent-widget.js`
  - `#hisAgentOpenChatButton`：主视图“进入 Agent 对话”入口，只切换到 chatView，不发送任务。
  - `openChatWorkspace()`：进入 Agent 对话与任务工作台；空历史时只追加一条工作台说明。
  - `renderTaskSummary()`：有 active task 时显示当前任务；没有 active task 但处于 chatView 时读取最近一条带 plan 的历史任务，渲染“最近任务计划”。
  - `renderCurrentTaskCard()`：任务卡显示 `Agent：...` 自然语言状态说明，并继续通过 `#hisAgentTaskList` 展示步骤列表。
  - `updatePrimaryTaskButton()`：footer 主按钮默认“发送”；planning/running 时变为“取消任务”；waiting_user、完成、失败、取消后恢复“发送”。
- `shared/agent-widget.css`
  - `.his-agent-home-actions` / `.his-agent-open-chat-button`：主视图工作台入口布局。
  - `.his-agent-current-narration`：任务卡中的 Agent 状态说明。
  - `.his-agent-current-card.recent`：最近任务计划的轻绿色历史态样式。
  - `.his-agent-button.primary.danger`：主按钮作为“取消任务”时的红色状态。
- `tests/e2e/his-agent.spec.ts`
  - 覆盖主动进入 chatView、最近任务 checklist 保留、footer 主按钮 running/waiting_user 状态切换。

安全边界：“进入 Agent 对话”和“最近任务计划”均为 UI 只读/切换行为，不调用 planner、不执行页面动作、不写 patient-store、不新增 audit log。

## 2026-06-22 语音入口与就诊会话启动边界

- `shared/agent-widget.js`
  - 底部按钮区为 `发送 / 语音输入 / 就诊会话 / 新会话`。
  - `#hisAgentVoiceButton` 只调用主输入语音转写，转写结果写入 `#hisAgentInput`，不切换页面、不生成医生/患者 turns、不自动发送。
  - `#hisAgentVoiceSessionButton` 只进入 `voiceView`，不自动开麦。
  - `#hisVoiceStartButton` 才启动就诊会话采集。
  - `#hisVoiceStopButton` 只停止采集并释放麦克风。
  - `#hisVoiceReviewTaskButton` 只整理 final turns 为可编辑自然语言任务，不直接执行页面动作。
- `shared/voice-input-controller.js`
  - `start({ mode: "dictation" })`：主输入转写模式，只写输入框。
  - `start({ mode: "visit" })`：就诊会话模式，生成 doctor / patient turns。
  - `checkAsrHealth()` 使用短超时，ASR 失败才阻止录音启动。
  - `checkDiarizationHealth()` 使用短超时，超时后进入 `manual` / `timeout`，不会阻塞麦克风和 ASR。
  - Diart WebSocket 只在 health 明确 `connected` 或 `available` 时连接。
  - `stop()` 必须停止 MediaStream tracks、清理 recorder/audio pipeline、关闭 ASR/Diart WebSocket，并把 UI 状态回到 idle。

按钮语义不可合并：

- 主输入“语音输入”是医生单人任务口述。
- 就诊会话“开始语音任务”是医生/患者会话采集。
- “停止语音任务”是停止采集。
- “结束对话并整理任务”是把已采集 final turns 交给 LLM 生成待确认任务。

## 2026-06-22 homeView / chatView UI

- `shared/agent-widget.js`
  - `state.viewMode`：`home` / `chat` 两个悬浮框视图状态。
  - `renderViewMode()`：根据 `viewMode` 切换 `#hisAgentHomeView` 与 `#hisAgentChatView`。
  - `enterChatView()`：用户发送任务、点击专题卡片、点击示例任务或进入就诊会话时切到对话视图。
  - `returnToHomeView()`：顶部“返回”按钮回到主视图，不清空聊天记录。
  - 四个主视图专题卡：`patient-management`、`connection`、`history`、`examples`。
- `shared/agent-widget.css`
  - `.his-agent-home-view` / `.his-agent-chat-view`：主视图与对话视图容器。
  - `.his-agent-back-button` / `.his-agent-chat-heading`：chatView 顶部返回与标题区。
  - `.his-agent-soft-button`、`.his-agent-card-button`、`.his-agent-carousel-button`：统一白底、浅蓝 hover、active 按压反馈。
  - `.his-agent-message.user` / `.his-agent-message.agent`：用户右侧气泡、Agent 左侧气泡。
- `tests/e2e/his-agent.spec.ts`
  - 覆盖四个专题卡、home/chat 互斥显示、发送任务进入 chatView、连接状态 7 行、示例任务 5 条、无 LLM 不执行。

安全边界：本轮只改变悬浮框 UI 组织和样式；自然语言任务仍走后端 LLM planner、前端 allowlist executor、LLM gate 和现有 audit 机制。

## 总入口

- `html/login.html`
- `html/dashboard.html`
- `html/patient-management.html`
- `html/patient-editor.html`

四个核心页面都应按顺序加载：

1. `shared/runtime-config.js`
2. `shared/patient-field-schema.js`
3. `shared/patient-store.js`
4. `shared/voice-input-controller.js`
5. `shared/ui-action-feedback.js`
6. `shared/agent-state-machine.js`
7. `shared/agent-input-router.js`
8. `shared/agent-scroll-manager.js`
9. `shared/agent-task-model.js`
10. `shared/agent-task-orchestrator.js`
11. `shared/agent-widget-bootstrap.js`
12. `shared/agent-widget.js`

`patient-editor.html` 在 task orchestrator 前额外加载 `shared/patient-editor-action-adapter.js`。

`agent-widget-bootstrap.js` 是硬兜底入口，只负责确保 `#hisAgentLauncher` 存在，不执行页面动作。

## 主要文件职责

| 文件 | 职责 | 注意事项 |
| --- | --- | --- |
| `shared/agent-widget.js` | 悬浮框 DOM、状态展示、任务输入、消息流、服务状态、按钮交互 | 不应直接用本地关键词 fallback 执行业务动作 |
| `shared/agent-widget-bootstrap.js` | 主 widget 加载前的兜底启动按钮 | 必须先于主 widget 加载 |
| `shared/agent-widget.css` | 悬浮按钮、面板、任务列表、状态 chip、消息流样式 | UI 调整后必须跑 E2E |
| `shared/ui-action-feedback.js` | 手动点击、Agent 导航、字段修改、保存、校验的视觉反馈 | 只做 UI 动画/toast，不执行业务动作 |
| `shared/runtime-config.js` | backend / ASR / LLM 服务地址推断与迁移 | 前端状态检测必须读这里 |
| `shared/agent-task-orchestrator.js` | activeTask 生命周期、任务计划执行、进度消息、waiting_user 状态 | 不恢复本地自然语言解析 fallback |
| `shared/agent-input-router.js` | 输入归类与冲突处理 | 不解析业务语义，不执行页面动作 |
| `shared/agent-state-machine.js` | 对话状态与 transition 记录 | 只记录 UI 状态，不授权动作 |
| `shared/agent-task-model.js` | task / step schema 规范化 | 用于 UI、history、E2E 统一字段 |
| `shared/agent-scroll-manager.js` | 聊天滚动和未读提示 | 不改变消息内容 |
| `shared/voice-input-controller.js` | 浏览器麦克风、ASR health、语音输入状态 | ASR 服务状态和麦克风能力必须分开显示 |
| `shared/agent-action-adapter.js` | 结构化 action 到页面能力的适配 | 只执行 `source === "backend_llm"` 的 action |

## DOM ID 地图

| DOM ID | 位置 | 用途 |
| --- | --- | --- |
| `#hisAgentLauncher` | bootstrap / widget | 右下角 AI Agent 启动按钮 |
| `#hisAgentPanel` | `createWidget()` | 悬浮 Agent 主面板 |
| `#hisAgentHeader` | panel header | 扩大的拖拽区域，`data-testid="his-agent-drag-region"` |
| `#hisAgentDragHandle` | panel header | 标题旁拖拽提示图标，仍可用于拖拽 |
| `#hisAgentResetPositionButton` | panel header | 重置位置 |
| `#hisAgentCloseButton` | panel header | 关闭面板 |
| `#hisAgentBackendStatus` | service status | Backend / LLM / Agent 状态 chip |
| `#hisAgentAsrStatus` | service status | ASR 服务 / 麦克风 / Data 状态 chip |
| `#hisAgentCurrentTaskCard` | task summary | 当前任务卡片 |
| `#hisAgentTaskList` | task summary | 结构化任务步骤列表 |
| `#hisAgentTask` | legacy/debug slot | 旧大块 task dump 容器，正式 UI 应保持隐藏 |
| `#hisAgentHistory` | message stream | 用户、系统、Agent 消息流 |
| `#hisAgentInput` | input area | 文字任务输入 |
| `#hisAgentSendButton` | input area | 发送任务 |
| `#hisAgentVoiceButton` | input area | 语音输入开关 |
| `#hisAgentCancelButton` | input area | 取消当前任务 |
| `#hisAgentNewSessionButton` | input area | 新会话 |
| `#hisAgentBackendUrl` | settings | 当前 backend 地址 |
| `#hisAgentAsrUrl` | settings | 当前 ASR 地址 |
| `#hisAgentServiceDiagnostics` | settings details | backend / LLM / ASR health 诊断 |

## CSS 选择器地图

| 选择器 | 用途 |
| --- | --- |
| `.his-agent-launcher` | 右下角启动按钮 |
| `.his-agent-panel` / `.his-agent-panel.open` | 主面板关闭与打开状态 |
| `.his-agent-header` | 顶部标题和按钮区 |
| `.his-ui-flash` / `.his-ui-pulse` | 共享操作反馈动画 |
| `.his-agent-action-toast` | Agent 自动操作反馈 toast |
| `.agent-action-target` | Agent 当前操作目标高亮 |
| `.agent-action-clicking` | Agent 点击/按下态 |
| `.agent-field-editing` | Agent 正在编辑字段 |
| `.agent-field-changed` | 字段已修改闪烁 |
| `.agent-field-saved` / `.agent-save-pulse` | 保存/同步反馈 |
| `.agent-row-highlight` | 患者行定位高亮 |
| `.his-agent-service-status` | 服务状态区域 |
| `.his-agent-connection-chip` | 单个状态 chip |
| `.his-agent-connection-chip.connected` | 已连接 |
| `.his-agent-connection-chip.warning` | 浏览器限制、未配置、未知 |
| `.his-agent-connection-chip.disconnected` | 服务不可达 |
| `.his-agent-current-task` | 当前任务卡片 |
| `.his-agent-task-list` | 任务列表容器 |
| `.his-agent-task-item` | 单个任务步骤 |
| `.his-agent-task-item.completed` | 已完成步骤 |
| `.his-agent-task-item.running` | 执行中步骤 |
| `.his-agent-task-item.pending` | 待执行步骤 |
| `.his-agent-task-item.failed` | 失败步骤 |
| `.his-agent-task-detail-panel` | 可展开详情 |
| `.his-agent-example-panel` | 示例任务折叠区 |
| `.his-agent-settings` | 服务地址折叠区 |

## 核心函数地图

### `shared/agent-widget.js`

- `createWidget()`: 创建主面板 DOM。
- `bindEvents()`: 绑定按钮、输入、拖拽、尺寸调整。
- `renderServiceStatus()`: 渲染 Backend / LLM / Agent / ASR / 麦克风 / Data 状态。
- `connectionChip(label, value, forcedClass)`: 生成状态 chip。
- `connectionStatusText(value)`: 状态值到可见文案的映射。
- `connectionStatusClass(value)`: 状态值到 CSS class 的映射。
- `renderTaskSummary()`: 渲染当前任务概览和任务列表。
- `renderTaskStep(step, index, task)`: 渲染单个任务步骤。
- `formatElapsedMs(ms)`: 主 UI 耗时格式，使用 `MM:SS`。
- `toggleVoice()`: 调用 `HisVoiceInputController.toggle()`，同步 ASR 服务和麦克风状态。
- `updateDebugState()`: 更新 `window.__HIS_AGENT_WIDGET_DEBUG__`。

### `shared/ui-action-feedback.js`

- `sleep(ms)`: 统一延迟；E2E 下可通过 `window.__HIS_AGENT_FAST_ANIMATION__ = true` 缩短等待。
- `flashElement(el, type)`: 对目标元素做柔和闪烁。
- `pulseElement(el, type)`: 手动或 Agent 点击 pulse。
- `agentClickElement(el, options)`: Agent 点击/按下/跳转前可视反馈。
- `agentFocusField(el, options)`: 定位并高亮字段。
- `agentClearAndType(el, value, options)`: 清空字段并按块模拟输入，触发 `input/change`。
- `agentSelectOption(selectEl, value, label, options)`: select 选择过程提示和 value 设置。
- `agentSetDate(inputEl, value, options)`: 日期字段修改过程提示。
- `highlightChangedField(fieldName)`: 根据 `data-field` 高亮字段。
- `highlightPatientRow(patientId)`: 根据 `data-patient-id` 高亮患者行。
- `showAgentActionToast(message, type)`: 显示 Agent 操作 toast。

### `shared/agent-task-orchestrator.js`

- `startTask(objective, options)`: 任务入口。
- `runTaskLoop(context)`: 执行结构化任务步骤。
- `handleLoginPreconditionReply(task, objective)`: 处理登录前置确认。
- `classifyLoginPreconditionReply(value)`: 将“是 / 好 / 继续 / 123”等确认话术分类为 confirm。
- `addProgress(task, message, details)`: 写入任务进度。
- `saveTask(task)`: 保存 activeTask。

### `shared/voice-input-controller.js`

- `checkStatus(options)`: 检查 ASR health 和浏览器麦克风能力。
- `toggle(options)`: 开始或停止语音输入。
- `start(options)`: 启动录音与 ASR 连接。
- `checkAsrHealth(asrHealthUrl)`: 只判断 ASR 服务 health。
- `detectMicrophoneStatus(permission)`: 判断浏览器麦克风 API / 权限 / 安全上下文。
- `updateVoiceDebug()`: 更新 `window.__HIS_AGENT_VOICE_DEBUG__`。

## 状态显示规则

- Backend、LLM、Agent、ASR 服务状态来自 `runtime-config` 和 health/test 接口。
- 麦克风状态来自浏览器能力与权限，不等于 ASR 服务状态。
- 如果 ASR `/health` 为 200，但当前浏览器没有 `navigator.mediaDevices.getUserMedia`，应显示：
  - `ASR 服务: connected`
  - `麦克风: unavailable`
- 如果页面不是安全上下文，应显示：
  - `ASR 服务: connected` 或实际 health 结果
  - `麦克风: insecure_context`
- 上述浏览器限制不能被误报为 `ASR disconnected`。

## 任务展示规则

- 顶部只显示简洁连接状态。
- 旧的 `#hisAgentTask` 大块 dump 不应在正式 UI 中显示。
- 当前任务步骤由 `#hisAgentTaskList` 展示。
- 每个步骤必须显示：
  - 编号
  - 状态：`completed` / `running` / `pending` / `failed`
  - 耗时：`MM:SS` 或 `--:--`
  - token：有值显示数字，无消耗显示 `token: -`，后端未返回显示 `token: 未返回`
- 详情放入可展开区域，不展示原始完整思考链。

## 回归测试锚点

相关 E2E 位于 `tests/e2e/his-agent.spec.ts`：

- `HIS floating Agent visibility`
- `Chinese text encoding`
- `Floating Agent task display`
- `Login page task precondition`
- `activeTask lifecycle`

每次修改悬浮框 UI 后至少运行：

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31875 npm run test:e2e -- --reporter=list
```

## 2026-06-15 悬浮框专题入口改版

正式悬浮框仍只修改 `shared/agent-widget.js` 和 `shared/agent-widget.css`。

- 顶部标题改为 `HIS AGENT`，右上角保留关闭按钮。
- Agent 首页新增 `#hisAgentHome` 和 `#hisAgentTopicGrid`。
- 可见专题卡：
  - 查看患者管理
  - 系统连接情况
  - 查看历史任务
  - 示例任务
- 点击“查看患者管理 / 查看历史任务”不会走自然语言 fallback，而是转成 Agent 对话并给出明确跳转按钮；用户点击按钮后按手动 UI 操作跳转。
- 点击“系统连接情况”会刷新并以竖向文本列出 Backend、LLM、Agent、ASR 服务、麦克风、Data 状态。
- 点击“示例任务”会列出 5 个覆盖登录、页面切换、患者定位、联系方式修改、就诊信息修改、病历字段修改和 not_found 安全分支的任务；点击示例后走与输入框发送一致的 LLM gate 流程。
- 用户发送任务后，首页专题卡渐隐，`#hisAgentCurrentTaskCard` 成为中间主卡，展示当前任务摘要、步骤列表、耗时、token、查看完整记录和红色取消任务按钮。
- ASR 转写仍只填入输入框；点击发送任务时若正在录音，会先停止语音输入再发送。

### 2026-06-15 轮播专题补充

- `#hisAgentTopicGrid` 改为 carousel 容器。
- `#hisAgentTopicTrack` 横向承载专题页，每页显示两张大专题卡。
- `#hisAgentTopicPrevButton` / `#hisAgentTopicNextButton` 控制专题页左右滑动，使用 CSS transition 展示平滑切换。
- `就诊会话` 从顶部并列 tab 迁移为专题卡；顶部 `#hisAgentTabVoice` 保留为内部状态切换锚点但在正式 UI 中隐藏。
- 点击 `就诊会话` 专题后，先转换为 Agent 对话并给出 `进入就诊会话` 按钮；用户点击后切换到现有 voice panel。
- voice panel 新增 `#hisAgentBackToHomeButton` 用于返回专题入口。

### 2026-06-15 单专题循环与连接检查修复

- 专题轮播改为每次切换一个专题，`state.topicPage` 表示当前左侧专题索引。
- `#hisAgentTopicTrack` 使用首尾 clone 卡支持循环切换：
  - 第一项点击左箭头会跳到最后一项。
  - 最后一项点击右箭头会跳回第一项。
- `renderHistory()` 不再自动根据历史消息强制进入对话模式，避免点击取消后无法回到专题首页。
- 专题对话中的 `取消` 会清空该专题对话并返回主专题页。
- 连接情况专题会立即回复“正在检查”，并对 backend / ASR / LLM 状态探测使用 5 秒 fetch timeout，避免第三方 LLM test 慢响应导致悬浮框看起来没有回复。


## 2026-06-12 mapping update

Formal widget changes remain in `shared/` only:
- `shared/agent-widget.js`: task rows now show inline reason text for failed/waiting steps, hourglass running marker, and structured expandable details with resolver logs, adapter result, value change, audit details, error, and token usage.
- `shared/agent-widget.css`: added `.his-agent-task-error` for inline failure/waiting reasons.
- `shared/voice-input-controller.js`: `window.__HIS_AGENT_VOICE_DEBUG__.dump()` reports ASR health and microphone/browser capability separately.
- `shared/agent-task-orchestrator.js`: waiting_user confirmation handling expanded for login precondition; resolver not_found message is explicit without changing patient-store matching rules.
Formal HTML cache-busting version is now `20260612-voicemigration` in `html/` pages.
## 2026-06-12 Agent 执行记录页面迁移

正式悬浮框文件仍为：

- `shared/agent-widget.js`
- `shared/agent-widget.css`
- `shared/agent-widget-bootstrap.js`

本轮将重信息从悬浮框迁出：

- 悬浮框保留：连接状态、Agent 对话、当前任务简略摘要、输入区、取消任务、新会话、服务地址折叠区、“查看完整记录”按钮。
- 悬浮框移出：长期展示的结构化步骤详情、开发者详情、任务历史、raw action / trace / pageState debug。
- 新承载页面：`html/agent-history.html`。

`html/agent-history.html` 只读读取：

- `hisAgentActiveTask`
- `hisAgentTaskHistory`
- `PatientStore.getAuditLog()`
- patient-store 中的相关患者摘要

任务详情页面展示：

- 任务列表和当前任务详情。
- 每步状态、MM:SS 耗时、token，未消耗显示 `token: -`。
- 每步折叠详情中的 LLM 结构化 action、resolver 日志、adapter 结果、oldValue / newValue、audit_id、错误详情。
- 开发者详情默认折叠，不展示完整原始思考链。
## 2026-06-12 ASR / 就诊会话模块映射

正式就诊会话 UI 仍在 `shared/agent-widget.js` / `shared/agent-widget.css`，由所有 `html/` 正式页面引用。

新增/确认的正式 DOM：

- `#hisAgentTabVoice`：切换到“就诊会话”。
- `#hisAgentVoiceStatusCard`：显示 ASR 服务、麦克风、LLM、写入权限状态。
- `#hisAgentStartVoiceButton` / `#hisAgentStopVoiceButton`：开始/停止语音任务。
- `#hisAgentMockTurnsButton`：填入模拟就诊会话。
- `#hisAgentManualTranscript` / `#hisAgentPasteTurnsButton`：粘贴文本并转换为 doctor/patient turns。
- `#hisAgentTurns`：显示实时转写、临时/最终 turns、手动修正说话人。
- `#hisAgentFillAgentInputButton`：只把 turns 填入 Agent 输入框，不自动发送。
- `#hisAgentCopyTurnsButton`：复制 turns 文本。
- `#hisAgentSwapRolesButton`：一键交换医生/患者。
- `#hisAgentClearTurnsButton`：清空当前语音记录。
- `#hisAgentSendTurnsButton` / `#hisAgentDraftButton` / `#hisAgentWriteDraftButton`：受 LLM gate 控制；无 LLM 时禁用。
- `#hisAgentVoiceDebug`：ASR raw/debug 信息，默认折叠。

产品边界：

- ASR 只负责转写和 turns 展示。
- `填入 Agent 输入框` 不执行任务。
- `写入病历字段` 先填入确认式指令，用户手动发送后才可能走 backend_llm action。
- 当前没有真实自动 speaker diarization，只有默认 role mapping 和手动修正。

## 2026-06-12 microphone diagnostic mapping

Formal files:
- `shared/agent-widget.js`
- `shared/voice-input-controller.js`

New / updated DOM:
- `#hisAgentCheckMicrophoneButton`: user-triggered real browser microphone permission probe. It calls `getUserMedia({ audio: true })` only after the user clicks.
- `#hisAgentForceProbeButton`: toggles `his_voice_microphone_policy` between `auto` and `force_probe`.
- `#hisAgentVoiceStatusCard`: shows ASR service, WebSocket, microphone, permission, secure-context, and policy status separately.
- `#hisAgentVoiceDebug`: collapsed developer details with the read-only voice debug dump.

State / storage:
- `his_voice_microphone_policy`: `auto` by default, optional `force_probe`.
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()`: read-only diagnostic object; it does not start recording.

Debug fields:
- `href`, `protocol`, `hostname`, `isSecureContext`
- `hasNavigatorMediaDevices`, `hasGetUserMedia`
- `permissionState`, `microphoneStatus`
- `asrHealthUrl`, `asrHealthStatus`
- `asrWebSocketUrl`, `asrWebSocketStatus`
- `lastVoiceErrorName`, `lastVoiceErrorMessage`, `lastCheckedAt`

Important rule:
- `isSecureContext=false` is diagnostic only and must not by itself mark the microphone unavailable.
- Browser microphone failures must not overwrite ASR service health.
## 2026-06-12 old ASR microphone flow mapping

Formal files:
- `shared/voice-input-controller.js`
- `shared/agent-widget.js`

Migrated flow:
- `#hisAgentVoiceButton` calls `HisVoiceInputController.toggle()`.
- `HisVoiceInputController.start()` checks ASR health, opens ASR WebSocket, then calls `navigator.mediaDevices.getUserMedia({ audio: true })`.
- On success it creates `AudioContext`, `MediaStreamSource`, `ScriptProcessor(4096, 1, 1)`, downsamples to 16 kHz, and sends audio buffers to ASR WebSocket.
- On stop it sends `{ type: "end" }`, disconnects processor/source, stops all tracks, closes `AudioContext`, and closes WebSocket.
- `partial` messages update realtime transcript; `final` messages update doctor/patient turns.
- `#hisAgentFillAgentInputButton` only fills turns into the Agent input. It does not auto-send or execute actions.

Debug fields:
- `didCallGetUserMedia`
- `getUserMediaCalledAt`
- `audioContextState`
- `streamTrackCount`
- `lastVoiceErrorName`
- `lastVoiceErrorMessage`

UI rule:
- Do not present HTTP / non-localhost as the main microphone failure before a real `getUserMedia` attempt.
- ASR service status, ASR WebSocket status, and microphone status are shown separately.
## 2026-06-15 - Timing, Token, and Operation Feedback Anchors

- Current formal frontend URL: `http://10.26.6.8:31875/html/login.html?v=20260622-agent-v2-productization`.
- Task elapsed duration:

## 2026-06-15 timer/asr update

- Timer source of truth:
  - `shared/agent-widget.js` captures `taskStartedAtMs` when the user sends the task and immediately shows `计时结果：00:00`.
  - `shared/agent-task-orchestrator.js` receives `taskStartedAtMs` and uses it for active task elapsed time, progress messages, and history.
  - `shared/agent-widget.js` refreshes the current task summary every second while a task is active.
- ASR source of truth:
  - `shared/voice-input-controller.js` uses runtime ASR URL `http://10.26.6.8:31478`, converts it to WebSocket `/ws`, then requests browser microphone access.
  - Browser microphone capability uses `navigator.mediaDevices.getUserMedia` when available and falls back to legacy `navigator.getUserMedia` / `webkitGetUserMedia`.
  - ASR health state and browser microphone state stay separate.
  - `shared/agent-task-orchestrator.js` formats progress elapsed as `MM:SS`.
  - `shared/agent-widget.js` renders current task and task history elapsed duration as `MM:SS`.
  - `html/agent-history.html` renders task and step elapsed duration as `MM:SS`.
- Token display:
  - Floating widget current task and history list show compact total token only.
  - Step rows show `token: -` when no step usage exists.
  - Missing backend usage remains `token: 未返回`.
  - Prompt/completion/total details are preserved in task details JSON/developer detail rather than the main compact UI.
- Agent operation feedback:
  - `shared/patient-editor-action-adapter.js` emits `his-agent-ui-feedback` and writes `hisAgentUiFeedback` for UI-only feedback.
  - `html/patient-editor.html` listens for that event and highlights `[data-field="<field>"]`, the clinical field card with matching id, and the save button.
  - `html/patient-management.html` uses `tr[data-patient-id]` and flashes the related patient row when a recent Agent feedback marker exists.

## 2026-06-15 Topic Response / Connection Card Mapping

Formal files:
- `shared/agent-widget.js`
- `shared/agent-widget.css`

Topic response state:
- `beginTopicConversation(label)` clears old topic messages before rendering a new topic response.
- `.topic-response-mode` marks the panel as a lightweight topic/dialog screen.
- `backToAgentHome()` removes `.topic-response-mode` and returns to the topic carousel.

Connection status topic:
- `showConnectionTopic()` renders one replace-in-place `.his-agent-message-connection-status` card.
- Refreshing the connection topic updates the existing card instead of appending more Agent bubbles.
- The card rows are rendered by `renderConnectionStatusMessage()` from `details.rows`.
- Rows shown: Backend, LLM, Agent, ASR 服务, 麦克风, Data.
- Technical URLs and errors remain in the collapsed message details.

CSS anchors:
- `.his-agent-message-topic-card`
- `.his-agent-message-topic-command`
- `.his-agent-message-connection-status`
- `.his-agent-connection-topic-grid`
- `.his-agent-connection-topic-row`
- `.his-agent-connection-error`

Regression test:
- `tests/e2e/his-agent.spec.ts`
- Test name: `connection topic renders a replace-in-place status card`
- It verifies 6 status rows and that refresh keeps `#hisAgentHistory .his-agent-message` at 2 messages.
## 2026-06-17 Diarization 状态映射

- `shared/voice-input-controller.js`：新增独立 diarization health / WebSocket 状态，不复用 ASR 状态。
- `shared/agent-widget.js`：语音面板显示 `说话人分离` 和 `Diarization WS`，turn meta 展示 `speaker_id`、`source`、`manual/auto`、`final/provisional`。
- `shared/runtime-config.js`：新增 `diarizationUrl`，默认走 backend proxy。
- Diart 未真正可用时，UI 显示 manual/unavailable dependency，不显示自动医生/患者分离。

## 2026-06-17 Diart 真实流验证映射

当前真实浏览器 / Playwright fake microphone 验证路径：

- 打开 `http://10.26.6.8:31875/html/login.html?v=20260622-agent-v2-productization`。
- 悬浮 Agent -> 就诊会话 -> `语音输入`。
- `shared/voice-input-controller.js` 同时连接：
  - ASR: `ws://10.26.6.8:31478/ws`
  - Diarization: `ws://10.26.6.8:31451/ws/diarization`
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()` 当前可确认：
  - `asrHealthStatus=connected`
  - `asrWebSocketStatus=connected`
  - `diarizationProvider=diart_local`
  - `diarizationStatus=available`
  - `diarizationWebSocketStatus=connected`
  - `microphoneStatus=recording`
- `HisVoiceInputController.getState().diarizationSegments` 可看到真实 segment：
  - `speaker_id`
  - `source=diart_local`
  - `automatic=true`
  - `start_ms` / `end_ms`
- `HisVoiceInputController.getState().turns` 当前可看到 ASR turns 与 Diart 来源合并：
  - `raw_speaker_id`
  - `source=diart_local`
  - `role` / `role_label`

已知 UI metadata 缺口：

- 已修复：turn 对象会完整保留显式 `speaker_id` 和 `automatic_diarization=true`，rendered turn meta 可显示 `diart_local / auto`。
- 已修复：Diart 输出 `speaker0` / `speaker1` 会归一化为 `speaker_0` / `speaker_1` 后再做默认角色映射。
- 当前默认映射仍是 demo 规则，不是 LLM 语义校正。

## 2026-06-17 Diart speaker metadata mapping

Formal files:

- `shared/voice-input-controller.js`
- `shared/agent-widget.js`
- `tests/e2e/his-agent.spec.ts`

Core helper:

- `HisVoiceInputController.normalizeSpeakerId(value)`
- `speaker0`, `speaker_0`, `SPEAKER_0`, `spk0` -> `speaker_0`
- `speaker1`, `speaker_1` -> `speaker_1`
- Empty / unknown speaker -> `null`

Turn metadata preserved by `shared/voice-input-controller.js`:

- `raw_speaker_id`
- `speaker_id`
- `source`
- `diarization_source`
- `automatic`
- `automatic_diarization`
- `diarization_start_ms`
- `diarization_end_ms`
- `diarization_confidence`

Default role mapping:

- `speaker_0` -> `role=doctor`, `role_label=医生`
- `speaker_1` -> `role=patient`, `role_label=患者`
- `null` / unknown -> `role=unknown`, `role_label=未确认`

Widget behavior:

- `renderTurns()` shows concise turn meta: normalized `speaker_id`, optional `raw:<id>`, `source`, `diarization_source`, final/partial, and auto/manual state.
- `correctTurnRole()` marks `role_source=manual_corrected`; it does not overwrite `raw_speaker_id`, `speaker_id`, `source`, or `diarization_source`.
- `swapTurnRoles()` marks `role_source=manual_swapped`; it swaps roles only and preserves speaker metadata.
- `window.__HIS_AGENT_WIDGET_DEBUG__.speakerTurns` exposes recent turns for debugging without putting raw JSON in the main UI.

Regression test:

- `tests/e2e/his-agent.spec.ts`
- Test name: `voice controller normalizes Diart speaker metadata before turns`
- It verifies normalization, `speaker1 -> patient/患者`, `speaker0 -> doctor/医生`, Diart metadata preservation, and manual fallback not faking automatic diarization.
# 2026-06-21 语音就诊会话 UI 映射补充

- `shared/agent-widget.js`
  - `state.speakerTurns`：医生/患者 turns 的正式状态。
  - `state.voiceSessionEnded`：控制语音后续处理入口是否出现。录音中为 `false`，停止录音、粘贴 turns、填入模拟会话后为 `true`。
  - `#hisAgentPostVoiceActions`：语音结束后才显示的后续处理区，包含“整理到输入框 / 生成结构化草稿 / 生成 Agent 任务”。
  - `renderTurns()`：逐段渲染医生/患者 turns，每段支持手动修正说话人。
  - `prepareWriteDraftInstruction()`：生成确认式 Agent 任务并填入输入框，不自动发送。
- `shared/voice-input-controller.js`
  - `buildIncomingTurns()`、`mergeTurns()`：将 ASR partial 作为临时段更新，将 final 作为独立 turn 追加并去重，避免多轮对话被覆盖成一段。
- `shared/agent-widget.css`
  - `.his-agent-turn.doctor` / `.his-agent-turn.patient`：医生/患者分段视觉区分。
  - `.his-agent-post-voice-actions[hidden]`：隐藏未到时机的后续处理入口。

## 2026-06-21 Voice Panel Simplification

Formal voice UI lives in `shared/agent-widget.js` and is rendered under `[data-agent-panel="voice"]`.

Current visible controls:
- `#hisAgentVoiceButton`: start/stop voice recording from the shared footer.
- `#hisAgentStartVoiceTaskButton`: start recording in the voice panel.
- `#hisAgentStopVoiceTaskButton`: stop recording; this triggers LLM planning when turns exist.
- `#hisAgentMockTurnsButton`: fills a demo doctor/patient conversation for testing.
- `#hisAgentSwapRolesButton`: swaps doctor/patient roles for current turns.
- `#hisAgentClearTurnsButton`: clears current turns.

Removed from the formal UI:
- connection status grid inside the voice panel,
- ASR developer details panel,
- copy transcript button,
- paste-as-turns/manual transcript textarea,
- fill Agent input button,
- duplicate structured-draft/write buttons.

After stopping a voice task, `planVoiceConversationAfterStop()` calls `AgentTaskOrchestrator.planTaskOnly()` and renders a confirmable task-list bubble. Execution happens only through the explicit `voice-plan-execute` action, which calls `AgentTaskOrchestrator.executePlannedTask()`.

## 2026-06-22 语音会话整理任务 UI 映射

本节 supersedes 2026-06-21 的自动 planning 描述：停止语音后不再自动调用 task planning。

Formal files:

- `shared/agent-widget.js`
- `shared/agent-widget.css`
- `backend/main.py`
- `tests/e2e/his-agent.spec.ts`

Visible control:

- `#hisAgentPlanVoiceTaskButton`：按钮文案“结束对话并整理任务”。当前存在至少 1 条 final doctor/patient turn 时显示并可点击；点击后会先刷新检测 LLM，未连接时只提示，不调用整理接口、不执行页面动作。
- `#hisAgentViewBackButton`：聊天/语音视图唯一返回入口。内部重复的 `#hisAgentChatBackButton` 和 `#hisAgentBackToHomeButton` 已移除，避免聊天视图和语音视图出现多重“返回”。

Frontend functions:

- `endVoiceConversationAndDraftTask()`：按钮入口。若仍在录音，先停止 `HisVoiceInputController`，再收集 turns。
- `finalSpeakerTurns()`：仅保留 role、role_label、text、is_final，不带 raw speaker/debug/source。
- `currentPatientContext()`：仅收集 patientId、patientName、pageType。
- `requestVoiceTurnsToAgentTask()`：调用 `POST /api/voice/turns-to-agent-task`。
- `renderVoiceTaskReviewMessage()`：在聊天框渲染“已根据就诊会话整理出以下任务，请确认或编辑后执行：”、可编辑 textarea、执行/取消按钮。
- `executePendingVoiceTask()`：使用医生编辑后的自然语言任务进入现有 `handleCommand()` taskflow。

Backend endpoint:

- `POST /api/voice/turns-to-agent-task`
- 输入：patient_context、current_page_type、current_patient_id、turns。
- 输出：`{ ok: true, task_text, usage, provider, model }`。
- 输出不包含 action plan，不写 audit log，不修改 patient-store。

Actions:

- `voice-task-execute`：执行医生确认后的自然语言任务，之后才进入 backend LLM planner 和 allowlist executor。
- `voice-task-cancel`：取消本次整理，不执行页面动作，保留原始 turns。

Difference from nearby controls:

- “填入输入框”只填文本，不自动整理、不自动执行。
- “生成病历草稿”面向病历草稿文本；“结束对话并整理任务”面向待确认页面操作任务。
- “结束对话并整理任务”本身也不执行，必须医生确认后才进入 taskflow。
- 连接状态卡片只保留“刷新状态”动作，不再在消息气泡内提供“返回专题”。

## 2026-06-22 Agent 浮窗产品化 UI 映射

Formal files:

- `shared/agent-widget.js`
- `shared/agent-widget.css`
- `tests/e2e/his-agent.spec.ts`

Top-level view state:

- `state.viewMode`：当前支持 `home`、`chat`、`voice`、`status`、`examples`。
- `renderViewMode()`：保证五个主视图互斥显示，并同步浮窗顶部标题。
- `#hisAgentViewBackButton`：唯一返回入口；返回时进入 `home`，不再在各子视图内部重复渲染返回按钮。

Home:

- `#hisAgentHomeView`
- 首页只保留专题入口、当前任务卡片和必要的顶部状态。
- 专题轮播按钮使用 `.his-agent-topic-nav-button`；默认白底，hover 时蓝色高亮。

Chat:

- `#hisAgentChatView`
- `#hisAgentHistory`：只负责聊天记录、任务计划确认、Agent 执行反馈和错误提示。
- `runExampleTask()` 和医生确认后的 `executePendingVoiceTask()` 会进入 chat view，并继续走现有 `handleCommand()` taskflow。

Voice:

- `#hisAgentVoiceView`
- `#hisAgentVoiceStatusCard`：展示语音任务状态摘要。
- `#hisAgentVoiceSessionSummary`：展示当前 final turns 数量和后续操作提示。
- `#hisAgentFillVoiceInputButton`：仅填入输入框，不发送、不执行。
- `#hisAgentPlanVoiceTaskButton`：已有 final turns 时可点击；点击后仍受 LLM gate 约束。
- `#hisAgentTurns`：医生/患者 turns 列表；每条 turn 的 `speaker_id`、`source` 等技术信息在 `.his-agent-meta-details` 中默认折叠。
- `details.his-agent-voice-debug-panel`：ASR / diarization debug 信息的折叠入口，默认关闭。

Status:

- `#hisAgentStatusView`
- `#hisAgentStatusContent`
- `#hisAgentRefreshStatusButton`
- `renderStatusView()`：渲染后端服务、LLM、Agent、ASR、麦克风、说话人分离、数据源七项中文状态。
- `details.his-agent-developer-foldout`：折叠 Backend / LLM / ASR / Diarization 原始诊断和 URL。

Examples:

- `#hisAgentExamplesView`
- `#hisAgentExamplesList`
- `renderExamplesView()`：渲染示例任务卡片；点击卡片只把自然语言任务交给现有 Agent taskflow，不创建新的执行通道。

Footer:

- `#hisAgentInput`：动态高度输入框，保持紧凑。
- `#hisAgentSendButton`、`#hisAgentVoiceButton`、`#hisAgentNewSessionButton`：主操作区按钮。
- `details.his-agent-settings`：日常 UI 中隐藏，避免服务地址配置占据普通业务视图。

Non-goals:

- 本轮不改 Agent 执行业务逻辑、不改 ASR 主链路、不改 Diart 安装、不改 patient-store / resolver、不恢复 fallback。

## 2026-06-22 主输入语音 / 就诊会话拆分映射

Formal files:

- `shared/agent-widget.js`
- `shared/agent-widget.css`
- `shared/voice-input-controller.js`
- `tests/e2e/his-agent.spec.ts`

Footer controls:

- `#hisAgentSendButton`：发送底部输入框文本，进入现有 Agent taskflow。
- `#hisAgentVoiceButton`：主输入听写按钮。idle 显示“语音输入”；dictation 录音中显示“停止录音”。
- `#hisAgentVisitSessionButton`：进入就诊会话视图，只切换到 `voiceView`，不自动开麦。
- `#hisAgentNewSessionButton`：新会话；如果仍在录音，会先释放语音资源。

Main input dictation:

- `toggleVoice()`：只控制主输入听写，不再进入 `voiceView`。
- `startDictationVoice()`：调用 `HisVoiceInputController.start({ mode: "dictation", enableDiarization: false })`。
- `applyDictationTranscript()`：把 ASR partial/final 写入 `#hisAgentInput`，不更新 `state.speakerTurns`。
- `stopActiveVoice()`：统一停止 controller，释放 MediaStream tracks、audio pipeline 和 WebSocket。

Visit session:

- `openVisitSession()`：进入就诊会话页面，不启动麦克风。
- `startVoiceTask()` / `startSessionVoice()`：只有页面内“开始语音任务”才启动会话录音，并允许 diarization。
- `stopVoiceTask()`：停止就诊录音并保留 turns。
- `endVoiceConversationAndDraftTask()`：如仍在录音，先 `stopActiveVoice()`，再把 final turns 整理为待确认自然语言任务。

VoiceView default UI:

- 默认显示三项产品化状态：麦克风、ASR、说话人分离。
- `details.his-agent-voice-dev-summary`：折叠 ASR WebSocket、Diarization WS、provider、mic policy。
- `details.his-agent-voice-debug-panel`：折叠完整 debug dump。
- turns 默认显示角色标签、文本、角色修正下拉；`.his-agent-meta-details` 默认折叠技术元信息。

Release boundaries:

- 关闭浮窗、离开就诊会话、切换 tab、点击新会话、发送任务、整理任务前，都会通过 `stopActiveVoice()` 释放当前录音。
- 主输入听写不会生成医生/患者 turns；就诊会话按钮不会自动开麦。
## 2026-06-23 Agent V2 trace / task card 映射

Formal files:

- `shared/agent-flow-trace.js`
- `shared/agent-task-orchestrator.js`
- `shared/agent-widget.js`
- `shared/agent-widget.css`
- `html/login.html`
- `html/dashboard.html`
- `html/patient-management.html`
- `html/patient-editor.html`
- `html/agent-history.html`
- `tests/e2e/his-agent.spec.ts`

Trace:

- `window.AgentFlowTrace.record(event, details)`：写入浏览器侧 flow trace。
- `window.AgentFlowTrace.getEvents()`：读取最近事件。
- `window.AgentFlowTrace.clear()`：清空 trace。
- `localStorage["hisAgentFlowTrace"]`：最多保留 240 条事件。

Task UI:

- `renderTaskSummary()`：只刷新任务摘要，不再改变 `state.viewMode`。
- `renderCurrentTaskCard()`：渲染紧凑 sticky 当前任务卡。
- `.his-agent-current-steps`：完整 checklist 的折叠容器，默认关闭。
- `#hisAgentTaskList`：只有展开 `.his-agent-current-steps` 后才作为完整步骤列表可见。
- `buildTaskNarration()`：把当前状态转成 Agent 口吻说明，让医生能看到 Agent 正在做什么。

Patient context:

- `rememberResolvedPatient()`：写入 `slots.canonical_patient`，并记录 `canonical_patient_remembered` trace。
- `patientEditorContext()`：读取 URL patientId、pageState patientId/name 和 pageType。
- `patientEditorContextMatches()`：验证当前编辑页是否匹配目标患者。
- `open_patient_editor`：首次执行只跳转并返回 `defer_step_completion`；目标页恢复任务后验证通过才用 `noop` 完成打开步骤。

Login idempotency:

- `isLoginFormAlreadyReady()`：判断当前登录表单是否已经满足 demo 登录值。
- `fill_login_form`：表单已是 `123/123` 时返回 no-op success，不调用 clear/type。

## 2026-06-25 Scroll / Latest Output Mapping

- `shared/agent-scroll-manager.js`
  - `scrollToBottom({ force: true })`: enters explicit auto-follow and clears unread prompt.
  - `scrollToBottom({ force: true, userInitiated: true })`: used by the unread prompt, and may override a deliberate user scroll.
  - `applyBottomFollow(force, options)`: re-aligns the body bottom after layout changes only if the user has not deliberately scrolled away, unless the call is user-initiated.
  - `afterRender()`: follows new messages only when the user was already at the bottom or the render is explicitly important.
  - `userScrolledAway`: prevents stale delayed bottom-follow timers from hiding the unread prompt after a manual upward scroll.
- `shared/agent-widget.js`
  - `renderHistory()`: wraps history updates in scroll manager `beforeRender()` / `afterRender()`.
  - `addMessage()`: stores a message, calls `renderHistory()`, then persists widget state.
  - `#hisAgentTaskPlanButton`: visible in chat view when a current/recent task exists; reopens the minimized task plan from the header.
  - `renderCurrentTaskCard()`: renders minimized and expanded task plan states without altering the task execution state.
- `loop-engineering/scripts/run-case.mjs`
  - `latest_agent_message_visible`: waits for seeded history layout, returns to the bottom, then validates new Agent output stays visible.
  - `user_scroll_not_forced_bottom`: validates a deliberate upward scroll is preserved.
  - `new_message_prompt`: validates the unread prompt appears when the user is not at the bottom.
## 2026-06-25 任务计时、步骤锁定与恢复滚动

- `shared/agent-task-orchestrator.js`
  - active task/step 持久化 `started_at_ms` 和 `started_mono_ms`；running 显示实时耗时，terminal 任务冻结 `elapsed_ms`。
  - `demoPacingConfig()` 读取 `window.__HIS_AGENT_DEMO_PACING__`、`localStorage.his_agent_demo_pacing`，并在 fast animation 下关闭等待。
  - `updateTaskTiming()` 从 step breakdown 汇总 `action_ms / verify_ms / animation_ms / demo_delay_ms / page_navigation_ms`。
- `shared/agent-widget.js`
  - `startTaskSummaryTicker()` 以 250ms 更新当前任务耗时。
  - `renderTaskList()` / `lockTaskListToCurrentStep()` 给 running step 添加 `current-step` 和 `agent-step-pulse`，并在展开步骤时锁定当前 step。
  - 用户滚动 `#hisAgentTaskList` 后记录 pinned scroll，后续 progress render 保留内部 scrollTop。
  - `prepareInitialScrollRestore()` / `restoreInitialScrollSnapshot()` 在页面切换后用 `auto` 恢复聊天区滚动，避免可见 smooth scroll。
- `shared/agent-widget.css`
  - `.his-agent-task-item.current-step`、`.agent-step-pulse` 和 `.his-agent-body.restoring-scroll` 是本轮新增的关键样式。
- `html/agent-history.html`
  - 历史页显示冻结耗时；本地 DOM 步骤显示 `token: 本地执行`，缺失旧数据为 `未记录`。
## 2026-06-25 任务计时与步骤滚动最终映射

- `shared/agent-task-orchestrator.js`
  - `started_mono_ms / finished_mono_ms`：用于运行中计时恢复和终态冻结。
  - `recordActionTiming()` / `updateTaskTiming()`：从 step breakdown 重新汇总 `execute_ms / verify_ms / animation_ms / page_navigation_ms / demo_delay_ms`。
  - `demoPacingConfig()` / `waitDemoPacing()`：演示节奏默认关闭，fast animation 模式强制关闭。
- `shared/agent-widget.js`
  - 当前任务 ticker 为 250ms；running/waiting 显示 live elapsed，completed/failed/cancelled 显示冻结 elapsed。
  - `currentTaskStepLock` 和 `currentTaskStepsScroll` 保持展开步骤列表的局部滚动。
  - `prepareInitialScrollRestore()` / `restoreInitialScrollSnapshot()` 使用瞬时恢复，避免页面切换时可见滑动。
- `shared/agent-widget.css`
  - `.current-step` / `.agent-step-pulse` 标记当前执行步骤；`.restoring-scroll` 隐藏首帧恢复过程。
- `tests/e2e/his-agent.spec.ts`
  - 覆盖 live timer/freeze、step pulse/scroll、demo pacing fast mode、chat scroll instant restore。
## 2026-06-28 Voice Session Semantic Role Mapping

- `shared/agent-widget.js`
  - `SEMANTIC_ROLE_COOLDOWN_MS` / `SEMANTIC_ROLE_MIN_*`: low-frequency semantic mapping guards.
  - `initializeSemanticRoleMapping()`: runs when `开始语音任务` starts; `就诊会话` alone does not call it.
  - `maybeTriggerSemanticRoleMapping()` / `runSemanticRoleMapping()`: async mapping after new final turns; does not block ASR/Diart.
  - `runFinalSemanticRoleMapping()`: used by stop and end-conversation flows.
  - `freezeVoiceTurnsForReview()`: freezes corrected turns before task organizing.
  - `applySemanticRoleMapping()`: updates only non-manual turns; `manual_corrected` and `manual_swapped` remain authoritative.
  - `finalSpeakerTurns()`: task organizer payload contains only doctor/patient role text, not raw speaker/source/debug.
- `backend/main.py`
  - `POST /api/voice/semantic-role-map`: returns speaker role mapping only; no page action or business writes.
- `tests/e2e/his-agent.spec.ts`
  - Covers low-frequency trigger, cooldown, stop, final mapping + freeze, dictation isolation, and manual-priority protection.
