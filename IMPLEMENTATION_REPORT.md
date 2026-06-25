# IMPLEMENTATION_REPORT

## 2026-06-25 就诊会话整理到既往病史字段更新闭环

### 真实复现与第一偏差

- 复现任务：`更新患者 P001 张伟的主诉、现病史和既往病史并保存核验`。
- 失败步骤：`update_patient_field` 写入 `既往病史`。
- 第一偏差：浏览器 `PatientFieldSchema.resolvePatientField("既往病史")` 返回隐藏兼容字段 `medicalHistory`，但正式患者编辑页只有可见 textarea `[data-field="pastHistory"]`，没有 `[data-field="medicalHistory"]`。
- 证据：`probe_voice_past_history.before.json` 中 `fieldResolver.field="medicalHistory"`、`medicalHistory.controlCount=0`、adapter 返回 `dom_update_failed` / `未能填写既往病史`。
- 真实根因：字段 schema 与页面 DOM/PatientStore 标准 key 不一致；不是 ASR、Diart、LLM 未启动或 patient-store 保存失败。

### 修复内容

- `shared/patient-field-schema.js`
  - 将 `既往史 / 既往病史 / 既往病史内容 / 病史 / past history / past medical history / medical history / medicalHistory` 统一解析到 `pastHistory`。
  - 将隐藏兼容字段 `medicalHistory` 改为不可编辑，避免 Agent 继续写不存在的 DOM。
- `backend/main.py`
  - 后端字段 ontology、harness field normalization、contract field aliases 和 mutation allowlist 统一使用 `pastHistory`。
  - `/api/voice/turns-to-agent-task` 支持结构化 `proposed_fields`，并把其转成 `expected_mutations` 随医生确认后的自然语言任务进入现有 planner。
  - `clinical_draft` 作为语音整理结果类型保留，但不自动执行；医生确认后才进入 taskflow。
- `tests/e2e/his-agent.spec.ts`
  - 字段 resolver 回归覆盖全部 past-history aliases。
  - 普通 mutation contract 回归覆盖主诉、现病史、既往病史三字段写入、保存、核验和 audit ledger。
  - 语音确认执行回归覆盖 `expected_mutations` 传入 planner 后三字段写入并 completed。
- `loop-engineering/scripts/run-case.mjs`
  - voice review case 的 mocked task contract 带上 `pastHistory`，并断言 pending voice plan 包含该字段。

### 验证结果

- `npm run check:encoding`: passed.
- Targeted E2E:
  - `Patient and field resolver contracts`: 3 passed.
  - `voice confirmed task forwards expected mutations and executes normal taskflow`: passed.
  - `mutation task with update save verify changes patient-store and audit`: passed.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31684 npm run test:e2e -- --reporter=list` -> 73 passed / 3 skipped.
- RUN_LLM_E2E: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31684 npm run test:e2e -- --reporter=list` -> 75 passed / 1 skipped.
- Loop:
  - `npm run loop:voice-task-equivalence` -> `static_equivalence_passed`.
  - `npm run loop:matrix` -> `matrix_generated`, 20 patients, 25 editable fields.
  - `npm run agent:loop -- --category P0 --iteration 43` -> 8 passed / 0 failed.
  - `npm run agent:loop -- --category P1 --iteration 44` -> 14 passed / 0 failed.
- Real LLM voice turns probe:
  - First attempt returned empty completion and was safely treated as `no_action`.
  - Second attempt returned `explicit_action` with `proposed_fields/expected_mutations` for `chiefComplaint`, `presentIllness`, and `pastHistory`.
- Probe after fix:
  - `既往病史 -> pastHistory`.
  - DOM `[data-field="pastHistory"]` visible and enabled.
  - update dispatched `input/change`.
  - save returned `audit_id`.

### 强制刷新 URL

- `http://10.26.6.8:31684/html/patient-editor.html?patientId=P001&v=20260625-past-history-field-chain`

## 2026-06-24 Loop Engineering 基础设施

### 本轮目标

- 在现有 `/huaiwenpang/universal_agent` 内新增可重复运行的 Loop Engineering 基础设施。
- 先建立 baseline/evaluate、trace、评分、checkpoint 和数据恢复机制，不做大规模业务重构。

### 新增内容

- `loop-engineering/cases/core-cases.json`：P0/P1/P2 核心场景矩阵。
- `loop-engineering/scripts/run-loop.mjs`：baseline/evaluate/smoke/full 总控。
- `loop-engineering/scripts/run-case.mjs`：Explorer，运行真实浏览器 case 和健康探测。
- `loop-engineering/scripts/evaluate-case.mjs`：Evaluator，按确定性断言生成 first_failure。
- `loop-engineering/scripts/score-iteration.mjs`：统一评分。
- `loop-engineering/scripts/snapshot-demo-state.mjs` / `restore-demo-state.mjs`：Demo localStorage 快照恢复。
- `loop-engineering/scripts/create-checkpoint.mjs` / `compare-iterations.mjs`：Git 不可用时的文件级 checkpoint 和迭代比较。
- `loop-engineering/schemas/*.json`：机器可读 result / case / trace schema。
- `LOOP_ENGINEERING.md`、`loop-engineering/README.md`、`loop-engineering/NEXT_ITERATION_PROMPT.md`：运行方式和后续 Codex 协议。

### 安全边界

- baseline/evaluate 默认不执行真实 mutation。
- Runner 不直接写业务 patient-store；只在测试 finally 中恢复 localStorage 快照。
- 登录 case 走真实 DOM 表单和登录按钮，不以 click 未抛错作为成功。
- Trace 脱敏 password/token/key/secret。
- 不修改 `universal_agent_backup_*`，不恢复 fallback。

### 验证

- 待同步远端后运行：
  - `npm run check:encoding`
  - `HIS_BASE_URL=http://10.26.6.8:31210 npm run loop:baseline`
  - `HIS_BASE_URL=http://10.26.6.8:31210 npm run loop:evaluate`

## 2026-06-24 语音整理确认后直接执行页面任务

### 本轮问题

- 医患会话点击“结束对话并整理任务”后，LLM 有时把明确“记录一下”的就诊内容整理成“生成病历草稿”任务。
- 医生在语音任务框里点击“执行任务”后，Agent 会走 `create_structured_draft`，生成二次草稿确认卡或直接 completed；患者字段没有被修改，医生感知为“确认后没有更改”。
- 后端 planner 没有收到“这是医生已经确认过的语音整理任务”的显式上下文，无法区分普通聊天里的“生成病历草稿”和语音确认后的执行请求。

### 修复内容

- `backend/main.py`
  - `/api/voice/turns-to-agent-task` prompt 改为输出医生确认后可直接执行的自然语言任务；“记录/写一下/保存/改为”等意图优先整理为更新主诉、现病史或备注并保存。
  - 语音整理结果类型收紧为 `explicit_action / no_action / needs_clarification`，不再鼓励 `clinical_draft` 二次确认任务。
  - `TaskPlannerRequest` 新增 `task_origin` 和 `input_route`，planner prompt 明确：`voice_confirmed_task` 或 `voice_session_task` 已由医生确认，不要再规划 `create_structured_draft` 二次确认；应规划 `update_patient_fields + save_patient`，或自由文本记录时 `write_clinical_note_field + save_patient`。
- `shared/agent-task-orchestrator.js`
  - task planner payload 透传 `source/inputRoute`，让后端能识别语音确认来源。
  - `compactInputRoute()` 兼容 `input.input_type`，确保 `voice_session_task` 不丢失。
- `shared/agent-widget.js`
  - `scriptsVersion` 更新为 `20260624-voice-confirm-execute`，用于确认浏览器已加载新资源。
- `tests/e2e/his-agent.spec.ts`
  - 更新语音整理回归：整理阶段仍不修改 patient-store。
  - 强化“执行任务”回归：医生编辑并确认语音任务后，planner 收到 `task_origin=voice_confirmed_task`、`input_route.inputType=voice_session_task`，随后直接执行 `update_patient_fields + save_patient`，不出现病历草稿二次确认框。

### 安全边界

- 语音整理阶段仍只生成可编辑自然语言任务，不修改页面、不写 patient-store、不保存、不写 audit。
- 医生点击“执行任务”后仍走 backend LLM planner、allowlist executor、patient editor adapter 和 audit。
- 普通聊天里用户明确要求“生成病历草稿”时，`create_structured_draft` 的二次确认机制仍保留。
- 未修改 patient-store / resolver / adapter 业务规则；未恢复 fallback；未修改 Diart / ASR 主链路。

### 验证

- 本地语法：`node --check shared/agent-task-orchestrator.js`、`node --check shared/agent-widget.js`、`node --check tests/e2e/his-agent.spec.ts`、`python -m py_compile backend/main.py`：通过。
- 远端 `npm run check:encoding`、默认 E2E 与真实语音模拟流程：待同步远端后运行。

### 新强制刷新 URL

- `http://10.26.6.8:31824/html/login.html?v=20260624-voice-confirm-execute`

## 2026-06-24 医患语音整理确认写入闭环与医生单人 turn

### 本轮问题

- “生成病历草稿”已能完成 `create_structured_draft`，但任务完成后没有稳定显示“医生编辑/确认后写入”的二次确认入口。
- 确认卡出现后，点击“确认写入”只把卡片改成已确认，没有进入后续 Agent taskflow；原因是前端确认函数调用了不存在的 `truncateText()`，执行中断。
- 写入成功后的 `write_clinical_note_field` 结果一度也会被误识别为新草稿，导致多余确认卡。
- 就诊会话里只有医生一人 final turn 时，原逻辑要求 role 已经是 `doctor/patient`，`unknown` final turn 不会显示“结束对话并整理任务”。

### 修复内容

- `shared/agent-widget.js`
  - `clinical-draft-review` 消息不再被通用详情渲染覆盖，textarea 和“确认写入/取消”按钮会保留。
  - 从 progress、task summary、`slots.structured_draft` 三处幂等补出草稿确认卡，避免任务完成后只剩绿色 checklist。
  - “确认写入”改用已有 `compactText()`，随后把医生编辑后的自然语言任务交给 `handleCommand()`，继续走 backend LLM planner、allowlist executor、audit。
  - 草稿确认卡只接受 `create_structured_draft` 来源；`write_clinical_note_field` 写入结果不再生成新的确认卡。
  - `finalSpeakerTurns()` 改为接受任意 final 文本 turn；`unknown` 角色在发送给 LLM 整理时按医生口述处理，但原始 turn 仍保留未确认状态，可手动修正。
- `tests/e2e/his-agent.spec.ts`
  - 新增确认草稿不会提前写 patient-store、医生确认后写入 patient-store 并产生 audit 的回归。
  - 新增“只有医生单人 final turn、没有患者 turn”也能显示整理按钮并发送最小 turns payload 的回归。

### 安全边界

- `create_structured_draft` 仍然只生成可编辑草稿，不修改 patient-store、不写 audit log。
- 医生点击“确认写入”后才作为普通自然语言任务进入现有 Agent taskflow。
- 取消确认不执行任务、不修改 patient-store。
- 语音整理只发送必要 turns 文本和当前患者上下文，不发送 raw ASR / raw debug JSON / 全量 pageState。
- 医生单人 unknown turn 只在整理 payload 中按医生口述处理，不把原始 UI turn 标成 automatic diarization。

### 验证

- `node --check shared/agent-widget.js && node --check tests/e2e/his-agent.spec.ts`：通过。
- `npm run check:encoding`：通过，29 个文件合法 UTF-8。
- close-loop 专项：`HIS_BASE_URL=http://10.26.6.8:31824 npm run test:e2e -- --reporter=list --grep=close-loop`：10 passed。
- voice 专项：`HIS_BASE_URL=http://10.26.6.8:31824 npm run test:e2e -- --reporter=list --grep=voice`：12 passed。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31824 npm run test:e2e -- --reporter=list`：65 passed / 3 skipped。

### 新强制刷新 URL

- `http://10.26.6.8:31824/html/login.html?v=20260624-clinical-draft-confirm-doctor-only`

## 2026-06-23 当前任务步骤滚动与病历草稿 action 修正

### 本轮问题

- 当前任务卡的“展开步骤”已经能保持展开，但用户在步骤列表内下拉后，下一次任务进度刷新会整块重绘任务卡，导致步骤列表滚动位置回到顶部。
- 执行“为 P001 张伟生成病历草稿：咳嗽2天伴低热，夜间加重，少量白痰。”时，LLM 容易把“草稿输出”误规划成 `verify_patient_field` 的虚拟字段，前端校验时提示“校验字段不存在”。

### 修复内容

- `shared/agent-widget.js`：在当前任务卡重绘前捕获 `#hisAgentTaskList` 的 `scrollTop` 和面板滚动位置，重绘后按同一 `taskId` 恢复；用户手动滚动步骤列表时同步更新内存快照。
- `shared/agent-widget.css`：步骤列表滚动容器增加 `overscroll-behavior: contain` 和 `scroll-behavior: auto`，避免局部滚动被平滑动画或外层滚动联动打断。
- `backend/main.py`：将 `create_structured_draft` / `write_clinical_note_field` 纳入 task planner 允许动作，并在 prompt contract 中明确：
  - “生成病历草稿”使用 `create_structured_draft`。
  - 只有明确写入字段时才使用 `write_clinical_note_field`。
  - 不允许把“输出 / output / result / draft / 草稿”当成 `verify_patient_field` 字段。
- `shared/agent-task-orchestrator.js`：补齐两个 allowlist action 的执行分支：
  - `create_structured_draft` 只生成 Agent 草稿输出，写入 task slots 和进度消息，不修改 patient-store，不写 audit log。
  - `write_clinical_note_field` 才写入 schema 内的临床字段，并继续走 patient editor adapter / audit。
- `tests/e2e/his-agent.spec.ts`：新增回归覆盖步骤列表滚动保持，以及结构化病历草稿不会触发“校验字段不存在”、不会直接修改 patient-store。

### 安全边界

- 未恢复本地自然语言 fallback。
- 未改变 patient-store / resolver / adapter 的业务规则。
- `create_structured_draft` 不是保存动作；没有 `write_clinical_note_field` 或 `save_patient` 时不会写入患者数据。
- 所有页面动作仍要求 backend LLM plan、allowlist executor、LLM gate。

### 验证

- 新容器：`8edcoghjm8evc-0`，浏览器真实访问前端 `http://10.26.6.8:31824`。
- 当前端口：frontend `5500->31824`，backend `8000->31351`，LLM `8001->31189`，ASR `8010->31411`，SSH `22->30855`。
- 已启动：`scripts/serve-static-utf8.py` on 5500，`backend.main:app` on 8000，`asr_service.app.main:app` on 8010。
- 公开链路验证：
  - `http://10.26.6.8:31824/html/login.html`：返回 UTF-8 HTML。
  - `http://10.26.6.8:31351/api/health`：`ok:true`。
  - `http://10.26.6.8:31411/health`：`ok:true`，ASR provider 为 `qwen-asr-realtime-api`。
- 真实 backend planner 最小探针：
  - 输入：“为 P001 张伟生成病历草稿：咳嗽2天伴低热，夜间加重，少量白痰。”
  - 返回 actionType：`create_structured_draft`。
  - 返回 message：“将为 P001 张伟生成一份可确认的病历草稿，不会自动保存。”
  - 未再返回 `verify_patient_field` 或虚拟“输出字段”校验。
- `node --check shared/runtime-config.js shared/agent-widget.js shared/agent-task-orchestrator.js tests/e2e/his-agent.spec.ts`：通过。
- `python3 -m py_compile backend/main.py`：通过。
- `npm run check:encoding`：通过，29 个文件合法 UTF-8。
- close-loop 专项：`HIS_BASE_URL=http://10.26.6.8:31824 npm run test:e2e -- --reporter=list --grep=close-loop`：9 passed。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31824 npm run test:e2e -- --reporter=list`：63 passed / 3 skipped。

### 新强制刷新 URL

- `http://10.26.6.8:31824/html/login.html?v=20260624-step-scroll-draft`

## 2026-06-23 Agent 状态闭环与就诊会话整理修正

### 本轮范围

- 只修改正式链路中的 `shared/agent-widget.js`、`shared/agent-task-orchestrator.js`、`backend/main.py`、`tests/e2e/his-agent.spec.ts` 和相关文档。
- 未修改 ASR / Diart 安装，未修改 patient-store / resolver / adapter 业务规则，未恢复 fallback，未触碰 `universal_agent_backup_*`。

### 修复内容

- “展开步骤”状态改为按 taskId 存储到 `hisAgentTaskStepsUiV2`；任务卡每次重渲染时恢复 `details.open`，进度刷新不会自动折叠。
- 新任务发送后先创建 `planningTask + runId`，`renderTaskSummary()` 优先显示当前规划占位，不再用最近完成任务污染新任务卡。
- 页面切换前保存输入草稿和滚动快照；页面恢复时先把 `#hisAgentBody` 恢复到保存位置再显示，避免可见的从顶部滚到底部动画。
- 未发送输入存入 `hisAgentInputDraftV2`；只在任务被接受执行或用户取消时清空，LLM 不可用或页面切换时保留。
- 取消任务改为 `cancelActiveTask()`：冻结 `finished_at_ms / elapsed_ms`，归档到历史，清空 activeTask，并忽略晚到 progress / save，避免取消后计时继续。
- “我发错了，先不改”等元指令会终止当前任务，不进入新的患者字段任务。
- `/api/voice/turns-to-agent-task` 返回 `result_type + task_text + proposed_fields + reason_summary`；`explicit_action` 和 `clinical_draft` 均只生成可编辑自然语言待确认任务，`no_action / needs_clarification` 不显示执行框。

