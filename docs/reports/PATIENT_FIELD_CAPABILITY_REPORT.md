# Patient Field Capability Report

## 2026-06-25 Past History Capability Update

- Canonical key for `既往史 / 既往病史 / 既往病史内容 / past history / past medical history / medical history`: `pastHistory`.
- `medicalHistory` is retained only as a hidden legacy compatibility key and is no longer exposed as an editable target.
- Official editor DOM:
  - Present: `[data-field="pastHistory"]`, visible, enabled textarea, section label `既往史`.
  - Absent: `[data-field="medicalHistory"]`.
- Agent field resolver, mutation contract normalization, and patient editor adapter now all resolve past-history aliases to `pastHistory`.
- Probe evidence:
  - Before: `既往病史 -> medicalHistory`, `controlCount=0`, `dom_update_failed`.
  - After: `既往病史 -> pastHistory`, `controlCount=1`, `eventsDispatched=["input","change"]`, save returned an `audit_id`.
- Supported clinical mutation fields confirmed in this pass: `chiefComplaint`, `presentIllness`, `pastHistory`, `allergyHistory`, `note`.
- Latest matrix: `patient-field-matrix-20260625T072223Z`, 20 patients, 25 editable editor fields, 500 candidate cells.
- Loop verification: P0 8 passed / 0 failed, P1 14 passed / 0 failed.

Generated at: 2026-06-24T09:48:17.392Z
Run ID: patient-field-matrix-20260624T094817Z
Base URL: http://10.26.6.8:31681

## Summary

- Demo patients discovered: 20
- Editable editor fields: 25
- Candidate patient-field cells: 500
- Editable editor controls present and enabled: 25/25
- Full mutation execution complete: false

## Boundary

- This report discovers the full Demo patient x editable-field matrix from the live page schema and editor DOM.
- It does not execute every mutation in baseline/evaluate mode, so skipped execution must not be counted as pass.
- Real mutation execution still requires explicit mutation mode and data restore verification.

## Fields

- name (text)
- gender (select)
- age (number)
- birthDate (date)
- phone (text)
- idType (select)
- idNumber (text)
- address (text)
- emergencyContact (text)
- emergencyPhone (text)
- insuranceType (select)
- visitDate (date)
- department (select)
- doctor (text)
- visitType (select)
- visitStatus (select)
- chiefComplaint (textarea)
- presentIllness (textarea)
- pastHistory (textarea)
- allergyHistory (textarea)
- vitalSigns (textarea)
- diagnosis (textarea)
- examSummary (textarea)
- orders (textarea)
- note (textarea)

## Read-only Or Hidden

- patientId: editable=false, showInEditor=true
- encounterId: editable=false, showInEditor=true
- medicalHistory: editable=false, showInEditor=false, hidden legacy compatibility only; past-history writes use `pastHistory`
