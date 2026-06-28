# Project Backlog

## Fixed - 2026-06-26 悬浮框计时采样与任务演示节奏

Fixed:
- 悬浮框当前任务耗时改为 0.1s 采样，planning 阶段也实时刷新。
- 100ms tick 只更新耗时文本，任务卡结构低频重绘，避免“展开步骤”点击或滚动时 DOM 被替换。
- 正式任务总耗时不再把执行前 LLM 状态预检计入起点，减少所有任务被同一段预检耗时抬高的错觉。
- Demo pacing 默认开启 1s step/action 间隔，成功页面动作后会等待，便于观察字段修改、保存、页面跳转反馈。
- E2E 使用 `demoPacing=0` session 覆盖关闭演示节奏；真实页面默认不带该参数。

Verification:
- `npm run check:encoding`: passed.
- `node --check shared/agent-widget.js`: passed.
- `node --check shared/agent-task-orchestrator.js`: passed.
- Targeted E2E passed: planning timer, demo pacing, expanded step scroll.
- Default E2E: 82 passed / 3 skipped.

## Fixed - 2026-06-25 语音整理任务可写入既往病史

Fixed:
- 修复“就诊会话 turns -> LLM 整理任务 -> 医生确认执行 -> 更新主诉/现病史/既往病史 -> 保存核验”链路中 `既往病史` 写入失败。
- 根因是字段 schema 不一致：`既往病史` 被解析到隐藏兼容 key `medicalHistory`，而正式编辑页只提供 `[data-field="pastHistory"]`。
- 标准 key 统一为 `pastHistory`；`medicalHistory` 只保留为隐藏 legacy 兼容输入，并会解析到 `pastHistory`。
- `/api/voice/turns-to-agent-task` 现在可保留结构化 `proposed_fields`，医生确认后作为 `expected_mutations` 进入现有 Agent taskflow。

Verification:
- Before probe: `medicalHistory.controlCount=0`, `dom_update_failed`.
- After probe: `既往病史 -> pastHistory`, visible textarea found, `input/change` dispatched, save returned `audit_id`.
- Targeted E2E passed: resolver contracts, normal mutation contract, voice confirmed taskflow.

Final verification:
- `npm run check:encoding`: passed.
- Default E2E on `http://10.26.6.8:31451`: 73 passed / 3 skipped.
- RUN_LLM_E2E on `http://10.26.6.8:31451`: 75 passed / 1 skipped.
- Loop P0: 8 passed / 0 failed.
- Loop P1: 14 passed / 0 failed.

## Added - 2026-06-24 Loop Engineering 基础设施

Added:
- `loop-engineering/` 基础设施，用于自动选择 case、快照 Demo 数据、运行真实浏览器任务、捕获 trace、确定性评估、评分、生成 artifact 和 checkpoint。
- `loop:baseline`、`loop:evaluate`、`loop:smoke`、`loop:full` package scripts。
- `LOOP_ENGINEERING.md` 和下一轮 Codex prompt，要求后续先读 `first_failure` 再修最小正确层。

Known remaining work:
- 当前核心矩阵已列出 P0/P1/P2 场景，但只有基础安全/登录/数据恢复/UI 草稿等一部分 case 自动化；其余 case 会在 baseline 中标记 skipped，不能当作 passed。
- 后续应逐步把 `not_yet_automated` case 接入 Playwright，并把真实 LLM mutation case 纳入 `RUN_AGENT_LOOP_MUTATIONS=1` 的有界循环。

## Fixed - 2026-06-24 语音整理确认后直接执行页面任务

Fixed:
- 医患语音整理不再把“记录一下”的就诊内容优先整理成二次确认的 `clinical_draft`。
- `/api/voice/turns-to-agent-task` 会生成医生确认后可直接进入 Agent taskflow 的自然语言任务，例如更新主诉、现病史并保存。
- 后端 planner 能识别 `task_origin=voice_confirmed_task` / `input_route.inputType=voice_session_task`，医生点击语音任务框“执行任务”后不再规划 `create_structured_draft` 二次确认卡。
- 语音确认后的执行路线仍经过 backend LLM planner、allowlist executor、patient editor adapter 和 audit。

Guardrails:
- 整理阶段仍不修改页面、不写 patient-store、不保存、不写 audit。
- 普通聊天里的“生成病历草稿”仍保留可编辑草稿确认卡。
- 未修改 patient-store / resolver / adapter 业务规则，未恢复 fallback，未改 ASR / Diart 主链路。

Verification:
- 本地 JS/Python 语法检查通过。
- 远端编码、E2E 和真实语音模拟流程待同步后回填。

## Fixed - 2026-06-24 医患语音整理确认写入闭环

Fixed:
- `create_structured_draft` 完成后会稳定显示可编辑草稿确认卡，不再只显示绿色 completed checklist。
- 点击“确认写入”不再被前端 `truncateText` 引用错误中断，会把医生编辑后的草稿作为自然语言任务重新交给现有 Agent taskflow。
- `write_clinical_note_field` 写入结果不会再被误识别成新的待确认草稿，避免确认卡循环出现。
- 只有医生单人 final turn、没有患者 turn 时，也会显示“结束对话并整理任务”；unknown final turn 在整理 payload 中按医生口述传给 LLM。

Guardrails:
- 草稿确认前不改 patient-store、不写 audit log。
- 医生确认后仍走 backend LLM planner、allowlist executor、patient editor adapter 和 audit。
- 语音整理 payload 仍保持最小化，不发送 raw ASR、raw speaker debug、source/provider 或全量 pageState。
- unknown turn 的原始 UI 状态不伪装成 automatic diarization，医生仍可手动修正角色。

Verification:
- `npm run check:encoding`：通过，29 个文件合法 UTF-8。
- close-loop 专项：10 passed。
- voice 专项：12 passed。
- 默认 E2E：65 passed / 3 skipped。

