// Per-tab AbortControllers for non-streaming requests
const controllers = new Map();

// ── Non-streaming (manual actions) ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "ollama") return;

  const tabId = sender.tab?.id ?? 0;
  controllers.get(tabId)?.abort();

  const ctrl = new AbortController();
  controllers.set(tabId, ctrl);

  fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload),
    signal: ctrl.signal,
  })
    .then(r => { if (!r.ok) throw new Error("Ollama " + r.status); return r.json(); })
    .then(data => { controllers.delete(tabId); sendResponse({ ok: true, text: data.message?.content || "" }); })
    .catch(err => {
      controllers.delete(tabId);
      if (err.name === "AbortError") return;
      sendResponse({ ok: false, error: err.message });
    });

  return true;
});

// ── Streaming (auto-suggest) ──────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "te-stream") return;

  let ctrl = null;

  port.onMessage.addListener(async (payload) => {
    ctrl?.abort();
    ctrl = new AbortController();

    try {
      const resp = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: ctrl.signal,
      });

      if (!resp.ok) { port.postMessage({ error: "Ollama " + resp.status }); return; }

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
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.message?.content) port.postMessage({ token: d.message.content });
            if (d.done) { port.postMessage({ done: true }); return; }
          } catch (_) {}
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") port.postMessage({ error: e.message });
    }
  });

  port.onDisconnect.addListener(() => ctrl?.abort());
});

// ── Warmup: load model into memory immediately ────────────────────────────────
fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "llama3.2:1b",
    stream: false,
    messages: [{ role: "user", content: "." }],
    options: { num_predict: 1, num_ctx: 256, keep_alive: -1 },
  }),
}).catch(() => {});
