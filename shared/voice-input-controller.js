(function () {
  "use strict";

  const SERVICE_URLS = window.HisRuntimeConfig && window.HisRuntimeConfig.serviceUrls
    ? window.HisRuntimeConfig.serviceUrls()
    : {};
  const DEFAULT_ASR_URL = SERVICE_URLS.asrUrl || "";
  const DEFAULT_DIARIZATION_URL = SERVICE_URLS.diarizationUrl || SERVICE_URLS.backendUrl || "";
  const MICROPHONE_POLICY_KEY = "his_voice_microphone_policy";
  const listeners = new Set();

  const state = {
    voiceSupported: Boolean(getUserMediaFunction()),
    secureContext: Boolean(window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1"),
    permissionState: "unknown",
    microphonePermission: "unknown",
    microphoneStatus: "unknown",
    microphonePolicy: readMicrophonePolicy(),
    voiceInputStatus: "idle",
    asrStatus: "unknown",
    asrHealthUrl: "",
    diarizationStatus: "unknown",
    diarizationProvider: "manual",
    diarizationHealthUrl: "",
    diarizationWebSocketUrl: "",
    diarizationWebSocketStatus: "idle",
    diarizationLastError: "",
    llmStatus: "unknown",
    recording: false,
    asrWebSocketStatus: "idle",
    didCallGetUserMedia: false,
    getUserMediaCalledAt: "",
    audioContextState: "",
    streamTrackCount: 0,
    lastVoiceError: "",
    lastVoiceErrorName: "",
    lastVoiceErrorMessage: "",
    lastCheckedAt: "",
    message: "",
    transcript: "",
    turns: [],
    diarizationSegments: []
  };

  const runtime = {
    websocket: null,
    diarizationWebSocket: null,
    mediaStream: null,
    audioContext: null,
    source: null,
    processor: null,
    sessionId: "voice_" + Date.now().toString(36),
    turnCounter: 0,
    partialTurnId: "",
    finalTurnSignatures: []
  };

  function subscribe(callback) {
    listeners.add(callback);
    callback(getState());
    return function () { listeners.delete(callback); };
  }

  function emit(patch) {
    Object.assign(state, patch || {});
    updateVoiceDebug();
    listeners.forEach(function (callback) {
      try { callback(getState()); } catch (error) { console.warn("voice listener failed", error); }
    });
  }

  function getState() {
    return {
      voiceSupported: state.voiceSupported,
      secureContext: state.secureContext,
      permissionState: state.permissionState,
      microphonePermission: state.microphonePermission,
      microphoneStatus: state.microphoneStatus,
      microphonePolicy: state.microphonePolicy,
      voiceInputStatus: state.voiceInputStatus,
      asrStatus: state.asrStatus,
      asrHealthUrl: state.asrHealthUrl,
      diarizationStatus: state.diarizationStatus,
      diarizationProvider: state.diarizationProvider,
      diarizationHealthUrl: state.diarizationHealthUrl,
      diarizationWebSocketUrl: state.diarizationWebSocketUrl,
      diarizationWebSocketStatus: state.diarizationWebSocketStatus,
      diarizationLastError: state.diarizationLastError,
      llmStatus: state.llmStatus,
      recording: state.recording,
      asrWebSocketStatus: state.asrWebSocketStatus,
      didCallGetUserMedia: state.didCallGetUserMedia,
      getUserMediaCalledAt: state.getUserMediaCalledAt,
      audioContextState: state.audioContextState,
      streamTrackCount: state.streamTrackCount,
      lastVoiceError: state.lastVoiceError,
      lastVoiceErrorName: state.lastVoiceErrorName,
      lastVoiceErrorMessage: state.lastVoiceErrorMessage,
      lastCheckedAt: state.lastCheckedAt,
      message: state.message,
      transcript: state.transcript,
      turns: state.turns.slice(),
      diarizationSegments: state.diarizationSegments.slice()
    };
  }

  async function checkStatus(options) {
    const settings = options || {};
    const asrUrl = (settings.asrUrl || DEFAULT_ASR_URL).replace(/\/+$/, "");
    const diarizationUrl = (settings.diarizationUrl || DEFAULT_DIARIZATION_URL).replace(/\/+$/, "");
    const asrHealthUrl = asrUrl + "/health";
    const diarizationHealthUrl = diarizationUrl + "/diarization/health";
    const capabilities = getBrowserCapabilities();
    const permission = await queryMicrophonePermission();
    const asrStatus = await checkAsrHealth(asrHealthUrl);
    const diarization = await checkDiarizationHealth(diarizationHealthUrl);
    const microphoneStatus = detectMicrophoneStatus(permission, capabilities);
    const voiceInputStatus = canAttemptMicrophone(capabilities, microphoneStatus) ? "idle" : "blocked_by_browser";
    const message = buildMessage({ microphonePermission: permission, microphoneStatus: microphoneStatus, asrStatus: asrStatus, llmStatus: settings.llmStatus || state.llmStatus });
    emit({
      voiceSupported: capabilities.hasGetUserMedia,
      secureContext: capabilities.isSecureContext,
      permissionState: permission,
      microphonePermission: permission,
      microphoneStatus: microphoneStatus,
      voiceInputStatus: voiceInputStatus,
      asrWebSocketStatus: "idle",
      asrStatus: asrStatus,
      asrHealthUrl: asrHealthUrl,
      diarizationStatus: diarization.status,
      diarizationProvider: diarization.provider,
      diarizationHealthUrl: diarizationHealthUrl,
      diarizationWebSocketUrl: toDiarizationWebSocketUrl(diarizationUrl),
      diarizationWebSocketStatus: "idle",
      diarizationLastError: diarization.message || "",
      llmStatus: settings.llmStatus || state.llmStatus,
      message: state.message || "点击语音输入后将请求浏览器麦克风权限。",
      lastVoiceError: "",
      lastVoiceErrorName: "",
      lastVoiceErrorMessage: ""
    });
    return getState();
  }

  async function checkMicrophonePermission(options) {
    const settings = options || {};
    const asrUrl = (settings.asrUrl || DEFAULT_ASR_URL).replace(/\/+$/, "");
    const diarizationUrl = (settings.diarizationUrl || DEFAULT_DIARIZATION_URL).replace(/\/+$/, "");
    const asrHealthUrl = asrUrl + "/health";
    const diarizationHealthUrl = diarizationUrl + "/diarization/health";
    const capabilities = getBrowserCapabilities();
    const permission = await queryMicrophonePermission();
    const asrStatus = await checkAsrHealth(asrHealthUrl);
    const diarization = await checkDiarizationHealth(diarizationHealthUrl);
    emit({
      voiceSupported: capabilities.hasGetUserMedia,
      secureContext: capabilities.isSecureContext,
      permissionState: permission,
      microphonePermission: permission,
      microphoneStatus: "checking",
      voiceInputStatus: "checking",
      asrStatus: asrStatus,
      asrHealthUrl: asrHealthUrl,
      diarizationStatus: diarization.status,
      diarizationProvider: diarization.provider,
      diarizationHealthUrl: diarizationHealthUrl,
      diarizationWebSocketUrl: toDiarizationWebSocketUrl(diarizationUrl),
      diarizationWebSocketStatus: state.diarizationWebSocketStatus || "idle",
      diarizationLastError: diarization.message || "",
      asrWebSocketStatus: state.asrWebSocketStatus || "idle",
      llmStatus: settings.llmStatus || state.llmStatus,
      didCallGetUserMedia: false,
      getUserMediaCalledAt: "",
      audioContextState: "",
      streamTrackCount: 0,
      lastVoiceError: "",
      lastVoiceErrorName: "",
      lastVoiceErrorMessage: "",
      lastCheckedAt: new Date().toISOString(),
      message: "正在请求麦克风权限..."
    });

    if (!capabilities.hasGetUserMedia) {
      emit({
        microphoneStatus: "unavailable_api",
        voiceInputStatus: "blocked_by_browser",
        lastVoiceError: "getUserMedia_unavailable",
        lastVoiceErrorName: "getUserMedia_unavailable",
        lastVoiceErrorMessage: "getUserMedia is not exposed in this browser context",
        message: microphoneGuidance("unavailable_api", capabilities)
      });
      return getState();
    }

    let stream = null;
    try {
      emit({
        didCallGetUserMedia: true,
        getUserMediaCalledAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString()
      });
      stream = await requestUserMedia({ audio: true });
      if (stream && stream.getTracks) {
        stream.getTracks().forEach(function (track) { track.stop(); });
      }
      emit({
        permissionState: "granted",
        microphonePermission: "granted",
        microphoneStatus: "available",
        voiceInputStatus: "idle",
        lastVoiceError: "",
        lastVoiceErrorName: "",
        lastVoiceErrorMessage: "",
        lastCheckedAt: new Date().toISOString(),
        streamTrackCount: 0,
        message: "麦克风权限已授予。点击语音输入即可开始录音。"
      });
      return getState();
    } catch (error) {
      if (stream && stream.getTracks) {
        stream.getTracks().forEach(function (track) { track.stop(); });
      }
      emit(Object.assign({
        asrStatus: asrStatus,
        asrHealthUrl: asrHealthUrl,
        diarizationStatus: diarization.status,
        diarizationProvider: diarization.provider,
        diarizationHealthUrl: diarizationHealthUrl,
        diarizationWebSocketUrl: toDiarizationWebSocketUrl(diarizationUrl),
        asrWebSocketStatus: state.asrWebSocketStatus || "idle",
        lastCheckedAt: new Date().toISOString()
      }, normalizeMicrophoneError(error, capabilities)));
      return getState();
    }
  }

  async function toggle(options) {
    if (state.recording) return stop();
    return start(options || {});
  }

  async function start(options) {
    const settings = options || {};
    const useDiarization = settings.enableDiarization !== false && settings.mode !== "dictation";
    runtime.sessionId = "voice_" + Date.now().toString(36);
    runtime.turnCounter = 0;
    runtime.partialTurnId = "";
    runtime.finalTurnSignatures = [];
    const asrUrl = (settings.asrUrl || DEFAULT_ASR_URL).replace(/\/+$/, "");
    const diarizationUrl = (settings.diarizationUrl || DEFAULT_DIARIZATION_URL).replace(/\/+$/, "");
    const asrHealthUrl = asrUrl + "/health";
    const diarizationHealthUrl = diarizationUrl + "/diarization/health";
    const asrStatus = await checkAsrHealth(asrHealthUrl);
    const diarization = useDiarization
      ? await checkDiarizationHealth(diarizationHealthUrl)
      : { status: "disabled", provider: "disabled", message: "dictation mode" };
    const capabilities = getBrowserCapabilities();
    emit({
      voiceSupported: capabilities.hasGetUserMedia,
      secureContext: capabilities.isSecureContext,
      llmStatus: settings.llmStatus || state.llmStatus,
      asrStatus: asrStatus,
      asrHealthUrl: asrHealthUrl,
      diarizationStatus: diarization.status,
      diarizationProvider: diarization.provider,
      diarizationHealthUrl: diarizationHealthUrl,
      diarizationWebSocketUrl: useDiarization ? toDiarizationWebSocketUrl(diarizationUrl) : "",
      diarizationWebSocketStatus: "idle",
      diarizationLastError: diarization.message || "",
      asrWebSocketStatus: "idle",
      didCallGetUserMedia: false,
      getUserMediaCalledAt: "",
      audioContextState: "",
      streamTrackCount: 0
    });

    if (asrStatus !== "connected") {
      emit({
        message: "ASR 服务未连接，当前无法进行语音转写。麦克风状态保持独立。",
        voiceInputStatus: "blocked_by_asr",
        asrWebSocketStatus: "not_started",
        lastVoiceError: "asr_health_" + asrStatus
      });
      return getState();
    }

    if (!capabilities.hasGetUserMedia) {
      emit({
        message: microphoneGuidance("unavailable_api", capabilities),
        microphoneStatus: "unavailable_api",
        voiceInputStatus: "blocked_by_browser",
        asrWebSocketStatus: "not_started",
        didCallGetUserMedia: false,
        getUserMediaCalledAt: "",
        lastVoiceError: "getUserMedia_unavailable",
        lastVoiceErrorName: "getUserMedia_unavailable",
        lastVoiceErrorMessage: "getUserMedia is not exposed in this browser context"
      });
      return getState();
    }
    try {
      emit({
        message: "正在连接 ASR WebSocket...",
        asrWebSocketStatus: "connecting",
        microphoneStatus: "checking"
      });
      runtime.websocket = new WebSocket(toWebSocketUrl(asrUrl));
      runtime.websocket.binaryType = "arraybuffer";
      runtime.websocket.onmessage = function (event) { handleAsrMessage(event, settings); };
      runtime.websocket.onclose = function () {
        if (state.recording) emit({ asrWebSocketStatus: "closed", voiceInputStatus: "failed", lastVoiceError: "asr_websocket_closed", message: "ASR WebSocket 已断开；ASR 服务 health 状态保持独立。" });
      };
      await waitForWebSocketOpen(runtime.websocket);
      emit({ asrStatus: "connected", asrWebSocketStatus: "connected" });

      if (useDiarization && (diarization.status === "connected" || diarization.status === "available")) {
        try {
          runtime.diarizationWebSocket = new WebSocket(toDiarizationWebSocketUrl(diarizationUrl));
          runtime.diarizationWebSocket.binaryType = "arraybuffer";
          runtime.diarizationWebSocket.onmessage = handleDiarizationMessage;
          runtime.diarizationWebSocket.onclose = function () {
            if (state.recording) emit({ diarizationWebSocketStatus: "closed" });
          };
          await waitForWebSocketOpen(runtime.diarizationWebSocket, 2500);
          emit({ diarizationWebSocketStatus: "connected" });
        } catch (error) {
          emit({
            diarizationWebSocketStatus: "failed",
            diarizationLastError: error && error.message ? error.message : String(error || "unknown")
          });
          runtime.diarizationWebSocket = null;
        }
      }

      emit({
        didCallGetUserMedia: true,
        getUserMediaCalledAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        message: "正在请求麦克风权限..."
      });
      runtime.mediaStream = await requestUserMedia({ audio: true });
      emit({ permissionState: "granted", microphonePermission: "granted", microphoneStatus: "recording", voiceInputStatus: "recording", streamTrackCount: getStreamTrackCount(runtime.mediaStream), lastVoiceError: "", lastVoiceErrorName: "", lastVoiceErrorMessage: "", message: "麦克风已连接，正在录音。" });
      runtime.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      runtime.source = runtime.audioContext.createMediaStreamSource(runtime.mediaStream);
      runtime.processor = runtime.audioContext.createScriptProcessor(4096, 1, 1);
      runtime.processor.onaudioprocess = function (event) {
        if (!runtime.websocket || runtime.websocket.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const resampled = downsampleTo16k(input, runtime.audioContext.sampleRate);
        runtime.websocket.send(resampled.buffer);
        if (useDiarization && runtime.diarizationWebSocket && runtime.diarizationWebSocket.readyState === WebSocket.OPEN) {
          runtime.diarizationWebSocket.send(resampled.buffer);
        }
      };
      runtime.source.connect(runtime.processor);
      runtime.processor.connect(runtime.audioContext.destination);
      emit({
        recording: true,
        voiceInputStatus: "recording",
        microphoneStatus: "recording",
        audioContextState: runtime.audioContext.state || "running",
        streamTrackCount: getStreamTrackCount(runtime.mediaStream),
        asrWebSocketStatus: "connected",
        message: useDiarization
          ? "正在录音 / ASR 转写中；说话人分离状态：" + state.diarizationProvider + " / " + state.diarizationStatus + "。"
          : "正在录音 / ASR 转写中。"
      });
      return getState();
    } catch (error) {
      await cleanup({ skipFinal: true });
      emit(Object.assign({ asrWebSocketStatus: "failed" }, normalizeMicrophoneError(error, capabilities)));
      return getState();
    }
  }

  async function stop(options) {
    await cleanup(options || {});
    emit({ recording: false, voiceInputStatus: "idle", asrWebSocketStatus: "idle", message: "语音输入已停止。", asrStatus: state.asrStatus === "connected" ? "connected" : state.asrStatus });
    return getState();
  }

  async function cleanup(options) {
    const settings = options || {};
    if (!settings.skipFinal && runtime.websocket && runtime.websocket.readyState === WebSocket.OPEN) {
      try { runtime.websocket.send(JSON.stringify({ type: "end" })); } catch (error) {}
    }
    if (!settings.skipFinal && runtime.diarizationWebSocket && runtime.diarizationWebSocket.readyState === WebSocket.OPEN) {
      try { runtime.diarizationWebSocket.send(JSON.stringify({ type: "end" })); } catch (error) {}
    }
    if (runtime.processor) runtime.processor.disconnect();
    if (runtime.source) runtime.source.disconnect();
    if (runtime.mediaStream) runtime.mediaStream.getTracks().forEach(function (track) { track.stop(); });
    if (runtime.audioContext) await runtime.audioContext.close().catch(function () {});
    const websocket = runtime.websocket;
    const diarizationWebSocket = runtime.diarizationWebSocket;
    runtime.processor = null;
    runtime.source = null;
    runtime.mediaStream = null;
    runtime.audioContext = null;
    runtime.websocket = null;
    runtime.diarizationWebSocket = null;
    if (websocket && websocket.readyState !== WebSocket.CLOSED) websocket.close();
    if (diarizationWebSocket && diarizationWebSocket.readyState !== WebSocket.CLOSED) diarizationWebSocket.close();
    emit({ audioContextState: runtime.audioContext ? runtime.audioContext.state : "closed", streamTrackCount: 0, diarizationWebSocketStatus: "idle" });
  }

  function handleAsrMessage(event, settings) {
    let data = {};
    try { data = JSON.parse(event.data); } catch (error) { return; }
    if (data.type === "error") {
      emit({ message: "ASR 转写错误：" + (data.message || "unknown"), voiceInputStatus: "failed", lastVoiceError: data.message || "asr_error" });
      return;
    }
    if (data.type !== "partial" && data.type !== "final") return;
    const text = data.normalizedText || data.rawText || "";
    const incoming = applyDiarizationSegments(buildIncomingTurns(data, text));
    const turns = mergeTurns(state.turns, incoming, data.type === "final");
    emit({
      transcript: text || state.transcript,
      turns: turns,
      message: data.type === "final" ? llmNotice(settings.llmStatus || state.llmStatus) : "ASR 临时转写已更新。"
    });
    if (settings.onTranscript) settings.onTranscript(text, data, getState());
    if (settings.onTurns) settings.onTurns(turns, data, getState());
  }

  function handleDiarizationMessage(event) {
    let data = {};
    try { data = JSON.parse(event.data); } catch (error) { return; }
    if (data.type === "error") {
      emit({ diarizationWebSocketStatus: "failed", diarizationLastError: data.message || "diarization_error" });
      return;
    }
    if (data.type === "session_started") {
      emit({
        diarizationProvider: data.provider || state.diarizationProvider,
        diarizationStatus: data.status || state.diarizationStatus,
        diarizationWebSocketStatus: "connected"
      });
      return;
    }
    if (data.type === "session_finished") {
      emit({ diarizationWebSocketStatus: "idle" });
      return;
    }
    if (data.type !== "speaker_segment") return;
    const rawSpeakerId = data.speaker_id || data.raw_speaker_id || "";
    const speakerId = normalizeSpeakerId(rawSpeakerId);
    const source = data.source || state.diarizationProvider || "manual";
    const automatic = Boolean(data.automatic);
    const segment = {
      session_id: data.session_id || runtime.sessionId,
      raw_speaker_id: rawSpeakerId || null,
      speaker_id: speakerId,
      start_ms: Number(data.start_ms || 0),
      end_ms: Number(data.end_ms || 0),
      confidence: data.confidence === undefined ? null : data.confidence,
      is_final: Boolean(data.is_final),
      source: source,
      diarization_source: source,
      automatic: automatic,
      automatic_diarization: automatic && source === "diart_local"
    };
    emit({
      diarizationSegments: state.diarizationSegments.concat([segment]).slice(-80),
      diarizationProvider: segment.source || state.diarizationProvider,
      diarizationStatus: data.status || state.diarizationStatus || "connected"
    });
  }

  function applyDiarizationSegments(turns) {
    const segment = state.diarizationSegments.length ? state.diarizationSegments[state.diarizationSegments.length - 1] : null;
    if (!segment) return turns;
    return turns.map(function (turn) {
      const rawSpeakerId = segment.raw_speaker_id || segment.speaker_id || turn.raw_speaker_id || turn.speaker_id || "";
      const speakerId = normalizeSpeakerId(rawSpeakerId);
      const mapped = roleFromSpeakerId(speakerId);
      const existingRoleSource = turn.role_source || "";
      const preserveManualRole = existingRoleSource === "manual_corrected" || existingRoleSource === "manual_swapped" || turn.source === "manual_corrected";
      const source = segment.source || segment.diarization_source || "manual";
      const automatic = Boolean(segment.automatic || segment.automatic_diarization);
      return Object.assign({}, turn, {
        raw_speaker_id: rawSpeakerId || null,
        speaker_id: speakerId,
        role: preserveManualRole ? turn.role : mapped.role,
        role_label: preserveManualRole ? turn.role_label : mapped.role_label,
        role_source: preserveManualRole ? existingRoleSource : (speakerId ? "diarization_default_mapping" : "unknown_speaker"),
        confidence: segment.confidence,
        source: automatic && source === "diart_local" ? "diart_local" : source,
        diarization_source: source,
        automatic: automatic,
        automatic_diarization: automatic && source === "diart_local",
        diarization_start_ms: segment.start_ms,
        diarization_end_ms: segment.end_ms,
        diarization_confidence: segment.confidence === undefined ? null : segment.confidence
      });
    });
  }

  function mergeTurns(existing, incoming, isFinal) {
    const next = isFinal
      ? existing.filter(function (item) { return String(item.turn_id || "").indexOf(runtime.sessionId + "_partial") !== 0; })
      : existing.slice();
    incoming.forEach(function (turn) {
      const normalized = normalizeTurn(turn, isFinal);
      const signature = turnSignature(normalized);
      if (normalized.is_final && runtime.finalTurnSignatures.indexOf(signature) >= 0) {
        return;
      }
      const index = next.findIndex(function (item) { return item.turn_id === normalized.turn_id; });
      if (index >= 0) next[index] = normalized;
      else if (normalized.text) next.push(normalized);
      if (normalized.is_final && normalized.text) {
        runtime.finalTurnSignatures.push(signature);
        runtime.finalTurnSignatures = runtime.finalTurnSignatures.slice(-200);
      }
    });
    return next.slice(-120);
  }

  function buildIncomingTurns(data, text) {
    const rawTurns = Array.isArray(data.turns) && data.turns.length ? data.turns : [fallbackTurn(data, text)];
    return rawTurns.map(function (turn, index) {
      const next = Object.assign({}, turn);
      if (next.turn_id) return next;
      if (data.type === "final" || next.is_final) {
        runtime.turnCounter += 1;
        next.turn_id = runtime.sessionId + "_final_" + runtime.turnCounter + "_" + index;
      } else {
        if (!runtime.partialTurnId) {
          runtime.partialTurnId = runtime.sessionId + "_partial";
        }
        next.turn_id = runtime.partialTurnId + "_" + index;
      }
      return next;
    });
  }

  function turnSignature(turn) {
    return [
      turn.role || "",
      turn.speaker_id || "",
      String(turn.text || "").replace(/\s+/g, " ").trim()
    ].join("|");
  }

  function fallbackTurn(data, text) {
    const rawSpeakerId = data.raw_speaker_id || data.speaker_id || "";
    const speakerId = normalizeSpeakerId(rawSpeakerId);
    const mapped = roleFromSpeakerId(speakerId);
    const role = data.role || mapped.role;
    return {
      turn_id: "",
      raw_speaker_id: rawSpeakerId || null,
      speaker_id: speakerId,
      role: role,
      role_label: data.role_label || roleLabelForRole(role),
      text: text || "",
      is_final: data.type === "final",
      source: data.source || "asr_text_only_default_role",
      role_source: speakerId ? "asr_default_mapping" : "manual_fallback",
      automatic: false,
      automatic_diarization: false
    };
  }

  function normalizeTurn(turn, isFinal) {
    const rawSpeakerId = turn.raw_speaker_id || turn.speaker_id || "";
    const speakerId = normalizeSpeakerId(rawSpeakerId);
    const mapped = roleFromSpeakerId(speakerId);
    const role = normalizeRole(turn.role || mapped.role);
    const diarizationSource = turn.diarization_source || (turn.source === "diart_local" ? "diart_local" : "");
    const automatic = Boolean(turn.automatic || turn.automatic_diarization);
    return {
      turn_id: turn.turn_id || runtime.sessionId + "_" + state.turns.length,
      raw_speaker_id: rawSpeakerId || null,
      speaker_id: speakerId,
      role: role,
      role_label: turn.role_label || roleLabelForRole(role),
      text: turn.text || "",
      start_ms: Number(turn.start_ms || 0),
      end_ms: Number(turn.end_ms || 0),
      is_final: Boolean(turn.is_final || isFinal),
      confidence: turn.confidence === undefined ? null : turn.confidence,
      source: turn.source || "asr_text_only_default_role",
      diarization_source: diarizationSource || "",
      role_source: turn.role_source || (speakerId ? "default_mapping" : "manual_fallback"),
      automatic: automatic,
      automatic_diarization: automatic && (diarizationSource === "diart_local" || turn.source === "diart_local"),
      diarization_start_ms: turn.diarization_start_ms === undefined ? null : Number(turn.diarization_start_ms),
      diarization_end_ms: turn.diarization_end_ms === undefined ? null : Number(turn.diarization_end_ms),
      diarization_confidence: turn.diarization_confidence === undefined ? null : turn.diarization_confidence
    };
  }

  function normalizeSpeakerId(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    const match = text.match(/^(?:speaker|spk)[_\-\s]*(\d+)$/);
    if (match) {
      return "speaker_" + Number(match[1]);
    }
    return null;
  }

  function roleFromSpeakerId(speakerId) {
    if (speakerId === "speaker_0") return { role: "doctor", role_label: "医生" };
    if (speakerId === "speaker_1") return { role: "patient", role_label: "患者" };
    return { role: "unknown", role_label: "未确认" };
  }

  function normalizeRole(role) {
    const value = String(role || "").toLowerCase();
    if (value === "doctor" || value === "patient") return value;
    return "unknown";
  }

  function roleLabelForRole(role) {
    if (role === "doctor") return "医生";
    if (role === "patient") return "患者";
    return "未确认";
  }

  function normalizeMicrophoneError(error, capabilities) {
    const name = error && error.name ? error.name : "";
    const message = error && error.message ? error.message : String(error || "unknown");
    if (name === "NotAllowedError") {
      return withVoiceError({ permissionState: "denied", microphonePermission: "denied", microphoneStatus: "permission_denied", voiceInputStatus: "blocked_by_browser", message: microphoneGuidance("permission_denied", capabilities) }, name, message);
    }
    if (name === "SecurityError") {
      return withVoiceError({ microphonePermission: state.microphonePermission, microphoneStatus: "insecure_context", voiceInputStatus: "blocked_by_browser", message: microphoneGuidance("insecure_context", capabilities) }, name, message);
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return withVoiceError({ microphoneStatus: "not_found", voiceInputStatus: "blocked_by_browser", message: microphoneGuidance("not_found", capabilities) }, name, message);
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return withVoiceError({ microphoneStatus: "device_busy", voiceInputStatus: "blocked_by_browser", message: microphoneGuidance("device_busy", capabilities) }, name, message);
    }
    if (name === "OverconstrainedError") {
      return withVoiceError({ microphoneStatus: "get_user_media_error", voiceInputStatus: "blocked_by_browser", message: microphoneGuidance("overconstrained", capabilities, message) }, name, message);
    }
    return withVoiceError({ microphoneStatus: "get_user_media_error", voiceInputStatus: "failed", message: microphoneGuidance("get_user_media_error", capabilities, message) }, name || "get_user_media_error", message);
  }

  function withVoiceError(patch, name, message) {
    return Object.assign({}, patch, {
      lastVoiceError: name || message || "unknown",
      lastVoiceErrorName: name || "",
      lastVoiceErrorMessage: message || ""
    });
  }

  function buildMessage(next) {
    if (!state.voiceSupported || next.microphoneStatus === "unavailable_api") return microphoneGuidance("unavailable_api", getBrowserCapabilities());
    if (next.microphoneStatus === "insecure_context") return microphoneGuidance("insecure_context", getBrowserCapabilities());
    if (next.microphonePermission === "denied") return "麦克风权限被拒绝。请在浏览器地址栏左侧的网站权限中允许麦克风访问后重试。";
    if (next.asrStatus === "disconnected" || next.asrStatus === "unavailable") return "ASR 服务未连接，当前无法进行语音转写。";
    return "点击语音输入后将请求浏览器麦克风权限。";
  }

  async function checkAsrHealth(asrHealthUrl) {
    try {
      const response = await fetchWithTimeout(asrHealthUrl, { method: "GET" }, 3500);
      return response.ok ? "connected" : "unavailable";
    } catch (error) {
      return "disconnected";
    }
  }

  async function checkDiarizationHealth(diarizationHealthUrl) {
    try {
      const response = await fetchWithTimeout(diarizationHealthUrl, { method: "GET" }, 2500);
      const data = await response.json().catch(function () { return {}; });
      const provider = data.active_provider || data.provider || "manual";
      const status = response.ok ? (data.status || (data.ok ? "connected" : "unavailable")) : "unavailable";
      return {
        provider: provider,
        status: data.ok ? (provider === "manual" ? "manual" : "connected") : status,
        message: data.message || ""
      };
    } catch (error) {
      return {
        provider: "manual",
        status: error && error.name === "AbortError" ? "timeout" : "disconnected",
        message: error && error.message ? error.message : String(error || "unknown")
      };
    }
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? window.setTimeout(function () { controller.abort(); }, timeoutMs || 3000) : null;
    const requestOptions = Object.assign({}, options || {}, controller ? { signal: controller.signal } : {});
    return fetch(url, requestOptions).finally(function () {
      if (timer) window.clearTimeout(timer);
    });
  }

  function detectMicrophoneStatus(permission, capabilities) {
    const info = capabilities || getBrowserCapabilities();
    if (!info.hasNavigatorMediaDevices || !info.hasGetUserMedia) return "unavailable_api";
    if (permission === "denied") return "permission_denied";
    if (permission === "prompt") return "permission_prompt";
    if (permission === "granted") return "permission_granted";
    return "unknown";
  }

  function canAttemptMicrophone(capabilities, microphoneStatus) {
    const info = capabilities || getBrowserCapabilities();
    return Boolean(info.hasGetUserMedia && microphoneStatus !== "permission_denied");
  }

  function getUserMediaFunction() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return function (constraints) {
        return navigator.mediaDevices.getUserMedia(constraints);
      };
    }
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (legacy) {
      return function (constraints) {
        return new Promise(function (resolve, reject) {
          legacy.call(navigator, constraints, resolve, reject);
        });
      };
    }
    return null;
  }

  function requestUserMedia(constraints) {
    const getUserMedia = getUserMediaFunction();
    if (!getUserMedia) {
      const error = new Error("getUserMedia is not exposed in this browser context");
      error.name = "getUserMedia_unavailable";
      return Promise.reject(error);
    }
    return getUserMedia(constraints);
  }

  function getBrowserCapabilities() {
    const legacy = Boolean(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);
    return {
      href: window.location.href,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      isSecureContext: Boolean(window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"),
      hasNavigatorMediaDevices: Boolean(navigator.mediaDevices),
      hasMediaDevicesGetUserMedia: Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      hasLegacyGetUserMedia: legacy,
      hasGetUserMedia: Boolean((navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || legacy)
    };
  }

  async function queryMicrophonePermission() {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: "microphone" });
        return result.state || "unknown";
      } catch (error) {
        return "unknown";
      }
    }
    return "unknown";
  }

  function microphoneGuidance(status, capabilities, detail) {
    const info = capabilities || getBrowserCapabilities();
    if (status === "unavailable_api") {
      return "当前浏览器上下文没有暴露 getUserMedia，因此网页无法弹出麦克风授权。请在浏览器设置里允许当前站点使用麦克风，或将当前访问地址加入浏览器可信来源后刷新；也可以使用 HTTPS/localhost 转发访问。ASR 服务状态会独立检测。";
    }
    if (status === "insecure_context") return "麦克风请求失败：SecurityError。当前来源可能未被浏览器视为安全来源，请在浏览器站点权限中允许麦克风，或把当前访问地址加入浏览器可信来源后重试。";
    if (status === "permission_denied") return "麦克风请求失败：NotAllowedError。用户或浏览器拒绝了麦克风权限。";
    if (status === "not_found") return "麦克风请求失败：NotFoundError。没有找到麦克风设备。";
    if (status === "device_busy") return "麦克风请求失败：NotReadableError。设备可能被占用或不可读。";
    if (status === "overconstrained") return "麦克风请求失败：OverconstrainedError。" + (detail || "音频约束不满足。");
    if (status === "available") return "麦克风权限已授予。点击语音输入即可开始录音。";
    return "麦克风请求失败：" + (detail || "unknown") + "。请复制开发者详情中的诊断结果继续排查。";
  }

  function readMicrophonePolicy() {
    try {
      const value = window.localStorage && window.localStorage.getItem(MICROPHONE_POLICY_KEY);
      return value === "force_probe" ? "force_probe" : "auto";
    } catch (error) {
      return "auto";
    }
  }

  function setMicrophonePolicy(value) {
    const next = value === "force_probe" ? "force_probe" : "auto";
    try {
      window.localStorage && window.localStorage.setItem(MICROPHONE_POLICY_KEY, next);
    } catch (error) {}
    emit({
      microphonePolicy: next,
      message: next === "force_probe"
        ? "已启用 force_probe：前端不会提前阻止麦克风，仍以浏览器真实 getUserMedia 结果为准。"
        : "已恢复 auto 麦克风策略。"
    });
    return getState();
  }

  function buildVoiceDebug() {
    const capabilities = getBrowserCapabilities();
    return {
      href: capabilities.href,
      protocol: capabilities.protocol,
      hostname: capabilities.hostname,
      isSecureContext: Boolean(capabilities.isSecureContext),
      hasNavigatorMediaDevices: Boolean(capabilities.hasNavigatorMediaDevices),
      hasMediaDevicesGetUserMedia: Boolean(capabilities.hasMediaDevicesGetUserMedia),
      hasLegacyGetUserMedia: Boolean(capabilities.hasLegacyGetUserMedia),
      hasGetUserMedia: Boolean(capabilities.hasGetUserMedia),
      permissionState: state.permissionState,
      asrHealthUrl: state.asrHealthUrl || (DEFAULT_ASR_URL.replace(/\/+$/, "") + "/health"),
      asrHealthStatus: state.asrStatus,
      asrWebSocketUrl: toWebSocketUrl((state.asrHealthUrl || (DEFAULT_ASR_URL.replace(/\/+$/, "") + "/health")).replace(/\/health$/, "")),
      asrWebSocketStatus: state.asrWebSocketStatus,
      diarizationHealthUrl: state.diarizationHealthUrl || (DEFAULT_DIARIZATION_URL.replace(/\/+$/, "") + "/diarization/health"),
      diarizationStatus: state.diarizationStatus,
      diarizationProvider: state.diarizationProvider,
      diarizationWebSocketUrl: state.diarizationWebSocketUrl || toDiarizationWebSocketUrl(DEFAULT_DIARIZATION_URL),
      diarizationWebSocketStatus: state.diarizationWebSocketStatus,
      diarizationLastError: state.diarizationLastError || "",
      didCallGetUserMedia: Boolean(state.didCallGetUserMedia),
      getUserMediaCalledAt: state.getUserMediaCalledAt || "",
      microphoneStatus: state.microphoneStatus,
      audioContextState: runtime.audioContext ? runtime.audioContext.state : (state.audioContextState || ""),
      streamTrackCount: runtime.mediaStream ? getStreamTrackCount(runtime.mediaStream) : Number(state.streamTrackCount || 0),
      voiceInputStatus: state.voiceInputStatus,
      microphonePolicy: state.microphonePolicy,
      microphonePermission: state.microphonePermission,
      lastVoiceError: state.lastVoiceError || "",
      lastVoiceErrorName: state.lastVoiceErrorName || "",
      lastVoiceErrorMessage: state.lastVoiceErrorMessage || "",
      lastCheckedAt: state.lastCheckedAt || "",
      diarizationSegments: state.diarizationSegments.slice(-5),
      turns: state.turns.slice(-5)
    };
  }

  function updateVoiceDebug() {
    window.__HIS_AGENT_VOICE_DEBUG__ = Object.assign(buildVoiceDebug(), {
      dump: function () {
        const snapshot = buildVoiceDebug();
        console.table(snapshot);
        return snapshot;
      }
    });
  }

  function llmNotice(llmStatus) {
    if (llmStatus !== "connected") return "LLM 未连接，语音内容只能转写和展示，不能生成操作或修改病历。";
    return "LLM 已连接。语音转写可发送给 Agent 生成受控建议，写入前仍需确认。";
  }

  function waitForWebSocketOpen(websocket, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const timer = window.setTimeout(function () {
        reject(new Error("WebSocket 连接超时"));
      }, timeoutMs || 6000);
      websocket.onopen = resolve;
      websocket.onopen = function (event) {
        window.clearTimeout(timer);
        resolve(event);
      };
      websocket.onerror = function () {
        window.clearTimeout(timer);
        reject(new Error("ASR WebSocket 连接失败"));
      };
    });
  }

  function getStreamTrackCount(stream) {
    if (!stream || !stream.getTracks) return 0;
    return stream.getTracks().length;
  }

  function toWebSocketUrl(serviceUrl) {
    return toServiceWebSocketUrl(serviceUrl, "/ws");
  }

  function toDiarizationWebSocketUrl(serviceUrl) {
    return toServiceWebSocketUrl(serviceUrl || DEFAULT_DIARIZATION_URL, "/ws/diarization");
  }

  function toServiceWebSocketUrl(serviceUrl, path) {
    const url = String(serviceUrl || DEFAULT_ASR_URL).trim().replace(/\/+$/, "");
    if (url.startsWith("https://")) return "wss://" + url.slice(8) + path;
    if (url.startsWith("http://")) return "ws://" + url.slice(7) + path;
    return url;
  }

  function downsampleTo16k(input, sourceRate) {
    if (sourceRate === 16000) return new Float32Array(input);
    const ratio = sourceRate / 16000;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) output[index] = input[Math.floor(index * ratio)];
    return output;
  }

  updateVoiceDebug();

  window.HisVoiceInputController = {
    subscribe: subscribe,
    getState: getState,
    checkStatus: checkStatus,
    checkMicrophonePermission: checkMicrophonePermission,
    setMicrophonePolicy: setMicrophonePolicy,
    normalizeSpeakerId: normalizeSpeakerId,
    start: start,
    stop: stop,
    toggle: toggle
  };
})();