## Fixed - 2026-06-23 当前任务步骤滚动与病历草稿 action

Fixed:
- “展开步骤”内的步骤列表在任务进度刷新、任务卡重绘和计时 tick 后保持当前滚动位置，不再自动跳回顶部。
- “生成病历草稿”进入 `create_structured_draft` allowlist action；草稿输出不再被误当成 `verify_patient_field` 的虚拟“输出字段”。
- `create_structured_draft` 只生成 Agent 草稿输出，不改 patient-store、不写 audit log；只有 `write_clinical_note_field` / `save_patient` 才会进入写入链路。

Verification:
- 新增 E2E 覆盖步骤列表滚动保持，已在新容器 `HIS_BASE_URL=http://10.26.6.8:31824` 通过。
- 新增 E2E 覆盖结构化病历草稿不触发“校验字段不存在”，且不会直接修改 patient-store，已通过。
- close-loop 专项 9 passed；默认 E2E 63 passed / 3 skipped。

## Fixed - 2026-06-23 Agent 状态闭环与就诊会话整理

Fixed:
- 当前任务卡的“展开步骤”状态按 taskId 持久化，progress render 不会把医生已展开的步骤自动收起。
- 新任务发送时先进入当前 run 的 planning 占位，旧 completed 任务不再短暂显示为当前任务。
- chatView 页面切换保存输入草稿和滚动快照，恢复时避免从顶部滚到底部的可见动画。
- 未发送输入跨页保留；任务被接受执行或用户取消后再清空。
- 取消任务会冻结计时、归档历史、清空 activeTask；晚到 progress / save 不会复活 running 卡片。
- “我发错了，先不改”被视为当前任务取消元指令，不会进入患者字段任务。
- 就诊会话整理接口区分 `explicit_action`、`clinical_draft`、`no_action`、`needs_clarification`；只有前两类显示可编辑待确认任务。

Guardrails:
- 没有恢复本地自然语言 fallback。
- 没有修改 patient-store / resolver / adapter 业务规则。
- 没有修改 ASR / Diart 安装或主链路。
- 语音整理确认前不写 patient-store、不保存、不写 audit log。

Verification:
- 新增 E2E：`Agent state close-loop regressions` 覆盖六个状态闭环问题。
- 本轮最终命令结果待运行后回填到 `IMPLEMENTATION_REPORT.md`。

## Known - 2026-06-23 LLM 上游 chat completion 不稳定

Observed:
- “系统连接情况”刷新按钮会重新请求 backend `/api/llm/test`，刷新逻辑有效。
- 替换 `backend/.env` 后必须重启 backend，前端刷新不会让后端热加载 key。
- 重启 backend 后旧 401 已消失，但当前上游 `https://api.shubiaobiao.cn/v1/chat/completions` 返回 502 / 522 / timeout。
- `/models` 可返回 200，说明基础认证和模型列表通道可达；失败集中在 chat completion。

Current state:
- LLM 连接状态继续显示不可用是符合真实检测结果的。
- 需要稳定可用的 `base_url + key + model` 组合，或等待当前代理恢复。

## Fixed - 2026-06-23 新容器端口同步

Fixed:
- 新容器公开端口已同步为 frontend `5500->31210`、backend `8000->30921`、ASR `8010->31238`、LLM service `8001->31968`、aux `8888->45630`、SSH `22->30855`。
- `shared/runtime-config.js` 和 `tests/e2e/playwright.config.ts` 不再默认使用旧公开端口。
- E2E README 与主要项目文档中的服务地址已改为新端口。

Guardrails:
- 只改端口配置与文档，不改 Agent 执行链路、patient-store、resolver、adapter、ASR/Diart 安装或 fallback。
- 旧端口只作为历史文本存在于旧段落上下文时不作为当前默认入口使用。

Verification:
- `npm run check:encoding`：通过，28 个文件合法 UTF-8。
- `python3 -m py_compile backend/main.py asr_service/app/main.py`：通过。
- 默认 E2E：通过，51 passed / 3 skipped。
- `RUN_LLM_E2E=1`：通过，51 passed / 3 skipped；当前 LLM 上游令牌返回 401，真实 @llm 写数据用例按 guard skip。

## Fixed - 2026-06-22 Agent 对话工作台入口与主按钮取消态

Fixed:
- 主视图新增“进入 Agent 对话”，chatView 可以主动进入，不再只能由发送任务触发。
- chatView 顶部任务卡增加 `Agent：...` 状态说明，用更像对话的方式表达正在规划、正在执行、等待补充或任务完成。
- 任务完成后，工作台会显示最近一次带 plan 的任务列表，保留原绿色对勾 checklist，方便复盘 Agent 动作。
- footer 独立“取消任务”按钮已移除，运行中不再短暂闪现第二个底部主操作。
- 点击“发送”后，主按钮在 planning/running 阶段变为“取消任务”；waiting_user 需要医生补充、任务完成/失败/取消后恢复“发送”。

Guardrails:
- 主动进入工作台不调用 LLM、不创建任务、不执行页面动作。
- 最近任务计划只读 `hisAgentTaskHistory`，不修改 patient-store，不保存，不写新的 audit log。
- 取消仍走现有 `AgentTaskOrchestrator.cancel()`，不改 backend planner / allowlist executor / resolver / adapter。

Verification:
- `node --check shared/agent-widget.js`：通过。
- `npm run check:encoding`：通过，28 个文件合法 UTF-8。
- 默认 E2E：通过，51 passed / 3 skipped。

## Fixed - 2026-06-22 Universal Agent V2 产品化重构

