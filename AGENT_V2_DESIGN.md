# Agent V2 Design

更新时间：2026-06-22

## 2026-06-23 状态闭环补充

- 当前任务 UI 的可展开步骤属于医生阅读状态，不属于 task 执行状态；因此按 taskId 保存到 `hisAgentTaskStepsUiV2`，不随 progress render 丢失。
- 发送新任务后，前端先创建 `planningTask` 和 `runId`，直到 backend planner 返回前都显示当前任务占位，不展示最近完成任务。
- 未发送输入是医生草稿，保存到 `hisAgentInputDraftV2`；页面切换和刷新会恢复，任务被接受执行或取消后清空。
- chatView 滚动位置保存到 `hisAgentScrollRestoreV2`；初始化时先恢复滚动再显示主滚动容器，避免可见滚动动画。
- 取消任务是 terminal transition：`cancelActiveTask()` 冻结计时、归档历史、清空 activeTask，并阻止晚到事件复活任务。
- 就诊会话整理只生成待确认自然语言任务，新增 `explicit_action / clinical_draft / no_action / needs_clarification` 分类；确认前不写 patient-store、不保存、不写 audit log。

## 2026-06-24 Loop Engineering 补充

- 新增 `loop-engineering/`，把核心场景、真实浏览器执行、确定性评估、机器可读 result 和 checkpoint 分离。
- Explorer 只跑浏览器/健康探测并捕获 trace；Evaluator 只根据后置条件评分；Implementer 只修 `first_failure`。
- baseline/evaluate 默认不执行真实 mutation，避免为了验证基础设施而污染 Demo 数据。
- 每轮 artifact 保留 `result.json`、`report.md`、case trace 和文件级 checkpoint，用于后续 Codex 会话继续。

## 目标

Agent V2 的目标是把悬浮 Agent 从“一个输入框加若干状态块”整理成可维护的产品工作流：

- 输入先经过统一 router，判断是新任务、续接 waiting_user、取消、确认、主输入语音文本，还是就诊会话整理任务。
- 对话状态由 state machine 记录，避免 chat / planning / running / waiting_user / voice 等状态互相覆盖。
- 任务对象统一为 task schema，步骤对象统一为 step schema，方便 UI、历史页和 E2E 读取。
- 当前任务进度留在当前任务卡片，不再把每个终端日志都塞进聊天流。
- 聊天滚动由 scroll manager 管理，用户上滑阅读时不强行拉到底，有新消息时显示未读提示。
- 主输入语音和就诊会话彻底分开：主输入语音只把医生口述转成任务文本；就诊会话才采集医生/患者 turns。

## 新增模块

| 文件 | 作用 |
| --- | --- |
| `shared/agent-input-router.js` | 标准化输入并输出 route 决策，例如 `start_new_task`、`continue_active_task`、`ask_disambiguation`、`create_voice_task_draft`。 |
| `shared/agent-state-machine.js` | 记录 conversation state 和 transition，供 UI 和 E2E 观察。 |
| `shared/agent-task-model.js` | 规范化 task / step 字段，包括 `task_id`、`status`、`waitingFor`、`usage_total`、`audit_ids`、`elapsed_ms`。 |
| `shared/agent-scroll-manager.js` | 管理聊天容器自动跟随、未读消息提示和用户手动滚动保护。 |

这些模块只做前端状态、展示和输入路由，不执行页面业务动作，不写 patient-store，不绕过 LLM gate。

## 输入路由

`AgentInputRouter.routeInput()` 接收标准输入对象：

```json
{
  "input_id": "input_...",
  "input_type": "text",
  "text": "修改 P001 手机号并保存",
  "source_view": "chat",
  "active_task_id": "task_...",
  "conversation_state": "waiting_user"
}
```

核心规则：

- `voice_text`：只写底部输入框，由用户手动发送。
- `voice_session_task`：只创建就诊会话的待确认自然语言任务。
- `waiting_user + 普通文本`：续接当前 task，保持原 `task_id`。
- `running/planning + 新输入`：提示冲突，由医生选择继续当前任务或取消旧任务并开始新任务。
- 取消/确认只识别元指令，不解析患者字段业务语义。

## 状态机

当前状态包括：

- `home`
- `idle`
- `chatting`
- `planning`
- `task_running`
- `waiting_user`
- `voice_idle`
- `voice_recording`
- `voice_review`
- `voice_task_draft_ready`
- `confirm_execute`
- `completed`
- `failed`
- `cancelled`

状态转换保存在 `window.HisAgentWidget.getV2State().transitions`，用于调试和 E2E。状态机不代表动作授权，动作授权仍在 backend LLM planner、前端 allowlist executor、LLM gate 和 audit 机制中完成。

## waiting_user 续接

当 activeTask 处于 `waiting_user` 时，医生输入补充说明不会新建任务：

1. 保留原 `task_id`。
2. 将补充写入 `clarifications`。
3. 发送“原任务 + 当前等待点 + 本次补充”给 `/api/universal-agent/task-plan`。
4. 后端 LLM planner 返回继续澄清或结构化计划。
5. 仍通过 allowlist executor 执行，并继续写 audit log。

