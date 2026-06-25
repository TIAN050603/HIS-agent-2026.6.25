# Diarization Service

独立说话人分离服务，位于 `diarization_service/`，与 `backend/`、`asr_service/`、`shared/`、`html/` 并列。

## 启动

```bash
scripts/start_diarization_service.sh
```

默认内部端口：

```text
DIARIZATION_HOST=0.0.0.0
DIARIZATION_PORT=8020
```

日志：

```text
logs/diarization.log
```

## 接口

- `GET /health`
- `GET /diarization/health`
- `WebSocket /ws/diarization`

当前前端默认通过 backend 代理访问 diarization，因为容器平台暂未给 `8020` 配外部映射。

## Diart 说明

Diart 默认使用 pyannote/Hugging Face 模型，需要：

- CUDA PyTorch
- `HF_TOKEN` 或 `HUGGINGFACE_TOKEN`
- 接受相关 pyannote 模型条款
- 系统音频依赖按 Diart 官方说明配置

如果依赖、token、模型下载或端口不可用，服务会明确降级为 `manual`，不会伪装成自动说话人分离。