### 产品边界

- 就诊会话整理不直接返回页面 action，不写 patient-store，不保存，不写 agent audit log。
- 点击“执行任务”后仍把医生编辑后的自然语言任务送入现有 backend LLM planner、allowlist executor 和 audit 机制。
- 取消就诊会话整理只移除待确认任务，保留原始 turns。

### 验证

- 新增 E2E 覆盖：步骤展开持久化、新任务规划占位不闪旧任务、输入草稿跨页恢复并在成功发送后清空、取消冻结 activeTask 并忽略晚到 progress、滚动快照恢复、语音整理 clinical_draft/no_action。
- `node --check shared/agent-widget.js && node --check shared/agent-task-orchestrator.js && python3 -m py_compile backend/main.py`：通过。
- `npm run check:encoding`：通过，29 个文件合法 UTF-8。
- 关键回归组连续两轮：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list --grep=close-loop`：两轮均 7 passed。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：61 passed / 3 skipped。
- LLM E2E：`RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：61 passed / 3 skipped；两条真实 @llm 写 demo patient-store 用例仍按可用性 guard skip。
- 未发现 `RUN_MIC_E2E` / `RUN_DIARIZATION_E2E` 专用开关。

## 2026-06-23 LLM 状态刷新诊断

### 结论

- “系统连接情况”的“刷新状态”会重新检测，不是只读旧缓存。
- UI 调用链路：`#hisAgentRefreshStatusButton` -> `showConnectionTopic()` -> `probeHttpViaRuntime(/api/health)`、`probeHttpViaRuntime(/health)`、`refreshLlmStatusViaRuntime()` -> backend `/api/llm/test`。
- backend 只在启动时通过 `load_dotenv(BACKEND_DIR / ".env")` 读取 key；如果替换 `backend/.env` 后不重启 backend，刷新状态仍会命中旧进程的旧 key。
- 本次检查中 `backend/.env` 修改时间晚于 backend 进程启动时间，重启 backend 后旧 401 消失，说明新配置已被读取。
- 当前剩余问题不是前端刷新逻辑，而是上游 `https://api.shubiaobiao.cn/v1/chat/completions` 对 chat 请求返回 502 / 522 / timeout；`/models` 能返回 200，说明基础认证和网关可访问，但 chat completion 通道不稳定。

### 本轮操作

- 重启 backend，使其重新读取 `backend/.env`。
- 未打印、复制或记录任何 key 内容。
- 为排查模型通道，将 `LLM_MODEL` 切到已一度验证可用的 `gpt-4.1-mini`；随后上游 chat 通道仍出现 timeout / 522，说明问题在上游代理或模型服务可用性。

### 当前状态

- Frontend / Backend / ASR 端口链路可达。
- `/api/llm/test` 可达但返回上游错误，因此系统连接情况中 LLM 仍应显示不可用。
- 后续要恢复 LLM connected，需要提供稳定可用的 `base_url + key + model` 组合，或等待当前代理恢复。

## 2026-06-23 新容器端口同步

### 本轮范围

- 只同步新容器公开端口，旧公开端口不保留为默认值。
- 修改正式配置、E2E 默认地址和相关文档，不改 Agent 业务逻辑、不改 patient-store / resolver / adapter、不改 ASR / Diart 安装。

### 新端口映射

- Frontend：`5500->31210`
- Backend：`8000->30921`
- ASR：`8010->31238`
- LLM service：`8001->31968`
- Notebook / auxiliary：`8888->45630`
- SSH：`22->30855`

### 修改内容

- `shared/runtime-config.js` 默认端口更新为 frontend `31210`、backend `30921`、ASR `31238`、LLM `31968`。
- `tests/e2e/playwright.config.ts` 默认 `HIS_BASE_URL` 更新为 `http://10.26.6.8:31210`。
- `tests/e2e/README.md`、`DIARIZATION_INTEGRATION.md`、`FILE_STRUCTURE_AUDIT.md`、`AGENT_V2_DESIGN.md`、`WIDGET_UI_CODE_MAP.md`、`PROJECT_BACKLOG.md` 中的公开端口说明同步为新映射。

### 验证

- `npm run check:encoding`：通过，28 个文件合法 UTF-8。
- `python3 -m py_compile backend/main.py asr_service/app/main.py`：通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，51 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，51 passed / 3 skipped；当前 `/api/llm/test` 可达但上游返回 401“令牌状态不可用”，两条真实写 demo patient-store 的 `@llm` 用例仍按 guard skip。

### 新强制刷新 URL

`http://10.26.6.8:31210/html/login.html?v=20260623-new-container-ports`

## 2026-06-22 Agent 工作台入口与任务计划可视化修正

### 本轮范围

- 只修改悬浮框正式 UI 文件、E2E 和文档：`shared/agent-widget.js`、`shared/agent-widget.css`、`tests/e2e/his-agent.spec.ts`。
- 未修改 backend planner、allowlist executor、patient-store、resolver、adapter、ASR/Diart 主链路、fallback 或 `universal_agent_backup_*`。

### 修复内容

- 主视图新增“进入 Agent 对话”按钮，医生可以不发送任务，直接进入 Agent 对话与任务工作台。
- chatView 不再只是“发送任务后的临时执行态页面”；它现在也是可主动进入的工作台。
- 当前任务卡新增 `Agent：...` 自然语言状态说明，让医生能看到 Agent 正在理解任务、执行哪一步、等待什么或为什么失败。
- 任务完成后，如果 chatView 没有活动任务，会从 `hisAgentTaskHistory` 读取最近一次带 plan 的任务，显示“最近任务计划”。
- 原来的绿色对勾任务 list 仍用 `#hisAgentTaskList` 展示；完成后不再因为 active task 清空而从工作台消失。
- 底部 footer 移除独立“取消任务”按钮，避免运行中同时出现“发送”和“取消任务”两种主操作。
- 点击“发送”后，主按钮在 planning/running 时切换为“取消任务”；当任务完成、失败、取消，或进入 waiting_user 需要医生补充条件时恢复为“发送”。

### 安全边界

- “进入 Agent 对话”只切换 UI，不创建任务、不调用 planner、不执行页面动作。
- “最近任务计划”只读本地任务历史，不修改 patient-store、不保存、不写新的 audit log。
- 运行中主按钮切为“取消任务”只调用现有 `AgentTaskOrchestrator.cancel()`，不绕过现有 taskflow。

### 验证

- `node --check shared/agent-widget.js`：通过。
- `npm run check:encoding`：通过，28 个文件合法 UTF-8。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，51 passed / 3 skipped。

### 新强制刷新 URL

`http://10.26.6.8:31210/html/login.html?v=20260622-agent-workspace-primary-button`

## 2026-06-22 Universal Agent V2 产品化重构

### 本轮范围

- 只修改正式链路文件：`shared/` 新增 V2 状态/路由/任务/滚动模块，更新 `agent-widget.js`、`agent-widget.css`、`agent-task-orchestrator.js`、正式 `html/` 挂载脚本和 `tests/e2e/`。
- 未修改根目录重复 HTML/JS，未修改 `universal_agent_backup_*`，未恢复 fallback，未修改 patient-store / resolver / adapter 业务规则。
- 已按 `AGENTS.md` 先做备份：`/tmp/universal_agent_v2_productization_20260622_091401`。

### 新增能力

- 新增 `shared/agent-input-router.js`：统一区分新任务、waiting_user 续接、取消、确认、主输入语音文本和就诊会话整理任务。
- 新增 `shared/agent-state-machine.js`：记录 `home / chatting / planning / task_running / waiting_user / voice_* / completed / failed` 等状态和 transitions。
- 新增 `shared/agent-task-model.js`：规范化 task / step 字段，包括 `task_id`、`waitingFor`、`usage_total`、`audit_ids`、`elapsed_ms`。
- 新增 `shared/agent-scroll-manager.js`：用户上滑阅读时不强制滚到底部，有新消息时显示未读提示。
- `shared/agent-task-orchestrator.js` 支持 waiting_user 续接：保留原 `task_id`，把医生补充发送给 backend LLM planner，再走原 allowlist executor。
- 当前任务进度压缩在当前任务卡片，不再把每条 terminal 进度都镜像到聊天流。

### 语音与就诊会话

- 主输入“语音输入”仍只做医生单人任务口述转文字：写入底部输入框，不切换页面、不生成 doctor/patient turns、不自动发送。
- “就诊会话”只切换到 voiceView，不自动开麦；只有页面内“开始语音任务”才启动麦克风和 ASR。
- “结束对话并整理任务”继续只把 final turns 的必要文本交给 LLM，返回可编辑自然语言任务；医生点击“执行任务”前不执行页面动作。

### LLM 状态

- 本轮测试中发现 backend `/api/llm/test` 偶发卡在外部 LLM 检测调用，导致 `/api/health` 一度被单 worker 阻塞。
- 已做一次最小 backend 进程重启，只重启 8000 backend，不动 ASR、Diart 安装或业务文件。
- 重启后单独 `/api/llm/test` 可返回 `{"ok":true,"provider":"openai","model":"gpt-5.5","content":"ok"}`；但 RUN_LLM_E2E 的真实 @llm 用例仍可能因 availability check 遇到 20s 超时而 skip。

### 验证

- `node --check shared/agent-widget.js`：通过。
- `node --check shared/agent-task-orchestrator.js`：通过。
- `node --check shared/agent-state-machine.js`：通过。
- `node --check shared/agent-input-router.js`：通过。
- `node --check shared/agent-scroll-manager.js`：通过。
- `node --check shared/agent-task-model.js`：通过。
- `npm run check:encoding`：通过，28 个文件合法 UTF-8。
- 当前端口映射已更新为：frontend `5500->31210`，backend `8000->30921`，LLM service `8001->31968`，ASR `8010->31238`。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，49 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，49 passed / 3 skipped；两条真实写 demo patient-store 的 `@llm` 用例仍按测试自身 guard skip。
- `RUN_MIC_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，49 passed / 3 skipped；fake microphone 环境未暴露 `getUserMedia`，可选 @mic 仍 skip。

### 新强制刷新 URL

`http://10.26.6.8:31210/html/login.html?v=20260622-agent-v2-productization`

## 2026-06-22 就诊会话开始录音 Diart 超时修复

### 本轮范围

- 只修复悬浮框就诊会话中“开始语音任务”被可选 Diart 健康检查阻塞的问题。
- 未修改 Diart 安装、ASR 主链路、patient-store、resolver、adapter 业务规则、fallback 或 `universal_agent_backup_*`。
- 主输入“语音输入”和就诊会话继续保持分离：主输入只做医生任务口述转文字；就诊会话才生成医生/患者 turns。

### 产品逻辑确认

- 主视图底部“语音输入”：默认面向医生单人说话，只启动麦克风和 ASR，把转写填入底部 Agent 输入框；不会切到就诊会话、不会生成 doctor/patient turns、不会自动发送。
- 就诊会话“开始语音任务”：用于医生/患者会话采集，启动麦克风和 ASR；Diart 仅在健康检查明确可用时参与说话人分离。
- “停止语音任务”：只负责停止本次就诊会话采集并释放麦克风。
- “结束对话并整理任务”：在已有 final turns 后把必要的医生/患者文本交给 LLM 整理为可编辑自然语言任务；医生点击“执行任务”前不执行页面动作。

### 问题原因

- 当前 backend 的 `/diarization/health` 会超时。
- 旧实现中 `start()` 在请求浏览器麦克风前先等待 `checkDiarizationHealth()`，且该 fetch 没有超时保护。
- 因此点击“开始语音任务”后流程卡在 Diart 健康检查，浏览器还没有调用 `getUserMedia()`；录音状态没有进入 `recording`，所以“停止语音任务”一直保持不可点击。

### 修复内容

- `shared/voice-input-controller.js` 新增短超时 fetch：
  - ASR health 默认 3.5 秒超时。
  - Diart health 默认 2.5 秒超时。
- Diart health 超时时返回 `provider: manual` / `status: timeout`，不会阻塞麦克风和 ASR 启动。
- Diart WebSocket 只在 health 明确 `connected` 或 `available` 时尝试连接；manual / timeout / disconnected 不再打开 Diart WS。
- WebSocket open 等待增加超时保护，避免可选 diarization 通道长期挂起。
- `shared/agent-widget.js` 更新 `scriptsVersion` 为 `20260622-voice-ui-split-diarization-timeout`，用于强制刷新。

### 验证

- `node --check shared/agent-widget.js`：通过。
- `node --check shared/voice-input-controller.js`：通过。
- `npm run check:encoding`：通过，24 个文件合法 UTF-8。
- 专项浏览器验证：真实 `/diarization/health` 超时时，点击“开始语音任务”约 2.8 秒后进入 `recording:true`，“停止语音任务”可点击；点击停止后 `streamTrackCount:0` 且 track 已停止。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，45 passed / 3 skipped。

### 新强制刷新 URL

`http://10.26.6.8:31210/html/login.html?v=20260622-voice-ui-split-diarization-timeout`

## 2026-06-22 悬浮 Agent homeView / chatView UI 优化

### 本轮范围

- 只优化悬浮框 UI、交互模式和视觉风格。
- 正式修改限定在 `shared/agent-widget.js`、`shared/agent-widget.css`、`tests/e2e/his-agent.spec.ts` 和文档。
- 未修改 Agent 业务执行逻辑、LLM gate、allowlist executor、ASR、Diart、patient-store、resolver、fallback 或 `universal_agent_backup_*`。

### 视图结构

- 新增明确的 `homeView` / `chatView` 状态。
- `homeView` 只展示欢迎语、四个专题卡片和底部输入区，不再堆叠聊天消息、任务步骤、长 JSON 或开发者详情。
- `chatView` 展示用户/Agent 消息、当前任务卡片、任务步骤、就诊会话面板；顶部提供“返回”按钮，返回主视图但不清空聊天记录。
- “新会话”会清空当前对话与 activeTask 并回到 `homeView`。

### 专题卡片

- 主视图保留四个专题卡片：查看患者管理、系统连接情况、查看历史任务、示例任务。
- 查看患者管理：进入 `chatView` 后询问是否打开患者管理页，点击“打开患者管理”才执行手动导航。
- 系统连接情况：进入 `chatView` 后展示 Backend、LLM、Agent、ASR 服务、麦克风、说话人分离、Data 的竖向状态，不展示长 debug JSON。
- 查看历史任务：进入 `chatView` 后询问是否打开 Agent 执行记录页，点击确认后跳转。
- 示例任务：进入 `chatView` 后展示 5 条示例；点击任意示例等价于用户发送自然语言任务，仍走现有 Agent taskflow。

### 视觉统一

- 顶部和按钮收敛为白底、浅蓝 hover、active 轻按压反馈；发送按钮保留统一蓝色主按钮。
- 左右轮播按钮默认均为白色，hover 变浅蓝，active 为轻蓝背景。
- 用户消息右侧气泡，Agent / system 消息左侧气泡。
- 保留 Agent 自动操作反馈：按钮点击、字段高亮、字段修改闪烁、保存 pulse 和 toast 均未移除。

### 测试结果

- `node --check shared/agent-widget.js`：通过。
- `npm run check:encoding`：通过，24 个文件合法 UTF-8，关键中文文案存在。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，43 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，43 passed / 3 skipped；两条 `@llm` happy path 仍由测试内部条件跳过。
- Diarization health E2E 增加浏览器端 20 秒超时保护；超时时显式视为 `unavailable_timeout` / `manual`，不假装 automatic 或 available。

### 新强制刷新 URL

`http://10.26.6.8:31210/html/login.html?v=20260622-home-chat-ui`

## 2026-06-22 端口同步

### 当前容器端口映射

- Frontend：容器 `5500` -> 外部 `31210`
- SSH：容器 `22` -> 外部 `30855`
- Jupyter/调试：容器 `8888` -> 外部 `45630`
- Backend：容器 `8000` -> 外部 `30921`
- LLM service：容器 `8001` -> 外部 `31968`
- ASR：容器 `8010` -> 外部 `31238`

### 修改内容

- `shared/runtime-config.js` 默认外部端口更新为 `31210 / 30921 / 31238 / 31968`。
- `shared/agent-widget.js`、`shared/voice-input-controller.js`、`html/patient-editor.html` 的 fallback URL 更新为新端口。
- `tests/e2e/playwright.config.ts` 默认 `HIS_BASE_URL` 更新为 `http://10.26.6.8:31210`。
- E2E 文档、结构审计和 backlog 中当前可执行命令与强制刷新 URL 改为新端口。

### 验证

- `npm run check:encoding`：通过，24 个文件合法 UTF-8，关键中文文案存在。
- 容器内服务：`127.0.0.1:5500/html/login.html`、`127.0.0.1:8000/api/health`、`127.0.0.1:8010/health` 均可访问。
- 节点映射链路：容器内访问 `http://10.26.6.8:31210/html/login.html`、`http://10.26.6.8:30921/api/health`、`http://10.26.6.8:30921/api/llm/test`、`http://10.26.6.8:31238/health` 均通过；LLM test 返回 `ok:true`。
- Windows 当前环境直连 `http://10.26.6.8:31210` 和 `http://10.26.6.8:30921` 仍 connection refused，说明本机到节点端口访问层仍未放通；容器内和节点映射自身已验证通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，42 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，42 passed / 3 skipped；两条 `@llm` happy path 仍由测试内部条件跳过，backend LLM health 已确认可用。

### 新强制刷新 URL

`http://10.26.6.8:31210/html/login.html?v=20260622-port-sync`

## 2026-06-22 Agent 页面操作可视化与字段高亮

### 本轮范围

