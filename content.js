(function () {
  "use strict";

  // Don't run inside our own extension pages
  if (window.location.protocol === "chrome-extension:") return;

  const MODEL = "llama3.2";

  const ACTIONS = [
    { label: "Improve",      type: "improve",      icon: "✨" },
    { label: "Rewrite",      type: "rewrite",      icon: "🔄" },
    { label: "Proofread",    type: "proofread",    icon: "✅" },
    { label: "Shorten",      type: "shorten",      icon: "✂️" },
    { label: "Professional", type: "professional", icon: "💼" },
    { label: "Friendly",     type: "friendly",     icon: "😊" },
  ];

  // Few-shot chat messages �� 2 examples per action keeps prompt short and inference fast
  const SHOTS = {
    improve: [
      { role: "user",      content: "<input>cant make it tmrw sry</input>" },
      { role: "assistant", content: "I cannot make it tomorrow, sorry." },
      { role: "user",      content: "<input>i wanna ask if u have time to review my work</input>" },
      { role: "assistant", content: "I wanted to ask if you have time to review my work." },
    ],
    rewrite: [
      { role: "user",      content: "<input>I am sorry for the late reply I was busy</input>" },
      { role: "assistant", content: "Please accept my apologies for the delayed response; I was occupied with other matters." },
      { role: "user",      content: "<input>I sent the proposal yesterday did you get a chance to look at it</input>" },
      { role: "assistant", content: "I submitted the proposal yesterday — have you had a chance to review it?" },
    ],
    proofread: [
      { role: "user",      content: "<input>i recieved ur messege and will get back to u soon as posible</input>" },
      { role: "assistant", content: "I received your message and will get back to you as soon as possible." },
      { role: "user",      content: "<input>their going to there house to pick there stuff</input>" },
      { role: "assistant", content: "They're going to their house to pick up their stuff." },
    ],
    shorten: [
      { role: "user",      content: "<input>I just wanted to let you know that I will not be able to attend the meeting scheduled for tomorrow morning due to a prior commitment</input>" },
      { role: "assistant", content: "I cannot make tomorrow's meeting — prior commitment." },
      { role: "user",      content: "<input>Could you please let me know at your earliest convenience whether you will be able to complete the task that was assigned to you last week</input>" },
      { role: "assistant", content: "Can you let me know if you can complete last week's task?" },
    ],
    professional: [
      { role: "user",      content: "<input>hey can u send me that asap</input>" },
      { role: "assistant", content: "Could you please send that at your earliest convenience?" },
      { role: "user",      content: "<input>the client rejected the work and wants a refund this is crazy</input>" },
      { role: "assistant", content: "The client has rejected the deliverable and is requesting a refund." },
    ],
    friendly: [
      { role: "user",      content: "<input>Please submit the report by end of day.</input>" },
      { role: "assistant", content: "Hey, could you send over the report by end of day? Thanks so much!" },
      { role: "user",      content: "<input>We regret to inform you that your application has not been successful.</input>" },
      { role: "assistant", content: "Hey, so sorry to share this — unfortunately your application did not make it through this time." },
    ],
  };

  const SYSTEM_MSG = {
    improve:      "Rewrite the text in <input> tags with better clarity and grammar. Output ONLY the result, same meaning and perspective, no explanation.",
    rewrite:      "Rephrase the text in <input> tags. Output ONLY the result, same meaning and speaker perspective, no explanation.",
    proofread:    "Fix all grammar and spelling in the text in <input> tags. Output ONLY the corrected text, no explanation.",
    shorten:      "Shorten the text in <input> tags, keep core meaning and speaker. Output ONLY the result, no explanation.",
    professional: "Make the text in <input> tags formal and professional. Output ONLY the result, same perspective, no added content.",
    friendly:     "Make the text in <input> tags warm and casual. Output ONLY the result, same perspective, no explanation.",
  };

  let trigger  = null; // small floating ✦ button
  let menu     = null; // action menu panel
  let suggest  = null; // auto-suggestion bar
  let focused  = null; // currently focused editable element

  let suggestFor       = null; // element the suggestion targets
  let suggestText      = "";   // suggested replacement text
  let suggestGenId     = 0;    // increments each request — stale responses are dropped
  let lastSuggestInput = "";   // last text we suggested for (avoid re-triggering)
  let streamPort       = null; // active streaming port (disconnect to cancel)
  let pendingUndo      = null; // { el, original } — set when in undo state

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isEditable(el) {
    if (!el) return false;
    const id = el.id;
    if (id === "te-trigger" || id === "te-menu" || id === "te-suggest") return false;
    if (el.closest && el.closest("#te-suggest")) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      return ["text","search","email","url","tel",""].includes(t); // no password
    }
    return false;
  }

  function getText(el) {
    if (!el) return "";
    const raw = el.isContentEditable ? (el.innerText || el.textContent || "") : (el.value || "");
    return raw.replace(/<[^>]+>/g, ""); // strip any echoed HTML/XML tags
  }

  function setText(el, newText) {
    if (!el) return;
    if (el.isContentEditable) {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, newText);
      if (!el.textContent.includes(newText)) {
        el.textContent = newText;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    } else {
      el.focus();
      el.select();
      document.execCommand("insertText", false, newText);
      if (el.value !== newText) {
        el.value = newText;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  // ── Trigger button ────────────────────────────────────────────────────────

  function getTrigger() {
    if (trigger) return trigger;
    trigger = document.createElement("div");
    trigger.id = "te-trigger";
    trigger.title = "Text Enhancer";
    trigger.textContent = "✦";
    trigger.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });
    document.documentElement.appendChild(trigger);
    return trigger;
  }

  function positionTrigger(el) {
    const t = getTrigger();
    const r = el.getBoundingClientRect();
    const top  = r.bottom - 34;
    const left = r.right  - 34;
    t.style.top  = Math.max(4, top)  + "px";
    t.style.left = Math.max(4, left) + "px";
    t.style.display = "flex";
  }

  function hideTrigger() {
    if (trigger) trigger.style.display = "none";
    hideMenu();
  }

  // ── Suggestion bar ────────────────────────────────────────────────────────

  function getSuggest() {
    if (suggest) return suggest;
    suggest = document.createElement("div");
    suggest.id = "te-suggest";

    const label = document.createElement("span");
    label.id = "te-suggest-label";
    label.textContent = "✨";

    const textEl = document.createElement("span");
    textEl.id = "te-suggest-text";

    const accept = document.createElement("button");
    accept.id = "te-suggest-accept";
    accept.textContent = "Accept (Tab)";
    accept.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pendingUndo) {
        const { el, original } = pendingUndo;
        pendingUndo = null;
        setText(el, original);
        lastSuggestInput = original;
        el.focus();
        hideSuggest();
      } else {
        applySuggestion();
      }
    });

    const dismiss = document.createElement("button");
    dismiss.id = "te-suggest-dismiss";
    dismiss.textContent = "✕";
    dismiss.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); hideSuggest(); });

    suggest.appendChild(label);
    suggest.appendChild(textEl);
    suggest.appendChild(accept);
    suggest.appendChild(dismiss);
    document.documentElement.appendChild(suggest);
    return suggest;
  }

  function positionSuggest(el) {
    if (!suggest || suggest.style.display === "none") return;
    const r = el.getBoundingClientRect();
    const s = suggest;
    s.style.top  = (r.bottom + 6) + "px";
    s.style.left = Math.max(8, r.left) + "px";
    s.style.maxWidth = Math.min(520, window.innerWidth - Math.max(8, r.left) - 12) + "px";
  }

  function showSuggestLoading(el) {
    suggestFor = el;
    const s = getSuggest();
    s.style.borderColor = "";
    s.querySelector("#te-suggest-text").textContent = "Analyzing…";
    const accept = s.querySelector("#te-suggest-accept");
    accept.textContent = "Accept (Tab)";
    accept.style.background = "";
    accept.style.display = "none";
    const dismiss = s.querySelector("#te-suggest-dismiss");
    dismiss.textContent = "✕";
    const r = el.getBoundingClientRect();
    s.style.top      = (r.bottom + 6) + "px";
    s.style.left     = Math.max(8, r.left) + "px";
    s.style.maxWidth = Math.min(520, window.innerWidth - Math.max(8, r.left) - 12) + "px";
    s.style.display  = "flex";
  }

  function showSuggestResult(text) {
    if (!suggest || suggest.style.display === "none") return;
    suggestText = text;
    suggest.querySelector("#te-suggest-text").textContent = text;
    suggest.querySelector("#te-suggest-accept").style.display = "";
  }

  function hideSuggest() {
    streamPort?.disconnect();
    streamPort  = null;
    pendingUndo = null;
    if (suggest) suggest.style.display = "none";
    suggestFor  = null;
    suggestText = "";
    suggestGenId++;
  }

  function showUndoState(el, original) {
    const s = getSuggest();
    s.style.borderColor = "#22c55e";
    s.querySelector("#te-suggest-text").textContent = "Applied ✓";
    const accept = s.querySelector("#te-suggest-accept");
    accept.textContent = "Undo";
    accept.style.background = "#333";
    accept.style.display = "";
    pendingUndo = { el, original };
    s.querySelector("#te-suggest-dismiss").textContent = "✕";
    const r = el.getBoundingClientRect();
    s.style.top     = (r.bottom + 6) + "px";
    s.style.left    = Math.max(8, r.left) + "px";
    s.style.display = "flex";
    setTimeout(() => { hideSuggest(); }, 4000);
  }

  function applySuggestion() {
    if (suggestFor && suggestText) {
      const el       = suggestFor;
      const original = getText(el).trim();
      const replacement = suggestText;
      lastSuggestInput = replacement;
      clearTimeout(suggestTimer);
      suggestGenId++;
      streamPort?.disconnect(); streamPort = null;
      suggestFor  = null;
      suggestText = "";
      setText(el, replacement);
      el.focus();
      hideMenu();
      showUndoState(el, original);
    } else {
      hideSuggest();
      hideMenu();
    }
  }

  // ── Action menu ───────────────────────────────────────────────────────────

  function getMenu() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "te-menu";

    ACTIONS.forEach(({ label, type, icon }, i) => {
      const btn = document.createElement("button");
      btn.className = "te-btn";
      btn.dataset.type = type;
      btn.dataset.label = label;

      const iconEl = document.createElement("span");
      iconEl.className = "te-btn-icon";
      iconEl.textContent = icon;

      const labelEl = document.createElement("span");
      labelEl.textContent = label;

      btn.appendChild(iconEl);
      btn.appendChild(labelEl);

      // divider after Proofread (index 2)
      if (i === 3) {
        const div = document.createElement("div");
        div.className = "te-divider";
        menu.appendChild(div);
      }

      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        runAction(type);
      });
      menu.appendChild(btn);
    });

    document.documentElement.appendChild(menu);
    return menu;
  }

  function toggleMenu() {
    const m = getMenu();
    if (m.style.display === "flex") {
      hideMenu();
    } else {
      showMenu();
    }
  }

  function showMenu() {
    const m = getMenu();
    const t = getTrigger();
    const tr = t.getBoundingClientRect();
    m.style.display = "flex";

    requestAnimationFrame(() => {
      const mw = m.offsetWidth  || 300;
      const mh = m.offsetHeight || 40;
      let left = tr.left - mw + 28;
      let top  = tr.top  - mh - 6;
      left = Math.max(8, Math.min(left, window.innerWidth  - mw - 8));
      if (top < 8) top = tr.bottom + 6;
      m.style.left = left + "px";
      m.style.top  = top  + "px";
    });
  }

  function hideMenu() {
    if (menu) { menu.style.display = "none"; resetBtns(); }
  }

  function resetBtns() {
    if (!menu) return;
    ACTIONS.forEach(({ label, type, icon }) => {
      const btn = menu.querySelector(`[data-type="${type}"]`);
      if (!btn) return;
      btn.disabled = false;
      btn.innerHTML = "";
      const iconEl = document.createElement("span");
      iconEl.className = "te-btn-icon";
      iconEl.textContent = icon;
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
    });
  }

  // ── Ollama ────────────────────────────────────────────────────────────────

  function callOllama(text, type) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          type: "ollama",
          payload: {
            model: MODEL,
            stream: false,
            options: { temperature: 0.3, num_predict: 160, num_ctx: 1024, keep_alive: -1 },
            messages: [
              { role: "system", content: SYSTEM_MSG[type] },
              ...SHOTS[type],
              { role: "user", content: `<input>${text}</input>` },
            ],
          },
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error("Refresh page and retry"));
          if (!resp?.ok) return reject(new Error(resp?.error || "Ollama error"));
          resolve(clean(resp.text));
        });
      } catch (e) {
        reject(new Error("Refresh page and retry"));
      }
    });
  }

  function clean(text) {
    return text
      .replace(/<[^>]+>/g, "")                                                              // strip any HTML/XML tags the model echoes
      .replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "")
      .replace(/^(Text:|Result:|Output:)\s*/i, "")
      .replace(/^(Here(?:'s| is)[^:\n]*[:—]\s*)/i, "")
      .replace(/^(Sure[,!]?[^:\n]*[:—]?\s*)/i, "")
      .replace(/^(The (?:improved|rewritten|corrected|shortened|professional|friendly) (?:text|version)[^:\n]*[:—]\s*)/i, "")
      .trim();
  }

  // Same as clean() but trims only the left (for live stream preview)
  function cleanLeft(text) {
    return text
      .replace(/<[^>]+>/g, "")                                                              // strip any HTML/XML tags the model echoes
      .replace(/^["'\u201C\u201D]/, "")
      .replace(/^(Text:|Result:|Output:)\s*/i, "")
      .replace(/^(Here(?:'s| is)[^:\n]*[:—]\s*)/i, "")
      .replace(/^(Sure[,!]?[^:\n]*[:—]?\s*)/i, "")
      .replace(/^(The (?:improved|rewritten|corrected|shortened|professional|friendly) (?:text|version)[^:\n]*[:—]\s*)/i, "")
      .trimStart();
  }

  // ── Smart action detection ────────────────────────────────────────────────

  function typoScore(text) {
    let score = 0;
    const lo = text.toLowerCase();
    // Shorthand / chat abbreviations
    if (/\b(u|r|ur|pls|thx|ty|idk|omg|lol|btw|fyi|asap|tbh|imo|ngl|smh)\b/.test(lo)) score++;
    // Missing apostrophes in contractions
    if (/\b(dont|cant|wont|im|ive|its|theyre|youre|didnt|wasnt|isnt|wouldnt|couldnt|havent|shouldnt)\b/.test(lo)) score++;
    // All lowercase with meaningful length
    if (text.length > 20 && text === text.toLowerCase()) score++;
    // Common misspellings
    if (/\b(recieve|occured|seperate|definately|freind|wierd|beleive|untill|begining|goverment|occassion)\b/.test(lo)) score++;
    return score;
  }

  // Pick the best action based on what the text actually needs
  function pickAction(text) {
    if (text.length > 220)   return "shorten";
    if (typoScore(text) >= 2) return "proofread";
    return "improve";
  }

  // Returns true if suggestion is too similar to original to be worth showing
  function tooSimilar(original, suggestion) {
    const norm = s => s.toLowerCase().replace(/[^\w\s]/g, "").trim();
    const a = norm(original);
    const b = norm(suggestion);
    if (a === b) return true;
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const shared = [...setA].filter(w => setB.has(w)).length;
    const union  = new Set([...setA, ...setB]).size;
    return shared / union >= 0.88;
  }

  // Open a streaming port to background, call onToken(rawSoFar) as tokens arrive,
  // onDone(cleanedFinal) when complete, onError(msg) on failure.
  // Returns the port — disconnect it to cancel.
  function streamOllama(text, type, onToken, onDone, onError) {
    let port;
    try { port = chrome.runtime.connect({ name: "te-stream" }); }
    catch (_) { onError("Reload page and retry"); return null; }

    let raw = "";

    port.onMessage.addListener((msg) => {
      if (msg.error) { onError(msg.error); return; }
      if (msg.token) {
        raw += msg.token;
        const preview = cleanLeft(raw);
        if (preview) onToken(preview);
      }
      if (msg.done) onDone(clean(raw));
    });

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) onError("Reload page and retry");
    });

    port.postMessage({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_MSG[type] },
        ...SHOTS[type],
        { role: "user", content: `<input>${text}</input>` },
      ],
      options: { temperature: 0.3, num_predict: 160, num_ctx: 1024, keep_alive: -1 },
    });

    return port;
  }

  // ── Action ────────────────────────────────────────────────────────────────

  async function runAction(type) {
    const el   = focused;
    const text = getText(el).trim();
    if (!text) { hideMenu(); return; }

    const btn = menu.querySelector(`[data-type="${type}"]`);
    menu.querySelectorAll(".te-btn").forEach(b => (b.disabled = true));
    btn.innerHTML = '<span class="te-btn-icon">⏳</span><span>Working...</span>';

    try {
      const result = await callOllama(text, type);
      setText(el, result);
      hideMenu();
    } catch (err) {
      resetBtns();
      const errBtn = menu.querySelector(`[data-type="${type}"]`);
      if (errBtn) errBtn.innerHTML = `<span class="te-btn-icon">⚠️</span><span>${err.message}</span>`;
      setTimeout(resetBtns, 2500);
    }
  }

  // ── Typing detection & auto-suggest ──────────────────────────────────────

  let typingTimer  = null;
  let suggestTimer = null;

  function handleTyping(el) {
    if (!isEditable(el)) return;
    focused = el;

    clearTimeout(typingTimer);
    clearTimeout(suggestTimer);
    hideMenu();
    hideSuggest();

    const text = getText(el).trim();
    if (text.length < 4) { hideTrigger(); return; }
    positionTrigger(el);

    // Auto-suggest: stream after 1.5s pause, text ≥8 chars, only if changed
    if (text.length >= 8 && text !== lastSuggestInput) {
      suggestTimer = setTimeout(() => {
        if (focused !== el) return;
        const current = getText(el).trim();
        if (current.length < 8 || current === lastSuggestInput) return;

        const myId   = ++suggestGenId;
        const action = pickAction(current);
        lastSuggestInput = current;
        showSuggestLoading(el);

        streamPort?.disconnect();
        streamPort = streamOllama(
          current,
          action,
          (preview) => { // called each token
            if (suggestGenId !== myId) return;
            showSuggestResult(preview);
          },
          (final) => {   // called when complete
            if (suggestGenId !== myId) return;
            if (final && !tooSimilar(current, final)) showSuggestResult(final);
            else hideSuggest();
          },
          () => {        // error
            if (suggestGenId !== myId) return;
            hideSuggest();
          }
        );
      }, 1500);
    }
  }

  function onInput(e) {
    if (!isEditable(e.target)) return;
    handleTyping(e.target);
  }

  // listen on input + paste + compositionend for full coverage
  document.addEventListener("input",          onInput);
  document.addEventListener("paste",          (e) => setTimeout(() => onInput(e), 50));
  document.addEventListener("compositionend", onInput);

  document.addEventListener("focusin", (e) => {
    if (!isEditable(e.target)) return;
    focused = e.target;
    const text = getText(e.target).trim();
    if (text.length >= 4) positionTrigger(e.target);
  });

  document.addEventListener("focusout", (e) => {
    setTimeout(() => {
      const active = document.activeElement;
      if (
        (trigger  && trigger.contains(active))  ||
        (menu     && menu.contains(active))     ||
        (suggest  && suggest.contains(active))  ||
        isEditable(active)
      ) return;
      hideTrigger();
      hideSuggest();
      clearTimeout(suggestTimer);
      focused = null;
    }, 200);
  });

  window.addEventListener("scroll", () => {
    if (focused) { positionTrigger(focused); positionSuggest(focused); }
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (focused) { positionTrigger(focused); positionSuggest(focused); }
  }, { passive: true });

  document.addEventListener("mousedown", (e) => {
    if (trigger && trigger.contains(e.target)) return;
    if (menu    && menu.contains(e.target))    return;
    if (suggest && suggest.contains(e.target)) return;
    hideMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideMenu();
      hideSuggest();
      clearTimeout(typingTimer);
      clearTimeout(suggestTimer);
    }
    // Tab to accept suggestion
    if (e.key === "Tab" && suggest && suggest.style.display !== "none" && suggestText) {
      e.preventDefault();
      applySuggestion();
    }
    // Ctrl+. to toggle action menu on any focused input
    if (e.key === "." && (e.ctrlKey || e.metaKey) && focused) {
      e.preventDefault();
      if (menu && menu.style.display === "flex") hideMenu();
      else showMenu();
    }
  });

  // Warmup: ask background to load the model so first real request is instant
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({
        type: "ollama",
        payload: {
          model: MODEL,
          stream: false,
          messages: [{ role: "user", content: "." }],
          options: { num_predict: 1, num_ctx: 256, keep_alive: -1 },
        },
      }, () => { chrome.runtime.lastError; });
    } catch (_) {}
  }, 3000);

})();
