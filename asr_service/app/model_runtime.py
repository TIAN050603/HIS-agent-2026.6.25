# -*- coding: utf-8 -*-
"""Qwen3-ASR realtime runtime state."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .config import AsrConfig


@dataclass
class StreamingSession:
    session_id: str = field(default_factory=lambda: "asr_" + uuid.uuid4().hex)
    started_at: float = field(default_factory=time.monotonic)
    last_text: str = ""
    final_text: str = ""
    final_sent: bool = False
    sent_audio_chunks: int = 0
    turns: list[dict[str, Any]] = field(default_factory=list)


class AsrRuntime:
    def __init__(self, config: AsrConfig) -> None:
        self.config = config
        self.loaded = False

    def load(self) -> None:
        self.loaded = bool(self.config.api_key)

    def create_session(self) -> StreamingSession:
        self.ensure_loaded()
        return StreamingSession()

    def ensure_loaded(self) -> None:
        if not self.loaded:
            self.load()
        if not self.loaded:
            raise RuntimeError("未配置 QWEN_ASR_API_KEY 或 DASHSCOPE_API_KEY。")
