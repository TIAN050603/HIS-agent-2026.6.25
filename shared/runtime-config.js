(function () {
  "use strict";

  const DEFAULT_HOST = "10.26.6.8";
  const DEFAULT_PORTS = {
    frontend: "31451",
    backend: "31169",
    asr: "30197",
    llm: "31034",
    diarization: "8020"
  };

  function query() {
    try {
      return new URLSearchParams(window.location.search || "");
    } catch (error) {
      return new URLSearchParams("");
    }
  }

  function currentProtocol() {
    return window.location && window.location.protocol === "https:" ? "https:" : "http:";
  }

  function currentHost() {
    const params = query();
    return params.get("serviceHost") ||
      params.get("host") ||
      (window.location && window.location.hostname) ||
      DEFAULT_HOST;
  }

  function isLocalHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  }

  function baseUrl(port) {
    return currentProtocol() + "//" + currentHost() + ":" + port;
  }

  function normalizeUrl(value) {
    const text = String(value || "").trim().replace(/\/+$/, "");
    if (!text) return "";
    try {
      return new URL(text).toString().replace(/\/+$/, "");
    } catch (error) {
      return "";
    }
  }

  function queryUrl(names) {
    const params = query();
    for (const name of names) {
      const value = normalizeUrl(params.get(name));
      if (value) return value;
    }
    return "";
  }

  function readStoredConfig() {
    try {
      const raw = window.localStorage && window.localStorage.getItem("his_runtime_service_urls");
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function envUrl(names) {
    const env = window.__HIS_RUNTIME_ENV__ || {};
    for (const name of names) {
      const value = normalizeUrl(env[name]);
      if (value) return value;
    }
    return "";
  }

  function storedUrl(stored, names, fallback) {
    for (const name of names) {
      const value = normalizeUrl(stored && stored[name]);
      if (!value) continue;
      try {
        const url = new URL(value);
        const expected = new URL(fallback);
        const hostMatches = url.hostname === expected.hostname || (isLocalHost(expected.hostname) && isLocalHost(url.hostname));
        const portMatches = url.port === expected.port;
        if (!hostMatches || !portMatches) continue;
      } catch (error) {
        continue;
      }
      return value;
    }
    return fallback;
  }

  function serviceUrls() {
    const stored = readStoredConfig();
    const frontendFromPage = window.location && window.location.origin && window.location.protocol !== "file:"
      ? window.location.origin
      : baseUrl(DEFAULT_PORTS.frontend);
    return {
      frontendUrl: queryUrl(["frontendUrl", "frontend"]) || envUrl(["frontendUrl", "frontend"]) || storedUrl(stored, ["frontendUrl", "frontend"], frontendFromPage),
      backendUrl: queryUrl(["backendUrl", "backend"]) || envUrl(["backendUrl", "backend"]) || storedUrl(stored, ["backendUrl", "backend"], baseUrl(DEFAULT_PORTS.backend)),
      asrUrl: queryUrl(["asrUrl", "asr"]) || envUrl(["asrUrl", "asr"]) || storedUrl(stored, ["asrUrl", "asr"], baseUrl(DEFAULT_PORTS.asr)),
      llmUrl: queryUrl(["llmUrl", "llm"]) || envUrl(["llmUrl", "llm"]) || storedUrl(stored, ["llmUrl", "llm"], baseUrl(DEFAULT_PORTS.llm)),
      diarizationUrl: queryUrl(["diarizationUrl", "diarizationBaseUrl", "diarization"]) ||
        envUrl(["diarizationUrl", "diarizationBaseUrl", "diarization"]) ||
        storedUrl(stored, ["diarizationUrl", "diarizationBaseUrl", "diarization"], queryUrl(["backendUrl", "backend"]) || envUrl(["backendUrl", "backend"]) || storedUrl(stored, ["backendUrl", "backend"], baseUrl(DEFAULT_PORTS.backend))),
      host: currentHost(),
      ports: Object.assign({}, DEFAULT_PORTS)
    };
  }

  window.HisRuntimeConfig = {
    defaultHost: DEFAULT_HOST,
    defaultPorts: Object.assign({}, DEFAULT_PORTS),
    serviceUrls: serviceUrls
  };
})();