Fixed:
- 新增 `agent-input-router`，把文本输入、waiting_user 续接、取消/确认、主输入语音文本和就诊会话整理任务统一路由。
- 新增 `agent-state-machine`，记录 home、chatting、planning、task_running、waiting_user、voice、completed、failed 等状态。
- 新增 `agent-task-model`，统一 task / step 字段，保留 usage、audit、elapsed、waitingFor 和 clarifications。
- 新增 `agent-scroll-manager`，用户上滑阅读时不抢滚动，有新消息时显示未读入口。
- waiting_user 状态下医生补充说明会保留原 `task_id` 并继续调用 backend LLM planner，不再错误拆成新任务。
- 当前任务进度集中显示在当前任务卡片，减少 terminal 进度刷屏。
- 正式 `html/` 页面加载 V2 模块，版本更新为 `20260622-agent-v2-productization`。

Guardrails:
- 未修改根目录重复 HTML/JS。
- 未修改 `universal_agent_backup_*`。
- 未恢复本地自然语言 fallback。
- 未修改 patient-store、resolver、adapter 业务规则。
- 无 LLM 时仍不执行页面动作。
- 语音就诊整理任务仍只生成医生可编辑的自然语言任务，确认前不写 patient-store、不保存、不写 audit log。

Verification:
- 当前端口映射：frontend `5500->31210`，backend `8000->30921`，LLM service `8001->31968`，ASR `8010->31238`。
- `npm run check:encoding`：通过，28 个文件 UTF-8。
- 默认 E2E：49 passed / 3 skipped。
- `RUN_MIC_E2E=1`：49 passed / 3 skipped；fake microphone 环境未暴露 `getUserMedia`，@mic 仍 skip。
- `RUN_LLM_E2E=1`：常规路径 49 passed / 3 skipped；真实 @llm 仍受 LLM 检测偶发 20s 超时影响而 skip，backend 重启后单独 `/api/llm/test` 已恢复 ok。

## Fixed - 2026-06-22 就诊会话开始录音被 Diart health 阻塞

Fixed:
- 就诊会话点击“开始语音任务”不再被 `/diarization/health` 长时间超时卡住。
- Diart 健康检查改为短超时；超时时明确进入 `manual` / `timeout`，不冒充 automatic。
- ASR 健康且浏览器允许麦克风时，即使 Diart 不可用也会启动麦克风和 ASR。
- “停止语音任务”会在录音真正开始后启用，点击后释放 MediaStream tracks 并关闭本次音频链路。

Guardrails:
- 未修改 Diart 安装或 ASR 主链路。
- 未修改 patient-store、resolver、adapter、fallback 或 `universal_agent_backup_*`。
- 主输入“语音输入”仍只写 Agent 输入框；就诊会话才生成医生/患者 turns。
- “结束对话并整理任务”仍只生成待确认自然语言任务，不自动执行页面动作。

Verification:
- `node --check shared/agent-widget.js`：通过。
- `node --check shared/voice-input-controller.js`：通过。
- `npm run check:encoding`：通过。
- 专项浏览器验证：真实 Diart health timeout 下仍能进入 `recording:true`，停止后 `streamTrackCount:0`。
- 默认 E2E：45 passed / 3 skipped。

## Fixed - 2026-06-22 悬浮框 homeView / chatView UI

Fixed:
- 悬浮框拆成 `homeView` 与 `chatView`，发送任务、点击专题卡片和点击示例任务后进入独立对话视图。
- 主视图只保留欢迎语、四个专题卡片和底部输入区，不再堆聊天消息、任务步骤或长 JSON。
- 对话视图提供“返回”按钮；返回主视图不清空聊天记录，新会话才清空。
- 四个专题卡片改为查看患者管理、系统连接情况、查看历史任务、示例任务。
- 连接状态专题展示 7 行竖向状态，不展示长 debug JSON。
- 主视图按钮、轮播按钮、卡片 hover/active 和聊天气泡风格统一为更轻的产品级 UI。

Guardrails:
- 未修改 Agent 业务执行逻辑、LLM gate、ASR、Diart、patient-store、resolver 或 fallback。
- 示例任务点击仍等价于用户发送自然语言任务，继续走现有 backend planner 和 allowlist executor。
- Agent 自动操作高亮、字段闪烁、保存 pulse 保留。

Verification:
- `npm run check:encoding`：通过。
- 默认 E2E：43 passed / 3 skipped。
- `RUN_LLM_E2E=1` E2E：43 passed / 3 skipped。

## Fixed - 2026-06-22 Agent 页面操作可视化

Fixed:
- Agent 修改文本字段时会高亮目标、清空旧值、按块输入新值、触发 `input/change`，并显示已修改闪烁。
- Agent 修改 select 字段时会显示“正在选择/已选择”反馈，不依赖原生下拉菜单截图。
- Agent 修改 date 字段时会显示旧值到新值的日期修改过程，保持 `YYYY-MM-DD` 保存逻辑。
- 保存、登录、退出、dashboard 入口、患者行选择和跳转前都有可见点击/pulse/row highlight。
- E2E 可开启 `window.__HIS_AGENT_FAST_ANIMATION__ = true` 避免动画导致测试超时。

Guardrails:
- 视觉动画只做表现层，不替代 `PatientStore.updatePatient()`、`input/change`、audit log 或 allowlist executor。
- 无 LLM 时仍不执行页面动作。

Verification:
- `npm run check:encoding`：通过。
- 默认 E2E：43 passed / 3 skipped。
- `RUN_LLM_E2E=1` E2E：43 passed / 3 skipped。

## Fixed - 2026-06-22 Agent 历史、登录态与操作反馈

