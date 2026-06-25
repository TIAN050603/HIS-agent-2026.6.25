# Diart Integration Report

## 目标

新增独立 `diarization_service/`，为 HIS 就诊会话提供本地说话人分离能力，并在 Diart 不可用时明确降级为 manual。

## 端口

- 内部端口：`8020`
- 当前无外部映射，前端通过 backend 代理访问。

## Provider

- `manual`：可用，保留 speaker_id 字段，但不声称自动识别。
- `diart_local`：依赖 Diart、CUDA PyTorch、HF token 和模型下载/授权。

## 音频格式

前端沿用现有 ASR 采集链路：浏览器麦克风 -> AudioContext -> 16kHz mono Float32Array binary chunk。ASR 与 diarization 复用同一份 chunk，不重复申请麦克风。

## 限制

Diart 默认 pyannote 模型需要 Hugging Face token 和模型条款授权。未完成模型下载/预热前，UI 必须显示 manual 或 unavailable，不得显示自动说话人分离成功。