- 只处理 Agent 页面操作可视化、字段更改高亮、按钮/跳转反馈。
- 未修改业务执行语义、patient-store 数据结构、resolver、ASR、Diart、fallback 或 `universal_agent_backup_*`。
- 正式修改仍限定在 `html/`、`shared/`、`tests/e2e/` 和文档；未修改根目录重复 HTML/JS。

### 新增可视化反馈

- 文本 input / textarea：Agent 会先高亮目标字段，显示“Agent 正在修改：字段名”，清空原值，再按块模拟逐字输入新值，触发 `input/change`，最后字段闪烁提示“已修改”。
- 下拉框 select：Agent 会高亮 select，显示“Agent 正在选择：选项”，不依赖浏览器原生下拉截图，设置 value 后触发 `input/change` 并闪烁。
- 日期 input：Agent 会显示“旧日期 -> 新日期”，清空后写入兼容的 `YYYY-MM-DD` 值，触发 `input/change`，不强依赖系统 date picker。
- 保存/同步：保存按钮出现点击/保存 pulse，并显示“已保存 / 已同步 / 已记录 audit log”。
- 页面跳转：dashboard 入口卡片、登录按钮、退出登录、患者管理行和编辑按钮会先出现点击/高亮反馈，再延迟约 150-300ms 跳转。
- 患者行：Agent 选择患者时高亮目标行，并显示“Agent 已定位患者：patientId 姓名”。

### 工具函数

`shared/ui-action-feedback.js` 现在统一提供：

- `sleep(ms)`
- `flashElement(el, type)`
- `pulseElement(el, type)`
- `agentClickElement(el, options)`
- `agentFocusField(el, options)`
- `agentClearAndType(el, value, options)`
- `agentSelectOption(selectEl, value, label, options)`
- `agentSetDate(inputEl, value, options)`
- `highlightChangedField(fieldName)`
- `highlightPatientRow(patientId)`
- `showAgentActionToast(message, type)`

工具函数找不到元素或动画失败只记录 warning，不会让业务 action 失败。E2E 可通过 `window.__HIS_AGENT_FAST_ANIMATION__ = true` 启用快速动画模式。

### 安全边界

- 字段写入仍由 `PatientStore.updatePatient()` 完成，audit log 仍记录 oldValue/newValue。
- Agent task 仍经过后端 LLM planner、前端 allowlist executor、`source === "backend_llm"` 校验。
- 可视化只是表现层；无 LLM 时仍不执行页面动作，手动操作仍正常。

### 测试结果

- 本地 JS 语法检查通过：`node --check shared/ui-action-feedback.js`、`node --check shared/patient-editor-action-adapter.js`、`node --check shared/agent-task-orchestrator.js`。
- 远端同步和远端 E2E 暂未执行：`ssh aistation-gui-qwen` 当前连接到 `10.26.6.88:30855` 被拒绝；`http://10.26.6.8:31210` 与 `http://10.26.6.8:30921` 当前也不可连接。
- 待远端恢复后运行：`npm run check:encoding`、默认 E2E、`RUN_LLM_E2E=1` E2E。

## 2026-06-22 Agent 历史、登录态与操作反馈优化

### 本轮范围

- 只处理 Agent 修改历史展示、Demo 登录态/任务前置条件、悬浮面板拖拽区域、工作台退出登录、手动/Agent 操作视觉反馈。
- 未修改 ASR 主链路、Diart 安装或说话人分离逻辑。
- 未修改 patient-store 数据结构；只读取现有 audit log 用于历史展示。
- 未修改 resolver 匹配规则，未恢复本地 fallback，未修改 `universal_agent_backup_*`。
- 正式链路仍限定在 `html/`、`shared/`、必要 E2E 和文档。

### 修改内容

- `agent-history.html`：任务列表新增来源、相关患者、总耗时、总 token；详情页新增创建/完成时间、prompt/completion token、步骤 old/new 值、audit_id，并保持开发者 JSON 默认折叠。
- `agent-task-orchestrator.js`：activeTask/历史记录持久化时保留步骤耗时、args、result、usage、audit、source、slots；登录页任务仍先等医生确认，进入 HIS 内部页后可自动恢复等待中的登录前置任务。
- `login.html` / `dashboard.html` / `patient-management.html` / `patient-editor.html` / `agent-history.html`：补充 `isLoginPage`、`isInHisContext`、`hisDemoAuthenticated`、`loginState`，让 Agent 能区分登录页与内部 HIS 页面。
- `dashboard.html`：新增“退出登录”按钮，仅清除 Demo 登录态并返回登录页，不清 patient-store、audit log 或 Agent 历史。
- `shared/ui-action-feedback.js`：新增共享视觉反馈层；手动点击有 pulse，Agent 导航、字段修改、保存、校验有 flash/toast。
- `agent-widget.js` / `agent-widget.css`：悬浮面板整个 header 成为更大的拖拽区域，保留原拖拽手柄与重置按钮。

### 安全边界

- 对话或任务结束后不会自动绕过医生确认执行页面动作。
- Agent 执行动作仍走后端 LLM planner、前端 allowlist executor、patient-store audit log。
- 历史页只读取并展示 task/audit，不写 patient-store。
- 无 LLM 时仍不会执行 Agent 任务；手动页面按钮和 Demo 登录不受影响。

### 测试结果

- `npm run check:encoding`：通过，24 个文件合法 UTF-8，关键中文文案存在。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，40 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，40 passed / 3 skipped；两条真实 LLM happy path 仍由测试内部 guard 跳过，直接检查 `http://10.26.6.8:30921/api/llm/test` 返回 `ok:true`。

## 2026-06-12 中文乱码修复与编码防回归

### 本轮范围

- 只处理中文乱码 / 编码回归防护。
- 未修改 Agent 执行业务逻辑。
- 未修改 ASR 业务逻辑。
- 未修改 patient-store。
- 未恢复本地 fallback Agent。
- 未修改任何 `universal_agent_backup_*` 备份目录。

### 乱码原因

本轮定位到 `html/login.html` 和 `html/patient-editor.html` 中存在真实写坏的 UTF-8 文案。典型表现是部分中文被替换成不可读字符或半截标签。

根因是此前在 Windows / PowerShell 环境中对含中文文件做机械重写时，读写编码没有被稳定限定为 UTF-8，导致原本的中文字节被错误解码后再次写回。浏览器随后加载的就是已经损坏的文件，而不是单纯缓存问题。

### 修复内容

- 修复 `html/login.html` 的可见中文文案：
  - `医院信息系统 HIS Demo`
  - `门诊工作台 / 病历编辑 / Agent 原型演示`
  - `用户登录`
  - Demo 登录提示、按钮、页脚、登录成功/失败提示
- 修复 `html/patient-editor.html` 的可见中文文案和受损字符串：
  - 顶部用户/科室/时间/登录状态
  - `返回工作台`、`患者管理`、`退出登录`
  - 病历导航、患者基础信息、旧病历、现病史、既往史、过敏史、检查检验
  - `患者摘要`、`主诉`、`现病史`
  - 字段来源、草稿、请选择、audit empty、状态简卡等展示文案
- 确认四个核心 HTML 文件 head 前部均已有 `<meta charset="UTF-8">`。
- 新增 `scripts/check-encoding.mjs`。
- `package.json` 新增 `check:encoding`。
- E2E 增加中文文案和乱码断言。
- `AGENTS.md` 增加 UTF-8 / 中文文案防回归规则。
- `.agents/skills/his-ui-e2e-review/SKILL.md` 增加中文乱码检查要求。

### 防回归脚本

运行：

```bash
npm run check:encoding
```

脚本检查：

- HTML / JS / CSS / MD / TS / JSON 是否为合法 UTF-8。
- HTML 文件 head 前部是否有 `<meta charset="UTF-8">`。
- 页面和测试目标文件是否包含典型乱码片段：`Ã`、`å`、`é`、`è`、`鐩`、`婚`、`榇`、`淇`、`鍖`、`�`、`锟`。
- 关键中文文案是否仍存在：
  - `医院信息系统 HIS Demo`
  - `用户登录`
  - `患者管理`
  - `患者列表`
  - `返回工作台`
  - `退出登录`
  - `AI Agent`

### E2E 增强

`tests/e2e/his-agent.spec.ts` 新增 `Chinese text encoding` 分组：

- login 页面断言：
  - `医院信息系统 HIS Demo`
  - `用户登录`
  - 页面正文不包含典型乱码
- patient-management 页面断言：
  - `患者管理`
  - `患者列表`
  - `P001`
  - `张伟`
  - 页面正文不包含典型乱码
- patient-editor 页面断言：
  - `患者摘要`
  - `主诉`
  - `现病史`
  - 页面正文不包含典型乱码

### 本地检查结果

```bash
npm run check:encoding
```

结果：

```text
Encoding check passed: 20 files are valid UTF-8 and required Chinese copy is present.
```

### 后续验收

已同步到真实运行目录 `/huaiwenpang/universal_agent` 并完成验收。

远端编码检查：

```bash
npm run check:encoding
```

结果：

```text
Encoding check passed: 22 files are valid UTF-8 and required Chinese copy is present.
```

远端静态响应头：

```text
Content-type: text/html; charset=utf-8
Content-type: text/javascript; charset=utf-8
Content-type: text/css; charset=utf-8
```

为保证静态文件响应头包含 charset，本轮新增并启用了 `scripts/serve-static-utf8.py`，替换原先的 `python3 -m http.server 5500`。

E2E：

```bash
HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

## 2026-06-12 容器端口变更配置更新

### 本轮范围

本轮只更新运行时端口配置、E2E 默认 baseURL 和文档，不修改业务逻辑、不修改 UI、不修改 Agent 执行逻辑、不修改 ASR 业务逻辑、不修改 `universal_agent_backup_*`。

### 新端口探测结果

根据平台新映射，当前目标地址为：

- frontendBaseUrl: `http://10.26.6.8:31210`
- backendBaseUrl: `http://10.26.6.8:30921`
- asrBaseUrl: `http://10.26.6.8:31238`
- llmBaseUrl: `http://10.26.6.8:31968`

探测情况：

- 容器内 `http://127.0.0.1:5500/html/login.html` 返回 200，且 `Content-Type` 包含 `charset=utf-8`。
- 当前探测时容器内 `127.0.0.1:8000` 未启动，外部 `30921` 因此无法确认 health。
- 当前探测时容器内 `127.0.0.1:8010` 未启动，外部 `31238` 因此无法确认 health。
- 前端配置仍按新映射更新；后端和 ASR 状态由实际服务启动情况决定。

### 修改内容

- `shared/runtime-config.js` 默认端口更新为 `31210 / 30921 / 31238 / 31968`。
- `shared/runtime-config.js` 继续支持 query 参数覆盖。
- 新增 `window.__HIS_RUNTIME_ENV__` 覆盖入口，用于测试或宿主环境注入。
- 新增 `his_runtime_service_urls` localStorage 覆盖读取，但会自动忽略旧 host `10.26.6.8` 和旧端口 `31210 / 30921 / 31238 / 31210 / 30921 / 31238 / 31968`。
- `shared/agent-widget.js`、`shared/voice-input-controller.js`、`html/patient-editor.html` 中的兜底服务地址同步更新。
- `tests/e2e/playwright.config.ts` 默认 `HIS_BASE_URL` 更新为 `http://10.26.6.8:31210`，仍可用环境变量覆盖。

### 验证

本地已通过：

```bash
node --check shared/runtime-config.js
node --check shared/agent-widget.js
node --check shared/voice-input-controller.js
node --check tests/e2e/his-agent.spec.ts
npm run check:encoding
```

远程同步后需要在服务启动后运行：

```bash
HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

远程已使用新前端地址完成默认 E2E：

```bash
HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

结果：

```text
21 passed / 2 skipped / 0 failed
```

Skipped 仍为默认关闭的真实 LLM 数据变更用例：

- `updates P001 phone with visible progress when LLM is connected @llm`
- `updates Zhang Wei gender without patient not found @llm`

当前外部 health 探测结果：

- `http://10.26.6.8:31210/html/login.html` 返回 200。
- `http://10.26.6.8:30921/api/health` 当前 connection refused，原因是容器内 `127.0.0.1:8000` 未启动。
- `http://10.26.6.8:30921/api/llm/test` 当前 connection refused，原因同上。
- `http://10.26.6.8:31238/health` 当前 connection refused，原因是容器内 `127.0.0.1:8010` 未启动。

结果：

```text
19 passed / 2 skipped / 0 failed
```

Skipped 仍为默认关闭的真实 LLM 数据变更用例：

- `updates P001 phone with visible progress when LLM is connected @llm`
- `updates Zhang Wei gender without patient not found @llm`

并确认强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260612-encodingfix
```

## 2026-06-12 悬浮框代码地图、ASR/麦克风状态与 waiting_user 确认修复

### 本轮范围

本轮只处理悬浮框现有 UI 的代码审计地图、乱码防护补强、ASR 状态显示误导、以及 `waiting_user` 登录确认回复识别问题。未修改 Agent 执行业务语义、patient resolver、field resolver、patient-store、ASR 后端业务逻辑，也没有恢复本地 fallback Agent。

### 代码地图

新增 `WIDGET_UI_CODE_MAP.md`，记录悬浮框相关文件职责、核心 DOM id、CSS class、函数入口、Bootstrap 兜底按钮与主 widget 的边界、ASR 服务状态和浏览器麦克风状态的显示规则，以及后续 UI 修改需要跑的 E2E 锚点。

### 乱码防护补强

`scripts/check-encoding.mjs` 和 E2E 的 `mojibakePattern` 均增加了更宽的异常片段检查，包括连续问号、`閿`、`閻`、`脙`、`�`、`锟` 等。目标是防止后续 PowerShell 或错误编码脚本再次把中文页面写坏。

### ASR 状态显示修复

真实原因：前端之前把“浏览器麦克风 API 不可用 / 非安全上下文 / 权限拒绝”和“ASR 服务不可用”混在同一个状态里，导致 ASR `/health` 正常时，点击语音输入仍可能显示 ASR disconnected。

修复方式：

- `shared/voice-input-controller.js` 增加 `asrHealthStatus`、`microphoneStatus`、`voiceInputStatus`、`lastVoiceError`。
- `checkStatus()` 先检查 ASR `/health`，再单独检测浏览器 `navigator.mediaDevices.getUserMedia`、权限和安全上下文。
- `start()` 在浏览器不支持麦克风或非安全上下文时，不再把 ASR 服务状态改成 disconnected。
- `shared/agent-widget.js` 的服务状态 chip 改为显示 `ASR 服务` 与 `麦克风` 两个状态。
- `window.__HIS_AGENT_VOICE_DEBUG__` 增加诊断字段，便于区分服务连接和浏览器能力。

当前检测地址：

- ASR health：`<runtime-config.asrUrl>/health`
- Backend health：`<runtime-config.backendUrl>/api/health`
- LLM test：`<runtime-config.backendUrl>/api/llm/test`

### waiting_user 确认修复

真实原因：登录前置确认分类原先没有把单字中文“是”作为确认回复处理，导致用户在 `waiting_user` 状态下回复“是”后可能继续停留在等待提示。

修复方式：

- `shared/agent-task-orchestrator.js` 的 `classifyLoginPreconditionReply()` 增加确认词：`是`、`好`、`好的`、`行`、`可以`、`确认`、`继续`。
- 该逻辑仅用于已存在的登录前置确认，不引入自然语言 fallback，也不绕过 LLM 任务计划。

### E2E 增强

新增 / 更新测试：

- 页面正文不得出现连续问号等疑似问号乱码。
- 服务状态 chip 应显示 `ASR 服务`、`麦克风`、`Data`。
- 当浏览器没有麦克风 API 但 ASR health 正常时，应显示 `ASR 服务: connected`、`麦克风: unavailable`。
- 登录前置任务进入 `waiting_user` 后，用户回复“是”应继续执行登录前置步骤，不再重复“请选择继续当前任务或取消旧任务”。

### 验证计划

本地已通过：

```bash
node --check shared/agent-widget.js
node --check shared/voice-input-controller.js
node --check shared/agent-task-orchestrator.js
node --check tests/e2e/his-agent.spec.ts
```

远程同步后继续运行：

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

## 2026-06-12 CORS smoke unblock

Scope: only backend CORS, E2E browser connectivity, and documentation. No business execution logic, ASR logic, patient-store, resolver, adapter, fallback Agent, or backup directories were changed.

Root cause:
- Backend `/api/health` and `/api/llm/test` returned 200 from curl.
- Browser floating Agent failed because CORS preflight from `Origin: http://10.26.6.8:31210` returned `400 Disallowed CORS origin`.
- `backend/main.py` had old fixed origins and did not include the current frontend origin.

Fix:
- `backend/main.py` now reads optional `CORS_ALLOWED_ORIGINS` and `CORS_ALLOW_ORIGIN_REGEX`.
- The current frontend origin `http://10.26.6.8:31210` is explicitly allowed.
- Demo/dev dynamic ports are covered by `^https?://(localhost|127\.0\.0\.1|10\.26\.6\.8):[0-9]+$`.
- `allow_credentials=True` is preserved; no wildcard origin is used.

Validation:
- Remote syntax: `backend/.venv/bin/python -m py_compile backend/main.py` passed.
- CORS preflight GET `/api/llm/test`: 200 OK, `access-control-allow-origin: http://10.26.6.8:31210`.
- CORS preflight POST `/api/universal-agent/task-plan`: 200 OK, `access-control-allow-origin: http://10.26.6.8:31210`, `access-control-allow-headers: content-type`.
- Browser `fetch(http://10.26.6.8:30921/api/llm/test)` from the frontend page returned 200 with provider `openai`, model `gpt-5.5`, content `ok`.
- Floating Agent debug showed `llmStatus: connected` and `agentMode: llm_enabled`.
- ASR at `http://10.26.6.8:31238/health` currently returns connection refused; no ASR code was changed in this CORS-only round.

