# -*- coding: utf-8 -*-
"""Configuration for the standalone Qwen3-ASR realtime API service."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv(encoding="utf-8-sig", override=True)


@dataclass(frozen=True)
class AsrConfig:
    provider: str = "qwen-asr-realtime-api"
    model_name: str = os.getenv("QWEN_ASR_MODEL", "qwen3-asr-flash-realtime")
    sample_rate: int = int(os.getenv("ASR_SAMPLE_RATE", "16000"))
    api_key: str = os.getenv("QWEN_ASR_API_KEY") or os.getenv("DASHSCOPE_API_KEY", "")
    realtime_base_url: str = os.getenv(
        "QWEN_ASR_REALTIME_URL",
        "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    ).rstrip("/")
    language: str = os.getenv("QWEN_ASR_LANGUAGE", "zh").strip()
    vad_threshold: float = float(os.getenv("QWEN_ASR_VAD_THRESHOLD", "0.0"))
    silence_duration_ms: int = int(os.getenv("QWEN_ASR_SILENCE_DURATION_MS", "400"))
    min_rms: float = float(os.getenv("ASR_MIN_RMS", "0.003"))
    context: str = os.getenv(
        "QWEN_ASR_CONTEXT",
        "GUI agent patient editor. Common patient IDs include P001 P002 P003 P004 P005. "
        "Common fields include phone department visitType insuranceType symptoms remark.",
    )

    @property
    def endpoint(self) -> str:
        return f"{self.realtime_base_url}?model={self.model_name}"


def get_config() -> AsrConfig:
    return AsrConfig()