Fixed:
- `agent-history.html` 现在能展示任务来源、相关患者、总耗时、总 token、prompt/completion token、步骤耗时、步骤 token、old/new 值、audit_id，并将原始开发者详情默认折叠。
- Demo 登录状态现在通过 `hisDemoAuthenticated` 和 pageState 的 `isInHisContext` 显式表达，登录页任务会等待医生确认，内部 HIS 页面不会重复要求登录。
- 工作台新增“退出登录”，只清 Demo 登录态，不清 Agent 历史、audit log 或 patient-store。
- 悬浮 Agent header 扩大为可拖拽区域，保留重置位置按钮。
- 新增共享 UI 反馈层，手动点击和 Agent 自动导航/修改/保存/校验都有可见反馈。

Guardrails:
- 仍不恢复本地自然语言 fallback。
- Agent 执行仍只接受 `source === "backend_llm"` 的 allowlist action。
- 历史页只读取 audit/task，不直接修改 patient-store。

Verification:
- `npm run check:encoding`：通过。
- 默认 E2E：40 passed / 3 skipped。
- `RUN_LLM_E2E=1` E2E：40 passed / 3 skipped；真实 LLM happy path 仍由测试内部 guard 跳过，后端 `/api/llm/test` 直接返回 `ok:true`。

## 已知问题：登录页任务前置状态判断

**状态：fixed**

**现象：**

用户在登录页通过悬浮框输入“更改患者电话 / 修改患者信息 / 编辑病历”等 HIS 内部业务任务时，Agent 没有先提示需要登录。

**期望：**

Agent 应识别当前 `pageType=login`。对于患者管理、患者编辑、病历修改等需要登录后才能执行的任务，应先提示需要登录，或在用户提供账号密码 / 确认使用 Demo 登录后，规划：

登录 -> HIS 工作台 -> 患者管理 -> 编辑页 -> 修改字段。

**当前处理：**

已修复基线行为：当当前 `pageType=login` 且未认证，后端 LLM 返回的结构化计划包含患者管理、患者编辑、字段修改、保存或校验等受保护 HIS 动作，但没有先规划 `submit_login` 时，前端 task precondition 会将任务拦截为 `waiting_user`。

拦截后不会执行 patient resolver、页面导航、字段修改、保存或 audit log 写入，只提示用户需要先登录 HIS，或确认使用 Demo 默认账号密码 `123/123` 后继续。

**验证方式：**

- `tests/e2e/his-agent.spec.ts` 中 `Login page task precondition › patient edit task on login waits for login confirmation and does not mutate patient-store`
- `tests/agent-cases/his-agent-cases.json` 中 `case_login_requires_auth_001` 已更新为 `fixed_waiting_user`

**优先级：**

P1

## 已知问题：语音输入把浏览器麦克风限制误报为 ASR 未连接

**状态：fixed**

**现象：**

ASR 服务 `/health` 可用，但点击悬浮框“语音输入”后，前端可能显示 ASR disconnected，实际原因是当前浏览器上下文不支持 `navigator.mediaDevices.getUserMedia`、不是安全上下文，或麦克风权限不可用。

**修复方式：**

- 已将 ASR 服务 health 与浏览器麦克风能力拆成两个状态。
- 悬浮框状态区显示 `ASR 服务` 与 `麦克风` 两个 chip。
- `window.__HIS_AGENT_VOICE_DEBUG__` 可查看 `asrHealthStatus`、`microphoneStatus`、`voiceInputStatus` 和具体错误。

**关联测试：**

- `Floating Agent task display → microphone API unavailable does not mark ASR service disconnected`

## 已知问题：waiting_user 下用户回复“是”未继续登录前置任务

**状态：fixed**

**现象：**

登录页中，患者修改任务被正确拦截到 `waiting_user` 后，用户回复“是”时，系统仍可能提示“请选择继续当前任务或取消旧任务”，没有继续使用 Demo 登录前置步骤。

**修复方式：**

- `classifyLoginPreconditionReply()` 已把 `是`、`好`、`好的`、`行`、`可以`、`确认`、`继续` 识别为登录前置确认。
- 该修复只作用于已存在的登录前置确认状态，不新增本地自然语言 fallback。

**关联测试：**

- `Login page task precondition → single Chinese confirmation resumes login precondition task`

**关联测试：**

- `tests/agent-cases/his-agent-cases.json` 中 `case_login_requires_auth_001`
- `tests/e2e/his-agent.spec.ts` 中 `login page patient edit task should require login before mutation`，当前标记为 `fixme`

## 已知问题：Demo 患者数量从 20 退化为 5

**状态：fixed**

**现象：**

患者管理页只显示 P001-P005，共 5 个患者；Demo 数据期望为 P001-P020，共 20 个患者。

**真实原因：**

`shared/patient-store.js` 的 `demoPatients` seed 只保留了 5 条记录。`readPatients()` 读到 `his_demo_patients_v2` 或 legacy key 后会直接返回 localStorage 内容，没有按 seed 补齐缺失患者，所以曾经写入过 5 条数据的浏览器会一直保持 5 条。

**修复方式：**

- `demoPatients` seed 已恢复为 P001-P020。
- `readPatients()` 增加 `mergeWithDemoSeed()`，按 `patientId` 合并 seed。
- 已有 P001-P020 的用户修改优先保留。
- 缺失的 P006-P020 自动从 seed 补齐。
- 额外自定义 patientId 不删除。
- 自动迁移不清空 `his_demo_patient_audit_v2`。
- `resetDemoPatients()` 现在恢复 20 个 seed 患者，并保留 audit log，避免误删审计。

**验证方式：**

- `Manual HIS pages › patient-management shows 20 demo patients and reset keeps 20`
- `Manual HIS pages › patient-store migrates 5-patient localStorage to 20 while preserving edits and audit`
- `Patient and field resolver contracts › patient-management contains P001 Zhang Wei and resolvers work`
- `tests/agent-cases/his-agent-cases.json` 中 `case_demo_patient_seed_count_020`

**优先级：**

P1

## Fixed / Follow-up - 2026-06-12 CORS smoke unblock

