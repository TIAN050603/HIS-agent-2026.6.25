from __future__ import annotations

from ..schemas import DiarizationHealth, SpeakerSegment
from ..session_store import DiarizationSession
from .base import BaseDiarizationProvider


class ManualProvider(BaseDiarizationProvider):
    provider = "manual"

    def __init__(self, reason: str = "Diart 未启用，使用手动说话人映射。") -> None:
        self.reason = reason

    def health(self) -> DiarizationHealth:
        return DiarizationHealth(
            ok=True,
            provider="manual",
            active_provider="manual",
            status="available",
            gpu=False,
            device="manual",
            needs_hf_token=False,
            message=self.reason,
        )

    async def accept_audio(self, session: DiarizationSession, chunk: bytes) -> SpeakerSegment | None:
        session.chunk_count += 1
        # Manual mode deliberately does not claim automatic diarization. It emits a
        # provisional default speaker only so the UI can keep speaker_id fields.
        if session.chunk_count % 8 != 1:
            return None
        elapsed = session.elapsed_ms()
        return SpeakerSegment(
            session_id=session.session_id,
            speaker_id="speaker_0",
            start_ms=max(0, elapsed - 1000),
            end_ms=elapsed,
            confidence=None,
            is_final=False,
            source="manual",
            automatic=False,
            status="manual",
        )

