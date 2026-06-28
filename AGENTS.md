# universal_agent 开发规则

本文件是当前项目给 Codex / Agent 迭代使用的项目级约束。后续修改前应先阅读本文件，并优先遵守这里的项目边界。

## 1. 项目路径规则

- 真实运行目录是 `/huaiwenpang/universal_agent`。
- 不要修改任何 `universal_agent_backup_*` 备份目录；如需查看备份，只允许只读查看。
- 不要打印、复制、提交或泄露 `.env`、API key、token、SSH 私钥等敏感信息。
- 不要执行 `rm -rf`、`git reset`、`git clean`、强制覆盖等破坏性命令，除非用户明确要求。
- 每次涉及远端同步时，要确认浏览器真实访问的是当前服务返回的新文件。

## 2. Agent 产品边界

- 页面手动操作不依赖 LLM。
- 悬浮 Agent 执行动作必须依赖 LLM。
- 无 LLM 时，悬浮 Agent 只显示状态、接收输入、显示 ASR 转写，不执行登录、导航、选患者、改字段、保存等页面动作。
- 不允许本地关键词、正则、if/else fallback 冒充 Agent 理解自然语言。
- Local Allowlist Executor 只执行 `source === "backend_llm"` 的 action。
- patient resolver 和 field resolver 只能处理 LLM 返回的结构化 selector / action，不能直接解析完整自然语言并执行。

## 3. HIS 页面规则

- `login` 是 Demo 登录页。
- `dashboard` 是 HIS 工作台。
- `patient-management` 负责完整患者表、搜索、编辑入口。
- `patient-editor` 只编辑当前 `patientId` 对应患者。
- 右下角悬浮 Agent 是正式 Agent 入口。
- 旧调试功能应进入开发者详情或 debug 面板，不暴露在正式 HIS 主流程中。

## 4. 编码与中文文案规则

- 所有 HTML 文件 head 前部必须保留 `<meta charset="UTF-8">`。
- HTML / JS / CSS / MD / TS / JSON 文件必须保存为 UTF-8。
- 不要用未显式 UTF-8 的 PowerShell `Set-Content`、`Out-File` 或脚本重写含中文文件。
- 如必须脚本化改中文文件，读写都要明确使用 UTF-8，并在改后运行 `npm run check:encoding`。
- 修 UI 文案后必须检查页面不包含典型乱码片段，例如 `Ã`、`å`、`é`、`è`、`鐩`、`婚`、`榇`、`淇`、`鍖`、`�`、`锟`。
- 关键中文文案必须保持可读，包括：`医院信息系统 HIS Demo`、`用户登录`、`患者管理`、`患者列表`、`返回工作台`、`退出登录`、`AI Agent`。

## 5. 必跑验收

涉及 Agent / 患者数据 / 页面跳转 / 中文 UI 文案的修改后，应按影响范围验证：

- `npm run check:encoding`
- `HIS_BASE_URL=<当前前端地址> npm run test:e2e -- --reporter=list`
- 手动登录正常。
- 四个页面均显示 AI Agent。
- 无 LLM 时悬浮框输入任务不执行页面动作。
- 患者管理页仍显示 20 个患者。
- P001 / 张伟能被 patient resolver 找到。

## 6. 项目级 skills

项目级 skills 位于 `.agents/skills/`，只属于本项目，不安装到全局。

- `$safe-universal-agent-workflow`：用于远程服务器、容器、备份、路径、部署和真实运行目录确认。
- `$his-agent-contract`：用于悬浮 Agent、LLM gate、executor、旧逻辑迁移、action allowlist。
- `$patient-field-resolver`：用于患者检索、字段解析、patient-store、field schema。
- `$task-telemetry-active-task`：用于任务进度、计时、token usage、activeTask 生命周期。
- `$his-ui-e2e-review`：用于页面 UI、中文文案、Playwright 测试、真实浏览器回归验收。

## 7. 每轮完成后更新

- `docs/reports/IMPLEMENTATION_REPORT.md`
- 如涉及旧功能迁移，更新 `docs/reports/OLD_AGENT_MIGRATION_AUDIT.md`
- 如涉及废代码，更新 `docs/reports/DEAD_CODE_REVIEW.md`
- 如新增已知问题，更新 `docs/reports/PROJECT_BACKLOG.md` 或 `KNOWN_ISSUES.md`

## 8. Loop Engineering 规则

- 每轮 Agent/业务/任务状态开发前，先运行或读取最新 `npm run loop:baseline` / `npm run loop:evaluate` 结果。
- 没有 trace 和确定性后置条件证据时，不得猜测根因。
- 每轮只修复最高优先级的 `first_failure`，不要顺手重构无关模块。
- 涉及 mutation 的测试必须先快照 Demo 数据，结束后自动恢复并验证恢复成功。
- 每轮必须生成或更新 `loop-engineering/artifacts/iteration-XXX/result.json`。
- Git 因 `dubious ownership` 不可用时，不修改全局 `safe.directory`；使用 `loop-engineering/scripts/create-checkpoint.mjs` 创建文件级 checkpoint。
- `baseline` / `evaluate` 默认不得执行真实 mutation；需要真实 mutation 时必须显式使用 `RUN_AGENT_LOOP_MUTATIONS=1` 或 `loop:full`。
- 退出必须满足 `LOOP_ENGINEERING.md` 的 Loop 条件；skipped 用例不得当作 passed。