Fixed:
- Browser floating Agent can fetch backend `/api/llm/test` from `http://10.26.6.8:31210` after backend CORS update.
- Default E2E and RUN_LLM_E2E both pass with current frontend/backend ports.

Follow-up:
- Missing-patient real LLM smoke is safe (no mutation, no audit log) but should produce a clearer user-facing not-found message.
- ASR service at `http://10.26.6.8:31238` is currently connection refused; no ASR code was changed in the CORS-only round.

## Fixed - 2026-06-12 widget status and not_found clarity

Fixed:
- Missing-patient Agent task now shows an explicit not-found message and does not mutate patient-store or audit log.
- waiting_user login confirmation now accepts single-word Chinese confirmation such as `是`, plus common confirmation variants.
- ASR service status and microphone/browser capability are displayed separately.

Open:
- Current browser origin is `http://10.26.6.8`, so microphone API may remain unavailable until the page is served from HTTPS or a browser-trusted origin.
## 后续：真实说话人区分 diarization

- 状态：open
- 背景：当前就诊会话模块只保存 doctor / patient turns，默认 `speaker_0 -> 医生`，支持手动修正和一键交换，但没有真正自动区分医生/患者。
- 建议：后续单独接入 FunASR / Diart / pyannote 等 diarization 能力，输出稳定 speaker_id 后再映射医生/患者。
- 约束：不要在前端用本地关键词或简单规则冒充真实自动说话人区分。

## 待观察：真实 LLM E2E 偶发未执行业务修改

- 状态：open
- 背景：2026-06-12 ASR / 就诊会话迁移后，默认 E2E 28 passed / 2 skipped；但 `RUN_LLM_E2E=1` 本次两条真实 LLM 修改链路在等待 patient-store 更新时超时，P001 手机号和性别保持原值。
- 当前判断：mock LLM gate、无 LLM guard、resolver 合约和页面 UI 测试均通过；本轮未改业务执行逻辑。需要后续单独排查真实 LLM provider 响应、planner 输出、任务链路日志与超时策略。
- 约束：不要用本地 fallback 或关键词规则绕过 LLM 来让测试“看起来通过”。
## Fixed - 2026-06-12 ASR / visit-session acceptance

- ASR service health is separated from microphone/browser capability and WebSocket state.
- Microphone unavailable / insecure context no longer makes the widget report ASR service disconnected.
- The widget no longer pre-blocks microphone startup solely because `window.isSecureContext` is false; if `getUserMedia` exists, it attempts real startup and records the actual failure.
- Visit-session turns can be pasted, mocked, role-corrected, swapped, copied, cleared, and filled into the Agent input without auto-send.
- Without LLM, visit-session content can be organized locally but cannot generate structured drafts or write fields.
- With LLM, draft/write entry points remain gated by backend LLM and user confirmation.

## Follow-up - real speaker diarization

- Status: open.
- Current demo does not provide true automatic doctor/patient speaker identification.
- Current behavior uses ASR-provided turns when available and otherwise default/manual doctor/patient mapping.
- Future work: investigate FunASR / Diart / pyannote and define a stable `speaker_id -> role` workflow.

## Follow-up - real browser microphone diagnosis

- Status: open / diagnostic ready.
- The widget now exposes a real-browser `检查麦克风权限` probe and `window.__HIS_AGENT_VOICE_DEBUG__.dump()`.
- If the user's browser still cannot record while the backup page can, compare the dump output, page origin, address-bar microphone permission, HTTPS / localhost access method, and browser trusted-origin settings.
- Do not treat Playwright/headless microphone results as proof that the user's real browser cannot use the microphone.
- Do not change ASR recognition logic until the browser permission/device diagnosis is clear.
## Follow-up - real browser ASR microphone verification

- Status: open for manual browser verification.
- The old single-page microphone flow has been migrated into `shared/voice-input-controller.js`.
- If the user's browser still does not prompt for microphone permission, collect `window.__HIS_AGENT_VOICE_DEBUG__.dump()` after clicking `语音输入`.
- Important debug fields: `hasGetUserMedia`, `didCallGetUserMedia`, `getUserMediaCalledAt`, `lastVoiceErrorName`, `lastVoiceErrorMessage`, `asrWebSocketStatus`, `audioContextState`, `streamTrackCount`.
- Do not change ASR backend recognition or add diarization until the browser dump shows the frontend microphone flow is actually reaching ASR audio streaming.
## 2026-06-15 Status Update

- Fixed: task elapsed labels in the Agent task UI now use elapsed `MM:SS` instead of clock-like or decimal-second labels.
- Fixed: compact token display now shows total token in list/current summaries, with per-step `token: -` for no-usage steps and `token: 未返回` when backend usage is absent.
- Fixed: Agent operation UI feedback added for edited fields, save action, and patient-management row highlight without changing execution logic.
- Partial: prompt payload has been slimmed on the browser side. Real provider latency/token comparison still depends on a responsive backend `/api/llm/test` and task-plan endpoint.
- Current default URLs are `frontend=http://10.26.6.8:31210`, `backend=http://10.26.6.8:30921`, `asr=http://10.26.6.8:31238`.
## 2026-06-17 Diart / diarization 后续

- 状态：fixed / superseded
- 当前已经有独立 `diarization_service/`、backend proxy、前端状态展示和 WS 链路。
- ABI mismatch 已通过独立 `.venv-diart` 解决。
- 当前已安装 CUDA wheel，并且 `/diarization/health` 返回 `provider=diart_local`、`status=available`、`ok=true`、`gpu=true`、`device=cuda`。
- 浏览器 fake microphone 验证已收到真实 `source=diart_local`、`automatic=true` speaker segment。
- 原则仍保留：Diart 不可用时不得宣称自动说话人分离，不用 fake speaker_0 冒充自动结果。
## 2026-06-17 Diart token / CUDA 后续

