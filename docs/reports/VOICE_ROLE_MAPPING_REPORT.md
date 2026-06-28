# Voice Role Mapping Report

Generated at: 2026-06-24T09:47:30.632Z
Run ID: voice-role-20260624T094730Z

## Summary

- Fixture cases: 10
- Baseline heuristic passed: 10/10
- Live diarization validated: false
- LLM semantic role validated: false

## Boundary

- The fixture baseline checks semantic role examples without changing ASR or Diart.
- It does not pretend Diart is available when only manual turns are present.
- Product execution should still prefer manually corrected doctor/patient labels before task drafting.

## Cases

- vr-001: expected=doctor, actual=doctor, passed=true, text=哪里不舒服？
- vr-002: expected=patient, actual=patient, passed=true, text=我胸闷半天，活动后加重。
- vr-003: expected=doctor, actual=doctor, passed=true, text=把主诉写成胸闷半天，现病史补充活动后加重并保存。
- vr-004: expected=patient, actual=patient, passed=true, text=最近咳嗽两天，还有点低热。
- vr-005: expected=doctor, actual=doctor, passed=true, text=记录患者 P001 主诉为咳嗽两天伴低热。
- vr-006: expected=patient, actual=patient, passed=true, text=夜间更严重，白痰不多。
- vr-007: expected=doctor, actual=doctor, passed=true, text=先不要保存，等我确认。
- vr-008: expected=patient, actual=patient, passed=true, text=没有药物过敏。
- vr-009: expected=doctor, actual=doctor, passed=true, text=一键交换医生患者标签后再整理。
- vr-010: expected=patient, actual=patient, passed=true, text=我叫张伟，今年四十五岁。

