chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ollama") {
    fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then(r => {
        if (!r.ok) throw new Error("Ollama " + r.status);
        return r.json();
      })
      .then(data => sendResponse({ ok: true, text: data.message?.content || "" }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
