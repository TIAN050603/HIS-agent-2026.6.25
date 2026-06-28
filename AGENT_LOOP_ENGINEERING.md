# Agent Loop Engineering

This file is the explicit entry point requested by the Agent loop workflow. The canonical loop design remains in `LOOP_ENGINEERING.md`; keep both files aligned when changing runner behavior, scoring, artifacts, or hard gates.

## 2026-06-25 Timer / Pacing / Step Scroll Gate

- Active task timer must start when a backend LLM task becomes executable; running display may use a resumed monotonic clock, but terminal records must freeze `elapsed_ms`.
- Step timing must include real `execute_ms` plus UI/demo delay as `demo_delay_ms` / `ui_animation_ms`; local DOM steps keep `token_source=local_dom`.
- Demo pacing is off by default and disabled by `window.__HIS_AGENT_FAST_ANIMATION__` so E2E and loop runs do not wait for 1s visual delays.
- The current running step should be visibly marked; if a user scrolls the expanded step list, loop/UI tests should assert progress render does not reset that internal list to the top.
- Page-switch scroll restore should use an instant restore path, not smooth scrolling from top to bottom.

## Required Loop Artifacts

- `loop-engineering/artifacts/iteration-XXX/result.json`
- `artifacts/agent-loop/<run-id>/result.json`
- `artifacts/patient-field-matrix/result.json`
- `artifacts/voice-role/result.json`
- `artifacts/voice-task-equivalence/result.json`
- `artifacts/performance-baseline/current.json`

## Hard Gate Rules

- Skipped cases are never counted as passed.
- A task marked `completed` is not enough; evaluator assertions must verify page postconditions.
- Login success must be validated by the real page login flow.
- Patient mutation success must be validated by real DOM input/change, real save, patient-store result, and audit evidence.
- Voice task drafting must stop at editable natural-language text until the doctor confirms execution.
- Baseline and evaluate modes must not run broad real mutations unless `RUN_AGENT_LOOP_MUTATIONS=1` is explicitly set.

## Current Scope

The current loop can run browser health checks, manual login checks, Agent login checks, no-LLM gate checks, terminal-task lifecycle checks, no-mutation save-denial checks, field matrix discovery, voice role fixtures, voice task equivalence static checks, and performance summary collection.

Full all-patient all-field mutation execution is intentionally not claimed complete until a mutation-mode run verifies data restore after every cell.

## 2026-06-25 Current Loop Evidence

- Current base URL: `http://10.26.6.8:31210`.
- Current health URLs: backend `http://10.26.6.8:30921`, ASR `http://10.26.6.8:31238`, LLM service observation `http://10.26.6.8:31968`.
- P0 iterations 029 and 030 passed consecutively with `8 / 0 / 0`; after the final task-loop gate cleanup, iteration 031 also passed `8 / 0 / 0`.
- P1 iterations 027 and 028 passed consecutively with `14 / 0 / 0`; after the final task-loop gate cleanup, iteration 032 also passed `14 / 0 / 0`.
- `backend_llm_health` is a real backend `/api/llm/test` check. The endpoint is intentionally timeout-bounded for status UX and no longer blocks backend `/api/health`.
- Deterministic execution of an already planned `backend_llm` task is gated by task source, step source, allowlist, mutation contract, page postconditions, patient-store verification, and audit evidence. It does not re-test LLM connectivity before every DOM step.

## 2026-06-25 Final Loop Convergence

- Current public mapping: frontend `5500->31451`, backend `8000->31169`, ASR `8010->30197`, LLM service `8001->31034`, Jupyter `8888->49676`, SSH `22->30855`.
- Current base URL: `http://10.26.6.8:31451`.
- `call_qwen_json` now performs one backend-LLM JSON repair retry when the first backend response is invalid JSON. This is not a local keyword fallback; the repair request still goes through the configured backend LLM and the normal schema validation path.
- P2 skipped cases were automated: latest output visibility, user-scroll preservation, new-message prompt, home-view progress isolation, expanded-step scroll stability, and rich agent-history fields.
- Scroll manager `force` now explicitly keeps auto-follow enabled and repeats bottom alignment across layout frames so new task output remains visible when the user is already at the bottom.
- P2 iteration 037: `7 / 0 / 0`.
- Full loop iteration 038: `29 / 0 / 0`.
- Default E2E: `73 / 0 / 3`.
- RUN_LLM_E2E: `75 / 0 / 1`; both live `@llm` mutation cases executed and passed. The remaining skipped case is optional fake microphone.
- Forced refresh URL: `http://10.26.6.8:31451/html/login.html?v=20260628-mic-status-truth`.

## 2026-06-25 Task Telemetry Panel Final Evidence

- Full loop iteration 049: `29 / 0 / 0`, score 100.
- Performance baseline source iteration: 049, average case elapsed 2140ms, max case elapsed 8252ms.
- Default E2E after the final scroll-manager fix: `76 / 0 / 3`.
- RUN_LLM_E2E latest full run after the final scroll-manager fix: `77 / 1 / 1`; the live gender-update case failed because the real LLM run did not produce the expected page mutation within 90000ms. A follow-up `--grep @llm` run skipped both live cases through the real LLM availability gate.
- Scroll manager now treats user-scrolled-away as a hard boundary for delayed automatic bottom-follow callbacks. User-clicked unread prompt can still scroll to the bottom.
- Forced refresh URL: `http://10.26.6.8:31451/html/login.html?v=20260628-mic-status-truth`.
## 2026-06-25 Final Timer Loop Evidence

- P0 loop: `iteration-050`, `8 passed / 0 failed / 0 skipped`.
- P1 loop: `iteration-051`, `14 passed / 0 failed / 0 skipped`.
- Full evaluate loop: `iteration-052`, score `100`, `29 passed / 0 failed / 0 skipped`.
- Default E2E: `80 passed / 3 skipped / 0 failed`.
- Live LLM note: backend health returned `qwen3-14b ok` quickly, but the focused live `@llm` phone mutation case failed to mutate P001 within 90s; do not treat that as loop/timer convergence.
