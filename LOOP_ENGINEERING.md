# Loop Engineering

更新时间：2026-06-24

Loop Engineering 用于让 Universal Agent 后续迭代从“用户逐个发现 bug”变为“Codex 运行基线、捕获 trace、定位第一个偏差、修复最小正确层、再评估”的有界循环。

## 架构

目录位于 `loop-engineering/`：

- `cases/core-cases.json`：核心 P0/P1/P2 场景矩阵。
- `scripts/run-loop.mjs`：总控 runner，负责 baseline/evaluate/smoke/full。
- `scripts/run-case.mjs`：Explorer，运行真实浏览器或健康探测 case。
- `scripts/evaluate-case.mjs`：Evaluator，只根据确定性断言评分，不相信 Agent 自称 completed。
- `scripts/score-iteration.mjs`：统一评分。
- `scripts/snapshot-demo-state.mjs` / `restore-demo-state.mjs`：Demo localStorage 快照与恢复。
- `scripts/create-checkpoint.mjs`：Git 不可用时复制本轮涉及文件并生成 manifest。
- `schemas/*.json`：机器可读 result / case / trace schema。
- `artifacts/iteration-XXX/`：每轮 `result.json`、`report.md`、trace、checkpoint。

## 三个角色

Explorer：

- 运行真实浏览器任务或服务健康探测。
- 捕获页面状态、localStorage、任务状态、AgentFlowTrace 和后置条件。
- 不修改产品代码。

Evaluator：

- 根据 case 的 `expected_postconditions` 和 runner 断言生成 `passed / failed / skipped`。
- 输出第一个偏差：预期、实际、事件、证据、建议修复层。
- 不相信 HTTP 200、click 未抛错或 `task.status=completed`。

Implementer：

- 只修复 Evaluator 指出的最高优先级 first_failure。
- 每轮只修改最小正确层。
- 修改后重新运行 `loop:evaluate` 和必要分类/全量 E2E。

## Trace 字段

每个 trace event 至少归一化为：

```json
{
  "event_id": "",
  "iteration": 1,
  "case_id": "",
  "task_id": "",
  "run_id": "",
  "at": "",
  "event": "",
  "conversation_state": "",
  "input_route": "",
  "page_type": "",
  "url": "",
  "action": "",
  "step_id": "",
  "expected": {},
  "actual": {},
  "task_slots": {},
  "canonical_patient": {},
  "page_patient": {},
  "action_payload": {},
  "action_result": {},
  "postcondition": {},
  "error": null
}
```

密码、API key、HF token、secret 会被脱敏；登录 case 只记录 `password_matched_requested`。

## 评分

基础分为 100。

Hard failure：

- 错误患者被修改：-100
- 错误凭据被登录成功：-100
- 无 mutation 却保存或 completed：-100
- 无 LLM 执行页面动作：-100
- terminal task 被复活：-100
- 测试后 Demo 数据未恢复：-100

普通扣分：

- P0 case failed：-50
- P1 case failed：-20
- P2 case failed：-10
- 默认 E2E failed：-30
- LLM E2E failed：-30
- UI/历史/消息可见性小问题：-5

`skipped` 不扣分，但报告必须如实列出，不能把 skipped 当作通过。

## 数据快照与恢复

Runner 在浏览器上下文中快照以下 localStorage key：

- `his_demo_patients_v2`
- `his_demo_patients_v1`
- `his_demo_patient_audit_v2`
- `his_demo_patient_audit_v1`
- `hisAgentActiveTask`
- `hisAgentTaskHistory`
- `hisAgentInputDraftV2`
- `hisAgentConversationStateV2`
- `hisAgentScrollRestoreV2`
- `hisAgentTaskStepsUiV2`
- `hisAgentFlowTrace`
- `hisDemoAuthenticated`
- `hisDemoAuthenticatedAt`

每个浏览器 case 都在 `finally` 中恢复并验证。恢复失败会标记 `data_restore_failed` hard failure。

## Checkpoint 与回滚

每次 `run-loop` 都会在 artifact 下创建文件级 checkpoint：

```text
loop-engineering/artifacts/iteration-XXX/checkpoints/before-loop/
```

如果 Git 因 `dubious ownership` 不可用，不修改全局 `safe.directory`，只使用文件级副本和 manifest。后续 Implementer 修改前可先运行：

```bash
node loop-engineering/scripts/create-checkpoint.mjs
```

如果 score 下降或新增 P0 hard failure，应按 manifest 回滚本轮涉及文件并停止。

## 有界循环

最大迭代次数：6。

停止条件：

- 同一 first_failure 连续两轮无改善。
- 连续两轮 score 无提升。
- 新增 P0 hard failure。
- 无法安全恢复 Demo 数据。
- 无法安全回滚。

成功退出条件：

- 所有 P0 通过。
- 默认 E2E 通过。
- `RUN_LLM_E2E=1` 通过。
- 所有 mutation 数据已恢复。
- 错误患者操作次数为 0。
- 错误 completed 次数为 0。
- 无 mutation 保存次数为 0。
- terminal task 复活次数为 0。
- 无 LLM 页面动作次数为 0。
- 关键矩阵连续两轮通过。
- score 连续两轮为 100。
- 没有新增回归。

当前基础设施阶段允许状态为 `partial`，不得把 skipped 或未自动化 case 写成完成。

## 运行

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31681 npm run loop:baseline
HIS_BASE_URL=http://10.26.6.8:31681 npm run loop:evaluate
```

默认 baseline/evaluate 不执行真实 mutation。需要显式 mutation 时：

```bash
RUN_AGENT_LOOP_MUTATIONS=1 HIS_BASE_URL=http://10.26.6.8:31681 npm run loop:full
```