- 状态：fixed / superseded
- ABI mismatch 已通过干净 `.venv-diart` 避开。
- 当前 `.venv-diart` 已是 CUDA wheel：`torch==2.4.1+cu121`、`torchaudio==2.4.1+cu121`。
- `diarization_service` 当前 health 返回 `provider=diart_local`、`active_provider=diart_local`、`status=available`、`ok=true`、`gpu=true`、`device=cuda`。
- 浏览器 fake microphone 验证已收到真实 `source=diart_local`、`automatic=true` speaker segment。
- 保持约束：token 不得打印、提交或写入代码；Diart 不可用时仍不得 fake 自动说话人分离。

## 2026-06-17 Diart stream metadata follow-up

- 状态：fixed
- 当前已确认 Diart WebSocket 能输出真实 speaker segment：`speaker_id=speaker0/speaker1`、`source=diart_local`、`automatic=true`。
- 已新增 `normalizeSpeakerId(value)`，规范 `speaker0` / `speaker_0` 和 `speaker1` / `speaker_1`。
- 已将 `speaker_id`、`raw_speaker_id`、`source=diart_local`、`diarization_source=diart_local`、`automatic=true`、`automatic_diarization=true`、diarization timing/confidence 一起保留到 turns 和 UI/debug meta。
- 已修复 `speaker1` 因未归一化被映射为 doctor 的风险：现在 `speaker_1 -> patient / 患者`。
- 已新增 E2E 覆盖 fake WebSocket / fake media 下的 metadata 合并路径。
- 不做事项：本 follow-up 不应修改 ASR 主链路、不应恢复 fallback、不应做 LLM 语义校正。

## 2026-06-17 Role mapping / LLM semantic correction follow-up

- 状态：open
- 当前 demo 仍使用默认 role mapping：归一化后 `speaker_0 -> doctor / 医生`，`speaker_1 -> patient / 患者`。
- 该映射只是 demo 默认角色映射，不等于真正语义识别医生/患者。
- 手动修正和一键交换医生/患者已验证可用。
- 后续应单独实现明确的 speaker-to-role mapping UX；LLM semantic correction 医生/患者角色仍是后续任务。
# 2026-06-21 更新

- fixed：语音就诊会话 turns 分段展示不稳定，ASR fallback final 片段可能覆盖成同一段。
- fixed：语音后续处理按钮常驻，已改为停止录音/粘贴/模拟后才显示“整理到输入框 / 生成结构化草稿 / 生成 Agent 任务”。
- open：真实医生/患者自动映射仍依赖 Diart speaker_id 默认映射和人工修正，后续可继续做语义角色校正。

## 2026-06-22 更新

- fixed：新增“结束对话并整理任务”按钮，解决医生/患者 turns 展示后没有明确入口交给 LLM 整理的问题。
- fixed：停止语音不再自动执行 LLM planning；医生必须点击按钮并确认可编辑任务后，才进入现有 Agent taskflow。
- fixed：整理阶段只发送最小 doctor/patient final turns 和当前患者轻量上下文，不发送 raw debug JSON、完整 pageState、patient-store、任务历史或 raw action。
- fixed：有 final turns 后“结束对话并整理任务”可点击；点击时刷新检测 LLM，未连接只提示，不调用整理接口，也不能执行。
- fixed：如果 LLM 判断没有明确页面操作，只显示“未发现明确需要执行的页面操作。可以选择生成病历草稿，或继续补充说明。”，不生成执行按钮。
- fixed：取消整理不会执行任务，不修改 patient-store，不保存，不写 Agent audit log，并保留原始 turns。
- fixed：聊天视图和语音视图重复“返回 / HIS AGENT”入口已清理，只保留浮窗顶部返回；连接状态卡片也只保留“刷新状态”。
- fixed：backend 8000 卡住导致 LLM timeout 时，重启 backend 后 `/api/health` 和 `/api/llm/test` 已恢复。
- open：真实 LLM E2E 仍需按 RUN_LLM_E2E 环境单独观察 provider 可用性和测试开关条件；不能恢复 fallback 让测试表面通过。

## 2026-06-22 Agent 浮窗产品化 UI 更新

- fixed：首页、聊天、语音、系统连接情况、示例任务拆成互斥视图，避免同一浮窗里重复标题、重复返回和内容串台。
- fixed：聊天视图只保留 Agent 对话、任务确认和执行反馈；连接状态、示例任务、语音 turns 不再混在聊天流中。
- fixed：系统连接情况迁移为独立状态页，默认显示中文摘要，原始 Backend / LLM / ASR / Diarization 诊断折叠到开发者详情。
- fixed：语音输入页内部重复返回入口已清理，只保留顶部返回；语音页保留 turns、角色修正、填入输入框、交换、清空和“结束对话并整理任务”。
- fixed：已有 final turns 时“结束对话并整理任务”保持可点击；是否整理仍由 LLM gate 决定，未连接时只提示，不调用整理接口。
- fixed：每条医生/患者 turn 的 `speaker_id` / `source` / debug meta 默认折叠，保留可查性但不干扰普通医生操作。
- fixed：输入框改为动态紧凑高度，底部服务地址配置从日常 UI 隐藏，减少滚动和遮挡。
- fixed：专题卡片、示例卡片、按钮和轮播控件视觉统一；专题左右切换按钮保持白底，hover 蓝色高亮。
- open：如后续要暴露服务地址编辑，应设计明确的开发者配置入口，而不是恢复到底部常驻区域。

## 2026-06-22 主输入语音与就诊会话拆分

