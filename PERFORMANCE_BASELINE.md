# Performance Baseline

## 2026-06-25 Final Runtime Evidence

- Default E2E: `80 passed / 3 skipped / 0 failed` on `http://10.26.6.8:31684`.
- Loop evaluate after the final timer patch: `iteration-052`, score `100`, `29 passed / 0 failed / 0 skipped`.
- P0/P1 focused loops: `iteration-050` (`8 / 0 / 0`) and `iteration-051` (`14 / 0 / 0`).
- Live LLM health probe was fast (`0.14s`, `qwen3-14b ok`), but the focused live `@llm` phone mutation test failed to update P001 within 90s; treat this as live LLM/taskflow evidence, not as timer or scroll performance evidence.

## 2026-06-25 Timer And Demo Pacing Baseline

- Targeted UI telemetry regression on `http://10.26.6.8:31684`: 4 passed.
- Running task timer now refreshes in the widget at 250ms cadence and displays one-decimal seconds for sub-minute values.
- Demo pacing defaults to disabled. When `window.__HIS_AGENT_DEMO_PACING__` or `localStorage.his_agent_demo_pacing` enables it, field/click delay is counted in `demo_delay_ms`; E2E fast mode (`window.__HIS_AGENT_FAST_ANIMATION__ = true`) disables the delay.
- Page-switch scroll restoration uses `behavior: "auto"` and hides the chat body only for the first restore frame, avoiding the visible top-to-bottom glide.

Generated at: 2026-06-25T08:34:36.828Z
Source iteration: iteration-049
Source run ID: evaluate-20260625T081847Z
Base URL: http://10.26.6.8:31684

## Summary

- Status: baseline_collected
- Score: 100
- Passed / failed / skipped: 29 / 0 / 0
- Total measured case elapsed: 62050ms
- Average case elapsed: 2140ms
- Max case elapsed: 8252ms

## Case Timings

- p0-runtime-health-baseline: passed, 2216ms
- p0-login-invalid-username-manual: passed, 724ms
- p0-login-invalid-username-agent: passed, 1267ms
- p0-no-mutation-save-denied: passed, 1149ms
- p0-wrong-patient-protection: passed, 8252ms
- p0-no-llm-no-page-action: passed, 1401ms
- p0-terminal-task-not-reanimated: passed, 577ms
- p0-data-snapshot-restore: passed, 323ms
- p1-login-valid-manual: passed, 915ms
- p1-agent-login-valid: passed, 1746ms
- p1-update-p001-phone: passed, 3861ms
- p1-in-his-no-return-login: passed, 3700ms
- p1-missing-patient-clarify: passed, 4360ms
- p1-missing-field-clarify: passed, 4356ms
- p1-new-task-during-waiting-user: passed, 1693ms
- p1-cancel-task-terminal: passed, 1651ms
- p1-refresh-restore-no-repeat: passed, 4222ms
- p1-multi-field-update: passed, 4971ms
- p1-date-and-select-update: passed, 4443ms
- p1-primary-voice-input-only: passed, 760ms
- p1-voice-session-review-before-execute: passed, 1087ms
- p1-diart-unavailable-manual: passed, 982ms
- p2-latest-agent-message-visible: passed, 1879ms
- p2-user-scroll-not-forced-bottom: passed, 1019ms
- p2-new-message-prompt: passed, 1046ms
- p2-progress-does-not-steal-home-view: passed, 1014ms
- p2-expanded-steps-not-reset: passed, 1599ms
- p2-input-draft-persist: passed, 479ms
- p2-agent-history-rich-fields: passed, 358ms

## Threshold Notes

- Status refresh target: 5000ms
- LLM health fast-check target: 5000ms
- Single loop case target: 15000ms

## 2026-06-25 Interpretation

- Simple valid Agent login (`p1-agent-login-valid`) completed in 1746ms in iteration-049.
- Prefilled login E2E completed in 2.4s and verified that DOM typing is skipped when the requested values are already present.
- The slowest deterministic loop case was wrong-patient protection at 8252ms; it remains below the 15000ms loop case target.
- Deterministic DOM execution no longer waits on `/api/llm/test` for every step after a backend-planned task has passed the LLM gate.
- The real LLM E2E timings remain upstream-model dependent and are not used as deterministic DOM performance baselines.
