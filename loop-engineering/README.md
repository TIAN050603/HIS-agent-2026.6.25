# Loop Engineering Runner

本目录提供 Universal Agent 的可重复评估循环。

## 常用命令

```bash
npm run loop:baseline
npm run loop:evaluate
npm run loop:smoke
npm run loop:full
```

推荐显式指定当前前端：

```bash
HIS_BASE_URL=http://10.26.6.8:31210 npm run loop:baseline
```

## 输出

每次运行生成：

```text
loop-engineering/artifacts/iteration-001/result.json
loop-engineering/artifacts/iteration-001/report.md
loop-engineering/artifacts/iteration-001/traces/
loop-engineering/artifacts/iteration-001/screenshots/
loop-engineering/artifacts/iteration-001/checkpoints/
```

`result.json` 是机器可读结果；`report.md` 给 Codex 和医生/产品复盘使用。

## 边界

- `baseline` / `evaluate` 默认不跑真实 mutation。
- Explorer 只运行场景，不改代码。
- Evaluator 只评分，不修代码。
- Implementer 只修 first_failure。
- 密码明文不会进入 trace。
- Demo 数据恢复失败视为 P0 hard failure。
