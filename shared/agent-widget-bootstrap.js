(function () {
  "use strict";

  var VERSION = "20260612-voicemigration";
  var DEBUG_KEY = "__HIS_AGENT_WIDGET_DEBUG__";

  function debugPatch(patch) {
    var current = window[DEBUG_KEY] || {};
    window[DEBUG_KEY] = Object.assign(
      {
        bootstrapLoaded: true,
        launcherEnsured: false,
        llmStatus: "unknown",
        agentMode: "blocked_no_llm",
        lastInitError: null,
        scriptsVersion: VERSION
      },
      current,
      patch || {}
    );
  }

  function ensureLauncher() {
    if (!document.body) return;
    if (document.getElementById("hisAgentLauncher")) {
      debugPatch({ launcherEnsured: true });
      return;
    }

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "hisAgentLauncher";
    launcher.className = "his-agent-launcher his-agent-bootstrap-launcher";
    launcher.setAttribute("aria-label", "AI Agent");
    launcher.innerHTML = "<strong>AI Agent</strong><span>LLM status</span>";
    launcher.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:24px",
      "top:auto",
      "z-index:2147483647",
      "display:grid",
      "gap:4px",
      "min-width:126px",
      "min-height:58px",
      "padding:10px 12px",
      "border:1px solid #bfdbfe",
      "border-radius:8px",
      "background:#1d4ed8",
      "color:#fff",
      "font-family:Microsoft YaHei, Segoe UI, Arial, sans-serif",
      "font-weight:800",
      "box-shadow:0 18px 40px rgba(15,23,42,.24)",
      "cursor:pointer",
      "visibility:visible",
      "opacity:1",
      "pointer-events:auto"
    ].join(";");

    var panel = document.createElement("section");
    panel.id = "hisAgentBootstrapPanel";
    panel.hidden = true;
    panel.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:92px",
      "z-index:2147483647",
      "width:min(360px,calc(100vw - 32px))",
      "padding:14px",
      "border:1px solid #bfdbfe",
      "border-radius:8px",
      "background:#fff",
      "color:#172033",
      "box-shadow:0 18px 40px rgba(15,23,42,.22)",
      "font-family:Microsoft YaHei, Segoe UI, Arial, sans-serif"
    ].join(";");
    panel.innerHTML = [
      "<strong>AI Agent</strong>",
      "<p>LLM status is being checked. If unavailable, Agent will not execute page actions. Manual page buttons and forms still work.</p>",
      '<button type="button" id="hisAgentBootstrapClose">Close</button>'
    ].join("");

    launcher.addEventListener("click", function () {
      var mainPanel = document.getElementById("hisAgentPanel");
      if (mainPanel) {
        mainPanel.classList.toggle("open");
        panel.hidden = true;
        return;
      }
      panel.hidden = !panel.hidden;
    });
    panel.querySelector("#hisAgentBootstrapClose").addEventListener("click", function () {
      panel.hidden = true;
    });

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    debugPatch({ launcherEnsured: true });
    console.info("[AgentWidget] bootstrap launcher ensured");
  }

  debugPatch({ bootstrapLoaded: true, scriptsVersion: VERSION });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureLauncher);
  } else {
    ensureLauncher();
  }
})();
