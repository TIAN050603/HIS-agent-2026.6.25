# Agent Flow Trace Guide

## 目的

`AgentFlowTrace` 用于定位 Agent 与网页真实状态之间的第一个偏差。它不记录密码、API key、token 或 `.env` 内容，只保留任务、页面、动作、观察和验证证据。

## 关键事件

- `observe`: `HisAgentBrowser.observeCurrentPage()` 完成一次结构化页面观察。
- `generic_action`: 通用 Browser Action 执行后，包含 before / after observation id。
- `action_selected`: task orchestrator 选择 allowlisted action。
- `action_executed`: 页面 adapter 返回真实执行结果。
- `canonical_patient_remembered`: patient resolver 得到唯一患者。
- `planner`: backend LLM task-plan 的 trace。
- `repair`: backend LLM repair 的 trace。

## 排障顺序

1. 查看 `plannerRawResponse` 与 `parsedAgentResponse`，确认 LLM 是否生成了必要 action。
2. 查看 normalizer / contract validation，确认 action 是否被过滤、修复或拒绝。
3. 查看 `action_selected`，确认 executor 实际选择了哪个结构化 action。
4. 查看 `generic_action` 或 `action_executed` 的 before / after observation，确认页面真实变化。
5. 对保存类任务查看 patient-store 与 audit log，确认不是 click dispatched 即 completed。

## Mutation Contract Trace

字段修改任务必须在 planner trace 中出现：

```json
{
  "taskContract": {
    "target_patient": {"patientId": "P001", "name": "张伟"},
    "expected_mutations": [
      {"field": "chiefComplaint", "value": "..."},
      {"field": "presentIllness", "value": "..."}
    ],
    "requires_save": true,
    "requires_verification": true
  }
}
```

若 planner 返回 `find_patient / open_patient_editor / save_patient` 但缺少 update / verify，后端 normalizer 会记录 `plan_validation.before_errors`，并补全或拒绝；前端再次校验，仍不完整时不执行任何页面动作。

## 读取方式

浏览器控制台：

```js
window.AgentFlowTrace.getEvents()
window.AgentFlowTrace.latest("action_executed")
```

localStorage：

```js
JSON.parse(localStorage.getItem("hisAgentFlowTrace") || "[]")
```

## 2026-06-25 Trace Update

- Flow trace now supports P2 scroll/message evidence in loop artifacts for latest-message visibility, user-scroll preservation, unread prompt, and expanded-step scroll retention.
- Backend LLM malformed JSON repair is recorded as backend planning behavior; successful repair still returns through normal schema validation before task execution.
- Current loop evidence: iteration-038 `29 / 0 / 0`.
- Current forced refresh URL: `http://10.26.6.8:31684/html/login.html?v=20260625-final-loop`.