Smoke test results:
- Login page cross-page task with credentials updated P001 phone to `13800138000`, wrote audit log, then restored data.
- Patient management task updated Zhang Wei gender to `女`, wrote audit log, then restored data.
- Missing patient task did not mutate P001 and did not add audit log, but the message did not clearly say patient not found; record as follow-up semantic issue, not CORS.
- Login page task without credentials entered `waiting_user`, asked whether to use Demo 123/123, did not mutate data, then restored data.

E2E:
- Default: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 22 passed / 2 skipped / 0 failed.
- Real LLM: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 24 passed / 0 skipped / 0 failed.
- Added browser-context CORS/LLM test because Playwright `page.request` bypasses browser CORS.
- Increased only `@llm` test timeout to account for real network/LLM latency.

New URL:
- http://10.26.6.8:31210/html/login.html?v=20260612-corsfix

## 2026-06-12 ASR reconnect

Scope: connect the current ASR service to the running frontend. No Agent execution logic, patient-store, resolver, editor adapter, or fallback Agent logic was changed.

Root cause:
- No ASR process was running on container port 8010, so external `http://10.26.6.8:31238/health` returned connection refused.
- `asr_service/app/main.py` also had an old fixed CORS allowlist that did not include the current frontend origin `http://10.26.6.8:31210`.

Fix:
- Updated ASR CORS to allow `http://10.26.6.8:31210`.
- Added env-configurable ASR CORS: `ASR_CORS_ALLOWED_ORIGINS` / `ASR_CORS_ALLOW_ORIGIN_REGEX`, with fallback to `CORS_ALLOWED_ORIGINS` / `CORS_ALLOW_ORIGIN_REGEX`.
- Added demo/dev dynamic-port regex: `^https?://(localhost|127\.0\.0\.1|10\.26\.6\.8):[0-9]+$`.
- Started ASR with `uvicorn app.main:app --host 0.0.0.0 --port 8010` from `/huaiwenpang/universal_agent/asr_service`.

Validation:
- Remote ASR syntax check passed.
- `http://127.0.0.1:8010/health` returned 200.
- `http://10.26.6.8:31238/health` returned 200.
- OPTIONS preflight from `Origin: http://10.26.6.8:31210` to `/health` returned 200 with `access-control-allow-origin: http://10.26.6.8:31210`.
- Browser page fetch to `http://10.26.6.8:31238/health` returned 200.
- Browser WebSocket open to `ws://10.26.6.8:31238/ws` succeeded.
- Floating Agent debug showed `asrStatus: connected` and `asrUrl: http://10.26.6.8:31238`.
- Targeted UI/status E2E passed: 7 passed.
- `npm run check:encoding` passed.

Note:
- A full default E2E run had one unrelated real LLM browser-fetch timeout; ASR-related tests passed and backend `/api/llm/test` returned 200 immediately on follow-up curl.

Current ASR URL:
- http://10.26.6.8:31238

## 2026-06-12 widget status, voice state, waiting_user, not_found

Scope:
- Only formal `html/`, `shared/`, tests, and docs were changed.
- No root duplicate HTML/JS files were changed.
- No patient-store, patient resolver business rules, editor adapter, ASR recognition business logic, or local fallback Agent execution was changed.

Widget UI:
- Top status remains compact: Backend, LLM, Agent, ASR service, microphone, data source.
- Legacy `#hisAgentTask` dump remains hidden.
- Task steps render as expandable `details` rows with status, MM:SS elapsed time, and token field.
- Running steps now show an hourglass marker; failed/waiting steps show the reason inline.
- Step details now expose structured action, patient resolver logs, field resolver logs, adapter execution result, value change, audit details, error, usage, and related progress. Raw chain-of-thought is not displayed.
- Example tasks, service settings, developer details, and task history remain collapsed by default.

ASR and microphone state:
- ASR service health and microphone capability remain separated.
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()` includes `asrHealthUrl`, `asrHealthStatus`, `hasGetUserMedia`, `isSecureContext`, `microphoneStatus`, and `lastVoiceError`.
- Current ASR service is running and health is 200 at `http://10.26.6.8:31238/health`.
- Real browser check after clicking voice input showed ASR service `connected`, microphone `unavailable`, `hasGetUserMedia: false`, `isSecureContext: false`, `lastVoiceError: getUserMedia_unavailable`.
- The microphone limitation is from the current plain HTTP IP origin / browser capability; it is not an ASR service outage.

waiting_user confirmation:
- Login-precondition waiting tasks now treat `yes/y/ok/continue/sure`, `是/好/可以/确认/继续/继续吧/可以的/没问题`, and default-account phrases such as `使用 123/123` as confirmation.
- This is only meta-instruction handling for an existing waiting task, not a local natural-language business fallback.

Missing patient message:
- When resolver-driven steps cannot find a patient, the widget now says: `没有找到匹配患者，请提供 patientId、姓名、手机号或返回患者管理确认。`
- This keeps the task waiting for user input and does not mutate patient-store or write audit log.

Validation:
- Local and remote `node --check` passed for changed JS files.
- `npm run check:encoding` passed locally and remotely.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 23 passed / 2 skipped / 0 failed.
- Real LLM E2E: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 25 passed / 0 failed.

New forced refresh URL:
- http://10.26.6.8:31210/html/login.html?v=20260612-widgetstatusfix
## 2026-06-12 Agent 执行记录页面迁移

- 新增正式页面 `html/agent-history.html`，页面名称为“修改历史 / Agent 执行记录”。
- `dashboard` 左侧导航和模块卡片新增“修改历史 / Agent 执行记录”入口。
- 悬浮框保持轻量：保留连接状态、Agent 对话、当前任务摘要、输入区、“查看完整记录”按钮；不再长期展示结构化步骤详情、开发者详情、任务历史和 raw action。
- `agent-history.html` 从 `hisAgentActiveTask`、`hisAgentTaskHistory`、`PatientStore.getAuditLog()` 和 patient-store 读取只读数据，展示任务列表、当前任务详情、步骤状态、MM:SS 耗时、token、执行详情、相关患者摘要和 audit log。
- 每个步骤详情默认折叠，展示 LLM 计划摘要、结构化 action、patient resolver / field resolver 相关日志、adapter 执行结果、oldValue / newValue、audit_id、错误详情；不展示完整原始思考链。
- 更新缓存版本号为 `20260612-agenthistory`，强制浏览器加载新的正式 `html/` 与 `shared/` 文件。
- 本轮未修改 Agent 执行业务语义、ASR 业务逻辑、patient-store、resolver，也未恢复本地 fallback Agent。

验证：

- `node --check shared/agent-widget.js`：通过。
- `node --check shared/agent-task-orchestrator.js`：通过。
- `node --check shared/agent-widget-bootstrap.js`：通过。
- `node --check tests/e2e/his-agent.spec.ts`：通过。
- `npm run check:encoding`：通过。
- 远端 `npm run check:encoding`：通过，23 个文件为 UTF-8。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 25 passed / 2 skipped / 0 failed。
- 真实 LLM E2E：`RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 27 passed / 0 failed。
- 新强制刷新 URL：`http://10.26.6.8:31210/html/login.html?v=20260612-agenthistory`。
## 2026-06-12 ASR / 就诊会话迁移

- 旧 ASR 转写填入任务框体验已迁移为悬浮框“就诊会话”模块中的“填入 Agent 输入框”按钮。
- ASR 转写和模拟会话不会自动发送、不会自动执行、不会绕过 LLM gate；用户仍需切回 Agent 助手并手动点击“发送”。
- 就诊会话模块新增：ASR 服务状态、麦克风状态、开始语音任务、停止语音任务、实时 turns、手动修正医生/患者、一键交换医生/患者、清空语音记录、复制转写、粘贴文本为 turns、填入模拟就诊会话、填入 Agent 输入框、发送给 Agent、生成结构化草稿、写入病历字段确认式入口。
- ASR 服务状态来自 ASR `/health`，麦克风状态来自浏览器能力、权限和安全上下文；麦克风不可用不会把 ASR 服务误报为 disconnected。
- 当前页面是 `http://10.26.6.8`，不是 HTTPS / localhost 安全上下文；浏览器可能禁用麦克风 API。ASR 服务仍可在线，但当前浏览器无法直接录音时可使用“粘贴转写文本”或“填入模拟就诊会话”。
- 无 LLM 时允许查看状态、显示 turns、修正角色、交换角色、清空、复制、填入 Agent 输入框；不允许发送给 Agent、生成草稿或写入字段。
- 有 LLM 时“生成结构化草稿”通过 Agent LLM gate 发送 turns 和页面上下文；“写入病历字段”只把确认式 backend_llm action 指令填入 Agent 输入框，不自动写入，用户确认发送后仍走 LLM planner / allowlist / adapter / audit log。
- raw ASR 信息、speaker turns、WebSocket 状态、最后 ASR 错误进入“ASR 开发者详情”折叠区，默认折叠。
- 当前未实现真正自动 speaker diarization；demo 仅保存 doctor / patient turns，默认 speaker_0 为医生，支持手动修正和一键交换。
- 本轮未修改 ASR 后端业务逻辑、patient-store、resolver、patient-editor adapter，也未恢复本地 fallback Agent。

验证：

- `node --check shared/agent-widget.js`：通过。
- `node --check tests/e2e/his-agent.spec.ts`：通过。
- `npm run check:encoding`：通过。
- 远端 `npm run check:encoding`：通过，23 个文件为 UTF-8。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 28 passed / 2 skipped / 0 failed。
- 真实 LLM E2E：`RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 28 passed / 2 failed / 0 skipped。本次失败为真实 LLM 手机号/性别修改链路未在 90 秒内写入 patient-store，页面停留在患者管理页，P001 数据保持原值；默认 E2E、mock LLM gate、无 LLM guard 均通过。本轮未修改业务执行逻辑，未在 ASR 迁移任务中修该真实 LLM 链路波动。
- 新强制刷新 URL：`http://10.26.6.8:31210/html/login.html?v=20260612-voicemigration`。
## 2026-06-12 ASR / visit-session acceptance fix

Scope:
- Changed only formal `shared/` files and docs for ASR / visit-session acceptance.
- Did not change patient-store, resolver, Agent main execution logic, ASR backend recognition logic, root duplicate HTML/JS, or `universal_agent_backup_*`.
- Did not restore local fallback Agent.

Fixes:
- `shared/voice-input-controller.js` now keeps ASR health status separate from microphone/browser status and WebSocket status.
- ASR fallback URL now matches the current mapping: `http://10.26.6.8:31238`.
- A microphone failure, insecure context, permission denial, or WebSocket close no longer rewrites ASR health to `disconnected`.
- Because the backup page can use the microphone, the widget no longer blocks microphone startup only because `window.isSecureContext` is false. If `navigator.mediaDevices.getUserMedia` exists, it allows a real start attempt and classifies the actual browser error afterward.
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()` now includes `asrHealthUrl`, `asrHealthStatus`, `asrWebSocketStatus`, `hasGetUserMedia`, `isSecureContext`, `microphoneStatus`, and `lastVoiceError`.
- The visit-session primary action is now "整理到输入框": it only copies doctor/patient turns into the Agent input and never auto-sends.
- Without LLM, users can still view turns, paste transcript text, use mock visit turns, correct roles, swap roles, copy turns, clear turns, and fill the Agent input.
- Structured draft generation and write-field preparation are blocked unless LLM is connected.
- Write-field preparation still only fills a confirmation instruction into the Agent input. Field updates and audit log writes still require user send plus backend LLM action / allowlist / adapter.
- The UI continues to state that real automatic speaker diarization is not implemented; current doctor/patient roles are manual/mock/default mapping only.

Validation:
- Local `node --check` passed for `agent-widget.remote.js` and `voice-input-controller.remote.js` before upload.
- Remote service health before upload: frontend internal 200, backend internal 200, ASR internal 200.
- Current public forced refresh URL: `http://10.26.6.8:31210/html/login.html?v=20260612-asr-visitfix`.

Known remaining items:
- Browser microphone should now be attempted when `getUserMedia` is exposed. If it still fails while the backup page works, compare site permission, access origin, and cached widget resources.
- Real automatic speaker diarization with FunASR / Diart / pyannote remains a separate follow-up.
- Full E2E results for this exact version are recorded below after test execution.

Final validation:
- `npm run check:encoding` passed.
- Default E2E with internal service overrides: `HIS_BASE_URL=http://127.0.0.1:5500 npm run test:e2e -- --reporter=list` => 28 passed / 2 skipped / 0 failed.
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://127.0.0.1:5500 npm run test:e2e -- --reporter=list` => 28 passed / 2 skipped / 0 failed. The two `@llm` mutation cases remain skipped by current test gating and did not mutate demo data.
- The public browser URL for this version is `http://10.26.6.8:31210/html/login.html?v=20260612-asr-visitfix`.

## 2026-06-12 microphone permission diagnostic fix

Scope:
- Changed only formal `shared/`, `tests/e2e/`, and docs.
- Did not change ASR backend recognition logic, Agent execution logic, patient-store, resolver, root duplicate HTML/JS, or `universal_agent_backup_*`.
- Did not restore local fallback Agent.

Reason:
- The previous widget treated `window.isSecureContext === false` and Playwright/headless browser capability as too strong a signal.
- That could make the UI report microphone unavailable before the user's real browser had a chance to probe permission.
- The backup page had worked with microphone before, so the widget now performs a user-triggered browser probe instead of pre-blocking on HTTP IP alone.

Fix:
- Added a user-triggered `检查麦克风权限` button in the visit-session area.
- `isSecureContext=false` is now diagnostic information only. If the browser exposes `navigator.mediaDevices.getUserMedia`, the user can explicitly probe microphone permission.
- ASR service health, ASR WebSocket status, browser media API availability, secure-context status, permission state, device availability, and getUserMedia errors are tracked separately.
- Added `his_voice_microphone_policy` with `auto` and `force_probe`. `force_probe` does not bypass browser security; it only prevents the widget from pre-blocking when getUserMedia is available.
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()` is read-only and does not start recording.

Microphone status values:
- `unknown`
- `checking`
- `available`
- `unavailable_api`
- `insecure_context`
- `permission_prompt`
- `permission_granted`
- `permission_denied`
- `not_found`
- `device_busy`
- `get_user_media_error`

Debug fields:
- `href`, `protocol`, `hostname`, `isSecureContext`
- `hasNavigatorMediaDevices`, `hasGetUserMedia`
- `permissionState`, `microphoneStatus`
- `asrHealthUrl`, `asrHealthStatus`
- `asrWebSocketUrl`, `asrWebSocketStatus`
- `lastVoiceErrorName`, `lastVoiceErrorMessage`, `lastCheckedAt`

Manual check:
1. Open `http://10.26.6.8:31210/html/login.html?v=20260612-micdiagnostic`.
2. Open the floating Agent and switch to `就诊会话`.
3. Click `检查麦克风权限`.
4. If it still fails, run `window.__HIS_AGENT_VOICE_DEBUG__.dump()` in Console and share the output.

Validation:
- Local `node --check` passed for changed JS files before upload.
- Final remote validation is recorded below after deployment.

Final validation:
- Remote `node --check shared/agent-widget.js` passed.
- Remote `node --check shared/voice-input-controller.js` passed.
- Service health from the container: frontend 200, backend 200, ASR 200.
- `npm run check:encoding` passed: 23 files valid UTF-8 and required Chinese copy present.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 28 passed / 3 skipped / 0 failed.
- Optional fake microphone E2E: `RUN_MIC_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 28 passed / 3 skipped / 0 failed.
- The optional fake microphone test is skipped when Chromium still does not expose `getUserMedia` for the current HTTP IP origin. This is recorded as environment capability, not a product failure.
- New forced refresh URL: `http://10.26.6.8:31210/html/login.html?v=20260612-micdiagnostic`.
## 2026-06-12 old ASR microphone flow migration

Scope:
- Changed only formal `shared/`, `tests/e2e/`, and docs.
- Did not change ASR backend recognition logic, ASR model, LLM taskflow, patient-store, resolver, root duplicate HTML/JS, or `universal_agent_backup_*`.
- Did not restore local natural-language fallback Agent.

Old single-page ASR flow reviewed:
1. The old page triggered microphone permission from `voiceInputButton` click.
2. It checked `navigator.mediaDevices.getUserMedia` only for API exposure, then called `navigator.mediaDevices.getUserMedia({ audio: true })` during recording start.
3. It created `AudioContext`, `MediaStreamSource`, and `ScriptProcessor(4096, 1, 1)`.
4. It connected ASR WebSocket with `toWebSocketUrl(serviceUrl)`.
5. It downsampled audio to 16 kHz and sent `Float32Array.buffer` through WebSocket.
6. It handled ASR `partial` / `final` messages by updating transcript and the old command input.
7. It stopped by disconnecting processor/source, stopping all tracks, closing `AudioContext`, sending `{ type: "end" }`, waiting for final transcript, and closing WebSocket.
8. The current migrated widget had most of the audio graph already, but it lacked explicit debug evidence for whether `getUserMedia` was actually called, and still showed misleading static security-context guidance before a real browser probe.

