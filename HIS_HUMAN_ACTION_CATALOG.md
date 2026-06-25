# HIS Human Action Catalog

Generated at: 2026-06-24T08:20:02.012Z
Base URL: http://10.26.6.8:31681

## 自动发现摘要

- login: controls=5, forms=1, tables=0
- dashboard: controls=14, forms=0, tables=0
- patient-management: controls=47, forms=0, tables=1
- patient-editor: controls=46, forms=0, tables=0
- agent-history: controls=4, forms=0, tables=0
- unknown-fixture: controls=11, forms=1, tables=1

## 操作目录

| 页面 | 控件 | role | 人类操作 | Agent action | 前置条件 | 验证方式 | 自动执行 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| login | 账号 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| login | 密码 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| login | 登录系统 | button | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| login | 恢复默认账号 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| login | 打开或收起全站 AI Agent | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 门诊工作台 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 患者管理 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 病历编辑 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 修改历史 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 系统设置 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 退出登录 | button | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| dashboard | 打开患者管理 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 进入编辑页 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 暂未开放 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 打开执行记录 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 暂未开放 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 暂未开放 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 暂未开放 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| dashboard | 打开或收起全站 AI Agent | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 返回工作台 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 重置 Demo 数据 | button | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| patient-management | 退出登录 | link | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| patient-management | 搜索患者 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 科室筛选 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 清空筛选 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 编辑 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 查看详情 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-management | 打开或收起全站 AI Agent | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 返回工作台 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 患者管理 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 退出登录 | link | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| patient-editor | 患者基础信息 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次就诊 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 旧病历 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 主诉 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 现病史 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 既往史 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 过敏史 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 生命体征 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 诊断 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 检查检验 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 医嘱/处方 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 操作日志 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 就诊人ID | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 姓名 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 性别 请选择 男 女 其他 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 年龄 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 出生日期 | date | set_date | set_date | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 手机号 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 证件类型 请选择 身份证 护照 港澳通行证 其他 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 证件号码 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 地址 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 紧急联系人 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 紧急联系人电话 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 医保类型 请选择 城镇职工医保 城乡居民医保 商业保险 自费 其他 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 就诊ID | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 就诊日期 | date | set_date | set_date | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 就诊科室 请选择 呼吸内科 消化内科 心血管内科 神经内科 骨科 皮肤科 儿科 眼科 耳鼻喉科 急诊科 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 接诊医生 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 就诊类型 请选择 初诊 复诊 急诊 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 就诊状态 请选择 待就诊 就诊中 已完成 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 本次问诊修改草稿 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 保存 / 同步 patient-store | button | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| patient-editor | 重新加载 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 撤销最近一次 Agent 修改 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| patient-editor | 打开或收起全站 AI Agent | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| agent-history | 返回工作台 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| agent-history | 返回患者管理 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| agent-history | 返回当前患者编辑页 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| agent-history | 打开或收起全站 AI Agent | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 姓名 | textbox | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 备注 | textarea | clear + type | clear + type | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 科室 | combobox | select_option | select_option | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 日期 | date | set_date | set_date | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 同意记录 | checkbox | check / uncheck | check / uncheck | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 普通 | radio | check | check | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 加急 | radio | check | check | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 提交 | button | click | click | 需要 LLM plan + allowlist + 页面上下文验证 | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 仅明确任务允许 |
| unknown-fixture | 打开弹窗 | button | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 跳到表格 | link | click | click | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |
| unknown-fixture | 滚动区域 | div | read / focus | read / focus | 控件 visible/enabled | execute action 后重新 observe，并检查 expected_result / 页面消息 / business_state | 允许 |

## 架构说明

- 本目录由 `scripts/generate-human-action-catalog.mjs` 通过真实浏览器和 `HisAgentBrowser.observeCurrentPage()` 自动生成。
- Agent 不因目录存在而获得业务特权；高风险动作仍必须来自 backend LLM planner，并经过 allowlist、页面上下文、字段/患者解析和后置条件校验。
- 未命名或低语义控件应优先补 `data-testid`、label 或 accessible name，而不是在 Agent 中写死 nth-child。

## 2026-06-25 Catalog Evidence Update

- 本轮没有扩大 Agent 的业务权限；目录仍只是发现人类可操作控件，不授予旁路能力。
- P2 loop automation now covers widget scroll and message actions that were previously cataloged but skipped.
- Full loop iteration-038 passed `29 / 0 / 0`.
- Agent actions continue to require backend LLM source, allowlist, page-context validation, and postcondition verification for high-risk business operations.
- Current public URL: `http://10.26.6.8:31684/html/login.html?v=20260625-final-loop`.
