---
name: patient-field-resolver
description: 用于患者检索、字段解析、patient-store、field schema 和 resolver 回归；不要用于本地自然语言 fallback 或直接执行业务动作。
---

# patient-field-resolver

使用本 skill 时，只处理结构化 selector / field，不把完整自然语言任务解析成页面动作。

## 患者解析规则

- patient resolver 基于全量 patient-store。
- `P001 -> 张伟`。
- `张伟 -> P001`。
- 找到唯一患者时不要进入 `waiting_user`。
- 多个候选时才 `ask_clarification`。
- 不存在患者时返回 not_found，不随机选择。

## 字段解析规则

- field resolver 必须使用统一字段 schema。
- `手机号` / `手机号字段` / `电话` / `联系电话` -> `phone`。
- `性别` -> `gender`。
- `科室` / `就诊科室` -> `department`。
- `主诉` -> `chiefComplaint`。
- `现病史` -> `presentIllness`。
- `既往史` -> `medicalHistory`。
- `过敏史` -> `allergyHistory`。
- `地址` / `住址` -> `address`。
- `紧急联系人` -> `emergencyContact`。
- `紧急联系人电话` -> `emergencyPhone`。

## 禁止事项

- 不能在无 LLM 时通过 resolver 执行自然语言任务。
- 不能用本地正则解析“把张伟手机号改成 xxx”并直接执行。
- 不能把未知字段写入 patient-store。
- 不能在多候选患者时自动猜测。

## 必测项

- `resolvePatientSelector({patientId:"P001"}) -> P001 张伟`。
- `resolvePatientSelector({name:"张伟"}) -> P001 张伟`。
- `resolvePatientField("手机号字段") -> phone`。
- `resolvePatientField("性别") -> gender`。
- 未知字段返回 `field_not_found`。
