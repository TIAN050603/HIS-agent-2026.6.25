---
name: his-ui-e2e-review
description: 用于 HIS 页面 UI、中文文案、Playwright E2E、真实浏览器回归和验收检查；不要只用 node --check 或 VM 测试替代真实网页验证。
---

# his-ui-e2e-review

使用本 skill 时，重点是真实浏览器端行为和用户可见 UI，而不是单纯语法检查。

## 每次改悬浮框必须验证

- `login.html` 显示 `#hisAgentLauncher`。
- `dashboard.html` 显示 `#hisAgentLauncher`。
- `patient-management.html` 显示 `#hisAgentLauncher`。
- `patient-editor.html?patientId=P001` 显示 `#hisAgentLauncher`。
- 悬浮框可点击、可拖动、按钮可用。

## 每次改 Agent 必须验证

- 无 LLM 时悬浮框输入任务不执行页面动作。
- 有 LLM 时完整任务链路不能只看后端 planner，必须跑真实浏览器。
- 任务消息流显示进度、耗时、token 状态。
- 新任务不显示旧任务流程。

## 每次改患者数据必须验证

- patient-management 表和 patient-editor 同步。
- patient-store 更新正确。
- audit log 记录 oldValue / newValue。
- 保存后刷新或返回列表仍能看到变化。

## 每次改 UI 必须检查

- 没有大面积空白。
- 正式页面没有误留旧 Agent 测试区。
- 文本不互相遮挡。
- 悬浮框不遮挡关键表单到不可用。

## 中文乱码防回归

- 所有 HTML head 前部必须有 `<meta charset="UTF-8">`。
- HTML / JS / CSS / MD / TS 文件必须保持 UTF-8。
- 改动中文文案后必须运行 `npm run check:encoding`。
- E2E 必须覆盖关键中文文案，例如 `医院信息系统 HIS Demo`、`用户登录`、`患者管理`、`患者列表`、`患者摘要`、`主诉`、`现病史`。
- 页面正文不得出现典型乱码片段，例如 `Ã`、`å`、`é`、`è`、`鐩`、`婚`、`榇`、`淇`、`鍖`、`�`、`锟`。

## 登录页前置状态

每次改登录页或 task precondition，必须测试：

- 在 login 页面输入 HIS 内部任务时，不应直接执行患者修改。
- 后续正确行为应提示需要登录，或规划 Demo 登录 -> HIS -> 患者管理 -> 编辑页 -> 修改字段。