这避免了“上一轮等医生确认，下一句话却启动新任务”的断裂。

## 语音模式

主输入语音：

- 底部按钮为 `语音输入 / 停止录音`。
- 只启动麦克风和 ASR，把转写文本写入 `#hisAgentInput`。
- 不切换到就诊会话，不生成 doctor/patient turns，不自动发送。

就诊会话：

- 底部 `就诊会话` 只进入 voiceView，不自动开麦。
- voiceView 里的 `开始语音任务` 才启动麦克风、ASR 和可用时的 Diart。
- `停止语音任务` 只停止采集并释放麦克风。
- `结束对话并整理任务` 把 final turns 的必要文本交给 LLM，返回一段待确认自然语言任务。
- 医生编辑后点 `执行任务` 才进入现有 Agent taskflow。

## 滚动策略

`AgentScrollManager` 绑定 `#hisAgentBody`：

- 用户在底部附近时，新增消息自动跟随。
- 用户上滑阅读时，新增消息不抢滚动位置。
- 新消息到达后显示 `新消息` 按钮；点击后滚到底部并清零未读计数。

## 安全边界

- 不恢复本地自然语言 fallback。
- 不改 patient-store、resolver、adapter 业务规则。
- 不修改 `universal_agent_backup_*`。
- 无 LLM 时不执行页面动作。
- 就诊会话整理任务只生成自然语言，不直接返回 action，不直接保存，不直接写 audit log。
- `填入输入框` 只填文本，不自动执行。

## 验证状态

- `npm run check:encoding`：通过，28 个文件合法 UTF-8。
- 默认 E2E：49 passed / 3 skipped。
- `RUN_MIC_E2E=1`：49 passed / 3 skipped；可选 fake microphone 用例因当前 Chromium fake media 未暴露 `getUserMedia` 仍 skip。
- `RUN_LLM_E2E=1`：常规用例 49 passed / 3 skipped；真实 @llm 用例仍受 `/api/llm/test` 偶发 20s 超时影响而 skip。重启 backend 后单独 `/api/llm/test` 可返回 `ok:true`。

## 强制刷新

正式页面已加载新模块并使用版本：

`20260622-agent-v2-productization`

强制刷新 URL：

`http://10.26.6.8:31210/html/login.html?v=20260622-agent-v2-productization`
## 2026-06-23 Agent V2 trace 与视图解耦

本轮修复了 Agent v2 真实工作流中的五个高风险点：

- 当前任务摘要不再在 `renderTaskSummary()` 中强制 `state.viewMode = "chat"`。用户点击返回后，即使 active task 后续产生 progress，也只刷新任务摘要，不抢回 chatView。
- 当前任务卡改为紧凑 sticky 摘要，默认只展示状态、进度、耗时、token、Agent 叙述和当前步骤；完整 checklist 放入 `details.his-agent-current-steps`，默认折叠。
- `open_patient_editor` 不再因为发生跳转就立即完成步骤。它会先进入目标 URL，再在目标页用 URL / pageState / patient name 验证 canonical patient，验证通过后用 `noop` 完成打开步骤。
- 登录页 demo 账号密码已预填为 `123/123` 时，Agent 不再清空重输，只提交现有正确值。
- 新增 `shared/agent-flow-trace.js`，记录 input route、task/status、planner/action、canonical patient、URL、pageState、DOM 上下文、视图和滚动状态，用于 E2E 与现场排障。

这些改动不改变安全边界：页面动作仍必须来自 backend LLM planner，仍经过 allowlist executor、adapter 与 audit log；无 LLM 时仍不能执行动作。

强制刷新版本：

```text
20260623-agent-v2-matrix
```

## 2026-06-24 GUI Agent 与网页业务边界

本轮把登录和患者保存重新收敛到“网页是业务状态唯一权威”的模型：

- `fill_login_form` 只使用 LLM plan / 用户任务中的显式账号密码；不再把缺失值静默补成 `123/123`。
- `submit_login` 只点击真实登录按钮并等待页面自己的 submit handler；不直接设置 `hisDemoAuthenticated`，不直接跳 dashboard，不因 click dispatched 判定完成。
- 登录成功后必须由页面登录逻辑先设置认证状态，再导航到 HIS 页面；Agent 在 dashboard 端恢复任务并完成 `submit_login` step。
- 登录失败时停留 login、`hisDemoAuthenticated=false`、显示页面错误提示，并把任务标记 `failed`，不再进入 repair 覆盖凭据或继续后续 HIS 动作。
- task history / progress / flow trace 中的 password 均脱敏为 `[redacted]`；只保留 username 和 password 是否匹配请求的布尔结果。
- 患者字段 action 只操作真实 DOM 控件并触发 `input/change`；patient-store 和 audit log 只由患者编辑页保存按钮的页面 handler 写入。
- `save_patient` 通过真实保存按钮触发页面保存流程，并在保存后读取页面状态和 audit 结果校验。

真实追踪结论：

