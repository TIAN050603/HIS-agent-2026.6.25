# Playwright E2E 自动化验收

## 当前容器状态

## 2026-06-23 新增状态闭环回归

新增 `Agent state close-loop regressions` 用例组，覆盖：

- 当前任务“展开步骤”在 progress render 和 reload 后保持展开。
- 新任务 planning 阶段只显示当前任务，不闪现上一条 completed 任务。
- 未发送输入草稿跨页面恢复，任务接受后清空。
- 取消任务后 activeTask 立即清空、计时冻结、晚到 progress 不复活旧任务。
- chatView 按保存的滚动快照恢复到底部。
- 就诊会话整理 `clinical_draft` 显示可编辑确认框，`no_action` 不显示执行框，且整理阶段不修改 patient-store。

本轮验证命令：

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

当前容器已通过 Playwright 官方安装方式安装 Chromium：

```bash
cd /huaiwenpang/universal_agent
npx playwright install chromium
npx playwright install-deps chromium
```

默认 E2E 已可运行：

```bash
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

最近一次默认结果：73 passed / 3 skipped / 0 failed。

Playwright 浏览器路径：

- Chromium: `/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`
- Chromium headless shell: `/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell`


本目录是当前 `universal_agent` HIS Demo 的可运行 Playwright 验收测试。

## 运行方式

```bash
cd /huaiwenpang/universal_agent
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e
```

如果容器内存在系统 Chromium / Chrome，但 Playwright 自带浏览器没有安装，可以显式指定浏览器路径：

```bash
cd /huaiwenpang/universal_agent
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

当前容器已检查 `chromium`、`chromium-browser`、`google-chrome`、`google-chrome-stable`、`microsoft-edge` 和 `/usr/bin` 下的 chrome/chromium 项；暂未发现可用浏览器。未安装浏览器时，E2E 可以列出测试，但不能启动 Chromium。

有界面运行：

```bash
cd /huaiwenpang/universal_agent
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e:headed
```

真实 LLM 主链路默认跳过，因为会修改 demo patient-store。需要显式开启：

```bash
cd /huaiwenpang/universal_agent
RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e:headed
```

也可以只运行真实 LLM 用例：

```bash
cd /huaiwenpang/universal_agent
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e:llm
```

## 当前依赖

项目根目录已包含：

- `package.json`
- `package-lock.json`
- `@playwright/test`

如果换到新服务器或新容器，需要先执行：

```bash
npm install
npx playwright install chromium
```

如果 Chromium 报缺系统库，例如 `libnspr4.so`，再执行：

```bash
npx playwright install-deps chromium
```

## 覆盖范围

- 四个核心页面显示 `#hisAgentLauncher`。
- 手动登录正常。
- patient-management 可见 `P001 张伟`。
- `patient-editor.html` 无 `patientId` 时显示“未选择就诊人”空状态。
- `patient-editor.html?patientId=P001` 显示 P001 张伟摘要条和 Agent 状态简卡。
- 模拟无 LLM 时，悬浮 Agent 不执行登录、导航、患者修改或保存。
- 模拟 LLM 已连接但未规划登录步骤时，login 页面患者修改任务进入 `waiting_user`，提示需要先登录，不修改 patient-store。
- patient resolver 与 field resolver 基础契约。
- failed activeTask 归档到 history，新会话清空当前 activeTask。
- 悬浮 Agent 任务 UI：当前任务卡、结构化任务步骤列表、步骤状态、耗时 `MM:SS`、token 占位、示例任务/开发者详情/服务地址默认折叠。

## 跳过项

`LLM task happy path` 默认跳过，原因是：

- 依赖当前后端 LLM 和网络。
- 会修改 demo patient-store。
- 需要显式设置 `RUN_LLM_E2E=1` 或运行 `npm run test:e2e:llm`。

开启方式：

```bash
RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e:headed
```

真实 LLM 用例会在浏览器上下文中快照并恢复以下 localStorage 数据：

- `his_demo_patients_v2`
- `his_demo_patients_v1`
- `his_demo_patient_audit_v2`
- `his_demo_patient_audit_v1`
- `hisAgentActiveTask`
- `hisAgentTaskHistory`

当前真实 LLM 用例覆盖：

