# Agent V3 Regression Report

## 2026-06-24 增量范围

本轮没有新建平行项目，没有修改 `universal_agent_backup_*`，只在 `/huaiwenpang/universal_agent` 正式目录对应文件上做增量改造。

已完成：

- 新增 `shared/generic-browser-agent.js`，提供 `observeCurrentPage()` 和通用 `executeAction()`。
- 正式 HIS 页面接入通用 Observation / Action 层。
- 新增 `tests/fixtures/unknown-page.html`，覆盖陌生网页控件类型。
- 新增 `scripts/generate-human-action-catalog.mjs`，通过真实浏览器自动生成 `HIS_HUMAN_ACTION_CATALOG.md`。
- 新增 mutation contract / mutation ledger，字段修改任务不能只 find/open/save 后 completed。
- 语音就诊任务确认后会把 `task_contract.expected_mutations` 一起传给 planner。

## Observation / Action 架构

- Observation：DOM / 表单 / 控件 / 表格 / 页面消息 / auth context / patient context。
- Action：click、double_click、hover、focus、clear、type、select_option、set_date、check、uncheck、press_key、scroll、submit、navigate、back、forward、reload、wait、read。
- Verification：每个通用 action 执行后重新 observe，返回 before / after observation id；业务 action 仍由 domain adapter 校验 patient-store 和 audit。

## Mutation Contract 回归

新增合同：

```json
{
  "target_patient": {"patientId": "P001", "name": "张伟"},
  "expected_mutations": [
    {"field": "chiefComplaint", "value": "咳嗽两天伴低热"},
    {"field": "presentIllness", "value": "患者近两天咳嗽，有少量白痰，夜间咳嗽更明显，伴低热"}
  ],
  "requires_save": true,
  "requires_verification": true
}
```

规则：

- 每个 expected mutation 必须有 update action。
- update 必须在 save 前。
- save 后必须 verify。
- 保存前必须看到 applied mutation 和 dirty field。
- 保存后必须看到 changedFields 和 audit_id。
- completed 前必须确认 applied / saved / verified / patient-store 一致。

## 测试状态

- 本地静态语法检查：通过 `node --check` / `python -m py_compile`。
- 本地 targeted E2E：未跑通，原因是本地完整镜像未安装 `@playwright/test`；远端正式目录已有 `node_modules`，同步后在远端执行。
- 默认 E2E：待远端同步后运行。
- RUN_LLM_E2E：待远端同步后运行；若 LLM 健康检查仍超时，将明确列出。

## 未完成项

- 全量人类操作目录需要同步远端后运行 `npm run catalog:human-actions` 生成最终发现数量。
- 每个控件的人工/Agent 等价测试还不是 100% 全覆盖。
- next-decision endpoint 尚未替代现有 task-plan 主循环；本轮先补 Observation / Action 基础层和关键 mutation 安全合同。
## 2026-06-24 Remote verification update

已同步到 `/huaiwenpang/universal_agent` 并通过浏览器真实访问地址 `http://10.26.6.8:31681` 验证。

本次补充修复：

- 最后一步 `verify_patient_store` 不再停留在 `running`，会完成只读校验并归档任务。
- store 校验兼容正式 `PatientStore.getPatientById`，不修改 patient-store。
- completed task history 现在保留 `mutation_ledger`，包含 applied / verified / save / audit id。
- voice confirmed task 会把最小 `task_contract.expected_mutations` 传入 planner。
- E2E voice mock 与正式 `/api/voice/turns-to-agent-task` 字段对齐。

验证命令与结果：

```text
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31681 npm run test:e2e -- --reporter=list --grep=mutation
HIS_BASE_URL=http://10.26.6.8:31681 npm run test:e2e -- --reporter=list
RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31681 npm run test:e2e -- --reporter=list
```

- Encoding：passed，30 files valid UTF-8。
- Mutation subset：5 passed。
- Default E2E：73 passed / 3 skipped。
- RUN_LLM_E2E=1：73 passed / 3 skipped；两个 `@llm` 写数据用例仍由测试内部 guard skip，不能作为 live LLM 写数据验收结论。
