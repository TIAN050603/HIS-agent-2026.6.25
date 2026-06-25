# HIS Agent Equivalence Matrix

本矩阵记录“人工操作结果 == Agent 操作结果”的验收口径。Agent 只能通过真实 DOM 控件、页面事件、页面保存 handler 完成操作；业务状态以网页和 patient-store / audit log 为权威。

| 范围 | 手动操作 | Agent 操作 | 等价验证 | 当前状态 |
| --- | --- | --- | --- | --- |
| Login success | 输入 `123/123` 并点击登录 | `fill_login_form` + `submit_login` | 离开 login、`hisDemoAuthenticated=true`、无错误提示 | covered |
| Login wrong username | 输入 `1234/123` 并点击登录 | 同值填入并点击真实登录按钮 | 停留 login、错误提示、任务 failed | covered |
| Prefilled login | 输入框已有 `123/123` | 不清空重输，只提交 | DOM value 保持一致，登录成功 | covered |
| Patient search | 搜索姓名 / patientId / 手机号 | LLM plan -> `find_patient` | patient resolver 唯一匹配，不猜测多候选 | covered |
| Patient editor context | 手动打开 P001 编辑页 | `open_patient_editor(P001)` | URL / pageState / DOM patient 一致 | covered |
| Text field update | 修改主诉 / 现病史 | `update_patient_field` | DOM draft 改变，保存前 patient-store 不变 | covered |
| Multi field save | 修改两个字段并保存 | update x2 -> save -> verify x2 | patient-store 两字段匹配，audit log 存在 | added |
| Incomplete mutation plan | 人工不会“未修改就保存成功” | find/open/save-only plan | plan validation 拒绝，不执行页面动作 | added |
| Clinical draft | 生成草稿不写 store | `create_structured_draft` | draft card 可编辑，patient-store 不变 | covered |
| Voice session task | 医患 turns 整理后确认 | voice task contract -> normal taskflow | 医生确认后才执行 update/save/verify | added |
| Unknown page textbox | 输入普通文本 | generic `type` | after observation value 匹配 | added |
| Unknown page select | 选择下拉 | generic `select_option` | after observation value 匹配 | added |
| Unknown page checkbox/radio | 勾选 | generic `check` | after observation value 匹配 | added |
| Unknown page submit | 提交表单 | generic `click` / `submit` | 页面 status/result 文本匹配 | added |

## 未完成项

- 尚未为每个自动发现控件建立逐项手动/Agent 对照断言。
- 尚未把所有 HIS 页面操作都迁移到逐步 next-decision 循环；当前仍保留高层 plan + 每步执行前后校验的混合模式。
- 真实 LLM E2E 受当前 LLM 健康状态影响，需要在 `/api/llm/test` 稳定后继续跑。

## 2026-06-25 Equivalence Evidence Update

- Live LLM E2E now passed `75 / 0 / 1`; both `@llm` mutation cases executed and passed.
- Default E2E passed `73 / 0 / 3`.
- Full loop iteration-038 passed `29 / 0 / 0`.
- Wrong-login, prefilled-login, Liu Yang patient context, mutation save/verify, voice-confirmed task, and structured draft confirmation remain covered by browser E2E.
- The optional fake microphone case remains environment-dependent and is the only skipped item in the LLM E2E run.
