# -*- coding: utf-8 -*-
"""Standalone Qwen3-ASR service."""

from __future__ import annotations

import os

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .config import get_config
from .model_runtime import AsrRuntime
from .schemas import AsrHealthResponse
from .websocket import asr_websocket_endpoint


config = get_config()
runtime = AsrRuntime(config)

DEFAULT_CORS_ALLOWED_ORIGINS = [
    "https://tian050603.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://10.26.6.8:31875",
    "http://10.26.6.8:31416",
    "http://10.26.6.8:31478",
    "http://10.26.6.8:31139",
]

DEFAULT_CORS_ALLOW_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|10\.26\.6\.8):[0-9]+$"


def parse_cors_allowed_origins(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def get_cors_allowed_origins() -> list[str]:
    configured = parse_cors_allowed_origins(os.getenv("ASR_CORS_ALLOWED_ORIGINS") or os.getenv("CORS_ALLOWED_ORIGINS"))
    seen: set[str] = set()
    result: list[str] = []
    for origin in configured + DEFAULT_CORS_ALLOWED_ORIGINS:
        if origin in seen:
            continue
        seen.add(origin)
        result.append(origin)
    return result


def get_cors_allow_origin_regex() -> str | None:
    value = os.getenv(
        "ASR_CORS_ALLOW_ORIGIN_REGEX",
        os.getenv("CORS_ALLOW_ORIGIN_REGEX", DEFAULT_CORS_ALLOW_ORIGIN_REGEX),
    ).strip()
    return value or None


app = FastAPI(title="GUI Agent ASR Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_allowed_origins(),
    allow_origin_regex=get_cors_allow_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def load_asr_model() -> None:
    runtime.load()


@app.get("/health", response_model=AsrHealthResponse)
def health() -> AsrHealthResponse:
    return AsrHealthResponse(
        ok=runtime.loaded,
        model=config.model_name,
        device="realtime-api",
        loaded=runtime.loaded,
        provider=config.provider,
        endpoint=config.endpoint,
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await asr_websocket_endpoint(websocket, runtime)
