from __future__ import annotations

import os
from typing import Any

from ..schemas import DiarizationHealth, SpeakerSegment
from ..session_store import DiarizationSession
from .base import BaseDiarizationProvider


class DiartProvider(BaseDiarizationProvider):
    provider = "diart_local"

    def __init__(self) -> None:
        self.pipeline: Any | None = None
        self.sample_rate = 16000
        self.chunk_samples = 0
        self.step_samples = 0
        self._health = self._probe_health()

    def _probe_health(self) -> DiarizationHealth:
        token_present = bool(os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN"))
        allow_cpu = os.getenv("DIARIZATION_ALLOW_CPU") == "1"

        try:
            import torch  # type: ignore
            import torchaudio  # noqa: F401  # type: ignore
        except OSError as exc:
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status="unavailable_torch_audio_abi",
                active_provider="manual",
                needs_hf_token=not token_present,
                message=f"torch/torchaudio ABI error: {type(exc).__name__}: {exc}",
            )
        except Exception as exc:
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status="unavailable_dependency",
                active_provider="manual",
                needs_hf_token=not token_present,
                message=f"PyTorch or torchaudio unavailable: {type(exc).__name__}: {exc}",
            )

        gpu = bool(torch.cuda.is_available())
        device = torch.cuda.get_device_name(0) if gpu else "cpu"

        try:
            import diart  # noqa: F401  # type: ignore
        except Exception as exc:
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status="unavailable_dependency",
                active_provider="manual",
                gpu=gpu,
                device=device,
                needs_hf_token=not token_present,
                message=f"diart import failed: {type(exc).__name__}: {exc}",
            )

        if not token_present:
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status="unavailable_missing_token",
                active_provider="manual",
                gpu=gpu,
                device=device,
                needs_hf_token=True,
                message="HF_TOKEN/HUGGINGFACE_TOKEN is required for pyannote-backed Diart models.",
            )

        if not gpu and not allow_cpu:
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status="unavailable_gpu",
                active_provider="manual",
                gpu=False,
                device=device,
                needs_hf_token=False,
                message="CUDA is unavailable. Set DIARIZATION_ALLOW_CPU=1 for slow CPU validation.",
            )

        if os.getenv("DIARIZATION_PRELOAD_MODEL") != "1":
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status="unavailable_model_download_failed",
                active_provider="manual",
                gpu=gpu,
                device=device,
                needs_hf_token=False,
                message="Dependencies and token are present, but DIARIZATION_PRELOAD_MODEL=1 is not set.",
            )

        try:
            from diart import SpeakerDiarization  # type: ignore

            self.pipeline = SpeakerDiarization()
            self.sample_rate = int(self.pipeline.config.sample_rate)
            self.chunk_samples = int(round(float(self.pipeline.config.duration) * self.sample_rate))
            self.step_samples = max(1, int(round(float(self.pipeline.config.step) * self.sample_rate)))
            return DiarizationHealth(
                ok=True,
                provider="diart_local",
                status="available",
                active_provider="diart_local",
                gpu=gpu,
                device=str(self.pipeline.config.device),
                needs_hf_token=False,
                message="Diart pipeline loaded.",
            )
        except Exception as exc:
            return DiarizationHealth(
                ok=False,
                provider="diart_local",
                status=self._classify_model_error(exc),
                active_provider="manual",
                gpu=gpu,
                device=device,
                needs_hf_token="token" in str(exc).lower(),
                message=f"Diart model load failed: {type(exc).__name__}: {exc}",
            )

    def _classify_model_error(self, exc: Exception) -> str:
        text = f"{type(exc).__name__}: {exc}".lower()
        if "token" in text or "gated" in text or "401" in text or "403" in text:
            return "unavailable_missing_token"
        if "abi" in text or "undefined symbol" in text or "libtorchaudio" in text:
            return "unavailable_torch_audio_abi"
        if "download" in text or "connection" in text or "not found" in text:
            return "unavailable_model_download_failed"
        return "error"

    def health(self) -> DiarizationHealth:
        return self._health

    async def accept_audio(self, session: DiarizationSession, chunk: bytes) -> SpeakerSegment | None:
        session.chunk_count += 1
        if not self._health.ok or self.pipeline is None:
            return None

        samples = self._decode_audio(chunk)
        if samples.size == 0:
            return None

        import numpy as np
        from pyannote.core import SlidingWindow, SlidingWindowFeature

        if session.audio_buffer is None:
            session.audio_buffer = samples
        else:
            session.audio_buffer = np.concatenate([session.audio_buffer, samples])

        if session.audio_buffer.shape[0] < self.chunk_samples:
            return None

        window_samples = session.audio_buffer[: self.chunk_samples]
        session.audio_buffer = session.audio_buffer[self.step_samples :]
        start_seconds = session.processed_samples / float(self.sample_rate)
        session.processed_samples += self.step_samples

        feature = SlidingWindowFeature(
            window_samples.reshape(-1, 1),
            SlidingWindow(start=start_seconds, duration=1.0 / self.sample_rate, step=1.0 / self.sample_rate),
        )
        outputs = self.pipeline([feature])
        if not outputs:
            return None

        annotation, _ = outputs[-1]
        for segment, _track, speaker in annotation.itertracks(yield_label=True):
            return SpeakerSegment(
                session_id=session.session_id,
                speaker_id=str(speaker),
                start_ms=max(0, int(round(segment.start * 1000))),
                end_ms=max(0, int(round(segment.end * 1000))),
                confidence=None,
                is_final=False,
                source="diart_local",
                automatic=True,
                status="available",
            )
        return None

    def _decode_audio(self, chunk: bytes):
        import numpy as np

        if not chunk:
            return np.array([], dtype=np.float32)
        if len(chunk) % 4 == 0:
            data = np.frombuffer(chunk, dtype=np.float32)
            if data.size and np.isfinite(data).all() and float(np.max(np.abs(data))) <= 8.0:
                return np.clip(data.astype(np.float32), -1.0, 1.0)
        if len(chunk) % 2 == 0:
            data = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
            return np.clip(data, -1.0, 1.0)
        return np.array([], dtype=np.float32)
