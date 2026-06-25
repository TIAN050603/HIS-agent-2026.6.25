# Diart Speaker Diarization Integration

## 2026-06-25 Voice Turns To Field Mutation Fix

- Scope: this update did not change ASR, Diart installation, diarization runtime, or the main ASR pipeline.
- The voice session flow still is: doctor/patient final turns -> backend LLM turns-to-task -> editable natural-language task -> doctor confirmation -> existing Agent taskflow.
- The turns-to-task endpoint now asks the LLM to keep a compact structured draft beside the editable text:
  - `result_type`: `explicit_action`, `clinical_draft`, `no_action`, or `needs_clarification`.
  - `task_text`: short natural-language task shown to the doctor.
  - `proposed_fields`: objects such as `{ field: "pastHistory", label: "既往病史", value: "无明确慢性病史" }`.
- Confirmation is still required. The structured draft is only passed as `expected_mutations` into the normal planner/executor after the doctor clicks "执行任务".
- The past-history failure root cause was not Diart or ASR. It was a field schema mismatch: the browser resolver mapped `既往病史` to hidden legacy key `medicalHistory`, while the editor DOM only exposes `[data-field="pastHistory"]`.
- Standard field key: `pastHistory`. Supported aliases now include `既往史`, `既往病史`, `既往病史内容`, `病史`, `past history`, `past medical history`, `medical history`, and `medicalHistory`.
- DOM location: the official patient editor has one visible enabled textarea with `[data-field="pastHistory"]`; no `medicalHistory` control exists in the current page.
- Verification artifacts: `loop-engineering/artifacts/probes/probe_voice_past_history.before.json`, `probe_voice_past_history.after.json`, and `probe_voice_past_history_unique.after.json`.

## 2026-06-22 V2 Voice Boundary Update

当前语音入口拆成两个产品模式：

- 主输入“语音输入”：只用于医生单人任务口述，把 ASR final 文本写入底部 Agent 输入框；不启动 Diart，不生成 doctor/patient turns，不自动发送。
- “就诊会话”：进入 voiceView 后不会自动开麦；只有点击“开始语音任务”才启动麦克风、ASR，以及在 health 明确可用时启动 Diart。
- Diart 不可用、超时或返回 manual 时，UI 只显示手动模式；manual turns 仍可使用，但不能假装 automatic diarization。
- “停止语音任务”、离开就诊会话、关闭悬浮框或新会话时，都必须释放 MediaStream tracks 并关闭本次 ASR/Diart WebSocket。
- “结束对话并整理任务”只把必要 final turns 文本交给 LLM 生成待确认自然语言任务；不直接执行 action，不写 patient-store，不保存。
- 2026-06-24 起，医生确认语音整理任务后会直接进入正式 Agent 执行链路；语音整理不再输出“生成病历草稿等待再次确认”的二次确认任务。

V2 相关前端模块：

- `shared/voice-input-controller.js`：仍负责麦克风、ASR、可选 Diart 和 turns。
- `shared/agent-input-router.js`：把就诊会话整理结果标记为 `voice_session_task`，进入待确认任务文本流程。
- `shared/agent-state-machine.js`：记录 `voice_idle / voice_recording / voice_review / voice_task_draft_ready`。

## 2026-06-23 就诊会话整理任务更新

- 本轮不改 Diart 安装、不改 ASR 主链路、不改变 manual / automatic diarization 判定。
- voiceView 中已有 doctor/patient final turns 后，“结束对话并整理任务”只把必要 turns、当前 patientId / patientName 和 page type 发送给 backend LLM。
- 后端整理结果 `result_type`：
  - `explicit_action`：医生明确要求修改字段、记录病情、打开页面或保存，前端显示可编辑自然语言任务。
  - `no_action`：没有明确操作或可整理内容，只提示继续补充。
  - `needs_clarification`：患者或任务不明确，只提示医生补充。
