---
name: his-agent-contract
description: 用于悬浮 Agent、LLM gate、executor、旧逻辑迁移和 action allowlist 审查；不要用于无关 UI 美化或 ASR 研发。
---

# his-agent-contract

使用本 skill 时，重点检查悬浮 Agent 是否仍符合产品契约。

## 核心契约

- 页面手动操作不依赖 LLM。
- 悬浮 Agent 执行动作必须依赖 LLM。
- 无 LLM 时，悬浮 Agent 可以显示、输入、展示 ASR 转写，但不能执行登录、导航、选患者、改字段、保存。
- 不允许本地关键词、正则、if/else 直接解析自然语言并执行任务。
- 前端执行器只执行 `source === "backend_llm"` 的 action。
- LLM Planner 负责自然语言理解；Local Allowlist Executor 只执行结构化 action。

## 执行前校验

- action 是否在 allowlist。
- action 是否来自 `backend_llm`。
- 当前 `pageType` 是否允许该 action。
- 目标患者是否已经通过 patient resolver 唯一确认。
- 目标字段是否通过统一 field schema 解析。
- 写入 patient-store 前是否有合法值校验。
- 保存或修改是否写入 audit log。

## 旧逻辑迁移规则

- 可以复用旧字段修改、保存、校验、预览逻辑。
- 不要复活旧本地自然语言 fallback。
- 不要把旧 `/api/universal-agent/next-action` 重新设为主入口。
- 旧 debug 信息应进入开发者详情或折叠区。

## 验收重点

- LLM disconnected 时输入任务不执行页面动作。
- LLM connected 时也必须经过 allowlist、pageState、patient-store、field schema 校验。
- 真实浏览器中确认无 LLM 不会修改 localStorage / patient-store / audit log。
