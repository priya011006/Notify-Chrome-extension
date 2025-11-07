// ai-client.js
// Global hybrid AI helper for Chrome extensions
// Adds window.askAI(prompt, opts)

window.askAI = async function (promptText, opts = {}) {
  // 1️⃣ Try Chrome’s built-in on-device AI (Prompt API)
  try {
    if (typeof window !== "undefined" && window.ai) {
      const can = await window.ai.canCreateTextSession?.();
      if (can === true) {
        // Try the simple prompt API (newer Chrome versions)
        if (window.ai.prompt) {
          const localResp = await window.ai.prompt(promptText, opts);
          return localResp?.text || localResp;
        }

        // Fallback older session-based API (Dev/Canary builds)
        const session = await window.ai.createTextSession?.();
        if (session?.prompt) {
          const out = await session.prompt(promptText);
          return out?.text || out;
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Built-in AI failed, switching to cloud:", err);
  }

  // 2️⃣ Cloud fallback (Gemini via your proxy server)
  try {
    const resp = await fetch(opts.proxyUrl ?? "https://your-proxy-host.com/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText, options: opts }),
    });

    if (!resp.ok) throw new Error(`Proxy error ${resp.status}`);
    const data = await resp.json();
    return data.output ?? data;
  } catch (err) {
    console.error("❌ Cloud fallback failed:", err);
    throw err;
  }
};
