from __future__ import annotations

from pydantic import BaseModel, Field


class DiarizationHealth(BaseModel):
    ok: bool
    service: str = "diarization_service"
    provider: str
    status: str
    active_provider: str = "manual"
    gpu: bool = False
    device: str = "no cuda"
    num_speakers: int = 2
    needs_hf_token: bool = False
    message: str = ""


class SpeakerSegment(BaseModel):
    type: str = "speaker_segment"
    session_id: str
    speaker_id: str = "speaker_0"
    start_ms: int = 0
    end_ms: int = 0
    confidence: float | None = None
    is_final: bool = False
    source: str = "manual"
    automatic: bool = False
    status: str = "manual"


class SessionEvent(BaseModel):
    type: str
    session_id: str
    provider: str
    status: str
    message: str = ""
    details: dict = Field(default_factory=dict)

