# -*- coding: utf-8 -*-
"""Shared ASR response schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AsrHealthResponse(BaseModel):
    ok: bool
    model: str
    device: str
    loaded: bool
    provider: str = ""
    endpoint: str = ""


class TranscriptMessage(BaseModel):
    type: str
    session_id: str = ""
    rawText: str = ""
    normalizedText: str = ""
    message: str = ""
    turns: list[dict] = Field(default_factory=list)
    diarization: dict = Field(default_factory=dict)
