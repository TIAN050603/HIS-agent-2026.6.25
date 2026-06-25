# Agent V2 Regression Matrix

本矩阵用于回归悬浮 Agent 的真实工作流，重点覆盖本轮修复的 UI 视图隔离、任务状态、患者上下文、登录前置条件和 LLM gate。

## 核心契约

- 医生发送任务后，输入先经过 `AgentInputRouter`，再进入 backend LLM planner。
- 页面动作只能来自 `source=backend_llm` 的结构化步骤，并继续走 allowlist executor、adapter、audit log。
- 无 LLM 时不能执行页面动作，也不能写 patient-store。
- `waiting_user` 的补充输入必须继续同一个 `task_id`。
- 打开患者编辑页必须验证 URL / pageState / DOM 上下文与 canonical patient 一致，不能只因为发生跳转就完成步骤。
- 用户点击返回后，任务进展刷新不能强制把视图拉回 chatView。
- 当前任务卡只做紧凑摘要；完整步骤默认折叠，聊天记录仍是主要区域。

## 回归用例

| 范围 | 用例 | 期望 |
| --- | --- | --- |
| UI A | task progress updates current card without mirroring every step as chat messages | 任务卡显示 Agent 叙述，步骤默认折叠，进展不刷屏到聊天流 |
| UI B | task progress does not force the user back into chat view after returning home | 点击返回后保持 homeView，后续 progress 只刷新摘要 |
| UI C | chat workspace can be opened directly and keeps the recent task checklist | 聊天工作台可主动进入，最近任务摘要默认折叠 |
| UI D | primary footer button becomes cancel only while a task is running | running 时发送按钮变取消任务；waiting_user/完成后恢复发送 |
| UI E | renders compact current task list with collapsed optional panels | 当前任务摘要紧凑，开发者/步骤详情不默认铺满聊天区 |
| Login | pre-filled demo login is submitted without clearing and retyping credentials | 账号密码已是 123/123 时不清空重输，只提交 |
| Continuation | waiting_user clarification keeps original task id and uses backend planner | 补充说明沿用原 taskId，并重新请求 backend planner |
| Patient missing | missing patient task shows explicit not found message without mutation | 找不到患者时等待用户补充，不改 patient-store |
| Patient canonical | patient context carries from Liu Yang lookup into later update steps | 刘洋被解析为 P006，打开 P006 编辑页并验证后才更新生日 |

## 本轮验证结果

- `npm run check:encoding`：通过，29 files are valid UTF-8 and required Chinese copy is present。
- 默认 E2E：`HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`，54 passed / 3 skipped。
- `RUN_LLM_E2E=1`：54 passed / 3 skipped；两条真实 `@llm` 写数据用例仍被 `isRealLlmAvailable` guard 跳过。现场只读探针显示 `http://10.26.6.8:30921/api/llm/test`、`/api/qwen/test`、`/health` 均超时，因此未把真实 LLM 用例记为通过。
- `RUN_MIC_E2E=1`：54 passed / 3 skipped；`optional fake microphone recording @mic` 因当前 Chromium fake media 未暴露 `getUserMedia` 而 skip。
- 关键矩阵两轮：
  - 第一轮：9 passed。
  - 第二轮：9 passed。

## 强制刷新

```text
http://10.26.6.8:31210/html/login.html?v=20260623-agent-v2-matrix
```

## 2026-06-24 登录与业务隔离追加矩阵

| 范围 | 用例 | 期望 |
| --- | --- | --- |
| Login wrong manual | 手动输入 `1234/123` 后点击真实登录按钮 | 停留 login，提示账号或密码错误，`hisDemoAuthenticated=false` |
| Login wrong Agent | Agent 执行 `输入账户为1234，密码为123，然后登录` | action payload 和 DOM 保留 `1234`；点击真实按钮；任务 failed，不进 dashboard |
| Login success Agent | Agent 执行 `123/123` 登录 | 页面 handler 设置认证状态并导航 dashboard；submit step 在 dashboard 端 completed；任务 completed |
| Login wrong password | Agent 执行 `123/1234` | 与手动一致失败，不继续后续 HIS 动作 |
| Login empty | Agent 执行空账号或空密码 | 与手动一致失败，不自动补 Demo 默认值 |
| Login prefilled | 登录框已是 `123/123` | 不清空重输，只点击登录 |
| Password privacy | task history / progress / trace | 不记录密码明文，只显示 `[redacted]` 和匹配布尔值 |
| Patient DOM write | `update_patient_field` | 只改页面控件和 draft，不直接写 patient-store |
| Patient save | `save_patient` | 点击真实保存按钮，由页面保存 handler 写 patient-store 和 audit |

本轮已执行：

