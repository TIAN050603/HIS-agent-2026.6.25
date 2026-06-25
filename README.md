# GUI Agent Patient Editor Test

This repository contains a single-page patient information editor for GUI/Web Agent research.
The frontend is a static `index.html` page. The current main agent path is **Universal Observe-Act Agent**.

Public frontend URL:

```text
https://tian050603.github.io/gui-agent-patient-editor-test/
```

## Current Architecture

```text
Static frontend page
  -> browser collects a structured pageState from the current page
  -> local FastAPI backend calls Qwen for the next observe-act action
  -> frontend applies that action to the current page DOM
  -> loop continues until the task is saved, finished, or needs user clarification
```

Optional voice input:

```text
Browser microphone
  -> local asr_service WebSocket
  -> Qwen ASR realtime API
  -> transcript is filled into the task textarea
  -> user clicks Send Task
  -> Universal Observe-Act Agent runs on the text command
```

The ASR service only converts speech to text. It never executes a task automatically.

## Important Notes

- GitHub Pages only serves the static frontend. It cannot run Python services.
- To use the agent, start the local `backend` service.
- To use voice input, also start the local `asr_service` service.
- Real API keys must stay in local `.env` files and must not be committed.
- The backup folder `_backup_before_perf_optimization_20260604/` is local-only and ignored by Git.
- The current UI main mode is Universal Observe-Act Agent. Browser Use / Smoke Test code is no longer the main path.

## Project Layout

```text
index.html
start_lan_services.ps1
backend/
  main.py
  pyproject.toml
  .env.example
asr_service/
  app/
  requirements.txt
  .env.example
  README.md
voice_client/
  voice_asr_client.js
  voice_asr.css
Universal Observe-Act Agent technical report/
README.md
```

Technical report:

[Universal Observe-Act Agent technical report](Universal%20Observe-Act%20Agent%E6%8A%80%E6%9C%AF%E6%8A%A5%E5%91%8A/UNIVERSAL_OBSERVE_ACT_AGENT_REPORT.md)

## 1. Backend Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

For DashScope / Qwen compatible API:

```env
LLM_PROVIDER=qwen
DASHSCOPE_API_KEY=your_real_key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus
```

For a self-hosted OpenAI-compatible Qwen service:

```env
LLM_PROVIDER=qwen
DASHSCOPE_API_KEY=EMPTY
DASHSCOPE_BASE_URL=http://your-qwen-host:8001/v1
DASHSCOPE_MODEL=qwen3-14b
```

Start backend for local-only use:

```powershell
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --log-level debug
```

Start backend for LAN access:

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --log-level debug
```

Health checks:

```powershell
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/qwen/test
```

## 2. Frontend

Use GitHub Pages:

```text
https://tian050603.github.io/gui-agent-patient-editor-test/
```

Or serve the local file for LAN testing:

```powershell
python -m http.server 8080 --bind 0.0.0.0
```

Then open:

```text
http://YOUR_IPV4_ADDRESS:8080
```

Example:

```text
http://10.31.97.44:8080
```

In the page, set backend URL to:

```text
http://127.0.0.1:8000
```

or, for other devices on the same LAN:

```text
http://YOUR_IPV4_ADDRESS:8000
```

## 3. One-Command LAN Startup on Windows

A helper script is included for local LAN demos:

```powershell
.\start_lan_services.ps1
```

It starts:

- frontend at `http://YOUR_IPV4_ADDRESS:8080`
- backend at `http://YOUR_IPV4_ADDRESS:8000`
- ASR service at `http://YOUR_IPV4_ADDRESS:8010`

## 4. ASR Service Setup

```powershell
cd asr_service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

Edit `asr_service/.env`:

```env
QWEN_ASR_API_KEY=your_real_key
QWEN_ASR_REALTIME_URL=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
QWEN_ASR_MODEL=qwen3-asr-flash-realtime
ASR_SAMPLE_RATE=16000
QWEN_ASR_LANGUAGE=zh
```

Start ASR service for local-only use:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --log-level debug
```

Start ASR service for LAN access:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8010 --log-level debug
```

Health check:

```powershell
curl http://127.0.0.1:8010/health
```

## 5. Browser Microphone Note

Browsers only expose `getUserMedia` on secure origins.

Usually OK:

- `http://localhost:8080`
- `http://127.0.0.1:8080`

For LAN HTTP pages such as `http://10.31.97.44:8080`, Chrome/Edge may block microphone access.
Use HTTPS or add the LAN origin in:

```text
chrome://flags/#unsafely-treat-insecure-origin-as-secure
```

Then restart the browser.

## 6. Universal Observe-Act Agent Flow

1. Open the frontend.
2. Keep mode as `Universal Observe-Act Agent`.
3. Set backend URL.
4. Optional: click backend health check.
5. Type a task or use voice input to fill the textarea.
6. Click Send Task.
7. The chat area shows each round's thought, elapsed time, and token usage.
8. A green final message is shown when the task finishes.

The current maximum observe-act rounds is `20`.

## 7. Test Tasks

```text
请选择 P001 张伟，将手机号修改为 13912345678，然后点击保存。
```

```text
请选择 P002 李娜，将就诊科室修改为 消化内科，然后点击保存。
```

```text
请选择 P003 王强，将就诊类型修改为 复诊，然后点击保存。
```

```text
请选择 P004 陈敏，将就诊科室修改为 呼吸内科，将就诊类型修改为 复诊，将主诉/症状描述修改为 咳嗽、胸闷两天，然后点击保存。
```

```text
请选择 P005 赵磊，将手机号修改为 123，然后点击保存，观察页面是否提示手机号格式错误。
```

Voice tolerance example:

```text
选择批零零三王墙，把就诊类型改成付诊，然后保存。
```

## 8. Troubleshooting

### Backend connection failed

Check backend:

```powershell
curl http://127.0.0.1:8000/api/health
```

If another device is using the frontend, use the host machine IPv4 address instead of `127.0.0.1`.

### Qwen call failed

Check `.env` values and run:

```powershell
curl http://127.0.0.1:8000/api/qwen/test
```

If using a self-hosted Qwen service, make sure `DASHSCOPE_BASE_URL` is reachable from the backend machine.

### ASR cannot start

Check ASR service:

```powershell
curl http://127.0.0.1:8010/health
```

If the browser says microphone is unavailable, see the secure-origin note above.

### Port already in use

Find the process:

```powershell
netstat -ano | findstr ":8000 :8010 :8080"
```

Stop only the matching service process, then restart the service.