- `修改患者 P001 的手机号为 13800138000 并保存`
- `把张伟的性别改成女`

如果 `/api/llm/test` 不可用，真实 LLM 用例会跳过，不会改业务逻辑。

## agent-cases

`tests/agent-cases/his-agent-cases.json` 是验收用例集，当前 E2E 仍是手写关键链路测试，尚未自动读取该 JSON。

当前 `agent-cases` 已标记会修改 demo 数据的用例，并使用 `restoreFixture: localStorageSnapshot` 描述恢复方式。E2E 真实 LLM 用例目前手写调用同一类恢复 fixture，尚未自动从 JSON 生成测试。

后续建议把 `agent-cases` 接入 Playwright，自动生成以下类别测试：

- LLM connected 主链路。
- no-LLM 不执行。
- 登录页前置状态。
- 不存在患者 / 模糊患者澄清。

## Loop Engineering

2026-06-24 新增 `loop-engineering/`，用于把 case catalog、真实浏览器执行、确定性评估和机器可读结果接起来。

常用命令：

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31451 npm run loop:baseline
HIS_BASE_URL=http://10.26.6.8:31451 npm run loop:evaluate
```

默认 `baseline` / `evaluate` 不执行真实 mutation。需要 mutation 时必须显式运行：

```bash
RUN_AGENT_LOOP_MUTATIONS=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run loop:full
```

每轮输出位于：

```text
loop-engineering/artifacts/iteration-001/result.json
loop-engineering/artifacts/iteration-001/report.md
loop-engineering/artifacts/iteration-001/traces/
```

后续 Codex 会话应先读最新 `result.json` 的 `first_failure`，再修最小正确层。
- 字段解析与 audit log 回归。

## 2026-06-25 最新验收结果

```bash
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

- 默认 E2E：73 passed / 3 skipped / 0 failed。
- RUN_LLM_E2E：75 passed / 1 skipped / 0 failed；两条 live `@llm` 写 demo patient-store 用例均执行并通过。
- P0 loop：iteration-031，8 passed / 0 failed / 0 skipped。
- P1 loop：iteration-032，14 passed / 0 failed / 0 skipped。

## ASR 服务与浏览器麦克风状态

E2E 现在区分两类问题：

- `ASR 服务`：来自 runtime-config 的 ASR `/health`。
- `麦克风`：来自浏览器 `navigator.mediaDevices.getUserMedia`、安全上下文和权限状态。

如果浏览器不支持麦克风 API，但 ASR `/health` 返回 200，测试要求悬浮框显示：

```text
ASR 服务: connected
麦克风: unavailable
```

这类浏览器能力限制不应被误报为 ASR 服务 disconnected。

## waiting_user 确认

登录页前置任务进入 `waiting_user` 后，用户回复单字“是”应被识别为确认使用 Demo 登录前置步骤。E2E 覆盖该行为，并确认不会反复显示“请选择继续当前任务或取消旧任务”。

## 悬浮框任务 UI 与连接状态验收

当前默认 E2E 还覆盖悬浮框展示层：

- `#hisAgentTaskList` 显示 `任务：<objective>` 和结构化步骤。
- 步骤状态显示为 `completed`、`running`、`pending`、`failed` 等稳定文案。
- 步骤耗时显示为 `MM:SS`。
- 每个步骤显示 token 字段；无 usage 的步骤显示 `token: -`。
- 示例任务、服务地址、开发者详情、任务历史默认折叠。
- 服务状态 chip 显示 `Backend`、`LLM`、`Agent`、`ASR`、`Data`。
- 服务地址折叠区显示 backend / LLM / ASR 的实际检测 URL 和错误原因。

默认运行命令：

```bash
cd /huaiwenpang/universal_agent
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

## 连接状态显示回归

悬浮框服务状态依赖浏览器 `fetch`，因此 backend / ASR 不仅要 health 返回 200，还必须允许当前前端 origin：

```text
http://10.26.6.8:31451
```

当前 E2E 已覆盖服务状态 chip 和诊断区可见性；本轮真实浏览器额外验证 `window.__HIS_AGENT_WIDGET_DEBUG__.serviceDetails` 中 backend / LLM / ASR 均为 `connected`。

## CORS and browser LLM connectivity

The floating Agent uses browser `fetch`, so backend health from `curl` or Playwright `page.request` is not enough. The default E2E suite includes a browser-context check that loads the current frontend origin and calls:

```text
http://10.26.6.8:31169/api/llm/test
```

Current command:

```bash
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