- fixed：底部“语音输入”改为主输入听写，只把 ASR 转写写入底部输入框，不切到就诊会话、不生成医生/患者 turns、不自动发送。
- fixed：新增底部“就诊会话”按钮；点击只进入 voiceView，不自动开麦、不自动启动 ASR/diarization。
- fixed：voiceView 内“开始语音任务”才启动就诊会话录音；“停止语音任务”通过统一 stop 流程释放麦克风、audio pipeline 和 WebSocket。
- fixed：关闭悬浮框、离开就诊会话、新会话、发送任务、整理任务前，如仍在录音，会先 stop + release。
- fixed：voiceView 默认只展示麦克风、ASR、说话人分离三项产品化状态；ASR WS、Diarization WS、provider、mic policy 和完整 debug 默认折叠。
- fixed：主视图专题卡片和背景统一，轮播左右按钮默认白底、hover 蓝色、active 按下，并避免边缘裁切。
- fixed：共享 widget / voice controller 不再写死服务端口，统一依赖 runtime-config。
- open：真实浏览器麦克风权限仍受浏览器安全来源策略影响；如用户真实浏览器无法授权，应继续收集 `window.__HIS_AGENT_VOICE_DEBUG__.dump()`。
## 2026-06-23 Agent V2 回归矩阵

- fixed：任务计划与聊天视图的层级重新整理，当前任务卡变为紧凑摘要，完整 checklist 默认折叠。
- fixed：任务 progress 不再强制切回 chatView，用户点击返回后保持主视图。
- fixed：打开患者编辑页必须验证 canonical patient；刘洋用例确认 `P006` 被打开和更新，避免只跳到 generic editor 后继续执行。
- fixed：登录页已填 `123/123` 时不清空重输，Agent 会复用已有正确输入。
- fixed：`waiting_user` 补充说明继续同一 taskId，并继续走 backend planner。
- added：`AGENT_V2_REGRESSION_MATRIX.md` 记录核心回归矩阵与两轮结果。
- added：`AGENT_FLOW_TRACE_GUIDE.md` 记录 `AgentFlowTrace` 字段、读取方式和排障路径。
- open：当前 backend 映射上的 `/health`、`/api/llm/test`、`/api/qwen/test` 探针超时；真实 `@llm` E2E 被 guard skip，需恢复 backend/LLM 服务后再验真实写数据路径。

## 2026-06-24 Agent 登录与业务隔离

- fixed：错误凭据 `1234/123` 手动失败但 Agent 可能继续 repair / 完成的风险。现在 Agent 点击真实登录按钮后以页面后置条件判定，错误凭据任务 `failed`，不进入 dashboard，不继续患者动作。
- fixed：`fill_login_form`、登录页 adapter、后端旧 action 归一化中的默认 `123/123` 覆盖路径已收紧；只有用户明确确认 Demo 默认账号时才使用。
- fixed：`submit_login` 不再直接假定 `pageAfter=dashboard`，不直接写认证状态，不直接导航；成功登录由页面 handler 设置 `hisDemoAuthenticated` 并导航。
- fixed：正确 `123/123` 登录后，submit step 在 dashboard 端恢复并归档 completed。
- fixed：任务 history、progress、summary、flow trace 中的 password 脱敏为 `[redacted]`。
- fixed：患者字段 action 不再直接写 patient-store；字段只落 DOM，`save_patient` 点击页面保存按钮，由页面保存流程写 patient-store 和 audit log。
- open：真实 `/api/llm/test` 当前仍 20 秒超时，真实 LLM E2E 只能在 LLM 服务恢复后单独验收；本轮关键浏览器回归使用 mock backend_llm planner 验证前端 executor / adapter 真实行为。

## 2026-06-24 Agent V3 后续待办

- [in_progress] 全量 Observation / Generic Browser Action 架构：已新增基础层和 unknown fixture，仍需把 task loop 主链路进一步升级为 observe -> next-decision -> act -> verify 的逐步循环。
- [in_progress] Human Action Catalog：已新增自动生成脚本，需同步远端后运行并提交生成的 `HIS_HUMAN_ACTION_CATALOG.md`。
- [in_progress] Mutation Contract：已补计划完整性校验、mutation ledger、保存前置条件和完成后置条件；需远端 E2E 连续两轮确认。
- [open] 每个自动发现控件的人工/Agent 等价测试还未 100% 覆盖，当前只覆盖登录、患者字段、保存、语音确认任务和 unknown fixture 核心控件。
- [open] `/api/agent/route-input` 和 `/api/agent/next-decision` 仍未成为正式后端主入口；当前仍是 backend task-plan + 前端逐步执行/验证的混合模式。
- [open] 若 LLM 健康检查继续超时，`RUN_LLM_E2E=1` 只能报告失败或 skip 原因，不能声称真实 LLM 全通过。

## 2026-06-24 Agent V3 close-loop follow-up

- [fixed] `verify_patient_store` 作为计划最后一步时会停在 `running/current_step_index=7`，导致字段已保存但任务不归档。现在该步骤走只读 store verification，并在最后一步完成后立即进入 completion validation。
- [fixed] 任务完成 history 缺少 `mutation_ledger`，无法复盘 applied / verified / save / audit。现在 history 保留 `task_contract`、`expected_mutations` 和 `mutation_ledger`。
- [fixed] store 校验只调用不存在的 `PatientStore.getPatient`。现在兼容 `getPatient`、`getPatientById`、`getAllPatients`，不修改 patient-store。
- [fixed] voice E2E mock 丢弃 `/api/voice/turns-to-agent-task` 的 `expected_mutations` / `task_contract`，导致确认执行路径无法验证 planner payload。现在 mock 与正式接口字段一致。
- [verified] `--grep=mutation` 5 passed；默认 E2E 73 passed / 3 skipped；`RUN_LLM_E2E=1` 73 passed / 3 skipped。
- [open] `RUN_LLM_E2E=1` 当前没有实际打开两个 `@llm` 写数据测试，它们仍被测试内部 guard skip；后续如果要证明 live LLM 写数据，需要单独调整/审查该 skip 条件。