- 手动 `1234/123`：真实点击 `#loginButton`，触发 `#loginForm` submit，停留 `login.html`，页面提示账号或密码错误，`hisDemoAuthenticated=false`。
- Agent `1234/123`：`fill_login_form` action payload 保留 `username=1234`，DOM value 为 `1234`，password 与请求匹配；`submit_login` 点击同一真实按钮，触发同一 submit handler，最终任务 `failed`。

强制刷新版本：

```text
20260624-auth-boundary
```

## 2026-06-24 V3 增量设计：Observation / Generic Action / Mutation Contract

V3 不新建平行项目，在现有 V2 文件上增量加入两层：

- Generic Browser Layer：`shared/generic-browser-agent.js`，只理解 element_ref、role、accessible name、value、generic action、observation、postcondition。
- HIS Domain Adapter Layer：继续由 patient-store、patient-field-schema、patient-editor-action-adapter 和 task orchestrator 提供患者身份、字段 schema、保存后置条件和 audit 验证。

LLM 仍负责自然语言理解和结构化计划；确定性代码负责：

- action allowlist；
- `source === "backend_llm"`；
- patient / field resolver；
- mutation contract；
- 保存前置条件；
- 保存后 patient-store / audit / verify；
- 终态任务不可复活。

字段修改任务新增 Task Mutation Contract。任何包含 expected mutations 的任务，在执行前必须验证 update/save/verify 语义完整；执行中记录 mutation ledger；完成前验证目标满足。这样 planner 即使返回 find/open/save-only，也不会再直接保存并 completed。

## 2026-06-24 Mutation close-loop update

V2/V3 混合执行链路的完成语义进一步收紧：

- `verify_patient_store` 是只读校验步骤，不写 patient-store；它读取页面权威保存结果并核对 expected mutations。
- 完成任务前必须同时满足：必要字段已通过真实 DOM action 写入草稿、真实保存按钮已产生 patient-store 更新和 audit id、字段校验通过、patient-store 当前值与 expected mutations 一致。
- `hisAgentTaskHistory` 必须保留 `task_contract` 和 `mutation_ledger`，用于医生复盘 Agent 具体修改了什么、校验了什么、保存证据是什么。
- voice turns 确认执行时，planner payload 只携带最小自然语言任务和最小 `task_contract`，不携带 raw debug JSON 或完整 pageState/patient-store。

最新验证：

- `npm run check:encoding`：通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list --grep=mutation`：5 passed。
- 默认 E2E：73 passed / 3 skipped。
- `RUN_LLM_E2E=1`：73 passed / 3 skipped；当前 `@llm` 写数据用例仍由测试内部 guard skip，未作为 live LLM 写数据通过证据。

## 2026-06-24 Loop Capability Matrix Update

- Added AGENT_LOOP_ENGINEERING.md as the explicit loop-entry document; LOOP_ENGINEERING.md remains the canonical detailed design.
- run-loop.mjs now supports --case and --category filters, so a failing hard gate can be rerun directly.
- Loop results are exported to both loop-engineering/artifacts/iteration-XXX/result.json and artifacts/agent-loop/<run-id>/result.json.
- Added browser automation for Agent invalid login, Agent valid login, and save-only plan rejection when expected mutations are present.
- Added generated capability artifacts for patient-field matrix, voice role fixtures, voice task equivalence, and performance baseline.
- Current loop evidence: iteration-008 scored 100 with 10 passed / 0 failed / 19 skipped. Skipped cases remain unfinished capability work, not success.
- Runtime health in iteration-008 observed frontend/backend/ASR healthy; LLM and Diart returned fetch failed and are not claimed healthy in this pass.

## 2026-06-25 LLM Gate Clarification

- A new natural-language task still requires backend LLM planning before any page action can run.
- A persisted executable task must still have `task.source === "backend_llm"` and every executable step must have `step.source === "backend_llm"`.
- Page actions must still be selected by the allowlist executor and sent to adapters with `action.source === "backend_llm"`.
- Once the backend LLM planner has returned a valid plan, deterministic DOM steps do not re-run `/api/llm/test` before every action. This avoids interrupting a valid task when the status probe is slow, while keeping source, allowlist, mutation contract, patient-store, and audit postconditions intact.
- LLM repair remains a true LLM operation and still checks/calls the backend LLM before attempting repair.

## 2026-06-25 Final Loop Design Notes

- The current formal public URL is `http://10.26.6.8:31684/html/login.html?v=20260625-final-loop`.
- Planner JSON repair is allowed only as a backend LLM repair call for malformed JSON. It does not create actions locally, does not restore keyword fallback, and must still return through the same JSON schema validation path.
- Scroll auto-follow is part of the conversation UX contract: when the user is already at the bottom, new Agent output must remain visible; when the user has intentionally scrolled up, the widget preserves that position and shows a new-message prompt.
- `AgentScrollManager` therefore distinguishes user-scroll preservation from forced bottom alignment and keeps forced auto-follow stable across delayed layout frames.
- P2 loop automation is now part of the hard evidence set, not a skipped backlog.