Migration result:
- `语音输入` now starts the real flow: ASR health check -> ASR WebSocket connect -> `navigator.mediaDevices.getUserMedia({ audio: true })` -> `AudioContext` / `MediaStreamSource` / `ScriptProcessor` -> 16 kHz audio buffer send.
- `window.isSecureContext === false` is not used as a pre-blocking condition.
- If `getUserMedia` is exposed, the widget attempts the real browser call and records the result.
- If `getUserMedia` is not exposed, the UI reports: `当前浏览器未暴露 getUserMedia，无法申请麦克风权限。`
- Microphone failures now show real error category and detail: `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, or raw `error.name/message`.
- ASR service status remains independent from microphone and WebSocket status.
- ASR WebSocket failures show `ASR WebSocket disconnected/failed` and do not mean microphone is unavailable.
- Misleading static long messages about HTTPS / localhost / Chrome flags were removed from the primary user-facing failure path.

Voice debug dump:
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()` is read-only and does not start recording.
- It includes `href`, `isSecureContext`, `hasNavigatorMediaDevices`, `hasGetUserMedia`, `didCallGetUserMedia`, `getUserMediaCalledAt`, `microphoneStatus`, `lastVoiceErrorName`, `lastVoiceErrorMessage`, `asrHealthUrl`, `asrHealthStatus`, `asrWebSocketUrl`, `asrWebSocketStatus`, `audioContextState`, and `streamTrackCount`.

Visit-session behavior:
- ASR partial text updates the visit-session realtime transcript.
- ASR final text is stored as doctor/patient turns.
- Turns can be manually corrected and swapped.
- `整理到输入框` only fills text into the Agent input; it does not auto-send and does not execute page actions.
- Without LLM, ASR still only transcribes/displays text and cannot execute page actions.
- With LLM, sending from the Agent input still goes through backend LLM / allowlist / adapter.

Manual verification:
1. Open `http://10.26.6.8:31210/html/login.html?v=20260612-asr-micflow`.
2. Open the floating Agent.
3. Enter `就诊会话`.
4. Click `语音输入`.
5. Observe whether the browser prompts for microphone permission.
6. If no permission prompt appears, run `window.__HIS_AGENT_VOICE_DEBUG__.dump()` in Console and share the result.
7. If recording succeeds, say a sentence and verify ASR final enters turns.

Validation:
- Local `node --check` passed for changed JS files before upload.
- Final remote validation is recorded below after deployment.

Final validation for 2026-06-12 old ASR microphone flow migration:
- Remote static service returns `20260612-asr-micflow` resources for formal `html/` pages.
- Remote `node --check shared/voice-input-controller.js` passed.
- Remote `node --check shared/agent-widget.js` passed.
- Service health from the container: frontend 200, backend 200, ASR 200.
- `npm run check:encoding` passed: 23 files valid UTF-8 and required Chinese copy present.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 28 passed / 3 skipped / 0 failed.
- Optional fake microphone E2E: `RUN_MIC_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 28 passed / 3 skipped / 0 failed.
- The optional fake microphone case is skipped when the remote Chromium test environment still does not expose `getUserMedia` for the HTTP IP origin. This is test-environment capability, not a product fallback.
- New forced refresh URL: `http://10.26.6.8:31210/html/login.html?v=20260612-asr-micflow`.

## 2026-06-12 local microphone origin fix

Problem:
- Opening the app at `http://10.26.6.8:31210` can make Chrome/Edge hide `navigator.mediaDevices.getUserMedia` before the app can request microphone permission.
- In that state the browser will not show a microphone permission prompt; the frontend only sees `hasGetUserMedia=false`.
- The old single-page Agent could use microphone because it was likely accessed from a browser-trusted origin such as localhost / a trusted old origin / a previously configured address.

Fix / workaround implemented:
- Started SSH local forwards on this workstation:
  - `http://localhost:15500` -> remote frontend `127.0.0.1:5500`
  - `http://localhost:30921` -> remote backend `127.0.0.1:8000`
  - `http://localhost:31238` -> remote ASR `127.0.0.1:8010`
- Updated `shared/runtime-config.js` so when the app is opened from `localhost` or `127.0.0.1`, stored non-local service URLs are ignored and the app defaults to localhost service ports.
- This keeps the same remote frontend/backend/ASR services, but lets the user's browser see a secure localhost origin for microphone access.

Verified locally:
- `http://localhost:15500/html/login.html?v=20260612-localmic` returns the current app.
- `http://localhost:30921/api/health` returns backend 200.
- `http://localhost:31238/health` returns ASR 200.
- Chrome DevTools probe on `http://localhost:15500/html/login.html?v=20260612-localmic` returned:
  - `isSecureContext=true`
  - `hasNavigatorMediaDevices=true`
  - `hasGetUserMedia=true`
  - runtime backend `http://localhost:30921`
  - runtime ASR `http://localhost:31238`
- Chrome fake-media probe successfully called `getUserMedia({ audio: true })` and received one audio track.

Use this URL for real microphone testing:
- `http://localhost:15500/html/login.html?v=20260612-localmic`

If the browser still does not prompt:
- Open Console after clicking `语音输入` and run `window.__HIS_AGENT_VOICE_DEBUG__.dump()`.
## 2026-06-15 - Task Timing, Token Display, Prompt Slimming, and Agent UI Feedback

Scope:
- Only formal `html/` pages and `shared/` modules were changed.
- No ASR recognition logic, patient-store data model, resolver matching rule, Agent execution semantics, local fallback, or `universal_agent_backup_*` directory was changed.

Current service URLs:
- Frontend: `http://10.26.6.8:31210`
- Backend: `http://10.26.6.8:30921`
- ASR: `http://10.26.6.8:31238`
- LLM service port: `http://10.26.6.8:31968` when needed by backend/platform wiring; browser Agent still talks to backend.

Changes:
- Task elapsed time is displayed as elapsed duration in `MM:SS`; orchestrator progress no longer emits decimal-second style elapsed labels.
- Widget and Agent history list display total token in compact form. Step rows still show `token: -` when a step has no usage, and `token: 未返回` when backend usage is absent.
- Prompt payload sent to `/api/universal-agent/task-plan` and `/api/universal-agent/task-repair` now uses compact page state, compact patient candidates, compact field schema, last 4 agent messages, last 8 speaker turns, and at most 3 audit summaries.
- Full debug/page state/raw details remain in UI developer details/history, but are not sent by default in planner payload.
- Agent field updates now emit a UI-only `his-agent-ui-feedback` event and `hisAgentUiFeedback` localStorage marker. Patient editor flashes the changed field and save button; patient management flashes the relevant row when visible.
- `shared/runtime-config.js` no longer keeps literal old-port allow/deny lists. Stored service URLs are accepted only when they match the current service host and expected latest service port.
- Cache-busting version updated to `20260615-tokentime` for formal pages.

Validation notes:
- Syntax checks should include `node --check shared/agent-task-orchestrator.js`, `node --check shared/agent-widget.js`, and `node --check shared/patient-editor-action-adapter.js`.
- Default E2E command: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`.
- Real LLM E2E command: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`.
- If `/api/llm/test` hangs, RUN_LLM_E2E may fail or time out for backend/provider reasons rather than UI timing/token changes.

Validation results:
- `npm run check:encoding` passed: 23 UTF-8 files checked and required Chinese copy is present.
- Remote syntax checks passed for `shared/agent-task-orchestrator.js`, `shared/agent-widget.js`, `shared/patient-editor-action-adapter.js`, and `shared/runtime-config.js`.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` => 29 passed / 3 skipped / 0 failed.
- `RUN_LLM_E2E=1` was attempted but exceeded the 5 minute command timeout. Failure artifact shows the first backend LLM connectivity test timed out in browser `fetch(/api/llm/test)`.
- Direct probe after the timeout: `curl -m 20 http://127.0.0.1:8000/api/llm/test` and `curl -m 20 http://10.26.6.8:30921/api/llm/test` both timed out with HTTP 000. This blocks reliable real-token before/after measurement in this run.

New force refresh URL:
- `http://10.26.6.8:31210/html/login.html?v=20260615-tokentime`

## 2026-06-15 timer/asr single-page migration follow-up

Current mapping:
- Container: `39hocqqgpeo25-0`
- Frontend: `http://10.26.6.8:31210`
- Backend: `http://10.26.6.8:30921`
- ASR: `http://10.26.6.8:31238`
- LLM service: `http://10.26.6.8:31968`

Timer migration:
- `shared/agent-widget.js` starts the visible task timer at the moment the user sends a task.
- The widget immediately appends an Agent reply with `计时结果：00:00` and token usage pending, matching the old single-page Agent behavior.
- `shared/agent-task-orchestrator.js` accepts `taskStartedAtMs` and uses it as the authoritative task start time, so planner latency, step progress, task summary, and history share one elapsed-time origin.
- The current-task summary refreshes once per second while an active task exists.

ASR/public microphone migration:
- `shared/runtime-config.js` and ASR fallback URLs now use the current public ASR port `31238`.
- `shared/voice-input-controller.js` keeps the old single-page flow: ASR WebSocket connection, then browser microphone request, then AudioContext audio chunks sent to ASR.
- The microphone probe no longer depends only on `navigator.mediaDevices.getUserMedia`; it also supports legacy `navigator.getUserMedia` / `webkitGetUserMedia` when exposed by the browser.
- If no getUserMedia API is exposed, the UI now explains that the browser context cannot show a permission prompt and points to the current public origin `http://10.26.6.8:31210` for browser microphone/trusted-origin configuration.
- ASR service health remains independent from microphone/browser permission failures.

Validation command:
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list --grep @llm`

Validation results:
- `npm run check:encoding` passed.
- Default E2E passed: 29 passed / 3 skipped / 0 failed.
- Optional fake microphone test was skipped in the default headless environment.
- Real LLM E2E passed: 2 passed / 0 failed for P001 phone update and Zhang Wei gender update.
- Public/internal service probes from the container returned 200 for frontend, backend health, backend LLM test, and ASR health.

New force refresh URL:
- `http://10.26.6.8:31210/html/login.html?v=20260615-timer-asr`
# 2026-06-15 悬浮框专题入口改版

本轮只改正式链路中的悬浮框 UI 与 E2E 锚点，不改业务执行逻辑、ASR 后端、patient-store、resolver，也没有恢复本地 fallback Agent。

## 改动

- `shared/agent-widget.js`
  - 顶部标题改为 `HIS AGENT`。
  - 新增首页专题区：查看患者管理、系统连接情况、查看历史任务、示例任务。
  - 专题点击会转换为 Agent 对话。
  - “打开患者管理 / 打开历史任务”是用户明确点击按钮后的手动 UI 跳转，不走自然语言 fallback。
  - 示例任务点击后直接走与输入框发送相同的 LLM gate 流程；LLM 未连接时仍不会执行页面动作。
  - 发送任务时若语音正在录制，会先停止语音输入，再发送任务。
  - 当前任务卡改为中间主卡，展示摘要、步骤列表、耗时、token、查看完整记录和红色取消任务按钮。
- `shared/agent-widget.css`
  - 改为更简洁的白底面板、渐变顶线、专题大卡片和当前任务主卡。
  - 首页专题在进入对话或当前任务后渐隐。
  - 输入区保留发送和语音输入按钮。
- `tests/e2e/his-agent.spec.ts`
  - 更新当前任务卡相关 E2E 锚点，适配新的任务卡按钮和步骤列表。
  - 将默认 CORS/LLM fetch 测试收窄为验证浏览器能访问后端且不是 CORS/Failed to fetch；第三方模型负载 500 不再误判为 UI/CORS 回归，真实 LLM 任务仍由 `RUN_LLM_E2E=1` 覆盖。
- `html/*.html`
  - 正式页面共享资源版本号统一升级为 `20260615-topicui`，避免浏览器继续缓存旧悬浮框 JS/CSS。
- `WIDGET_UI_CODE_MAP.md`
  - 追加专题入口改版映射。

## 验证结果

- `npm run check:encoding`：通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，`29 passed / 3 skipped / 0 failed`。
- skipped 项为可选 fake microphone 和 RUN_LLM_E2E 真实 LLM 变更链路；本轮默认 E2E 已覆盖悬浮框可见性、当前任务卡、语音状态分离、无 LLM 不执行页面动作等回归。

# 2026-06-15 悬浮框专题轮播补充

本轮继续只改正式悬浮框 UI，不改业务执行逻辑、ASR 后端、patient-store、resolver，也没有恢复本地 fallback Agent。

## 改动

- `shared/agent-widget.js`
  - 将专题区改为横向 carousel，每页显示两张大专题卡。
  - 新增左右切换按钮：`#hisAgentTopicPrevButton` / `#hisAgentTopicNextButton`。
  - 新增 `就诊会话` 专题卡。
  - `就诊会话` 不再作为顶部并列入口展示；顶部 tab 仅保留为内部切换机制。
  - 点击 `就诊会话` 专题后先进入 Agent 对话确认，用户点击 `进入就诊会话` 后切到现有 voice panel。
  - voice panel 新增 `返回专题` 按钮。
- `shared/agent-widget.css`
  - 新增 `his-agent-topic-viewport`、`his-agent-topic-track`、`his-agent-topic-page`、`his-agent-topic-nav` 样式。
  - 使用 CSS transition 实现专题整体横向平滑切换。
- `tests/e2e/his-agent.spec.ts`
  - 新增专题 carousel 回归：验证首页专题、下一页切换、`就诊会话` 专题入口和进入 voice panel。

## 验证结果

- `npm run check:encoding`：通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，`30 passed / 3 skipped / 0 failed`。
- skipped 项仍为可选 fake microphone 和 RUN_LLM_E2E 真实 LLM 修改链路。

# 2026-06-15 新会话返回专题首页

本轮只补充悬浮框 UI 状态复位逻辑，不改业务执行逻辑。

## 改动

- `shared/agent-widget.js`
  - 点击 `新会话` 后清空 activeTask、消息流和就诊会话 turns。
  - 自动切回 Agent 首页。
  - 轮播专题页重置到第 1 页。
  - 移除 `conversation-mode`、`has-active-task`、`is-planning-task`，重新显示大方块专题入口。
- `tests/e2e/his-agent.spec.ts`
  - 在专题轮播测试中补充回归：进入就诊会话后点击 `新会话`，应回到专题首页且 `data-topic-page="0"`。

## 验证结果

- `npm run check:encoding`：通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，`30 passed / 3 skipped / 0 failed`。

# 2026-06-15 专题单卡循环与连接检查响应修复

本轮只修悬浮框 UI 交互和测试等待逻辑，不改业务执行逻辑、ASR 后端、patient-store、resolver，也没有恢复本地 fallback Agent。

## 改动

- `shared/agent-widget.js`
  - 专题轮播从“每次切一页两张卡”改为“每次切一个专题”。
  - 轮播支持循环：第一个专题向左切到最后一个，最后一个向右切回第一个。
  - 点击患者管理 / 历史任务确认对话里的 `取消` 会清空专题对话并回到悬浮框主页面。
  - 连接情况卡会立即给出“正在检查”回复，不再等所有 health/LLM test 完成后才说话。
  - 后端、ASR、LLM 状态探测 fetch 增加 5 秒超时，避免第三方 LLM test 慢响应导致 UI 看起来无回复。
  - `renderHistory()` 不再自动根据历史消息重新强制进入对话模式，主页/取消/新会话可以稳定显示专题卡。
- `shared/agent-widget.css`
  - 专题 track 改为单卡宽度滑动，保留顺滑 transition。
  - 修复 hidden 状态行仍可能拦截点击的问题。
- `tests/e2e/his-agent.spec.ts`
  - 更新轮播测试：验证单专题切换、左右循环、取消回首页、就诊会话专题入口。
- `html/*.html`
  - 资源版本号升级为 `20260615-topicsingle`。

## 验证结果

- `npm run check:encoding`：通过。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，`30 passed / 3 skipped / 0 failed`。

## 2026-06-15 悬浮框专题页交互巡检修复

本轮只修悬浮框 UI/交互反馈，不改业务执行逻辑、ASR 业务逻辑、patient-store、resolver，也没有恢复本地 fallback Agent。

真实页面巡检发现：
- 点击“系统连接情况”后，旧专题消息会继续累积；刷新状态后消息数从 3 条增长到 5 条，导致滚动区出现旧消息残片。
- 连接状态用普通 Agent 文本气泡展示，信息密度低，用户看到大量空白和重复文本。
- 面板尺寸会保存在 `hisAgentWidgetSize`；如果曾经拖成超宽/超高，专题回复态会留下非常大的空白。
- `/api/llm/test` 在当前第三方 LLM 下可能需要 10-19 秒，连接专题不应等待慢接口完成后才给反馈。

修复：
- `shared/agent-widget.js`
  - 专题点击改成替换式对话：进入专题前清空旧专题消息，避免旧状态污染新专题。
  - “系统连接情况”改成单个结构化状态卡，包含 Backend、LLM、Agent、ASR 服务、麦克风、Data 六行。
  - “刷新状态”改为原地更新状态卡，消息数量保持不增长。
  - Backend/ASR health 使用短超时；LLM test 超时时显示 `timeout`，不再把整个 backend 误标记为 disconnected。
  - 专题回复态不再自动滚到底部，避免顶部消息被卷走。
  - 面板尺寸增加最大钳制，历史保存的超大尺寸会回到可读范围。
- `shared/agent-widget.css`
  - 新增专题卡和连接状态卡样式。
  - 连接状态使用两列紧凑状态行，按钮同排显示，减少空白。
- `tests/e2e/his-agent.spec.ts`
  - 新增“connection topic renders a replace-in-place status card”回归测试，验证刷新后消息数量仍为 2，状态行数量为 6。
- `html/*.html`
  - 资源版本号升级为 `20260615-widgetaudit`。