For the current demo container, backend CORS allows the current frontend origin and a dev-only regex for dynamic demo ports:

```text
http://10.26.6.8:31451
^https?://(localhost|127\.0\.0\.1|10\.26\.6\.8):[0-9]+$
```

If the container port changes again, prefer setting `CORS_ALLOWED_ORIGINS` or `CORS_ALLOW_ORIGIN_REGEX` on the backend instead of editing many frontend files.

## Microphone permission manual diagnosis

The default E2E suite does not require real microphone hardware. Playwright/headless results must not be treated as proof that the user's real browser cannot record.

Manual check:
1. Open `http://10.26.6.8:31451/html/login.html?v=20260617-ports`.
2. Open the floating Agent and switch to `就诊会话`.
3. Click `检查麦克风权限`.
4. If the check fails, open Console and run:

```js
window.__HIS_AGENT_VOICE_DEBUG__.dump()
```

Share the dump output for diagnosis. It should include page origin, secure-context state, mediaDevices/getUserMedia availability, permission state, ASR health URL/status, WebSocket status, microphone status, and the last getUserMedia error.

If the current HTTP IP origin does not expose `getUserMedia`, try one of these access methods before changing ASR code:
- HTTPS access to the same frontend.
- localhost/SSH tunnel access to the frontend port.
- Browser address-bar microphone permission settings.
- Browser trusted-origin / insecure-origin development setting, if your browser supports it.

Optional fake microphone E2E:

```bash
RUN_MIC_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

## Current service mapping

- Frontend: `http://10.26.6.8:31451`
- Backend: `http://10.26.6.8:31169`
- ASR: `http://10.26.6.8:30197`
- LLM service: `http://10.26.6.8:31034`
- Jupyter: `http://10.26.6.8:49676`
- SSH: `10.26.6.8:30855`

When validating microphone behavior, open:

```bash
http://10.26.6.8:31451/html/login.html?v=20260625-final-loop
```

`RUN_MIC_E2E=1` enables Chromium fake media flags in Playwright. It is only a UI/permission-flow regression check, not a real hardware recording test.

## 2026-06-23 Agent V2 matrix

本轮新增/强化的关键测试：

- `waiting_user clarification keeps original task id and uses backend planner`
- `task progress updates current card without mirroring every step as chat messages`
- `task progress does not force the user back into chat view after returning home`
- `chat workspace can be opened directly and keeps the recent task checklist`
- `primary footer button becomes cancel only while a task is running`
- `renders compact current task list with collapsed optional panels`
- `pre-filled demo login is submitted without clearing and retyping credentials`
- `missing patient task shows explicit not found message without mutation`
- `patient context carries from Liu Yang lookup into later update steps`

建议命令：

```bash
npm run check:encoding
HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
RUN_MIC_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list
```

关键矩阵可用标题 grep 连续跑两轮：

```bash
HIS_BASE_URL=http://10.26.6.8:31451 npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/his-agent.spec.ts --grep 'waiting_user clarification|task progress updates|task progress does not force|chat workspace can be opened directly|primary footer button|renders compact current task list|pre-filled demo login|missing patient task|patient context carries from Liu Yang' --reporter=list
```

2026-06-23 结果：

- 默认 E2E：54 passed / 3 skipped。
- `RUN_LLM_E2E=1`：54 passed / 3 skipped；真实 `@llm` 写数据用例因 backend LLM 探针超时被 guard skip。
- `RUN_MIC_E2E=1`：54 passed / 3 skipped；fake mic 用例因当前 Chromium fake media 未暴露 `getUserMedia` 被 skip。
- 关键矩阵两轮：9 passed + 9 passed。

## 2026-06-25 Current results

- `HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list`: 73 passed / 3 skipped.
- `RUN_LLM_E2E=1 HIS_BASE_URL=http://10.26.6.8:31451 npm run test:e2e -- --reporter=list`: 75 passed / 1 skipped.
- Remaining skipped case: optional fake microphone recording `@mic`.
