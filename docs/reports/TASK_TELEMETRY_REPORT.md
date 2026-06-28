# Task Telemetry Report

## 2026-06-25 Final Verification Addendum

- Final default E2E on `http://10.26.6.8:31451`: `80 passed / 3 skipped / 0 failed`.
- `RUN_LLM_E2E=1` full suite was attempted but the command wait exceeded 5 minutes. A focused live `@llm` phone-update case then failed because P001 phone stayed `13810010001` instead of `13800138000` after 90s; backend `/api/llm/test` itself returned `qwen3-14b ok` in `0.14s`.
- Loop evidence after the timer/step-scroll fix: P0 `iteration-050` = `8 / 0 / 0`, P1 `iteration-051` = `14 / 0 / 0`, full evaluate `iteration-052` = `29 / 0 / 0`.
- `npm run check:encoding`: passed after the final timing bucket patch.
- The login postcondition verifier now records a minimum `verify_ms=1` when the real verification path executed within one `Date.now()` tick, so local DOM timing remains visible without changing login success semantics.

## 2026-06-25 Active Timer / Step Lock Update

- Root cause: the widget preferred `step.elapsed_ms` even while a step was still `running`; planned steps were initialized with `elapsed_ms: 0`, so the visible timer stayed flat until the step completed and then jumped.
- Fix: active task and step display now derives live elapsed time from the persisted start timestamp and a resumed monotonic clock; terminal `completed / failed / cancelled` tasks use frozen `elapsed_ms`.
- Duplicate-looking totals were caused by reusing derived timing totals during repeated `updateTaskTiming()` calls. The timing summary now recomputes `action_ms`, `verify_ms`, `animation_ms`, `demo_delay_ms`, and `page_navigation_ms` from step breakdowns instead of adding old totals again.
- Demo pacing is recorded as `demo_delay_ms` and mirrored into `ui_animation_ms`; local DOM steps continue to show `token: 本地执行`.
- Current running steps use `current-step` / `agent-step-pulse`; if the user scrolls the step list, progress renders preserve that internal scroll instead of pulling the list back to the top.

Generated for the 2026-06-24 loop engineering pass.

## Current Telemetry Sources

- `hisAgentActiveTask`: current task state, status, plan, slots, timestamps, progress.
- `hisAgentTaskHistory`: terminal task archive used by loop assertions.
- `hisAgentFlowTrace`: recent route/action/pageState trace events.
- `loop-engineering/artifacts/iteration-008/traces/*.json`: per-case deterministic trace files.
- `artifacts/performance-baseline/current.json`: timing summary for the latest loop result.

## Current Run Evidence

- Loop run ID: `evaluate-20260624T095639Z`
- Passed / failed / skipped: `10 / 0 / 19`
- Data restored: `true`
- Average case elapsed: `303ms`
- Max case elapsed: `1746ms`

## What Is Covered

- Task status is checked from browser state and history, not trusted only from UI text.
- Login traces record requested username and whether the password matched the request; password plaintext is not written.
- Agent wrong-login case records DOM username after fill, auth state, page type, and task status.
- No-mutation save-denial case records before/after patient compact state, audit count, and task plan status.
- Terminal task lifecycle case checks that completed/waiting tasks are not revived after reload.

## Remaining Gaps

- Wall-clock, active execution, and waiting-user time are not yet split into separate telemetry fields.
- Token usage is recorded when backend returns it, but live LLM was unavailable in this run, so live token accounting was not validated.
- Wrong-patient protection is still cataloged but not automated.
- Full patient-field mutation matrix execution is not yet timed because baseline/evaluate modes intentionally avoid broad real mutations.

## Rule

Telemetry must support a postcondition-based verdict. `click dispatched`, HTTP 200, or `task.status=completed` alone is not enough to mark a business action complete.

## 2026-06-25 Telemetry Evidence Update

- Current loop run: iteration-049.
- Passed / failed / skipped: `29 / 0 / 0`.
- P2 telemetry now includes latest output visibility, preserved user scroll, unread prompt state, expanded-step scroll retention, and rich task-history fields.
- Current task panel state is stored separately from task execution state: minimization, step expansion, and header reopen do not change the task plan.
- Step timing now records real elapsed milliseconds and timing breakdowns. Old history records without timing render `未记录` instead of fake `00:00`.
- Token source is explicit: backend LLM usage shows real totals; deterministic DOM steps show `本地执行`; missing usage shows `未返回`.
- Default E2E after the final scroll fix: `76 / 0 / 3`.
- RUN_LLM_E2E latest full run after the final scroll fix: `77 / 1 / 1`; the failing live case was `updates Zhang Wei gender without patient not found @llm`, where the real LLM run did not update gender to `女` within the timeout. A follow-up `--grep @llm` run was skipped by the real LLM availability gate.
- Current public URL: `http://10.26.6.8:31451/html/login.html?v=20260628-mic-status-truth`.