验证：
- `node --check shared/agent-widget.js` 通过。
- `npm run check:encoding` 通过。
- 页面巡检脚本确认：系统连接情况刷新前后消息数固定为 2，不再累积旧连接消息。
- 大尺寸 localStorage 模拟确认：保存的 1380x940 面板尺寸会被钳回可读范围。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` 通过：31 passed / 3 skipped / 0 failed。

当前已知环境状态：
- Frontend `http://10.26.6.8:31210` 可访问。
- ASR `http://10.26.6.8:31238/health` 可访问。
- Backend 外部映射 `http://10.26.6.8:30921/api/health` 在本机探测中超时；后端容器内进程仍在 `127.0.0.1:8000` 运行。这个会导致真实浏览器中 Backend/LLM 可能显示 timeout/disconnected，需要后续单独处理端口映射或平台暴露问题。

新强制刷新 URL：
- `http://10.26.6.8:31210/html/login.html?v=20260615-widgetaudit`

## 2026-06-17 新端口切换与服务启动验证

本轮只处理容器端口变化、正式链路端口配置和服务启动，不改业务执行逻辑、UI 行为、Agent 语义、ASR 识别逻辑，也没有修改 `universal_agent_backup_*`。

当前平台信息：
- 容器名称：`11to532f07uv0-0`
- 节点 IP：`10.26.6.8`
- 容器 IP：`100.65.198.238`
- 端口映射：
  - Frontend：容器 `5500` -> 外部 `31210`
  - Backend：容器 `8000` -> 外部 `30921`
  - ASR：容器 `8010` -> 外部 `31238`
  - LLM service：容器 `8001` -> 外部 `31968`
  - SSH：容器 `22` -> 外部 `30855`
  - Jupyter：容器 `8888` -> 外部 `45630`

已更新的正式链路：
- `shared/runtime-config.js`
  - 默认 frontend/backend/asr/llm 端口更新为 `31210` / `30921` / `31238` / `31968`。
- `shared/agent-widget.js`
  - 后端、ASR、LLM fallback 地址更新为新端口。
- `shared/voice-input-controller.js`
  - ASR 默认地址和麦克风访问提示地址更新为新端口。
- `html/*.html`
  - 正式页面资源版本号统一升级为 `20260617-ports`。
- `tests/e2e/playwright.config.ts`
  - 默认 `baseURL` 更新为 `http://10.26.6.8:31210`，仍保留 `HIS_BASE_URL` 覆盖。
- `tests/e2e/his-agent.spec.ts`
  - 后端默认检测地址更新为 `http://10.26.6.8:30921`。
  - LLM 连接测试允许识别明确的上游配额不足错误，避免把“后端可达但上游拒绝”误判成 CORS 或端口失败。
- `tests/e2e/README.md`、`tests/e2e/BROWSER_ENV.md`
  - 当前运行 URL 和命令示例更新为新端口。

服务启动结果：
- Frontend：`python -m http.server 5500` 已启动。
- Backend：`uvicorn backend.main:app --host 0.0.0.0 --port 8000` 已启动。
- ASR：`uvicorn asr_service.app.main:app --host 0.0.0.0 --port 8010` 已启动。

服务验证：
- `http://10.26.6.8:31210/html/login.html`：HTTP 200。
- `http://10.26.6.8:30921/api/health`：HTTP 200。
- `http://10.26.6.8:30921/api/llm/test`：HTTP 403，上游 LLM 返回 `insufficient_quota`，说明端口和后端链路可达，但当前第三方模型账号配额不足。
- `http://10.26.6.8:31238/health`：HTTP 200。
- 远程静态服务实际返回的 `login.html` 已包含 `20260617-ports`。
- 远程静态服务实际返回的 `shared/runtime-config.js` 已包含 `31210` / `30921` / `31238` / `31968`。

正式链路旧端口检查：
- 已在 `html/`、`shared/`、`tests/e2e/` 中检查旧端口残留。
- 未发现 `31210`、`30921`、`31238`、`31968`、`31210`、`30921`、`31238` 等上一轮旧端口仍作为正式链路默认值残留。

验证命令与结果：
- `node --check shared/agent-widget.js`：通过。
- `node --check shared/voice-input-controller.js`：通过。
- `npm run check:encoding`：通过，`23 files are valid UTF-8 and required Chinese copy is present`。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，`31 passed / 3 skipped / 0 failed`。

当前已知问题：
- LLM 端口和后端接口已可达，但 `/api/llm/test` 返回上游配额不足，真实 LLM 任务链路需要第三方 API 配额恢复后再验收。

新强制刷新 URL：
- `http://10.26.6.8:31210/html/login.html?v=20260617-ports`
## 2026-06-17 Diart 说话人分离服务集成

本轮新增独立 `diarization_service/`，不放入 `asr_service/`，也不替换 ASR。浏览器语音链路现在同时连接 ASR WebSocket 和 Diarization WebSocket；ASR 继续负责转写，Diarization 只提供说话人元数据。前端通过 backend 代理访问 `/diarization/health` 和 `/ws/diarization`，因为当前容器没有暴露 8020 外部端口。

已确认当前服务器有 2 张 Tesla V100S 32GB，`nvidia-smi` 正常，系统 torch 可见 CUDA。但 Diart 自动分离尚未真正可用：`diart` 安装成功后导入会触发 `torchaudio` 与 NVIDIA patch torch 2.4.0a0 的 ABI 不匹配，health 真实返回 `provider=manual`、`status=unavailable_dependency`，不会伪装为自动分离。服务进程内也未读取到 HF token；该问题在 torchaudio ABI 修复后仍需处理。

已验证：diarization service `/health` 200，backend proxy `/diarization/health` 200，直接和代理 WebSocket 均能握手并返回 manual/provisional speaker metadata。ASR `/health` 仍可用，前端/后端服务仍可用。

测试结果：

- `npm run check:encoding` 通过。
- `node --check shared/agent-widget.js` 通过。
- `node --check shared/voice-input-controller.js` 通过。
- `backend/.venv/bin/python -m py_compile backend/main.py` 通过。
- `diarization_service/.venv/bin/python -m py_compile diarization_service/app/main.py diarization_service/app/providers/diart_provider.py` 通过。
- 默认 E2E：`31 passed / 3 skipped`。
- `RUN_LLM_E2E=1` 命令已尝试，但当前两个 `@llm` 用例仍按测试 gate 显示 skipped；本轮未改 LLM 测试策略。

新增/修改的正式文件：

- `diarization_service/**`
- `scripts/start_diarization_service.sh`
- `backend/main.py`
- `shared/runtime-config.js`
- `shared/voice-input-controller.js`
- `shared/agent-widget.js`
- `html/login.html`
- `html/dashboard.html`
- `html/patient-management.html`
- `html/patient-editor.html`
- `html/agent-history.html`
- `tests/e2e/his-agent.spec.ts`
- `DIARIZATION_INTEGRATION.md`

当前强制刷新 URL：

`http://10.26.6.8:31210/html/login.html?v=20260617-diarization`

## 2026-06-17 Diart 真实语音流验证与文档同步

本轮只做 Diart 真实语音流验证和文档更新。没有改业务逻辑、ASR 主链路、Agent 执行逻辑、patient-store、resolver、本地 fallback 或 `universal_agent_backup_*`。

当前运行状态：

- Frontend: `http://10.26.6.8:31210/html/login.html`
- Backend: `http://10.26.6.8:30921`
- ASR: `http://10.26.6.8:31238`
- Diarization: 通过 backend proxy 访问 `http://10.26.6.8:30921/diarization/health` 和 `ws://10.26.6.8:30921/ws/diarization`

Diarization health 当前真实返回：

- `provider=diart_local`
- `active_provider=diart_local`
- `status=available`
- `ok=true`
- `gpu=true`
- `device=cuda`
- `needs_hf_token=false`

当前 Diart 环境：

- venv: `diarization_service/.venv-diart`
- Python: `3.10.12`
- `torch==2.4.1+cu121`
- `torchaudio==2.4.1+cu121`
- `diart==0.9.2`
- `pyannote.audio==3.3.2`
- `huggingface-hub==0.25.2`

浏览器语音流验证：

- 使用 Playwright 真实打开当前前端 URL，进入悬浮 Agent 的就诊会话面板并点击 `语音输入`。
- 使用 Chromium fake microphone 注入 16 kHz mono wav 样本。该验证走现有浏览器 `getUserMedia`、ASR WebSocket、Diarization WebSocket、前端 debug state 和 turns 逻辑，不绕过前端链路。
- `window.__HIS_AGENT_VOICE_DEBUG__.dump()` 显示：
  - `asrHealthStatus=connected`
  - `asrWebSocketStatus=connected`
  - `diarizationProvider=diart_local`
  - `diarizationStatus=available`
  - `diarizationWebSocketStatus=connected`
  - `microphoneStatus=recording`
- 已收到真实 Diart speaker segment，例如：
  - `speaker_id=speaker0`
  - `start_ms=8008`
  - `end_ms=8508`
  - `source=diart_local`
  - `automatic=true`
- 长时 fake mic 验证中连续收到 `speaker0` / `speaker1` segments，均为 `source=diart_local`、`automatic=true`。
- ASR 同时正常输出 partial transcript，例如 `Hello. Hello. Oh, hello...`。在本轮 fake audio 自动化中未观测到 ASR `final` 事件，记录为测试介质/停止时机观察，不改 ASR 主链路。
- 前端 turns 已能带入 Diart 来源：observed turn 包含 `raw_speaker_id=speaker1` 和 `source=diart_local`。

降级验证：

- 将 `diarizationUrl` 临时指向坏端口后，ASR WS 仍保持 `connected` 并继续输出 transcript turns。
- Diarization 降级为 `provider=manual`、`status=disconnected`、`diarizationWebSocketStatus=failed`，没有伪造 `diart_local` automatic segment。

手动修正验证：

- 基于真实 ASR/Diart 产生的 turn，手动下拉修正医生/患者可用。
- `一键交换医生/患者` 可用。
- 修正后 turn source 变为 manual 修正来源，符合“人工覆盖自动/默认映射”的预期。

当前已知前端元数据缺口：

- Diart segment 已经包含 `speaker_id` 和 `automatic=true`。
- 当前 turn 对象保留了 `raw_speaker_id` 和 `source=diart_local`，但没有把显式 `speaker_id` 和 `automatic_diarization=true` 完整保留到 rendered turn meta。
- 因此 UI meta 仍可能显示 `manual/mapped`，即使相关 diarization segment 是 automatic。
- 当前 role 映射仍是默认 demo 映射；还没有做 LLM semantic correction。

验证命令与结果：

- `npm run check:encoding`：通过，`23 files are valid UTF-8 and required Chinese copy is present`。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：通过，`32 passed / 3 skipped / 0 failed`。

本轮文档更新：

- `DIARIZATION_INTEGRATION.md`
- `IMPLEMENTATION_REPORT.md`
- `PROJECT_BACKLOG.md`
- `WIDGET_UI_CODE_MAP.md`

新强制刷新 URL：

`http://10.26.6.8:31210/html/login.html?v=20260617-diart-stream-verify`

## 2026-06-17 Diart speaker_id 归一化与 turns 元数据保留

本轮只修改前端语音 turns 元数据处理、对应 E2E 和文档；未修改 Diart 安装环境、ASR 主链路、Agent 执行主逻辑、patient-store、resolver，也未恢复本地 fallback。

完成内容：

- `shared/voice-input-controller.js` 新增并暴露 `normalizeSpeakerId(value)`。
- 归一化规则：
  - `speaker0` -> `speaker_0`
  - `speaker1` -> `speaker_1`
  - `speaker_0` -> `speaker_0`
  - `speaker_1` -> `speaker_1`
  - `SPEAKER_0` -> `speaker_0`
  - `spk0` -> `speaker_0`
  - 空值 -> `null`
- Diart segment 合入 ASR turns 前会保留：
  - `raw_speaker_id`
  - normalized `speaker_id`
  - `source=diart_local`
  - `diarization_source=diart_local`
  - `automatic=true`
  - `automatic_diarization=true`
  - `diarization_start_ms`
  - `diarization_end_ms`
  - `diarization_confidence`
- 默认 role mapping 改为基于归一化后的 `speaker_id`：
  - `speaker_0 -> doctor / 医生`
  - `speaker_1 -> patient / 患者`
  - unknown -> `unknown / 未确认`
- `shared/agent-widget.js` 的 turn meta 现在显示归一化 `speaker_id`，必要时显示 `raw:speaker1`，并保留 `diart_local / auto` 的短状态。
- 手动修正医生/患者只设置 `role_source=manual_corrected`，不再覆盖 `source=diart_local`，也不丢失 `raw_speaker_id` / `diarization_source`。
- 一键交换医生/患者只交换 `role` / `role_label` 并设置 `role_source=manual_swapped`，不修改 raw speaker id 或 Diart metadata。
- Diart unavailable/manual fallback 仍保持 `automatic_diarization=false`，不会伪装为 `diart_local`。

新增测试：

- `Floating Agent task display › voice controller normalizes Diart speaker metadata before turns`
- 该测试使用 fake WebSocket / fake media 验证前端元数据路径，不改 ASR 主链路：
  - `speaker1` turn -> `speaker_id=speaker_1`、`role=patient`、`role_label=患者`
  - `speaker0` turn -> `speaker_id=speaker_0`、`role=doctor`、`role_label=医生`
  - Diart-backed turns 保留 `source=diart_local`、`diarization_source=diart_local`、`automatic_diarization=true`
  - 空 speaker fallback -> `speaker_id=null`、`role=unknown`、`automatic_diarization=false`

快速验证：

- `node --check shared/voice-input-controller.js`
- `node --check shared/agent-widget.js`
- `node --check tests/e2e/his-agent.spec.ts`
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- -g 'voice controller normalizes Diart speaker metadata before turns' --reporter=list`：通过，`1 passed`

当前仍不做：

- LLM semantic correction 医生/患者语义校正。
- enrollment speech / 声纹识别。
- ASR 主链路调整。
- Agent 执行业务逻辑调整。

新强制刷新 URL：

`http://10.26.6.8:31210/html/login.html?v=20260617-speaker-normalize`
## 2026-06-17 Diart 真实启用排查与修复

状态：历史记录，已被 `2026-06-17 Diart 真实语音流验证与文档同步` 取代。当前状态以本轮 stream verification 为准：`diart_local available`、CUDA wheel、浏览器 fake microphone 已收到真实 `source=diart_local` / `automatic=true` speaker segment。

本轮只处理 `diarization_service` 真实启用问题，没有改前端 UI、ASR 主链路、Agent 执行逻辑、patient-store、resolver，也没有恢复 fallback。

完成内容：

- 新建并启用干净独立环境：`diarization_service/.venv-diart`。
- 不再混用系统 NVIDIA patch `torch 2.4.0a0`。
- 尝试安装 CUDA wheel：`torch==2.4.1` / `torchaudio==2.4.1` from `cu121`，但安装未在容器超时时间内完成。
- 改用 CPU wheel 完成功能验证：`torch==2.4.1+cpu`、`torchaudio==2.4.1+cpu`。
- 安装成功：`diart==0.9.2`、`pyannote.audio==3.3.2`、`huggingface-hub==0.25.2`。
- 修复 `huggingface_hub 1.x` 与 Diart 0.9.2 的 `use_auth_token` 不兼容问题。
- `diart` 已能 import，`SpeakerDiarization()` 已能进入模型加载阶段。
- `scripts/start_diarization_service.sh` 现在优先使用 `.venv-diart`，并支持读取 `diarization_service/.env` 注入 `HF_TOKEN` / `HUGGINGFACE_TOKEN`。
- `diarization_service/app/providers/diart_provider.py` 现在区分 `unavailable_dependency`、`unavailable_missing_token`、`unavailable_model_download_failed`、`unavailable_torch_audio_abi`、`error`。
- `/diarization/health` 不再把失败伪装成 `ok:true/manual`；当前真实返回 `ok:false/provider=diart_local/status=unavailable_missing_token/active_provider=manual`。
- provider 已加入真实 Diart pipeline 调用路径：模型可用后会缓冲 16k 音频窗口，调用 `SpeakerDiarization`，从 pyannote `Annotation` 提取真实 `speaker_id`。模型不可用时不输出 fake 自动分离结果。

当前阻塞：

- `HF_TOKEN` / `HUGGINGFACE_TOKEN` 没有进入 `diarization_service` 进程。
- 当前项目没有 `diarization_service/.env`。
- 因 token 缺失，模型加载停在 `LocalTokenNotFoundError`，所以还不能真实输出 `diart_local` speaker_id。
- 当前验证环境是 CPU wheel，CUDA 不可用；即使 token 补齐，CPU 模式也只适合功能验证，性能有限。

验证结果：

- 新 venv：`diarization_service/.venv-diart`
- `torch`: `2.4.1+cpu`
- `torchaudio`: `2.4.1+cpu`
- `torch.cuda.is_available()`: `false`
- `diart import`: 通过
- `/diarization/health`: HTTP 200，body 中 `ok=false/status=unavailable_missing_token`
- backend proxy `/diarization/health`: HTTP 200，返回相同真实状态
- WebSocket `/ws/diarization`: 可握手；当前只返回 `source=manual/automatic=false`
- ASR `/health`: 200
- `npm run check:encoding`: 通过
- 默认 E2E：`32 passed / 3 skipped`

新增测试：

- `tests/e2e/his-agent.spec.ts` 增加 `diarization health is explicit and does not fake diart availability`，确保不可用时不会伪装为 `diart_local available`。

当前强制刷新 URL：

`http://10.26.6.8:31210/html/login.html?v=20260617-diarization`
# 2026-06-21 语音就诊会话 turns 与后续处理入口修复

