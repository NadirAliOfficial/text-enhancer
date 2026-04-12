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
    { label: "Translate",    type: "translate",    icon: "🌐" },
    { label: "Custom",       type: "custom",       icon: "⚙️" },
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
    translate: [
      { role: "user",      content: "<input>Bonjour, comment puis-je vous aider aujourd'hui?</input>" },
      { role: "assistant", content: "Hello, how can I help you today?" },
      { role: "user",      content: "<input>Hello, I would like to schedule a meeting for next week.</input>" },
      { role: "assistant", content: "Hola, me gustaría programar una reunión para la próxima semana." },
    ],
  };

  let customPrompt = "Make this text more concise and impactful.";
  try { chrome.storage.local.get("te_custom_prompt", r => { if (r.te_custom_prompt) customPrompt = r.te_custom_prompt; }); } catch (_) {}

  // SHOTS for dynamic types (empty — no few-shot needed for translate/custom)
  SHOTS.translate = SHOTS.translate || [];
  SHOTS.custom    = [];

  const SYSTEM_MSG = {
    improve:      "Rewrite the text in <input> tags with better clarity and grammar. Output ONLY the result, same meaning and perspective, no explanation.",
    rewrite:      "Rephrase the text in <input> tags. Output ONLY the result, same meaning and speaker perspective, no explanation.",
    proofread:    "Fix all grammar and spelling in the text in <input> tags. Output ONLY the corrected text, no explanation.",
    shorten:      "Shorten the text in <input> tags, keep core meaning and speaker. Output ONLY the result, no explanation.",
    professional: "Make the text in <input> tags formal and professional. Output ONLY the result, same perspective, no added content.",
    friendly:     "Make the text in <input> tags warm and casual. Output ONLY the result, same perspective, no explanation.",
    translate:    "Detect the language of the text in <input> tags. If it is not English, translate it to English. If it is already English, translate it to Spanish. Output ONLY the translation, no explanation.",
    custom:       "", // filled dynamically from customPrompt
  };

  let trigger  = null; // small floating ✦ button
  let menu     = null; // action menu panel
  let suggest  = null; // auto-suggestion bar
  let focused  = null; // currently focused editable element

  let suggestFor       = null;  // element the suggestion targets
  let suggestText      = "";    // suggested replacement text
  let suggestGenId     = 0;     // increments each request — stale responses are dropped
  let lastSuggestInput = "";    // last text we suggested for (avoid re-triggering)
  let streamPort       = null;  // active streaming port (disconnect to cancel)
  let undoStack        = [];    // multi-level undo: [{el, text}, ...] max 5
  let suggestDragged   = false; // true after user drags the bar — skip auto-reposition
  let triggerDragged   = false; // true after user drags the trigger — skip auto-reposition
  let originalForDiff  = "";    // text before suggestion — for diff view
  let siteUsage        = {};    // per-site action usage counts {hostname: {type: count}}

  // Load per-site usage from storage
  try { chrome.storage.local.get("te_site_usage", r => { if (r.te_site_usage) siteUsage = r.te_site_usage; }); } catch (_) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isEditable(el) {
    if (!el) return false;
    const id = el.id;
    if (id === "te-trigger" || id === "te-menu" || id === "te-suggest") return false;
    if (el.closest && el.closest("#te-suggest, #te-menu")) return false;
    // On LinkedIn, skip all contentEditable divs — the AI commenter handles those
    if (el.isContentEditable && window.location.hostname.includes("linkedin.com")) return false;
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

    let tDrag = null;
    let tMoved = false;
    trigger.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = trigger.getBoundingClientRect();
      tDrag  = { ox: e.clientX - r.left, oy: e.clientY - r.top };
      tMoved = false;
      trigger.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", (e) => {
      if (!tDrag) return;
      const dx = e.clientX - (tDrag.ox + parseFloat(trigger.style.left || 0));
      const dy = e.clientY - (tDrag.oy + parseFloat(trigger.style.top  || 0));
      if (!tMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      tMoved = true;
      triggerDragged = true;
      const x = Math.max(4, Math.min(e.clientX - tDrag.ox, window.innerWidth  - 34));
      const y = Math.max(4, Math.min(e.clientY - tDrag.oy, window.innerHeight - 34));
      trigger.style.left = x + "px";
      trigger.style.top  = y + "px";
    });
    document.addEventListener("mouseup", (e) => {
      if (!tDrag) return;
      const wasMoved = tMoved;
      tDrag = null; tMoved = false;
      trigger.style.cursor = "";
      if (!wasMoved) toggleMenu();
    });

    document.documentElement.appendChild(trigger);
    return trigger;
  }

  function positionTrigger(el) {
    const t = getTrigger();
    t.style.display = "flex";
    if (triggerDragged) return; // user repositioned it — leave it there
    const r = el.getBoundingClientRect();
    const top  = r.bottom - 34;
    const left = r.right  - 34;
    t.style.top  = Math.max(4, top)  + "px";
    t.style.left = Math.max(4, left) + "px";
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
      if (accept.classList.contains("undo") && undoStack.length) {
        const { el, text: original } = undoStack.pop();
        setText(el, original);
        lastSuggestInput = original;
        el.focus();
        if (undoStack.length) {
          updateUndoBtn(accept);
        } else {
          hideSuggest();
        }
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

    // ── Drag to reposition ──────────────────────────────────────────────────
    let drag = null;
    suggest.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return; // don't drag when clicking buttons
      e.preventDefault();
      const r = suggest.getBoundingClientRect();
      drag = { ox: e.clientX - r.left, oy: e.clientY - r.top };
      suggest.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", (e) => {
      if (!drag) return;
      suggestDragged = true;
      const x = Math.max(0, Math.min(e.clientX - drag.ox, window.innerWidth  - suggest.offsetWidth  - 4));
      const y = Math.max(0, Math.min(e.clientY - drag.oy, window.innerHeight - suggest.offsetHeight - 4));
      suggest.style.left = x + "px";
      suggest.style.top  = y + "px";
    });
    document.addEventListener("mouseup", () => {
      if (drag) { drag = null; suggest.style.cursor = ""; }
    });

    return suggest;
  }

  function positionSuggest(el) {
    if (!suggest || suggest.style.display === "none" || suggestDragged) return;
    const r = el.getBoundingClientRect();
    suggest.style.top      = (r.bottom + 6) + "px";
    suggest.style.left     = Math.max(8, r.left) + "px";
    suggest.style.maxWidth = Math.min(520, window.innerWidth - Math.max(8, r.left) - 12) + "px";
  }

  const ACTION_LABELS = { improve: "Improve", proofread: "Proofread", shorten: "Shorten", rewrite: "Rewrite", professional: "Professional", friendly: "Friendly" };

  function showSuggestLoading(el, action) {
    suggestFor    = el;
    suggestDragged = false; // reset drag so bar re-anchors below the input
    const s = getSuggest();
    s.style.borderColor = "";
    s.querySelector("#te-suggest-label").textContent = "✨ " + (ACTION_LABELS[action] || "");
    s.querySelector("#te-suggest-text").textContent  = "Analyzing…";
    const accept = s.querySelector("#te-suggest-accept");
    accept.textContent       = "Accept (Tab)";
    accept.style.background  = "";
    accept.style.display     = "none";
    s.querySelector("#te-suggest-dismiss").textContent = "✕";
    const r = el.getBoundingClientRect();
    s.style.top      = (r.bottom + 6) + "px";
    s.style.left     = Math.max(8, r.left) + "px";
    s.style.maxWidth = Math.min(520, window.innerWidth - Math.max(8, r.left) - 12) + "px";
    s.style.display  = "flex";
  }

  function wordDiffHtml(original, updated) {
    const a = original.split(/\s+/);
    const b = updated.split(/\s+/);
    const setA = new Set(a);
    const setB = new Set(b);
    return b.map(w => setA.has(w) ? w : `<mark>${w}</mark>`).join(" ");
  }

  function showSuggestResult(text) {
    if (!suggest || suggest.style.display === "none") return;
    suggestText = text;
    const textEl = suggest.querySelector("#te-suggest-text");
    if (originalForDiff && text.length > 5) {
      textEl.innerHTML = wordDiffHtml(originalForDiff, text);
    } else {
      textEl.textContent = text;
    }
    suggest.querySelector("#te-suggest-accept").style.display = "";
  }

  function hideSuggest() {
    streamPort?.disconnect();
    streamPort     = null;
    suggestDragged = false;
    if (suggest) {
      suggest.style.display = "none";
      const accept = suggest.querySelector("#te-suggest-accept");
      if (accept) { accept.classList.remove("undo"); accept.style.background = ""; }
    }
    suggestFor  = null;
    suggestText = "";
    suggestGenId++;
  }

  function updateUndoBtn(accept) {
    const levels = undoStack.length;
    accept.textContent      = levels > 1 ? `Undo (${levels})` : "Undo";
    accept.style.background = "#333";
    accept.classList.add("undo");
    accept.style.display    = "";
  }

  function showUndoState(el, original) {
    const s = getSuggest();
    s.style.borderColor = "#22c55e";
    s.querySelector("#te-suggest-label").textContent = "✓";
    s.querySelector("#te-suggest-text").textContent  = "Applied";
    const accept = s.querySelector("#te-suggest-accept");
    updateUndoBtn(accept);
    s.querySelector("#te-suggest-dismiss").textContent = "✕";
    if (!suggestDragged) {
      const r = el.getBoundingClientRect();
      s.style.top  = (r.bottom + 6) + "px";
      s.style.left = Math.max(8, r.left) + "px";
    }
    s.style.display = "flex";
    setTimeout(() => { if (!undoStack.length) hideSuggest(); }, 5000);
  }

  function applySuggestion() {
    if (suggestFor && suggestText) {
      const el          = suggestFor;
      const original    = getText(el).trim();
      const replacement = suggestText;
      lastSuggestInput  = replacement;
      clearTimeout(suggestTimer);
      suggestGenId++;
      streamPort?.disconnect(); streamPort = null;
      suggestFor  = null;
      suggestText = "";
      // Push to undo stack
      undoStack.push({ el, text: original });
      if (undoStack.length > 5) undoStack.shift();
      setText(el, replacement);
      el.focus();
      hideMenu();
      trackUsage("auto");
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

  function reorderMenuByUsage() {
    if (!menu) return;
    const host  = window.location.hostname;
    const usage = siteUsage[host] || {};
    const btns  = [...menu.querySelectorAll(".te-btn[data-type]")];
    const divider = menu.querySelector(".te-divider");
    // Sort by usage desc, keep custom + translate at bottom
    const pinned = ["translate", "custom"];
    const sorted = btns
      .filter(b => !pinned.includes(b.dataset.type))
      .sort((a, b) => (usage[b.dataset.type] || 0) - (usage[a.dataset.type] || 0));
    const pinnedBtns = btns.filter(b => pinned.includes(b.dataset.type));
    // Re-append in sorted order
    sorted.forEach(b => menu.appendChild(b));
    if (divider) menu.appendChild(divider);
    pinnedBtns.forEach(b => menu.appendChild(b));
  }

  function showMenu() {
    const m = getMenu();
    reorderMenuByUsage();
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

  // ── Dynamic options based on text size ───────────────────────────────────

  function wordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  // Returns the right system message — shorten gets a precise word-count target
  function getSystemMsg(type, text) {
    if (type === "shorten") {
      const w = wordCount(text);
      let target;
      if (w > 400)      target = "200 to 280 words";
      else if (w > 200) target = "90 to 130 words";
      else if (w > 100) target = "45 to 70 words";
      else if (w > 50)  target = "20 to 35 words";
      else              target = "about half the current length";
      return `Shorten the text in <input> tags to approximately ${target}. Keep the core meaning and the speaker's voice. Output ONLY the shortened text, no explanation.`;
    }
    return SYSTEM_MSG[type];
  }

  // Returns Ollama options scaled to the text length so large texts don't fail
  function getOllamaOptions(type, text) {
    const chars = text.length;
    const w     = wordCount(text);

    // Context window: input tokens ≈ chars/3.5, add headroom for system + shots
    const inputTokens = Math.ceil(chars / 3.5);
    const num_ctx = Math.min(8192, Math.max(1024, inputTokens + 800));

    // Predict budget: enough tokens for expected output
    let num_predict;
    if (type === "shorten") {
      if (w > 400)      num_predict = 380;
      else if (w > 200) num_predict = 200;
      else if (w > 100) num_predict = 110;
      else              num_predict = 60;
    } else if (type === "proofread") {
      num_predict = Math.min(1200, Math.max(160, Math.ceil(w * 1.15)));
    } else if (["improve", "rewrite", "professional", "friendly"].includes(type)) {
      num_predict = Math.min(800, Math.max(160, Math.ceil(w * 1.2)));
    } else {
      num_predict = 160;
    }

    return { temperature: 0.3, num_predict, num_ctx, keep_alive: -1 };
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
            options: getOllamaOptions(type, text),
            messages: [
              { role: "system", content: getSystemMsg(type, text) },
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

  // Returns true if text is a URL, email, or code — skip auto-suggest
  function shouldSkip(text) {
    const t = text.trim();
    if (/^https?:\/\/\S+$/.test(t))          return true; // URL
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true; // email
    if (/[{}\[\]<>]|function\s*\(|=>\s*{|import\s+|const\s+|var\s+|def\s+/.test(t)) return true; // code
    return false;
  }

  // Pick the best action based on what the text actually needs
  function pickAction(text) {
    if (text.length > 220)    return "shorten";
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
        { role: "system", content: getSystemMsg(type, text) },
        ...SHOTS[type],
        { role: "user", content: `<input>${text}</input>` },
      ],
      options: getOllamaOptions(type, text),
    });

    return port;
  }

  // ── Action ────────────────────────────────────────────────────────────────

  async function runAction(type) {
    const el   = focused;
    const text = getText(el).trim();
    if (!text) { hideMenu(); return; }

    // Custom action: show prompt input inline
    if (type === "custom") {
      showCustomPromptInput(el);
      return;
    }

    const btn = menu.querySelector(`[data-type="${type}"]`);
    menu.querySelectorAll(".te-btn").forEach(b => (b.disabled = true));
    btn.innerHTML = '<span class="te-btn-icon">⏳</span><span>Working...</span>';

    // Set custom system message dynamically
    if (type === "custom") SYSTEM_MSG.custom = `${customPrompt} The text is in <input> tags. Output ONLY the result, no explanation.`;

    try {
      const result = await callOllama(text, type);
      // Push to undo stack before replacing
      undoStack.push({ el, text });
      if (undoStack.length > 5) undoStack.shift();
      setText(el, result);
      hideMenu();
      trackUsage(type);
    } catch (err) {
      resetBtns();
      const errBtn = menu.querySelector(`[data-type="${type}"]`);
      if (errBtn) errBtn.innerHTML = `<span class="te-btn-icon">⚠️</span><span>${err.message}</span>`;
      setTimeout(resetBtns, 2500);
    }
  }

  function trackUsage(type) {
    const host = window.location.hostname;
    if (!siteUsage[host]) siteUsage[host] = {};
    siteUsage[host][type] = (siteUsage[host][type] || 0) + 1;
    try { chrome.storage.local.set({ te_site_usage: siteUsage }); } catch (_) {}
  }

  function showCustomPromptInput(el) {
    const m = getMenu();
    m.innerHTML = "";
    m.style.minWidth = "260px";

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "padding:10px;display:flex;flex-direction:column;gap:8px;";

    // Back button row
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const backBtn = document.createElement("button");
    backBtn.className = "te-btn";
    backBtn.style.cssText = "padding:4px 10px;font-size:12px;width:auto;";
    backBtn.innerHTML = '<span class="te-btn-icon">←</span><span>Back</span>';
    backBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      m.style.minWidth = "";
      m.innerHTML = "";
      // Rebuild menu buttons
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
        if (i === 3) { const div = document.createElement("div"); div.className = "te-divider"; m.appendChild(div); }
        btn.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); runAction(type); });
        m.appendChild(btn);
      });
    });

    const labelEl = document.createElement("div");
    labelEl.textContent = "Custom instruction";
    labelEl.style.cssText = "font-size:11px;color:#aaa;font-weight:500;flex:1;";

    topRow.appendChild(backBtn);
    topRow.appendChild(labelEl);

    // Textarea (large)
    const textarea = document.createElement("textarea");
    textarea.value = customPrompt;
    textarea.placeholder = "e.g. Make it sound like Hemingway\ne.g. Translate to French\ne.g. Make it more persuasive";
    textarea.rows = 4;
    textarea.style.cssText = "background:#2d2d2d;color:#fff;border:1px solid #555;border-radius:6px;padding:8px;font-size:12px;outline:none;resize:vertical;width:100%;box-sizing:border-box;font-family:inherit;line-height:1.5;";
    textarea.addEventListener("keydown", (e) => e.stopPropagation()); // prevent Ctrl+. etc

    const runBtn = document.createElement("button");
    runBtn.className = "te-btn";
    runBtn.innerHTML = '<span class="te-btn-icon">▶</span><span>Run</span>';
    runBtn.style.cssText = "justify-content:center;background:#0a66c2;color:#fff;border-radius:8px;";
    runBtn.addEventListener("mousedown", async (e) => {
      e.preventDefault();
      customPrompt = textarea.value.trim() || customPrompt;
      try { chrome.storage.local.set({ te_custom_prompt: customPrompt }); } catch (_) {}
      hideMenu();
      m.style.minWidth = "";
      SYSTEM_MSG.custom = `${customPrompt} The text is in <input> tags. Output ONLY the result, no explanation.`;
      SHOTS.custom = [];
      const text = getText(el).trim();
      if (!text) return;
      const result = await callOllama(text, "custom").catch(() => null);
      if (result) {
        undoStack.push({ el, text });
        if (undoStack.length > 5) undoStack.shift();
        setText(el, result);
        trackUsage("custom");
      }
    });

    wrapper.appendChild(topRow);
    wrapper.appendChild(textarea);
    wrapper.appendChild(runBtn);
    m.appendChild(wrapper);
    setTimeout(() => textarea.focus(), 50);
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

    // Auto-suggest: stream after 1.5s pause, text ≥8 chars, only if changed and not a URL/code
    if (text.length >= 8 && text !== lastSuggestInput && !shouldSkip(text)) {
      suggestTimer = setTimeout(() => {
        if (focused !== el) return;
        const current = getText(el).trim();
        if (current.length < 8 || current === lastSuggestInput || shouldSkip(current)) return;

        const myId   = ++suggestGenId;
        const action = pickAction(current);
        lastSuggestInput = current;
        originalForDiff  = current;
        showSuggestLoading(el, action);

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
