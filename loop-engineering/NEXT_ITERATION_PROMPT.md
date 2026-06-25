# Next Codex Iteration Prompt

请遵守 `AGENTS.md`，并显式使用：

- `$safe-universal-agent-workflow`
- `$his-agent-contract`
- `$task-telemetry-active-task`
- `$patient-field-resolver`
- `$his-ui-e2e-review`

请在 `/huaiwenpang/universal_agent` 中继续 Loop Engineering：

1. 读取最新 `loop-engineering/artifacts/iteration-*/result.json` 和 `report.md`。
2. 找到 `first_failure`。
3. 不猜根因，必要时补充 trace 证据。
4. 只修复 first_failure 对应的最小正确层。
5. 不修改 `universal_agent_backup_*`。
6. 不恢复本地自然语言 fallback。
7. 不直接写登录状态、patient-store 或 audit log 来伪造成果。
8. 修改后运行：

```bash
npm run check:encoding
HIS_BASE_URL=<当前前端URL> npm run loop:evaluate
HIS_BASE_URL=<当前前端URL> npm run test:e2e -- --reporter=list
RUN_LLM_E2E=1 HIS_BASE_URL=<当前前端URL> npm run test:e2e -- --reporter=list
```

如果 score 下降或新增 P0 hard failure，按 checkpoint 回滚并停止。
