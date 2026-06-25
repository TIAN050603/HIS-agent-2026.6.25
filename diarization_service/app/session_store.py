from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class DiarizationSession:
    session_id: str = field(default_factory=lambda: "dia_" + uuid.uuid4().hex)
    started_at: float = field(default_factory=time.monotonic)
    chunk_count: int = 0
    last_segment_at: float = 0.0
    audio_buffer: Any | None = None
    processed_samples: int = 0

    def elapsed_ms(self) -> int:
        return max(0, int((time.monotonic() - self.started_at) * 1000))
