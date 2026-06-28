---
name: safe-universal-agent-workflow
description: 用于 universal_agent 的远程服务器、容器、备份、路径、部署和真实运行目录确认；不要用于业务逻辑修复或 UI 改版。
---

# safe-universal-agent-workflow

使用本 skill 时，先确认当前任务是否涉及服务器、容器、端口、SSH、路径同步、运行目录或部署验证。

## 必做规则

- 只修改 `/huaiwenpang/universal_agent`。
- 不要修改 `universal_agent_backup_*`。
- 如果需要查看备份，只能只读查看。
- 不要打印、复制、提交或泄露 `.env`、API key、token、SSH 私钥。
- 不要执行 `rm -rf`、`git reset`、`git clean`、强制覆盖等破坏性命令。
- 修改前说明本地工作副本和真实运行目录的关系。
- 修改后确认 31416 服务实际返回新文件，而不是只确认本地文件。
- 如果 127.0.0.1 和 10.26.6.8 返回不同，必须说明哪个是浏览器真实访问地址。

## 推荐检查

- `pwd` / `ls -la` 确认远端目录。
- `curl http://10.26.6.8:31416/...` 确认前端资源。
- `curl http://10.26.6.8:31783/api/health` 确认后端。
- `curl http://10.26.6.8:31783/api/llm/test` 只看 ok/provider/model，不输出 secrets。
- 对 JS 改动运行 `node --check`。

## 输出要求

- 明确列出真实运行目录。
- 明确列出同步了哪些文件。
- 明确列出服务实际返回的版本号或关键字符串。
- 明确说明没有碰备份目录。
