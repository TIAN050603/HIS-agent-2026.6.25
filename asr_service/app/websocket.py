# -*- coding: utf-8 -*-
"""ASR WebSocket endpoint backed by Qwen3-ASR realtime API."""

from __future__ import annotations

import asyncio
import base64
from contextlib import suppress
import json
import time
import uuid

import numpy as np
import websockets
from fastapi import WebSocket, WebSocketDisconnect

from .model_runtime import AsrRuntime, StreamingSession
from .transcript_postprocess import normalize_transcript


async def asr_websocket_endpoint(websocket: WebSocket, runtime: AsrRuntime) -> None:
    await websocket.accept()

    try:
        session = runtime.create_session()
        async with websockets.connect(
            runtime.config.endpoint,
            additional_headers={
                "Authorization": f"Bearer {runtime.config.api_key}",
                "OpenAI-Beta": "realtime=v1",
            },
            max_size=8 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        ) as qwen_ws:
            await configure_qwen_session(qwen_ws, runtime)
            receiver_task = asyncio.create_task(receive_qwen_events(websocket, qwen_ws, session))
            try:
                await forward_browser_audio(websocket, qwen_ws, session, runtime)
                await asyncio.wait_for(receiver_task, timeout=20)
            except asyncio.TimeoutError:
                if not session.final_sent:
                    await send_transcript(websocket, "final", session.final_text or session.last_text, session)
            finally:
                if not receiver_task.done():
                    receiver_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await receiver_task
    except WebSocketDisconnect:
        return
    except RuntimeError as exc:
        if "disconnect" in str(exc).lower() or "websocket.close" in str(exc).lower():
            return
        await safe_send_json(websocket, {"type": "error", "message": str(exc)})
    except Exception as exc:
        await safe_send_json(websocket, {"type": "error", "message": str(exc)})


async def configure_qwen_session(qwen_ws, runtime: AsrRuntime) -> None:
    await qwen_ws.send(
        json.dumps(
            {
                "event_id": event_id(),
                "type": "session.update",
                "session": {
                    "input_audio_format": "pcm",
                    "sample_rate": runtime.config.sample_rate,
                    "input_audio_transcription": {
                        "language": runtime.config.language,
                        "corpus": {"text": runtime.config.context},
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": runtime.config.vad_threshold,
                        "silence_duration_ms": runtime.config.silence_duration_ms,
                    },
                },
            },
            ensure_ascii=False,
        )
    )


async def forward_browser_audio(websocket: WebSocket, qwen_ws, session: StreamingSession, runtime: AsrRuntime) -> None:
    while True:
        try:
            message = await websocket.receive()
        except RuntimeError as exc:
            if "disconnect" in str(exc).lower():
                raise WebSocketDisconnect()
            raise

        if "text" in message and message["text"] is not None:
            data = parse_control_message(message["text"])
            if data.get("type") == "end":
                if session.sent_audio_chunks == 0:
                    await send_transcript(websocket, "final", "", session)
                    return
                await qwen_ws.send(json.dumps({"event_id": event_id(), "type": "session.finish"}))
                return
            if data.get("type") == "ping":
                await safe_send_json(websocket, {"type": "pong"})
            continue

        audio = message.get("bytes")
        if audio:
            pcm16 = float32_bytes_to_pcm16(audio, min_rms=runtime.config.min_rms)
            if pcm16:
                session.sent_audio_chunks += 1
                await qwen_ws.send(
                    json.dumps(
                        {
                            "event_id": event_id(),
                            "type": "input_audio_buffer.append",
                            "audio": base64.b64encode(pcm16).decode("ascii"),
                        }
                    )
                )


async def receive_qwen_events(websocket: WebSocket, qwen_ws, session: StreamingSession) -> None:
    async for raw_message in qwen_ws:
        event = json.loads(raw_message)
        event_type = event.get("type")

        if event_type == "error":
            message = ((event.get("error") or {}).get("message")) or raw_message
            await safe_send_json(websocket, {"type": "error", "message": message})
            continue

        if event_type == "conversation.item.input_audio_transcription.text":
            current = (event.get("text") or "") + (event.get("stash") or "")
            text = merge_transcript(session.final_text, current)
            if text:
                session.last_text = text
                await send_transcript(websocket, "partial", text, session)
            continue

        if event_type == "conversation.item.input_audio_transcription.completed":
            transcript = event.get("transcript") or ""
            if transcript:
                session.final_text = merge_transcript(session.final_text, transcript)
                session.last_text = session.final_text
                await send_transcript(websocket, "partial", session.final_text, session)
            continue

        if event_type == "session.finished":
            if not session.final_sent:
                await send_transcript(websocket, "final", session.final_text or session.last_text, session)
                session.final_sent = True
            return


async def send_transcript(websocket: WebSocket, message_type: str, raw_text: str, session: StreamingSession) -> None:
    turns = build_structured_turns(session, raw_text, message_type == "final")
    await safe_send_json(
        websocket,
        {
            "type": message_type,
            "session_id": session.session_id,
            "rawText": raw_text,
            "normalizedText": normalize_transcript(raw_text),
            "turns": turns,
            "diarization": {
                "supported": False,
                "mode": "text_only_default_role",
                "note": "当前 Qwen3-ASR realtime 集成只返回转写文本，未确认返回 speaker_id/channel_id；这里不伪造自动说话人区分。",
            },
        },
    )


def build_structured_turns(session: StreamingSession, raw_text: str, is_final: bool) -> list[dict]:
    normalized = normalize_transcript(raw_text)
    elapsed_ms = max(0, int((time.monotonic() - session.started_at) * 1000))
    # 当前 demo 固定为医生/患者两人角色，后续可能修改为更多说话人或自定义角色。
    # 当前 Qwen3-ASR realtime 代码路径没有 speaker_id/channel_id 事件，因此这里不声称自动 diarization。
    turn = {
        "turn_id": f"{session.session_id}_turn_0",
        "raw_speaker_id": "speaker_0",
        "role": "doctor",
        "role_label": "医生",
        "text": normalized,
        "start_ms": 0,
        "end_ms": elapsed_ms,
        "is_final": is_final,
        "confidence": None,
        "source": "asr_text_only_default_role",
    }
    if normalized:
        existing_index = next((index for index, item in enumerate(session.turns) if item.get("turn_id") == turn["turn_id"]), -1)
        if existing_index >= 0:
            session.turns[existing_index] = turn
        else:
            session.turns.append(turn)
    return session.turns


async def safe_send_json(websocket: WebSocket, payload: dict) -> None:
    try:
        await websocket.send_json(payload)
    except RuntimeError:
        pass


def parse_control_message(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"type": text}


def float32_bytes_to_pcm16(audio_chunk: bytes, min_rms: float) -> bytes:
    floats = np.frombuffer(audio_chunk, dtype=np.float32)
    if floats.size == 0:
        return b""
    rms = float(np.sqrt(np.mean(np.square(floats))))
    if rms < min_rms:
        return b""
    clipped = np.clip(floats, -1.0, 1.0)
    return (clipped * 32767).astype("<i2").tobytes()


def event_id() -> str:
    return f"event_{uuid.uuid4().hex}"


def merge_transcript(prefix: str, current: str) -> str:
    prefix = prefix or ""
    current = current or ""
    if not prefix:
        return current
    if not current:
        return prefix
    if current.startswith(prefix):
        return current
    if prefix.endswith(current):
        return prefix
    return prefix + current