- 整理阶段不返回页面 action、不写 patient-store、不保存、不写 audit log；点击“执行任务”后才进入现有 Agent taskflow。
- 点击“执行任务”表示医生已确认语音整理任务。后端 planner 会收到 `task_origin=voice_confirmed_task` / `input_route.inputType=voice_session_task`，应直接规划字段更新、病历字段写入和保存，不再生成 `create_structured_draft` 二次确认卡。
- “填入输入框”仍只是文本搬运，不自动执行，也不触发语音整理接口。

## Scope

This iteration adds an independent speaker diarization service beside the existing HIS modules:

- `backend/`: HIS Agent backend and LLM proxy.
- `asr_service/`: existing ASR service; unchanged and still responsible for transcription.
- `diarization_service/`: new independent diarization service.
- `shared/`: browser integration that merges ASR transcript turns with diarization metadata.
- `html/`: formal HIS pages.

The diarization service does not replace ASR, does not execute Agent tasks, and does not write patient data. Natural-language page actions still require the backend LLM path.

## Runtime Mapping

Current verified external URLs:

- Frontend: `http://10.26.6.8:31875`
- Backend: `http://10.26.6.8:31593`
- ASR: `http://10.26.6.8:31478`
- LLM service: `http://10.26.6.8:31893`
- Diarization: proxied through backend because container port `8020` is not externally mapped.

Current internal URLs:

- Backend: `http://127.0.0.1:8000`
- ASR: `http://127.0.0.1:8010`
- Diarization: `http://127.0.0.1:8020`

The browser reads `shared/runtime-config.js`. By default, diarization uses the backend base URL and reaches:

- `GET /diarization/health`
- `WS /ws/diarization`

The backend proxies those requests to the internal `diarization_service`.

## Environment Check

Verified on the current server:

- GPU: two `Tesla V100S-PCIE-32GB`
- NVIDIA driver: `580.65.06`
- CUDA runtime shown by `nvidia-smi`: `13.0`
- Python: `3.10.12`
- System torch: `2.4.0a0+f70bd71a48.nv24.06`
- `torch.cuda.is_available()`: `true`
- System packages installed for this service: `python3.10-venv`, `ffmpeg`, `portaudio19-dev`

## Current Diart Status

Diart now uses a clean independent virtualenv at:

`diarization_service/.venv-diart`

This avoids the system NVIDIA-patched `torch 2.4.0a0` environment and the old `diarization_service/.venv` ABI mismatch.

Installed validation set:

- `torch==2.4.1+cu121`
- `torchaudio==2.4.1+cu121`
- `diart==0.9.2`
- `pyannote.audio==3.3.2`
- `huggingface-hub==0.25.2`

CUDA wheels are now installed in the clean venv. `torch.cuda.is_available()` is true in the service process and `/diarization/health` reports `gpu=true`, `device=cuda`.

What is fixed:

- `torch` and `torchaudio` now import from the clean venv.
- `diart` now imports successfully.
- `SpeakerDiarization()` loads successfully through Diart.
- The `huggingface_hub` compatibility issue was fixed by pinning `<0.26`; Diart 0.9.2 still calls `use_auth_token`.

Current status:

- `diarization_service/.env` exists and the service process has the required token variables available.
- The token values must never be printed, logged, committed, or copied into code.
- Diart model loading succeeds in the running service.

The service truthfully reports:

- `provider: diart_local`
- `status: available`
- `active_provider: diart_local`
- `ok: true`
- `gpu: true`
- `device: cuda`

The provider now emits real Diart speaker segments. It still must not claim automatic doctor/patient role identification; role mapping remains a separate layer.

## Interfaces

Direct service:

- `GET http://127.0.0.1:8020/health`
- `GET http://127.0.0.1:8020/diarization/health`
- `WS ws://127.0.0.1:8020/ws/diarization`

Backend proxy:

- `GET http://127.0.0.1:8000/diarization/health`
- `GET http://127.0.0.1:8000/api/diarization/health`
- `WS ws://127.0.0.1:8000/ws/diarization`

External browser path:

- `GET http://10.26.6.8:31593/diarization/health`
- `WS ws://10.26.6.8:31593/ws/diarization`

## Browser Integration

`shared/voice-input-controller.js` opens ASR and diarization WebSockets independently:

- ASR WebSocket receives audio and returns transcript text.
- Diarization WebSocket receives the same downsampled 16 kHz audio chunks and returns speaker metadata when available.
- If diarization is unavailable, the UI still shows ASR turns and labels speaker metadata as manual/provisional.

No extra microphone prompt is introduced for diarization. The existing microphone stream is shared.

## UI Behavior

The floating Agent voice panel now separates:

- ASR service status
- ASR WebSocket status
- Diarization provider/status
- Diarization WebSocket status
- Browser microphone status

Turns can display speaker metadata such as:

- `speaker_id`
- `source`
- `automatic` versus `manual`
- `final` versus provisional

Manual role correction and simulated visit turns remain available. The UI must not claim true automatic doctor/patient separation until Diart is healthy and emitting real speaker segments.

## Launch

Start the diarization service:

```bash
cd /huaiwenpang/universal_agent
scripts/start_diarization_service.sh
```

The script now prefers `diarization_service/.venv-diart` and falls back to the legacy `.venv` only if the clean venv is absent.

Token injection:

```bash
cat > diarization_service/.env <<'EOF'
HF_TOKEN=...
HUGGINGFACE_TOKEN=...
DIARIZATION_PRELOAD_MODEL=1
EOF
```

Do not commit or print this file.

The service listens on internal port `8020`.

The backend must be running so the browser can access diarization through the backend proxy.

## Verification Performed

Passed:

- `GET /health` on diarization service.
- `GET /diarization/health` through backend proxy.
- Direct WebSocket `/ws/diarization`.
- Backend proxied WebSocket `/ws/diarization`.
- Browser fake-microphone verification opened the current frontend, started the floating Agent voice flow, connected ASR WS and Diarization WS, and received real `source=diart_local`, `automatic=true` speaker segments.
- Example segment shape: `speaker_id=speaker0`, `start_ms=8008`, `end_ms=8508`, `source=diart_local`, `automatic=true`.
- Frontend voice state applied Diart metadata to ASR turns: observed turns included `raw_speaker_id=speaker1` and `source=diart_local`.
- With a deliberately broken diarization URL, ASR WS stayed connected and continued producing transcript turns while diarization fell back to `provider=manual`, `status=disconnected`, and no fake automatic segments were emitted.
- Existing ASR health remained available.
- Existing frontend/backend services remained available.
- `npm run check:encoding`
- Default E2E: `32 passed / 3 skipped`

Resolved in the metadata normalization follow-up:

- In Playwright fake-audio runs, ASR produced continuous `partial` transcripts but no `final` event was observed before/after stop. This is recorded as a test-medium observation, not an ASR code change.
- `normalizeSpeakerId(value)` now normalizes `speaker0`, `speaker1`, `speaker_0`, `speaker_1`, `SPEAKER_0`, and `spk0` into the canonical `speaker_0` / `speaker_1` form.
- Diart turns now preserve `raw_speaker_id`, normalized `speaker_id`, `source=diart_local`, `diarization_source=diart_local`, `automatic=true`, `automatic_diarization=true`, and diarization timing/confidence metadata.
- Empty speaker values normalize to `null` and map to `role=unknown` / `role_label=未确认`, not doctor.
- Default role mapping now runs only after speaker normalization: `speaker_0 -> doctor / 医生`, `speaker_1 -> patient / 患者`.
- Manual role correction and one-click role swap update `role_source` while preserving raw speaker and Diart source metadata.

## Known Limitations

- Diart now emits automatic speaker segments, but doctor/patient role mapping is still the demo default mapping layer, not semantic identification.
- Current default mapping is normalized and deterministic: `speaker_0` to doctor and `speaker_1` to patient.
- LLM semantic correction of doctor/patient roles is not implemented in this round.
- Manual provider fallback remains explicit fallback metadata only; it is not automatic speaker diarization.
- No patient data or audit log is written by diarization.