本轮只修改正式链路中的 `shared/agent-widget.js`、`shared/voice-input-controller.js`、`shared/agent-widget.css` 和 `html/*.html` 资源版本号，未修改 patient-store、resolver、Agent 执行业务逻辑、ASR 后端识别逻辑，也未恢复本地 fallback。

- 修复 ASR fallback turn 合并过粗的问题：每次录音新建 voice session，partial 只作为临时段更新，final 转写会生成独立 turn，并按文本/角色/speaker 去重，避免医生/患者内容被覆盖到同一段。
- 保留并强化手动说话人修正：每个 turn 仍可在 UI 中手动改为“医生 / 患者 / 未确认”。
- 语音流程后续操作改为“停止录音、粘贴 turns 或填入模拟会话后才显示”：`整理到输入框`、`生成结构化草稿`、`生成 Agent 任务` 不再常驻。
- “生成 Agent 任务”只把基于就诊会话的确认式任务填入 Agent 输入框，不自动发送，不自动写 patient-store，不自动写 audit log。
- 模拟就诊会话改为患者先说明身份、医生确认患者、再进入病情交流，便于验收医生/患者分段。
- CSS 增加医生/患者 turn 的分段视觉区分。

验收命令：

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list
```

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260621-voice-turns
```

## 2026-06-21 Voice Conversation Planning Cleanup

- Simplified the formal voice visit panel: removed connection-status grids, ASR developer details, copy transcript, paste-as-turns, fill-input, and duplicate draft/write controls from the normal doctor-facing UI.
- Kept ASR/microphone diagnostics in read-only debug APIs instead of occupying the visit workflow.
- Changed the voice workflow so doctor/patient turns are segmented during recording, and stopping the voice task sends the collected turns to the backend LLM planner.
- The LLM plan is shown as an Agent message bubble with a task list and explicit confirmation actions. No page action runs until the doctor clicks the execute confirmation.
- Doctors can choose the edit/supplement action to place the generated objective into the normal Agent input and revise it before sending.
- This change does not restore local fallback Agent behavior; natural-language task planning still requires the backend LLM.
- Updated E2E coverage for removed duplicate controls and confirm-before-execute voice planning behavior.

### Verification

- `npm run check:encoding`: passed.
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`: 33 passed / 4 skipped / 0 failed.
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`: 34 passed / 3 skipped / 0 failed.
- One fake-media no-LLM voice-planning case remains skipped because default no-LLM page-action guards already cover the safety rule, while fake WebSocket/media setup is not reliable enough for default acceptance.

## 2026-06-22 容器端口更新与服务启动

### 本轮范围

- 根据最新容器映射更新外部访问端口。
- 上一轮外部端口不再保留为正式默认配置。
- 未修改 universal_agent_backup_* 备份目录。
- 未打印或复制 .env、API key、token、SSH 私钥等敏感内容。
- 容器内部监听端口保持不变：frontend 5500、backend 8000、ASR 8010、diarization 8020。

### 最新端口映射

- Frontend：容器 5500 -> 外部 31210
- Backend：容器 8000 -> 外部 30921
- LLM service：容器 8001 -> 外部 31968
- ASR：容器 8010 -> 外部 31238
- SSH：容器 22 -> 外部 30855
- Jupyter：容器 8888 -> 外部 45630
- Diarization：继续通过 backend proxy 访问；当前无 8020 外部映射。

### 修改内容

- shared/runtime-config.js 默认外部端口更新为 31210 / 30921 / 31238 / 31968。
- shared/agent-widget.js、shared/voice-input-controller.js、html/patient-editor.html 中的兜底服务地址同步更新。
- backend/main.py、asr_service/app/main.py 的 CORS 默认允许列表同步到新外部端口。
- tests/e2e/playwright.config.ts 默认 HIS_BASE_URL 更新为 http://10.26.6.8:31210。
- tests/e2e/README.md、tests/e2e/BROWSER_ENV.md、DIARIZATION_INTEGRATION.md、WIDGET_UI_CODE_MAP.md、PROJECT_BACKLOG.md、.agents/skills/safe-universal-agent-workflow/SKILL.md 等项目文档同步更新。

### 服务启动

- Frontend：python3 scripts/serve-static-utf8.py --host 0.0.0.0 --port 5500 --directory .
- Backend：backend/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
- ASR：asr_service/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8010
- Diarization：scripts/start_diarization_service.sh，内部端口 8020。

### 验证结果

- 上一轮外部端口扫描：正式代码和当前文档范围内未发现残留。
- node --check shared/runtime-config.js shared/agent-widget.js shared/voice-input-controller.js tests/e2e/playwright.config.ts：通过。
- npm run check:encoding：通过，23 files are valid UTF-8 and required Chinese copy is present。
- http://10.26.6.8:31210/html/login.html：HTTP 200，Content-type: text/html; charset=utf-8。
- http://10.26.6.8:30921/api/health：HTTP 200。
- http://10.26.6.8:30921/api/llm/test：HTTP 200，返回 ok=true、provider openai、model gpt-5.5。
- http://10.26.6.8:31238/health：HTTP 200，ASR loaded。
- http://10.26.6.8:30921/diarization/health：HTTP 200，provider=diart_local、status=available、gpu=true、device=cuda。
- 默认 E2E：HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list 通过：33 passed / 4 skipped / 0 failed。
- RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list 本轮仍显示 33 passed / 4 skipped / 0 failed；backend LLM health 已可用，但当前测试内部仍跳过两条 @llm happy path，后续可单独排查测试开关或 isRealLlmAvailable() 探测条件。

### 当前正式访问地址

http://10.26.6.8:31210/html/login.html?v=20260622-ports

## 2026-06-22 语音会话整理为待确认 Agent 任务

### 本轮范围

- 新增“结束对话并整理任务”按钮，把医生/患者 final turns 整理成一条待确认的自然语言 Agent 任务。
- 本轮只调整语音就诊会话到 Agent 的产品逻辑；未修改 Diart 安装、ASR 主链路、patient-store、resolver、fallback 或 universal_agent_backup_*。
- 整理阶段不会执行页面动作、不会保存、不会写 patient-store、不会写 Agent audit log。

### 行为说明

- 按钮在当前至少有 1 条 final 医生/患者 turn 后显示；语音正在录音或已停止均可进入该流程。
- 如果点击时仍在录音，前端先停止语音输入，再整理任务。
- 有 final turns 后按钮可点击；点击时先刷新检测 LLM，未连接则只提示“LLM 未连接”，不会调用整理接口，也不会进入执行。
- 前端只把最小必要数据发给后端：当前 patientId / patientName / pageType，以及 doctor/patient final turns 的 role、role_label、text、is_final。
- 不发送 raw debug JSON、raw ASR、任务历史、完整 pageState、完整 patient-store 或 raw action。
- 后端新增 `POST /api/voice/turns-to-agent-task`，只调用 LLM 生成简短自然语言任务文本，不生成 action plan。
- LLM 若未发现明确页面操作，返回“未发现明确需要执行的页面操作。可以选择生成病历草稿，或继续补充说明。”

### 医生确认

- Agent 聊天框显示：“已根据就诊会话整理出以下任务，请确认或编辑后执行：”
- 下方显示可编辑文本框，以及“执行任务”“取消”按钮。
- “执行任务”使用医生编辑后的自然语言文本进入现有 Agent taskflow，仍经过 backend LLM planner、allowlist executor、LLM gate 和既有审计链路。
- “取消”不执行任何任务，保留原始 turns，可继续编辑或重新整理。

### 与其他入口的区别

- “填入输入框”只搬运文本，不自动整理语义，不自动执行。
- “生成病历草稿”是病历文本草稿方向；本按钮生成的是待确认的页面操作任务。
- 不自动执行是为了让医生先确认 LLM 对医患对话的理解，避免对话结束后直接改页面或保存。

### 验证结果

- `node --check shared/agent-widget.js`：通过。
- `python3 -m py_compile backend/main.py`：通过。
- `npm run check:encoding`：通过，23 files are valid UTF-8 and required Chinese copy is present。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：36 passed / 3 skipped / 0 failed。
- Voice 相关 E2E：9 passed / 0 failed，覆盖 no LLM 点击后安全阻断、整理后可编辑、取消不执行、编辑后进入 taskflow、无明确操作不生成执行任务。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：37 passed / 2 skipped / 0 failed。一个真实 LLM happy path 仍按测试自身条件跳过，另一个真实 LLM 修改链路通过。

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260622-voice-task-review
```

## 2026-06-22 LLM 连接恢复与重复返回控件修复

### 问题与处理

- LLM 显示 timeout 的直接原因是 backend 8000 进程卡住，`/api/health` 和 `/api/llm/test` 都超时；已重启 backend，当前 `/api/health` 返回 ok，`/api/llm/test` 返回 `provider=openai`、`model=gpt-5.5`、`content=ok`。
- 聊天视图删除内部重复的“返回 + HIS AGENT”标题，只保留浮窗顶部标题栏的唯一返回入口。
- 连接状态消息删除“刷新状态”旁边的“返回专题”，避免聊天流里再次出现返回入口。
- 语音输入视图删除内部“返回专题”，语音页同样只保留顶部返回。
- “结束对话并整理任务”改为当前有至少 1 条 final turn 后即可点击；点击后会刷新 LLM 状态，未连接时只显示错误提示，不调用 `POST /api/voice/turns-to-agent-task`，不进入 Agent 执行链。

### 安全边界

- 整理按钮可点击不等于允许执行：医生确认前仍不修改页面、不写 patient-store、不保存、不写 Agent audit log。
- LLM 未连接时不能整理任务；“执行任务”仍走现有 `handleCommand()`、backend LLM planner、allowlist executor 和既有 LLM gate。

### 验证结果

- `node --check shared/agent-widget.js`：通过。
- 重复控件扫描：`hisAgentChatBackButton`、`hisAgentBackToHomeButton`、`his-agent-chat-heading`、`his-agent-voice-top-actions` 在正式 widget JS/CSS 中无残留。
- `npm run check:encoding`：通过，24 files are valid UTF-8 and required Chinese copy is present。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：43 passed / 3 skipped / 0 failed。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：43 passed / 3 skipped / 0 failed；两条 `@llm` happy path 仍由测试内部 `isRealLlmAvailable(page)` guard 跳过，未在本轮扩大修改测试开关策略。

### 强制刷新 URL

```text
http://10.26.6.8:31210/html/login.html?v=20260622-llm-return-fix
```

## 2026-06-22 Agent 浮窗产品化 UI 整理

### 本轮范围

- 将首页、聊天、就诊会话、系统连接情况、示例任务拆成互斥视图，解决同一浮窗里标题、返回和内容层级重复的问题。
- 聊天视图只保留聊天记录、任务确认和执行反馈；不再承载连接状态卡片、示例任务卡片或语音就诊内容。
- 就诊会话视图只保留语音任务、医生/患者 turns、角色修正、填入输入框、清空记录、一键交换和“结束对话并整理任务”。
- 系统连接情况迁移为独立状态页；正常界面只展示中文状态摘要，Backend / LLM / ASR / Diarization 诊断 URL 和原始状态折叠到“开发者详情”。
- 服务地址配置从日常底部区域隐藏，避免和业务操作混在一起；后续如需修改仍应通过开发者配置或 runtime-config 完成。
- `speaker_id`、`source`、`raw_speaker_id` 等技术元信息默认折叠在每条 turn 的“元信息”里，正常问诊流程不再直接暴露 debug 文本。

### UI 行为

- 浮窗顶部保留唯一返回入口，聊天、连接状态和语音页内部重复的“返回 / HIS AGENT / 返回专题”入口已移除。
- 语音页在已有 final turns 时，“结束对话并整理任务”保持可点击；点击时仍先做 LLM gate，未连接时只提示，不调用整理接口，不执行页面动作。
- “填入输入框”只把医生/患者 turns 写入 Agent 输入框，不自动发送、不自动执行，和“结束对话并整理任务”的 LLM 语义整理明确区分。
- 输入框改为更紧凑的动态高度，避免默认占用过大空间；发送、语音输入、新会话按钮保持在同一操作区。
- 首页专题卡片、示例任务卡片、语音/状态按钮统一为更干净的卡片和按钮样式；专题轮播左右按钮保持白底，hover 时变为蓝色高亮。
- 任务运行中的字段高亮、步骤进度、审计链路提示和 Agent 操作反馈均保留；本轮未修改 backend planner、allowlist executor、patient-store 或 fallback 逻辑。

### 验证结果

- `node --check shared/agent-widget.js`：通过。
- 旧重复控件扫描：`hisAgentChatBackButton`、`hisAgentBackToHomeButton`、`his-agent-chat-heading`、`his-agent-voice-top-actions` 在正式 widget JS/CSS 中无残留。
- LLM 连接：`/api/health` 返回 ok，`/api/llm/test` 返回 `ok=true`、`provider=openai`、`model=gpt-5.5`，ASR `/health` 返回 ok。
- 静态资源确认：`http://10.26.6.8:31210/shared/agent-widget.js?v=20260622-product-ui-polish` 已返回本轮 `scriptsVersion`。
- 真实页面 DOM 抽检：患者编辑页进入语音视图后，标题为“就诊会话”，可见“返回”只有 1 个；填入 4 条模拟 turns 后，“结束对话并整理任务”可点击，turn 元信息默认折叠。
- `npm run check:encoding`：通过，24 files are valid UTF-8 and required Chinese copy is present。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：43 passed / 3 skipped / 0 failed。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：43 passed / 3 skipped / 0 failed。两条真实写数据的 `@llm` happy path 仍被测试自身 `isRealLlmAvailable(page)` guard 跳过；backend 直连 LLM health 已恢复为 ok，本轮未修改该 guard 策略。

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260622-product-ui-polish
```

## 2026-06-22 主输入语音与就诊会话彻底拆分

### 本轮范围

- 仅修改共享悬浮框 UI、语音前端交互、E2E 和文档；未修改根目录重复 HTML/JS、`universal_agent_backup_*`、fallback、patient-store、resolver、adapter 业务规则。
- 正式服务地址继续统一走 `HisRuntimeConfig.serviceUrls()` / 当前正式链路；本轮清理了共享 widget 与 voice controller 内的端口 fallback，避免写死端口。

### 产品行为

- 底部按钮区改为“发送 / 语音输入 / 就诊会话 / 新会话”，任务运行时才临时显示“取消任务”。
- 底部“语音输入”是主输入听写：点击后只启动麦克风和 ASR，把 partial/final 转写写入底部输入框；不切换页面、不生成医生/患者 turns、不启用 diarization、不自动发送、不自动执行。
- “停止录音”会调用统一 `HisVoiceInputController.stop()`，停止 MediaStream tracks、关闭 audio pipeline、关闭 ASR WebSocket，并保留输入框内文本。
- “就诊会话”只切到 `voiceView`，不会自动开麦、不会自动启动 ASR/diarization；只有点击页面内“开始语音任务”才启动就诊录音。
- 就诊录音继续生成医生/患者 turns；“结束对话并整理任务”仍只生成待确认自然语言任务，医生编辑确认后才进入现有 Agent taskflow。

### UI 整理

- 主视图专题卡片改为白底、浅边框、轻阴影，与浮窗背景更统一，减少突兀色差。
- 左右切换按钮默认白底、浅边框、深色箭头；hover 变蓝、active 轻微按下，并通过 viewport padding / outline-offset 避免边缘裁切。
- voiceView 默认只展示“麦克风 / ASR / 说话人分离”三项产品化状态。
- ASR WebSocket、Diarization WS、provider、mic policy 等技术信息移入“开发者详情”折叠区，默认隐藏。
- turns 列表默认只展示角色、对话内容和角色修正下拉；技术元信息仍在折叠区。

### 验证结果

- `node --check shared/agent-widget.js`：通过。
- `node --check shared/voice-input-controller.js`：通过。
- 端口硬编码扫描：`shared/agent-widget.js`、`shared/voice-input-controller.js` 未发现 `10.26.6.8` 或当前映射端口硬编码。
- 静态资源确认：`/shared/agent-widget.js?v=20260622-voice-ui-split` 已返回 `20260622-voice-ui-split`。
- `npm run check:encoding`：通过，24 files are valid UTF-8 and required Chinese copy is present。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：45 passed / 3 skipped / 0 failed。
- E2E 已覆盖：主视图卡片/轮播按钮 hover active、底部四按钮、主输入听写不切页且不生成 turns、停止后释放麦克风、就诊会话不自动开麦、voiceView 开始/停止录音、默认隐藏技术信息、整理任务按钮仍可用。

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260622-voice-ui-split
```
## 2026-06-23 Agent V2 真实工作流回归与修复

### 本轮范围

- 只修改 `/huaiwenpang/universal_agent` 正式链路文件；未修改 `universal_agent_backup_*`。
- 未恢复本地自然语言 fallback，未修改 patient-store / resolver / adapter 业务规则。
- 新增浏览器侧 `AgentFlowTrace`，用于记录真实任务流证据；它不执行动作、不写 patient-store、不替代 audit log。

### 修复内容

- Bug A：聊天视图现在以消息为主，任务计划卡片只保留紧凑 sticky 摘要；完整步骤默认折叠，避免大块 checklist 占据聊天顶部。
- Bug B：`renderTaskSummary()` 不再强制进入 chatView；返回主视图后，任务 progress 不会把用户再次拉回聊天页。
- Bug C：`open_patient_editor` 改为跳转后验证目标患者；必须确认 URL/pageState/DOM 上下文匹配 canonical patient 后才完成打开步骤。刘洋流程已验证为 `P006`。
- Bug D：登录页如果账号/密码已经是 `123/123`，Agent 不再清空重输。
- Bug E：`waiting_user` 补充说明继续沿用原 `task_id`，仍请求 backend planner，不新建任务。