## 2026-06-24 Loop Capability Backlog

- P0 remaining: automate wrong-patient protection. It is still skipped in iteration-008 and must not be counted as passed.
- P1 remaining: automate real patient-field mutation cases with explicit RUN_AGENT_LOOP_MUTATIONS=1 and data restore verification.
- P1 remaining: automate waiting_user continuation cases for missing patient and missing field clarification.
- P1 remaining: validate live voice role mapping with real/manual turns and no fake automatic Diart claim.
- P1 remaining: validate live LLM E2E once LLM health is reachable; current health observation returned fetch failed.
- P2 remaining: automate expanded-step scroll preservation and rich task-history fields.

## 2026-06-25 Loop Capability Backlog Update

- fixed: P0 wrong-patient protection is now automated and passing in the real browser loop.
- fixed: P1 patient-field mutation, waiting_user continuation, doctor-only voice task drafting, voice review-before-execute, cancellation, and new-task-during-waiting-user cases are automated with no skipped P1 cases.
- fixed: backend LLM status probing no longer blocks `/api/health`; `/api/llm/test` uses a bounded status timeout and runs blocking HTTP work off the event loop.
- fixed: live LLM tasks that already have a backend-planned allowlisted task no longer stop mid-execution because a later quick status refresh is slow.
- verified: P0 iteration-031 `8 / 0 / 0`; P1 iteration-032 `14 / 0 / 0`; default E2E `73 / 0 / 3`; RUN_LLM_E2E `75 / 0 / 1`.
- open: optional fake microphone `@mic` remains skipped in headless default runs unless the browser exposes fake media capture.
- current forced refresh URL: `http://10.26.6.8:31210/html/login.html?v=20260625-loop-gate`.

## 2026-06-25 Final Backlog Update

- fixed: P2 loop skipped cases are now automated and passing: latest output visibility, preserved user scroll, unread prompt, home-view progress isolation, expanded-step scroll retention, and rich task-history evidence.
- fixed: latest message auto-follow now survives delayed layout height changes when the user is at the bottom.
- fixed: backend LLM malformed JSON responses get one backend-LLM repair retry before schema validation failure.
- verified: P2 iteration-037 `7 / 0 / 0`.
- verified: full loop iteration-038 `29 / 0 / 0`.
- verified: default E2E `73 / 0 / 3`.
- verified: RUN_LLM_E2E `75 / 0 / 1`.
- current forced refresh URL: `http://10.26.6.8:31451/html/login.html?v=20260625-final-loop`.
- open: optional fake microphone `@mic` remains environment-dependent.
- open: full 500-cell patient-field mutation execution remains a separate mutation-mode gate, not claimed by this pass.

## 2026-06-25 Task Telemetry Panel Follow-up

- fixed: 最近任务计划可以最小化，chatView 顶部提供任务计划入口；homeView 不显示该入口。
- fixed: 任务 progress 更新不会重置最小化状态、步骤展开状态或步骤列表滚动位置。
- fixed: 用户手动上滑后，延迟自动滚动回调不再把聊天流拉回底部；“新消息”提示保持可见，点击后才主动到底。
- fixed: agent-history 对旧任务显示 `未记录`，对本地 DOM 步骤显示 `本地执行`，对 backend usage 显示真实 token。
- verified: full loop iteration-049 `29 / 0 / 0`; default E2E `76 / 0 / 3`; `npm run check:encoding` passed; performance baseline source iteration-049.
- observed: latest full `RUN_LLM_E2E=1` was `77 / 1 / 1`; the live Zhang Wei gender update did not mutate the page to `女` within timeout, and a follow-up `@llm` targeted run was skipped by real LLM availability gate.
- current forced refresh URL: `http://10.26.6.8:31451/html/login.html?v=20260625-task-telemetry-panel`.
## Fixed - 2026-06-25 任务计时、Demo 节奏和步骤滚动

Fixed:
- 修复 running task/step 耗时不实时递增、步骤完成后才突变的问题。
- 修复 timing 汇总重复累加导致多个任务耗时不可信的风险。
- 增加可配置 Demo pacing：默认关闭，E2E fast mode 自动关闭，开启后字段/点击延迟记录为 `demo_delay_ms`。
- 展开当前任务步骤时 running step 有 pulse 标记；用户滚动步骤列表后，progress render 不再立即把列表拉回顶部。
- 页面切换恢复聊天区滚动时使用瞬时恢复，避免顶部到底部的可见滑动动画。

Verification:
- Targeted E2E: live timer/freeze、current step pulse/scroll、fast pacing、page restore scroll 均通过。
## Verified - 2026-06-25 任务计时与步骤滚动收尾

Fixed:
- 运行中任务和步骤计时实时递增，终态任务冻结耗时；重复 `updateTaskTiming()` 不再把派生耗时反复累加。
- Demo pacing 默认关闭；开启时字段/点击演示延迟进入 `demo_delay_ms`，E2E fast mode 会禁用延迟。
- 当前执行步骤有 `current-step / agent-step-pulse` 标记；用户滚动展开步骤列表后，progress 刷新不再拉回顶部。
- 页面切换恢复聊天滚动使用瞬时恢复，避免可见的顶部到底部滑动。

Verification:
- `npm run check:encoding`: passed.
- Default E2E on `http://10.26.6.8:31451`: `80 passed / 3 skipped / 0 failed`.
- Loop P0/P1/full: `iteration-050` `8 / 0 / 0`, `iteration-051` `14 / 0 / 0`, `iteration-052` `29 / 0 / 0`.

Open:
- `RUN_LLM_E2E=1` is not green in the current Qwen run: backend health is fast and ok, but the focused live `@llm` P001 phone mutation case did not update patient-store within 90s.