## Next Steps

1. Implement explicit role mapping UX and later LLM semantic correction. This is separate from ASR and Diart health.
2. Keep observing real microphone sessions for ASR final-event timing; do not change the ASR main chain unless a reproducible ASR issue is isolated.
3. Consider a gated real-stream E2E such as `RUN_DIARIZATION_E2E=1` for longer fake-audio sessions against the live Diart service.

## 2026-06-17 Speaker Metadata Normalization

Changed files:

- `shared/voice-input-controller.js`
- `shared/agent-widget.js`
- `tests/e2e/his-agent.spec.ts`

Verification added:

- `normalizeSpeakerId("speaker0") -> "speaker_0"`
- `normalizeSpeakerId("speaker1") -> "speaker_1"`
- `normalizeSpeakerId("speaker_0") -> "speaker_0"`
- `normalizeSpeakerId("speaker_1") -> "speaker_1"`
- `normalizeSpeakerId("SPEAKER_0") -> "speaker_0"`
- `normalizeSpeakerId("spk0") -> "speaker_0"`
- `normalizeSpeakerId("") -> null`
- `raw_speaker_id=speaker1` becomes `speaker_id=speaker_1`, `role=patient`, `role_label=患者`.
- `raw_speaker_id=speaker0` becomes `speaker_id=speaker_0`, `role=doctor`, `role_label=医生`.
- `source=diart_local`, `diarization_source=diart_local`, `automatic=true`, and `automatic_diarization=true` are preserved on Diart-backed turns.
- Diart-unavailable/manual fallback keeps `automatic_diarization=false` and does not claim `diart_local`.

## 2026-06-22 LLM task drafting UI follow-up

- This follow-up does not change Diart installation, model files, WebSocket protocol, or the ASR main chain.
- The visit-session button is now clickable whenever at least one final doctor/patient turn exists. On click, the widget refreshes LLM status first; if LLM is unavailable, it shows an error and does not call the task-drafting endpoint.
- Diart/manual truthfulness remains unchanged: manual turns are usable, but they are not presented as automatic diarization.
- The task-drafting request still sends only minimal doctor/patient final turns plus lightweight patient/page context; it does not send raw Diart debug JSON, raw ASR payloads, full pageState, full patient-store, task history, or action JSON.
- The returned text is only a doctor-confirmable natural-language Agent task. No page action is executed until the doctor edits/confirms and clicks execute.

## 2026-06-22 语音 turns 到 Agent 任务的安全边界

- 新增“结束对话并整理任务”按钮后，Diart 仍只负责说话人分段和 metadata；本轮未修改 Diart 安装、模型、WebSocket 或 ASR 主链路。
- Diart unavailable 时仍可使用 manual turns；UI 不会把 manual turns 标记为 automatic diarization。
- 整理任务时前端只发送 doctor/patient final turns 的 role、role_label、text、is_final，以及当前 patientId / patientName / pageType。
- 不发送 raw Diart debug、raw ASR、完整 pageState、完整 patient-store、任务历史或 action JSON。
- LLM 在该步骤只返回一条简短自然语言任务；不会直接返回页面 action，也不会修改 patient-store 或保存。
- 医生确认前不会进入 Agent taskflow；点击“执行任务”后才走现有 backend planner 和 allowlist executor。

## 2026-06-25 Final Verification Note

- 本轮未修改 Diart 安装、模型文件、ASR 主链路或 WebSocket 协议。
- voiceView 仍可在 Diart 不可用时使用 manual turns，但 UI 不会把 manual turns 标记为 automatic diarization。
- `RUN_LLM_E2E=1` 全量套件已覆盖 voice turns -> editable task -> existing Agent taskflow，并通过 `75 / 0 / 1`。
- full loop iteration-038 已覆盖 voice task confirmation cases，结果 `29 / 0 / 0`。
- 当前强制刷新 URL：`http://10.26.6.8:31684/html/login.html?v=20260625-final-loop`。
