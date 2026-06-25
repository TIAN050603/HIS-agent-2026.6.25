# Agent Capability Matrix

Generated for the 2026-06-24 loop engineering pass.

## Current Run

- Frontend URL: `http://10.26.6.8:31210`
- Loop run: `loop-engineering/artifacts/iteration-008/result.json`
- Agent-loop export: `artifacts/agent-loop/evaluate-20260624T095639Z/result.json`
- Score: `100`
- Passed / failed / skipped: `10 / 0 / 19`
- Hard failures: `0`
- First failure: `none`

## Capability Status

| Area | Status | Evidence |
| --- | --- | --- |
| Runtime health | Partial | Frontend/backend/ASR passed. LLM and Diart were observed only and returned `fetch failed`, so they are not claimed healthy. |
| Manual wrong login | Passed | `1234/123` stays on login and keeps `hisDemoAuthenticated=false`. |
| Agent wrong login | Passed | Mock backend planner fills `1234/123`, page rejects it, task becomes `failed`, no business mutation. |
| Manual valid login | Passed | `123/123` enters HIS dashboard. |
| Agent valid login | Passed | Mock backend planner fills `123/123`, page login handler authenticates, task becomes `completed`. |
| No LLM gate | Passed | Simulated disconnected LLM does not perform page action or business mutation. |
| No-mutation save denial | Passed | Plan with expected mutations but missing update/verify is rejected before page save. |
| Terminal task lifecycle | Passed | Terminal tasks are not reanimated after reload. |
| Data snapshot/restore | Passed | Loop runner restores localStorage snapshot after each browser case. |
| Wrong-patient protection | Not automated | Cataloged P0 but still skipped in iteration-008. |
| Patient field matrix discovery | Generated | 20 patients, 25 editable editor fields, 500 candidate cells. Full mutation execution not claimed. |
| Voice role mapping | Fixture baseline | 10 semantic role fixture cases passed with deterministic baseline. Live Diart/LLM semantic role validation not claimed. |
| Voice task equivalence | Static passed | Confirmed voice task text routes through `handleCommand -> AgentTaskOrchestrator.startTask`. |
| Performance baseline | Collected | Average case elapsed 303ms, max case elapsed 1711ms from iteration-008. |

## Hard Gate Result

This pass is **not a full capability completion** because 19 cases remain skipped, including P0 wrong-patient protection. Skipped cases are visible work items and must not be counted as passed.

## Next Highest Priority

Automate `p0-wrong-patient-protection` with a real browser case that starts on a mismatched patient editor page, submits a structured mutation plan for another patient, and asserts:

- no field DOM is changed for the wrong patient,
- no patient-store mutation occurs,
- no audit entry is written,
- task fails or waits for correction instead of completing.

## 2026-06-25 Current Capability Status

- Frontend URL: `http://10.26.6.8:31210`.
- Current loop evidence: P0 iteration-031 `8 / 0 / 0`, P1 iteration-032 `14 / 0 / 0`.
- P0 wrong-patient protection: Passed, automated in the real browser loop.
- P1 taskflow cases: Passed, `14 / 0 / 0` with no skipped P1 cases.
- Runtime health: backend, ASR, and Diart health are reachable; backend LLM health uses bounded `/api/llm/test`.
- Live LLM write path: RUN_LLM_E2E passed `75 / 0 / 1`; both `@llm` mutation tests executed and passed.
- Remaining caveat: broad all-patient all-field mutation mode is still not claimed unless explicitly run with mutation restore coverage.

## 2026-06-25 Final Capability Status

- Frontend URL: `http://10.26.6.8:31684`.
- Backend URL: `http://10.26.6.8:30663`.
- ASR URL: `http://10.26.6.8:30410`.
- LLM service mapping: `8001->31756`.
- Full loop evidence: iteration-038 `29 / 0 / 0`, including P0, P1, and newly automated P2 checks.
- P2 message and scroll capabilities are now covered by browser automation instead of skipped rows.
- Live LLM write path remains gated by backend LLM source, allowlist executor, page postconditions, patient-store verification, and audit evidence.
- JSON repair capability is backend-LLM-only and exists to normalize malformed JSON responses before schema validation; it does not bypass planning or execution contracts.
- Remaining caveat: all 500 patient-field matrix cells are discovered, but broad mutation execution for every cell is still not claimed without an explicit mutation-mode run and restore proof.
