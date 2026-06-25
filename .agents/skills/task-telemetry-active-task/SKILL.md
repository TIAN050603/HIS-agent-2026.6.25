---
name: task-telemetry-active-task
description: 用于悬浮 Agent 进度推送、任务计时、token usage、activeTask 生命周期和任务历史；不要用于患者字段业务逻辑修复。
---

# task-telemetry-active-task

使用本 skill 时，关注任务可观测性和生命周期，而不是业务 action 本身。

## UI 展示规则

- 不要在悬浮框顶部显示大块 task dump。
- 顶部只保留简洁状态：LLM、Agent、ASR、当前任务状态、进度、耗时、token 摘要。
- 完整步骤进入消息流或“详细步骤”。
- resolver debug 默认折叠，进入“开发者详情”或单条消息详情。
- 历史任务进入“任务历史”。

## 进度与计时

- 用户发送任务且 LLM connected 后才启动业务任务计时。
- 每条关键进度消息显示相对耗时，例如 `[00:02.5]`。
- 每个 step 记录 startedAt、finishedAt、elapsedMs。
- 任务 completed / failed / cancelled 时显示总耗时。

## token usage

- 后端返回 usage 时记录 `prompt_tokens`、`completion_tokens`、`total_tokens`。
- 维护 `usage_last` 和 `usage_total`。
- 后端未返回 usage 时显示“后端未返回 token usage”，不要伪造。
- token JSON 放开发者详情，普通消息只显示摘要。

## activeTask 生命周期

- `completed` / `failed` / `cancelled` / `blocked_no_llm` 不得污染新任务。
- 新任务必须新 `task_id`。
- 新任务不能继承旧 step logs、current step、waiting prompt、错误提示。
- 旧任务进入 history。
- `waiting_user` / `running` 需要用户明确选择继续还是开始新任务。

## 必测项

- failed 后新任务不显示旧步骤。
- 新会话按钮清空 activeTask。
- 旧任务进入 history。
- 跨页面跳转后消息流和任务进度不丢。