- `npm run check:encoding`：通过，29 files are valid UTF-8 and required Chinese copy is present。
- 默认 E2E：67 passed / 3 skipped。
- `RUN_LLM_E2E=1`：67 passed / 3 skipped；真实 `@llm` 写数据用例因当前 `/api/llm/test` 20 秒超时被 guard skip。
- 登录关键回归连续两轮：3 passed + 3 passed。
- 患者保存关键回归：2 passed；字段可视化保存语义纳入默认 E2E。

强制刷新：

```text
http://10.26.6.8:31210/html/login.html?v=20260624-auth-boundary
```

## 2026-06-24 V3 增量回归项

| 范围 | 用例 | 期望 |
| --- | --- | --- |
| Observation | `login.html` 调用 `HisAgentBrowser.observeCurrentPage()` | 返回 observation_id、page_type、auth_context、forms、controls |
| Generic Action | unknown fixture 文本输入 | `type` 后重新 observe，控件 value 匹配 |
| Generic Action | unknown fixture select/date/checkbox/radio | `select_option` / `set_date` / `check` 后值匹配 |
| Generic Action | unknown fixture submit | click 后 status/result 文本更新，action status completed |
| Mutation Contract Success | P001 张伟主诉+现病史更新并保存 | 两个 update、save、两个 verify、patient-store 匹配、audit_id 存在 |
| Mutation Contract Reject | planner 只返回 find/open/save | 执行前拒绝，不保存，不 completed |
| Voice Contract | 医患 turns -> 待确认任务 -> 执行 | task_contract.expected_mutations 进入 planner，确认后走正常 Agent taskflow |

当前状态：本地静态语法通过；完整 E2E 待远端同步后运行并回填。

## 2026-06-24 V3 close-loop regression result

| 范围 | 用例 | 结果 |
| --- | --- | --- |
| Mutation success | P001 张伟主诉 + 现病史更新、保存、字段核对、patient-store 核对 | passed |
| Mutation reject | planner 只返回 find/open/save | passed，执行前失败，不保存，不 completed |
| Voice contract | turns -> 可编辑任务 -> 执行任务 | passed，`task_contract.expected_mutations` 进入 planner |
| History ledger | completed task history | passed，保留 `mutation_ledger.applied_mutations`、`verified_mutations`、`save.audit_id` |
| Store verification | `verify_patient_store` | passed，兼容正式 `PatientStore.getPatientById` |

运行结果：

- `npm run check:encoding`：passed，30 files valid UTF-8。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list --grep=mutation`：5 passed。
- `HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：73 passed / 3 skipped。
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31210 npm run test:e2e -- --reporter=list`：73 passed / 3 skipped；`@llm` 写数据用例仍被测试 guard skip，不能当作 live LLM 写数据已验收。

强制刷新：

```text
http://10.26.6.8:31210/html/login.html?v=20260624-agent-v3-mutation-voice-close-loop
```

## 2026-06-25 Agent Loop 回归补充

| 范围 | 用例 | 结果 |
| --- | --- | --- |
| P0 loop | 登录错误等价、无 LLM 禁止动作、错误患者保护、无修改保存拒绝、任务终态不复活、数据恢复 | passed，iteration-031 为 `8 / 0 / 0` |
| P1 loop | 正确登录、字段修改保存、缺患者/缺字段澄清、等待用户时新任务冲突、取消任务、主输入语音、就诊会话确认执行 | passed，iteration-032 为 `14 / 0 / 0` |
| LLM status | `/api/llm/test` 慢响应时不阻塞 `/api/health` | passed，状态探针线程化并限制 10 秒 |
| Live LLM | 两条 `@llm` 写 demo patient-store 用例 | passed，RUN_LLM_E2E 全量 `75 / 0 / 1` |

强制刷新：

```text
http://10.26.6.8:31210/html/login.html?v=20260625-loop-gate
```

## 2026-06-25 Final Regression Matrix

| 范围 | 用例 | 结果 |
| --- | --- | --- |
| Port mapping | frontend/backend/ASR/LLM/Jupyter/SSH 使用最新映射 | passed，`31684 / 30663 / 30410 / 31756 / 46121 / 30855` |
| Backend LLM JSON | planner 首次返回非法 JSON 时由后端 LLM 修复一次 | passed，live `task-plan` 调用返回 `ok:true` |
| P2 loop | 消息可见、用户滚动、未读提示、home view 不被 progress 抢占、展开步骤滚动、history 字段 | passed，iteration-037 `7 / 0 / 0` |
| Full loop | P0 + P1 + P2 | passed，iteration-038 `29 / 0 / 0` |
| Default E2E | 全量默认套件 | passed，`73 / 0 / 3` |
| LLM E2E | `RUN_LLM_E2E=1` 全量套件 | passed，`75 / 0 / 1` |
| Optional mic | fake microphone | skipped，环境依赖项，不作为默认硬门槛 |

强制刷新：
```text
http://10.26.6.8:31684/html/login.html?v=20260625-final-loop
```
