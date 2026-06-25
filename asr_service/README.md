# Qwen3-ASR Realtime API Service

This standalone service bridges the browser microphone WebSocket to the
Qwen3-ASR realtime WebSocket API.

Data flow:

1. Browser captures microphone audio.
2. `voice_client/voice_asr_client.js` sends 16 kHz Float32 PCM chunks to
   `ws://127.0.0.1:8010/ws`.
3. `asr_service` converts the chunks to PCM16 and forwards them to
   Qwen3-ASR realtime API.
4. Qwen partial/final transcript events are returned to the browser.
5. The browser fills the existing Universal Agent task input box.

The ASR service only converts speech to text. It does not execute Universal
Agent tasks and does not modify the patient form.

## Configuration

Create `asr_service/.env` from `.env.example` and fill in your real key:

```text
QWEN_ASR_API_KEY=your_real_key
QWEN_ASR_REALTIME_URL=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
QWEN_ASR_MODEL=qwen3-asr-flash-realtime
ASR_SAMPLE_RATE=16000
QWEN_ASR_LANGUAGE=zh
QWEN_ASR_VAD_THRESHOLD=0.0
QWEN_ASR_SILENCE_DURATION_MS=400
```

You can also reuse `DASHSCOPE_API_KEY` if it is already configured.

## Start

```powershell
cd C:\Users\16527\Desktop\gui-agent-patient-editor-test\asr_service
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --log-level debug
```

## Endpoints

`GET /health`

```json
{
  "ok": true,
  "model": "qwen3-asr-flash-realtime",
  "device": "realtime-api",
  "loaded": true,
  "provider": "qwen-asr-realtime-api",
  "endpoint": "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"
}
```

`WebSocket /ws`

Browser sends 16 kHz Float32 PCM chunks.

Partial transcript:

```json
{
  "type": "partial",
  "rawText": "...",
  "normalizedText": "..."
}
```

Final transcript:

```json
{
  "type": "final",
  "rawText": "...",
  "normalizedText": "..."
}
```