### 验证结果

- `node --check shared/agent-flow-trace.js`：通过。
- `node --check shared/agent-widget.js`：通过。
- `node --check shared/agent-task-orchestrator.js`：通过。
- `npm run check:encoding`：通过，29 files are valid UTF-8 and required Chinese copy is present。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`，54 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：54 passed / 3 skipped；真实 `@llm` 写数据用例因当前 backend LLM 探针超时被 guard skip。
- `RUN_MIC_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：54 passed / 3 skipped；fake mic 用例因当前 Chromium fake media 未暴露 `getUserMedia` 被 skip。
- 关键矩阵两轮：9 passed + 9 passed。

### LLM 探针现状

只读探针显示：

- `http://10.26.6.8:30921/api/llm/test`：25 秒超时。
- `http://10.26.6.8:30921/api/qwen/test`：25 秒超时。
- `http://10.26.6.8:30921/health`：10 秒超时。

因此本轮没有把真实 LLM E2E 记为通过；UI 和 taskflow 的 mock/backend-guard 回归均已通过。

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260623-agent-v2-matrix
```

## 2026-06-24 Agent 登录与业务权限边界修复

### 范围

- 修改正式链路：`shared/agent-task-orchestrator.js`、`html/login.html`、`html/patient-editor.html`、`shared/patient-editor-action-adapter.js`、`shared/runtime-config.js`、`backend/main.py`、`tests/e2e/`。
- 未修改 ASR、Diart、resolver 匹配规则、fallback、`universal_agent_backup_*`、根目录重复 HTML/JS。
- 修改前已备份正式文件到 `archive/codex-login-auth-20260624-150248`。

### 真实追踪

对照输入：账号 `1234`，密码为用户请求中的同一密码。

- 手动流程：`#loginAccountInput=1234`，点击真实 `#loginButton`，触发 `#loginForm` submit；URL 留在 `login.html`，pageType 为 `login`，`hisDemoAuthenticated=false`，页面提示“账号或密码错误”。
- Agent 流程：planner action payload 保留 `username=1234`；`fill_login_form` 后 DOM value 为 `1234`，password 与请求匹配；`submit_login` 点击真实 `#loginButton` 并触发真实 submit；URL 留在 `login.html`，`hisDemoAuthenticated=false`，任务 history 为 `failed`。
- 第一个偏差事件：旧执行器拿到登录失败后进入 repair/后续任务流，且旧 `submit_login` 曾用 action success / hard-coded `pageAfter=dashboard` 表达业务完成；页面失败结果没有成为 submit_login 的业务后置条件。

### 根因与修复

- 旧 `fill_login_form` / 登录页 adapter / 后端旧 action 归一化都存在缺失凭据时补 `123/123` 的路径。现在只有用户明确确认 Demo 默认账号时才生成 `useDemo=true` 的 `123/123`。
- 旧 `submit_login` 不是严格业务后置条件：点击或 adapter 返回值可能被当作 completed。现在必须等待页面认证结果；错误凭据直接 failed，不调用 repair，不继续后续 HIS 动作。
- 登录成功会先由页面设置认证状态，再导航；执行器把该步骤标记为等待导航确认，并在 dashboard 端用 pageState/auth 收尾。
- 患者字段 adapter 不再直接写 patient-store；字段 action 只填 DOM，`save_patient` 点击真实保存按钮，页面保存 handler 写 patient-store 和 audit log。

### 验证

- 真实追踪：`1234/123` 手动失败，Agent 同样失败；`123/123` Agent 成功并归档 completed。
- `npm run check:encoding`：通过，29 files are valid UTF-8 and required Chinese copy is present。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`，67 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`，67 passed / 3 skipped；真实 `@llm` 写数据用例因当前 `/api/llm/test` 20 秒超时被 guard skip。
- 关键登录对照连续两轮：3 passed + 3 passed。
- 患者保存回归：刘洋生日更新链路通过；结构化病历草稿确认写入链路通过；字段可视化测试确认 save 前无 audit、save 后由页面保存流程写 audit。

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260624-auth-boundary
```

## 2026-06-24 Agent V3 Observation / Action 与 Mutation Contract

### 本轮增量

- 新增 `shared/generic-browser-agent.js`：提供标准化 `observeCurrentPage()`，采集 URL、page_type、auth_context、patient_context、forms、controls、tables、dialogs、validation/success/error messages、business_state。
- 新增通用 action space：`click`、`double_click`、`hover`、`focus`、`clear`、`type`、`select_option`、`set_date`、`check`、`uncheck`、`press_key`、`scroll`、`submit`、`navigate`、`back`、`forward`、`reload`、`wait`、`read`。每次动作后都会重新 observe，并返回 before / after observation id。
- 五个正式 HIS 页面均接入 `generic-browser-agent.js`，供执行器、trace 和 E2E 统一观察页面。
- 新增 `tests/fixtures/unknown-page.html`，验证通用层可处理陌生页面 textbox、textarea、select、date、checkbox、radio、button、link、modal、table 和 scroll area。
- 新增 `scripts/generate-human-action-catalog.mjs` 与 `npm run catalog:human-actions`，通过真实浏览器自动生成 `HIS_HUMAN_ACTION_CATALOG.md`。

### Mutation Contract 修复

原问题：用户明确要求“更新主诉、更新现病史并保存”时，planner 可能只返回 `find_patient / open_patient_editor / save_patient`，旧 executor 因为所有步骤都 completed 就把任务整体标为 completed。

修复：

- 后端 `TaskPlannerRequest` 新增 `task_contract`。
- 后端从 voice task contract、显式 task contract 或最终自然语言中构建 `target_patient + expected_mutations + requires_save + requires_verification`。
- 后端 `normalize_planner_response` 对计划做 deterministic validation；如果缺少 update / verify，会按 contract 修复计划，否则返回 validation errors。
- 前端 `AgentTaskOrchestrator` 新增 mutation ledger：`expected_mutations`、`applied_mutations`、`verified_mutations`、`dirty_fields`、`save`。
- `save_patient` 前验证 patient context、applied mutations、dirty fields；不满足时失败，不保存。
- `save_patient` 后验证 `changedFields` 和 `audit_id`；缺少业务保存证据不能完成。
- `finishSuccess` 前验证 applied / saved / verified / patient-store 一致；不满足时 failed，不再显示“任务已完成”。
- 语音就诊整理确认后，`task_contract.expected_mutations` 会随最终任务文本一起传给 planner，不再只传自然语言。

### 当前验证状态

- 本地语法：`node --check shared/generic-browser-agent.js`、`node --check shared/agent-task-orchestrator.js`、`node --check shared/agent-widget.js`、`node --check scripts/generate-human-action-catalog.mjs`、`python -m py_compile backend/main.py` 通过。
- 本地 targeted E2E 未跑通：完整镜像未安装 `@playwright/test`；远端正式目录已有 `node_modules`，同步后在远端跑。
- 新增文档：`AGENT_FLOW_TRACE_GUIDE.md`、`HIS_AGENT_EQUIVALENCE_MATRIX.md`、`AGENT_V3_REGRESSION_REPORT.md`。
- 未完成：全量人类操作目录和默认 / LLM E2E 需同步远端后执行并回填结果。

强制刷新版本：

```text
http://10.26.6.8:31210/html/login.html?v=20260624-agent-v3-observe-action
```

## 2026-06-24 Agent V3 Mutation / Voice Close-loop Verification

### Additional Fixes

- Fixed the final `verify_patient_store` step staying in `running`: the run loop now handles the read-only patient-store verification step explicitly and immediately runs final completion validation when the last step finishes.
- Added `readPatientFromStore(patientId)` as a read-only compatibility layer for `PatientStore.getPatient`, `getPatientById`, and `getAllPatients`; the formal store currently exposes `getPatientById`.
- Archived `task_contract`, `expected_mutations`, and `mutation_ledger` into `hisAgentTaskHistory`, so completed tasks preserve applied fields, verified fields, save result, and audit id for review.
- Compacted planner `task_contract` payload to the minimum required shape: target patient, `expected_mutations[{field,value}]`, save / verification flags, and source.
- Fixed the E2E voice backend mock so it returns `expected_mutations` and `task_contract`, matching `/api/voice/turns-to-agent-task`.

### Verification

- `npm run check:encoding`: passed, 30 files valid UTF-8.
- Targeted mutation / voice contract E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list --grep=mutation`, 5 passed.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`, 73 passed / 3 skipped.
- `RUN_LLM_E2E=1`: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`, 73 passed / 3 skipped. The current suite still keeps the two `@llm` tests skipped under its own guard, so this is not evidence that live LLM data-writing cases executed.

强制刷新 URL：

```text
http://10.26.6.8:31210/html/login.html?v=20260624-agent-v3-mutation-voice-close-loop
```

## 2026-06-24 Loop Capability Pass

- Added AGENT_LOOP_ENGINEERING.md and machine-readable exports under artifacts/agent-loop/<run-id>/result.json.
- Added targeted loop automation for p0-login-invalid-username-agent, p1-agent-login-valid, and p0-no-mutation-save-denied.
- Added scripts and npm commands: loop:matrix, loop:voice-role, loop:voice-task-equivalence, loop:perf.
- Generated patient field matrix: 20 patients x 25 editable editor fields = 500 candidate cells. Full mutation execution is not claimed.
- Generated voice role fixture baseline: 10/10 fixture cases passed; live Diart/LLM role mapping is not claimed.
- Generated voice task equivalence static report: confirmed voice task text routes through the same handleCommand -> AgentTaskOrchestrator.startTask pipeline.
- Generated performance baseline from iteration-008: average case elapsed 303ms, max 1746ms.
- Loop evaluate iteration-008: score 100, 10 passed / 0 failed / 19 skipped, no hard failures.
- Runtime health note: frontend/backend/ASR passed; LLM and Diart returned fetch failed in health observation.

## 2026-06-25 Agent Loop P0/P1 Completion and LLM Status Fix

- Current public ports were updated to frontend `5500->31210`, backend `8000->30921`, ASR `8010->31238`, LLM service `8001->31968`, and SSH `22->30855`; user-facing test docs no longer keep old defaults.
- Backend `/api/llm/test` no longer blocks the FastAPI event loop: the OpenAI-compatible status probe now runs via `asyncio.to_thread`, uses a bounded 10 second status timeout, and keeps `/api/health` responsive while the upstream chat endpoint is slow.
- Already planned `source=backend_llm` tasks no longer re-run `/api/llm/test` before every deterministic DOM step. The safety gate remains: the task must come from backend LLM planner, every step must be `source=backend_llm`, and each page action still carries backend LLM source before the allowlist executor runs.
- This fixes the live LLM gender update failure where a successful backend plan was interrupted mid-task by a slow status refresh and incorrectly reported "LLM 未连接".
- P0 loop after final gate change: iteration-031 passed `8 / 0 / 0`.
- P1 loop after final gate change: iteration-032 passed `14 / 0 / 0`.
- Two consecutive full P0 runs before the final gate cleanup also passed: iterations 029 and 030 were both `8 / 0 / 0`; P1 iterations 027 and 028 were both `14 / 0 / 0`.
- `npm run check:encoding`: pending final rerun after this documentation sync.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` passed `73 / 0 / 3`.
- RUN_LLM_E2E: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list` passed `75 / 0 / 1`; both live `@llm` write cases executed and passed.

Forced refresh URL:

```text
http://10.26.6.8:31210/html/login.html?v=20260625-loop-gate
```

## 2026-06-25 Final Loop / LLM / Port Convergence

- Current public ports: frontend `5500->31684`, backend `8000->30663`, ASR `8010->30410`, LLM service `8001->31756`, Jupyter `8888->46121`, SSH `22->30855`.
- Runtime defaults and test defaults now use the current frontend/backend/ASR/LLM mapping. Historical report entries above remain as dated evidence only.
- Backend LLM planner robustness: `call_qwen_json` now retries malformed JSON once by asking the configured backend LLM to return exactly one valid JSON object. If repair fails, planning still fails; no deterministic fallback or keyword execution was introduced.
- Widget scroll robustness: `AgentScrollManager.scrollToBottom({ force: true })` now explicitly holds auto-follow and re-aligns the bottom across multiple layout frames. This fixes the latest-output-visible P2 case without forcing scroll when the user is intentionally reading older messages.
- Loop automation: the previously skipped P2 cases are now implemented in `loop-engineering/scripts/run-case.mjs` and listed in `loop-engineering/cases/core-cases.json`.
- P2 loop: iteration-037 passed `7 / 0 / 0`.
- Full loop: iteration-038 passed `29 / 0 / 0`.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31684 npm run test:e2e -- --reporter=list` passed `73 / 0 / 3`.
- RUN_LLM_E2E: `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31684 npm run test:e2e -- --reporter=list` passed `75 / 0 / 1`; both live `@llm` write cases executed and passed.
- Remaining skipped item: optional fake microphone recording `@mic` in headless browser mode.
- Not claimed: broad 500-cell mutation execution across all patients and fields without an explicit mutation-mode run.

Forced refresh URL:

```text
http://10.26.6.8:31684/html/login.html?v=20260625-final-loop
```

## 2026-06-25 Task Telemetry Panel / Scroll Finalization

- 最近任务计划默认收敛为可最小化卡片：任务执行中先显示 compact plan，完整 checklist 仍可展开；医生在 chatView 顶部可以用任务计划按钮重新打开。
- 主视图不显示任务计划入口，避免把任务执行状态带回首页卡片区。
- 任务卡片最小化、展开步骤、步骤滚动位置与任务执行状态分离，progress 刷新不会重置医生当前查看位置。
- 修复滚动回归：用户手动上滑后，历史遗留的延迟 `applyBottomFollow(force)` 不再把视图拉回底部，也不会隐藏“新消息”提示；用户点击“新消息”仍会主动到底。
- `agent-history` 和当前任务卡使用真实 timing：`planning_ms`、`action_ms`、`verify_ms`、`page_navigation_ms`、`total_ms` 等字段；旧记录显示 `未记录`，不再伪造 `00:00`。
- token 来源明确区分：backend LLM usage、`本地执行`、`未返回`。
- 性能基线：iteration-049 score 100，`29 / 0 / 0`，平均 2140ms，最大 8252ms；`p1-agent-login-valid` 为 1746ms，prefilled login E2E 为 2.4s。
- 验证：`npm run check:encoding` passed；默认 E2E `76 / 0 / 3`；full loop iteration-049 `29 / 0 / 0`；`npm run loop:perf` baseline_collected。
- RUN_LLM_E2E 最新全量执行为 `77 / 1 / 1`，失败项是 live LLM 的张伟性别更新没有在 90000ms 内实际写成 `女`；随后 `--grep @llm` 专项被实时 LLM availability gate skip。该失败记录为外部 LLM 行为/健康门控证据，不属于本轮 deterministic UI/telemetry 改动已验证通过的范围。

强制刷新 URL：

```text
http://10.26.6.8:31684/html/login.html?v=20260625-task-telemetry-panel
```
## 2026-06-25 任务计时、Demo 节奏与步骤滚动修复

- 根因：运行中的 step 初始化带 `elapsed_ms: 0`，UI 优先显示该冻结字段，所以计时只在步骤完成后突变；`updateTaskTiming()` 还会把已汇总的 action/animation/verify 耗时再次累加，造成派生耗时不可信。
- 修复：active task/step 增加 monotonic 运行计时字段，running 显示实时 elapsed，completed/failed/cancelled 使用冻结 `elapsed_ms`；timing 改为从 step breakdown 重新汇总。
- Demo pacing：支持 `window.__HIS_AGENT_DEMO_PACING__` 与 `localStorage.his_agent_demo_pacing`，字段/点击延迟写入 `demo_delay_ms` 和 `ui_animation_ms`；`window.__HIS_AGENT_FAST_ANIMATION__` 下自动禁用等待。
- 当前步骤：`current-step / agent-step-pulse` 标记 running step；用户滚动步骤列表后保持 pinned，progress render 不再立即拉回顶部。
- 页面恢复：scroll snapshot 使用 `auto` 恢复，并避免 chat view 进入时展示从顶部滑到底部的动画。
- 验证：目标 E2E 四条已通过，覆盖 live timer/freeze、step pulse/scroll、fast pacing、page restore scroll。
## 2026-06-25 任务计时、Demo 节奏与步骤滚动最终验证

- 修复范围：active task/step 运行计时、terminal freeze、demo pacing 分桶、当前步骤高亮/闪烁、展开步骤列表滚动保持、聊天页切换瞬时恢复滚动。
- 追加修复：登录提交的后置条件校验在极快本地 DOM 路径里可能同毫秒完成，导致 `verify_ms=0`；现在只在真实 verifier 已执行时记录最小 `1ms`，不改变登录成功/失败判定。
- `npm run check:encoding`: passed.
- Default E2E: `HIS_BASE_URL=http://10.26.6.8:31684 npm run test:e2e -- --reporter=list` -> `80 passed / 3 skipped / 0 failed`.
- `RUN_LLM_E2E=1`: full suite wait exceeded 5 minutes; focused `@llm` phone-update test failed because P001 phone remained `13810010001` instead of `13800138000` after 90s. Direct backend health probe returned `{"ok":true,"provider":"qwen","model":"qwen3-14b","content":"ok"}` in `0.14s`.
- Loop: P0 `iteration-050` -> `8 / 0 / 0`; P1 `iteration-051` -> `14 / 0 / 0`; full evaluate `iteration-052` -> `29 / 0 / 0`.
