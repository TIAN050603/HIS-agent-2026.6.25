from __future__ import annotations

import json
import os
from contextlib import suppress

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .providers import DiartProvider, ManualProvider
from .schemas import DiarizationHealth
from .session_store import DiarizationSession


DEFAULT_CORS_ALLOW_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|10\.26\.6\.8):[0-9]+$"


def parse_origins(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def create_provider():
    diart_provider = DiartProvider()
    health = diart_provider.health()
    if health.ok and health.active_provider == "diart_local":
        return diart_provider, health
    manual = ManualProvider(health.message or "Diart unavailable; manual metadata only.")
    return manual, health


provider, diart_health = create_provider()

app = FastAPI(title="HIS Diarization Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_origins(os.getenv("DIARIZATION_CORS_ALLOWED_ORIGINS") or os.getenv("CORS_ALLOWED_ORIGINS")),
    allow_origin_regex=os.getenv("DIARIZATION_CORS_ALLOW_ORIGIN_REGEX", DEFAULT_CORS_ALLOW_ORIGIN_REGEX),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def health_payload() -> DiarizationHealth:
    active = provider.health()
    if active.provider == "manual" and diart_health.provider == "diart_local":
        return diart_health
    return active


@app.get("/health", response_model=DiarizationHealth)
def health() -> DiarizationHealth:
    return health_payload()


@app.get("/diarization/health", response_model=DiarizationHealth)
def diarization_health() -> DiarizationHealth:
    return health_payload()


@app.websocket("/ws/diarization")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    session = DiarizationSession()
    await websocket.send_json(await provider.start_session(session))
    try:
        while True:
            message = await websocket.receive()
            if message.get("text") is not None:
                control = parse_control_message(message["text"])
                if control.get("type") == "end":
                    await websocket.send_json(await provider.finish_session(session))
                    return
                if control.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "session_id": session.session_id})
                continue
            chunk = message.get("bytes")
            if not chunk:
                continue
            segment = await provider.accept_audio(session, chunk)
            if segment:
                await websocket.send_json(segment.dict())
    except WebSocketDisconnect:
        return
    except Exception as exc:
        with suppress(RuntimeError):
            await websocket.send_json({"type": "error", "session_id": session.session_id, "message": str(exc)})


def parse_control_message(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:
        return {"type": text}
