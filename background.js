importScripts("config.js");
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const controllers = new Map();

function groqHeaders() {
  return { "Content-Type": "application/json", "Authorization": "Bearer " + getGroqKey() };
}

// On 429, rotate key and return wait seconds (or 0 to retry immediately with next key)
function handle429(r) {
  rotateGroqKey();
  const wait = r.headers.get("retry-after") || r.headers.get("x-ratelimit-reset-requests") || "0";
  const secs = Math.ceil(Number(wait) || 0);
  // If next key is fresh (secs == 0 or small), retry immediately; else surface the wait
  return secs > 5 ? "rate_limited:" + secs : null; // null = retry with new key
}

// ── Non-streaming (manual actions) ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "ollama") return;

  const tabId = sender.tab?.id ?? 0;
  controllers.get(tabId)?.abort();

  const ctrl = new AbortController();
  controllers.set(tabId, ctrl);

  const { messages, options = {} } = message.payload;
  const body = {
    model: message.payload.model || "llama-3.3-70b-versatile",
    messages,
    temperature: options.temperature ?? 0.3,
    ...(options.num_predict && options.num_predict > 0 ? { max_tokens: options.num_predict } : {}),
    stream: false,
  };

  async function tryFetch(attempt) {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: groqHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      if (r.status === 429 && attempt < GROQ_API_KEYS.length) {
        const errMsg = handle429(r);
        if (!errMsg) return tryFetch(attempt + 1); // retry with next key
        throw new Error(errMsg);
      }
      throw new Error("Groq " + r.status);
    }
    return r.json();
  }

  tryFetch(1)
    .then(data => {
      controllers.delete(tabId);
      sendResponse({ ok: true, text: data.choices?.[0]?.message?.content || "" });
    })
    .catch(err => {
      controllers.delete(tabId);
      if (err.name === "AbortError") return;
      sendResponse({ ok: false, error: err.message });
    });

  return true;
});

// ── Streaming (auto-suggest + smart reply) ────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "te-stream") return;

  let ctrl = null;

  port.onMessage.addListener(async (payload) => {
    ctrl?.abort();
    ctrl = new AbortController();

    const { messages, options = {} } = payload;
    const body = {
      model: payload.model || "llama-3.3-70b-versatile",
      messages,
      temperature: options.temperature ?? 0.3,
      ...(options.num_predict && options.num_predict > 0 ? { max_tokens: options.num_predict } : {}),
      stream: true,
    };

    async function tryStream(attempt) {
      const resp = await fetch(GROQ_URL, {
        method: "POST",
        headers: groqHeaders(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        if (resp.status === 429 && attempt < GROQ_API_KEYS.length) {
          const errMsg = handle429(resp);
          if (!errMsg) return tryStream(attempt + 1);
          port.postMessage({ error: errMsg });
          return;
        }
        port.postMessage({ error: "Groq " + resp.status });
        return;
      }

      const reader = resp.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) { port.postMessage({ done: true }); break; }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.replace(/^data:\s*/, "").trim();
          if (!trimmed || trimmed === "[DONE]") {
            if (trimmed === "[DONE]") { port.postMessage({ done: true }); return; }
            continue;
          }
          try {
            const d = JSON.parse(trimmed);
            const token = d.choices?.[0]?.delta?.content;
            if (token) port.postMessage({ token });
          } catch (_) {}
        }
      }
    }

    try {
      await tryStream(1);
    } catch (e) {
      if (e.name !== "AbortError") port.postMessage({ error: e.message });
    }
  });

  port.onDisconnect.addListener(() => ctrl?.abort());
});
