from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..schemas import DiarizationHealth, SpeakerSegment
from ..session_store import DiarizationSession


class BaseDiarizationProvider(ABC):
    provider = "manual"

    @abstractmethod
    def health(self) -> DiarizationHealth:
        raise NotImplementedError

    async def start_session(self, session: DiarizationSession) -> dict[str, Any]:
        return {
            "type": "session_started",
            "session_id": session.session_id,
            "provider": self.health().provider,
            "status": self.health().status,
        }

    @abstractmethod
    async def accept_audio(self, session: DiarizationSession, chunk: bytes) -> SpeakerSegment | None:
        raise NotImplementedError

    async def finish_session(self, session: DiarizationSession) -> dict[str, Any]:
        return {
            "type": "session_finished",
            "session_id": session.session_id,
            "provider": self.health().provider,
            "status": self.health().status,
        }

