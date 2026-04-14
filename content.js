(function () {
  "use strict";

  // Don't run inside our own extension pages
  if (window.location.protocol === "chrome-extension:") return;

  const MODEL = "llama-3.3-70b-versatile";

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
    improve:      "Improve the clarity, grammar, and flow of the text in <input> tags. Keep the same meaning, tone, length, and speaker perspective. Output ONLY the improved text. Do NOT include <input> tags or any explanation.",
    rewrite:      "Rephrase the text in <input> tags using different wording. Keep the same meaning, length, and speaker perspective. Output ONLY the rewritten text. Do NOT include <input> tags or any explanation.",
    proofread:    "Fix all grammar, spelling, and punctuation in the text in <input> tags. Do not change wording or style. Output ONLY the corrected text without <input> tags and without any explanation.",
    shorten:      "Shorten the text in <input> tags. Keep the core meaning and speaker's voice. Output ONLY the shortened text. Do NOT include <input> tags or any explanation.",
    professional: "Rewrite the text in <input> tags to sound formal and professional. Keep the same meaning, the same number of sentences, and the same length — do not add new sentences or new content. Output ONLY the rewritten text. Do NOT include <input> tags or any explanation.",
    friendly:     "Rewrite the text in <input> tags to sound warm and conversational. Keep the same meaning, the same number of sentences, and the same length — do not add new sentences or new content. Output ONLY the rewritten text. Do NOT include <input> tags or any explanation.",
    translate:    "Detect the language of the text in <input> tags. If it is not English, translate it to English. If it is already English, translate it to Spanish. Output ONLY the translation without <input> tags and without any explanation.",
    custom:       "", // filled dynamically from customPrompt
  };

  let trigger     = null; // small floating ✦ button
  let srBtn       = null; // dedicated Smart Reply 💬 button (outside menu)
  let menu        = null; // action menu panel
  let suggest     = null; // auto-suggestion bar
  let focused     = null; // currently focused editable element
  let lastFocused = null; // persists after blur so menu clicks still have a target

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

  function getSrBtn() {
    if (srBtn) return srBtn;
    srBtn = document.createElement("div");
    srBtn.id    = "te-sr-btn";
    srBtn.title = "Smart Reply";
    srBtn.textContent = "💬";
    srBtn.style.cssText = `
      position:fixed;z-index:2147483647;display:none;
      width:30px;height:30px;align-items:center;justify-content:center;
      background:#1e1e1e;color:#fff;font-size:15px;border-radius:50%;
      cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.35);
      user-select:none;border:1px solid #444;transition:background 0.15s;
    `;
    srBtn.addEventListener("mouseenter", () => { srBtn.style.background = "#2d2d2d"; });
    srBtn.addEventListener("mouseleave", () => { srBtn.style.background = "#1e1e1e"; });
    srBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    srBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      hideMenu();
      runSmartReply(focused || lastFocused);
    });
    document.documentElement.appendChild(srBtn);
    return srBtn;
  }

  function positionTrigger(el) {
    const t = getTrigger();
    const s = getSrBtn();
    t.style.display = "flex";
    s.style.display = "flex";
    if (triggerDragged) return;
    const r = el.getBoundingClientRect();
    const top  = Math.max(4, r.bottom - 34);
    const left = Math.max(4, r.right  - 34);
    t.style.top  = top  + "px";
    t.style.left = left + "px";
    s.style.top  = top  + "px";
    s.style.left = Math.max(4, left - 38) + "px";
  }

  function hideTrigger() {
    if (trigger) trigger.style.display = "none";
    if (srBtn)   srBtn.style.display   = "none";
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
      // divider before Professional (index 4)
      if (i === 4) {
        const div = document.createElement("div");
        div.className = "te-divider";
        menu.appendChild(div);
      }

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
    const host    = window.location.hostname;
    const usage   = siteUsage[host] || {};
    const btns    = [...menu.querySelectorAll(".te-btn[data-type]")];
    const divider = menu.querySelector(".te-divider");

    const pinned  = ["translate", "custom"];
    const sorted  = btns
      .filter(b => !pinned.includes(b.dataset.type))
      .sort((a, b) => (usage[b.dataset.type] || 0) - (usage[a.dataset.type] || 0));
    const pinnedBtns = btns.filter(b => pinned.includes(b.dataset.type));

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

    // Context window: input tokens ≈ chars/3.5, add headroom for system + shots + output
    const inputTokens = Math.ceil(chars / 3.5);
    const num_ctx = Math.min(32768, Math.max(2048, inputTokens * 2 + 1200));

    // num_predict: -1 = unlimited (model stops when done naturally).
    // Only shorten gets a ceiling since output is intentionally smaller than input.
    let num_predict;
    if (type === "shorten") {
      if (w > 400)      num_predict = 500;
      else if (w > 200) num_predict = 280;
      else if (w > 100) num_predict = 150;
      else              num_predict = 80;
    } else {
      num_predict = -1;
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

  // ── Smart Reply: chat history extraction ─────────────────────────────────

  function extractChatHistory(inputEl) {
    const host = window.location.hostname;

    // ── WhatsApp Web ──────────────────────────────────────────────────────
    if (host.includes("web.whatsapp.com")) {
      const msgs = [];
      document.querySelectorAll("#main .message-in, #main .message-out").forEach(el => {
        const isMe = el.classList.contains("message-out");
        const text = (el.querySelector(".copyable-text") || el).innerText?.split("\n")[0]?.trim();
        if (text) msgs.push({ role: isMe ? "me" : "them", content: text });
      });
      return msgs.slice(-30);
    }

    // ── LinkedIn Messages ─────────────────────────────────────────────────
    if (host.includes("linkedin.com")) {
      const msgs = [];
      const container = document.querySelector(
        ".msg-s-message-list-container, .msg-overlay-conversation-bubble__content-wrapper"
      );
      if (container) {
        container.querySelectorAll(".msg-s-message-list__event").forEach(el => {
          const isMe = !!el.querySelector(".msg-s-event-listitem--outgoing, .msg-s-message-list__event--right");
          const text = el.querySelector(".msg-s-event-listitem__body, .msg-s-message-list__event-body")?.innerText?.trim();
          if (text) msgs.push({ role: isMe ? "me" : "them", content: text });
        });
        return msgs.slice(-30);
      }
    }

    // ── Fiverr + Generic ─────────────────────────────────────────────────
    // Walk up from input to find scrollable chat container
    let container = inputEl?.parentElement;
    const maxDepth = host.includes("fiverr.com") ? 20 : 12;
    for (let i = 0; i < maxDepth; i++) {
      if (!container || container === document.body) break;
      if (container.scrollHeight > container.clientHeight + 100 &&
          container.children.length > 2) break;
      container = container.parentElement;
    }
    if (!container || container === document.body) return [];

    // Narrow to the direct child that holds the input (excludes sidebars)
    let searchRoot = inputEl;
    while (searchRoot?.parentElement && searchRoot.parentElement !== container) {
      searchRoot = searchRoot.parentElement;
    }
    if (!searchRoot || searchRoot === container) searchRoot = container;
    if (!searchRoot) return [];

    // ── Strategy 1: "Me" label detection (works for Fiverr inbox list layout)
    // Fiverr inbox shows "Me" as an explicit sender label next to Nadir's messages.
    // Find all those labels and mark their ancestor rows so we can classify content.
    const myRowRoots = new Set();
    Array.from(searchRoot.querySelectorAll("*")).forEach(el => {
      if (el.children.length > 0) return;
      if (el.innerText?.trim() !== "Me") return;
      // Walk up and tag the next 5 ancestors as "my message" containers
      let node = el.parentElement;
      for (let i = 0; i < 5 && node && node !== searchRoot; i++) {
        myRowRoots.add(node);
        node = node.parentElement;
      }
    });

    function isMyRow(el) {
      let node = el;
      while (node && node !== searchRoot) {
        if (myRowRoots.has(node)) return true;
        node = node.parentElement;
      }
      return false;
    }

    const seen   = new Set();
    let   lastTs = null;
    const candidates = [];

    Array.from(searchRoot.querySelectorAll("*")).forEach(el => {
      // Leaf nodes only — skips containers whose innerText bundles username+timestamp+message
      if (!el || el.children.length > 0) return;
      const text = el.innerText?.trim();
      if (!text || text.length < 2 || seen.has(text)) return;

      const ts = parseMessageTimestamp(text);
      if (ts) { lastTs = ts; return; }

      if (text === "Me") return;
      if (/^[A-Z]{1,4}$/.test(text)) return;                                    // avatar initial / short all-caps label (NAK, etc.)
      if (/^\w+$/.test(text) && /\d/.test(text) && text.length < 30) return;    // username9000 style
      if (/^\d{1,2}:\d{2}(\s*(AM|PM))?$/i.test(text)) return;
      if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i.test(text)) return;
      if (/\d+(\.\d+)?\s*(MB|KB|GB)/i.test(text)) return;
      if (/^\d+\s*Files?$/i.test(text)) return;
      if (/^Attachment_\d+/.test(text)) return;
      if (/Screen Recording/i.test(text)) return;
      // Sidebar duration/delivery strings ("3 days", "7 hours ago", etc.)
      if (/^\d+\s*(days?|hours?|minutes?)\s*(ago)?$/i.test(text)) return;
      // Fiverr UI buttons and system strings
      if (/^(create an offer|send offer|add extras|view order|order details|request extension|learn more|share feedback|we have your back)$/i.test(text)) return;
      if (/joined the conversation/i.test(text)) return;
      if (/take a moment to browse/i.test(text)) return;
      // Bot/system messages referencing the freelancer by full name
      if (/Nadir Ali Khan/i.test(text)) return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 5) return;

      // Only include elements that are above (or at) the input — exclude any sidebar below/right
      if (inputEl) {
        const inputRect = inputEl.getBoundingClientRect();
        if (rect.top > inputRect.bottom + 20) return;   // below the input area
        if (rect.left > inputRect.right  + 5)  return;  // to the right of the input (sidebar)
      }

      // Skip elements with no timestamp — these are sidebar/UI elements before the chat starts
      if (lastTs === null) return;

      seen.add(text);
      candidates.push({ el, text, rect, timestamp: lastTs });
    });

    if (!candidates.length) return [];

    // If we found "Me" labels, use label-based detection
    if (myRowRoots.size > 0) {
      return candidates.slice(-30).map(c => ({
        role:      isMyRow(c.el) ? "me" : "them",
        content:   c.text,
        timestamp: c.timestamp,
      }));
    }

    // ── Strategy 2: Dynamic position-based (bubble chat layouts)
    // Filter out full-width rows that give misleading center X
    const rootWidth = searchRoot.getBoundingClientRect().width || window.innerWidth;
    const bubbles   = candidates.filter(c => c.rect.width <= rootWidth * 0.82);
    if (!bubbles.length) return candidates.slice(-30).map(c => ({ role: "them", content: c.text, timestamp: c.timestamp }));

    const centers     = bubbles.map(c => c.rect.left + c.rect.width / 2);
    const dynamicMidX = (Math.min(...centers) + Math.max(...centers)) / 2;

    return bubbles.slice(-30).map(c => ({
      role:      (c.rect.left + c.rect.width / 2) > dynamicMidX ? "me" : "them",
      content:   c.text,
      timestamp: c.timestamp,
    }));
  }

  // ── Smart Reply helpers ───────────────────────────────────────────────────

  function parseMessageTimestamp(text) {
    const m = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2}\s*(AM|PM)?)/i);
    if (!m) return null;
    try { return new Date(`${m[1]} ${m[2]}, ${new Date().getFullYear()} ${m[3]}`); } catch (_) { return null; }
  }

  function detectClientType(chatMsgs) {
    const all = chatMsgs.map(m => m.content).join(" ").toLowerCase();
    if (/\b(order|delivery|revision|phase|deployed|running|logs?|testing|live|milestone|submitted|bot|code)\b/.test(all)) {
      if (/\b(issue|bug|error|not working|fix|broken|problem|help)\b/.test(all)) return "support";
      return "active_order";
    }
    return "potential"; // still discussing / no order yet
  }

  function buildSmartReplyMessages(chatMsgs, draftText) {
    const lastMsg     = chatMsgs[chatMsgs.length - 1];
    const lastThemMsg = [...chatMsgs].reverse().find(m => m.role === "them");

    // Time since client's last message
    let timeNote = "";
    if (lastThemMsg?.timestamp) {
      const mins = (Date.now() - lastThemMsg.timestamp.getTime()) / 60000;
      if (mins >= 120) {
        const hrs = Math.round(mins / 60);
        timeNote = `Note: The client's message was sent ~${hrs} hour${hrs > 1 ? "s" : ""} ago — briefly acknowledge the wait (e.g., "Thanks for your patience").`;
      } else if (mins >= 45) {
        timeNote = `Note: The client's message was sent ~${Math.round(mins)} minutes ago.`;
      }
    }

    const recentMsgs = chatMsgs.slice(-6);
    const lines = recentMsgs.map(m =>
      `${m.role === "me" ? "You" : "Them"}: ${m.content}`
    ).join("\n");

    // Match reply length to last client message complexity
    const lastClientMsg = chatMsgs[chatMsgs.length - 1]?.content || "";
    const lengthGuide = lastClientMsg.length < 20
      ? "Reply with 1 short sentence only."
      : lastClientMsg.length < 80
        ? "Keep the reply to 1–2 sentences."
        : "Keep the reply to 2–3 sentences max.";

    const system = `Write a short, natural reply to the last message. ${lengthGuide}${timeNote ? " " + timeNote : ""} Reply ONLY about what was discussed. Output ONLY the reply text.`;

    const userContent = lines
      ? `Recent messages:\n${lines}${draftText ? `\n\nDraft started: ${draftText}` : ""}\n\nWrite your reply to their last message:`
      : draftText
        ? `Draft started: "${draftText}"\nComplete and improve this reply.`
        : "Write a brief, friendly opening reply.";

    return { system, userContent, lastMsg };
  }

  async function runSmartReply(el) {
    if (!el) return;

    const s = getSrBtn();
    const origText = s.textContent;
    s.textContent = "⏳";
    s.style.pointerEvents = "none";

    const draftText = getText(el).trim();
    const chatMsgs  = extractChatHistory(el);
    console.log("[TE] extractedChat", JSON.stringify(chatMsgs, null, 2));

    // Only reply if client sent the last message
    if (chatMsgs.length > 0 && chatMsgs[chatMsgs.length - 1].role === "me") {
      s.textContent = "✓";
      setTimeout(() => { s.textContent = origText; s.style.pointerEvents = ""; }, 1800);
      return;
    }

    const { system, userContent } = buildSmartReplyMessages(chatMsgs, draftText);

    // Use the streaming port — more reliable than sendMessage (avoids SW cold-start drops)
    const result = await new Promise((resolve, reject) => {
      let port;
      try { port = chrome.runtime.connect({ name: "te-stream" }); }
      catch (e) { reject(new Error("Reload page and retry: " + e.message)); return; }

      let raw = "";
      let settled = false;
      const done = (val) => { if (settled) return; settled = true; port.disconnect(); resolve(val); };
      const fail  = (err) => { if (settled) return; settled = true; port.disconnect(); reject(err);  };

      const timer = setTimeout(() => fail(new Error("Timed out — retry")), 60000);

      port.onMessage.addListener((msg) => {
        console.log("[TE] SR msg:", JSON.stringify(msg).slice(0, 120));
        if (msg.error) { clearTimeout(timer); fail(new Error(msg.error)); return; }
        if (msg.token) raw += msg.token;
        if (msg.done)  { clearTimeout(timer); done(clean(raw)); }
      });

      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message;
        clearTimeout(timer);
        console.log("[TE] SR port disconnected, raw.length:", raw.length, "err:", err);
        if (!settled) fail(new Error(err || "Port closed — reload page and retry"));
      });

      port.postMessage({
        messages: [
          { role: "system", content: system },
          { role: "user",   content: userContent },
        ],
        options: { temperature: 0.65, num_predict: 150 },
      });
    }).catch(err => {
      console.error("[TE] Smart Reply error:", err?.message);
      s.textContent = "⚠";
      s.style.pointerEvents = "";
      setTimeout(() => { s.textContent = origText; }, 2000);
      return null;
    });

    if (result) {
      if (draftText) {
        undoStack.push({ el, text: draftText });
        if (undoStack.length > 5) undoStack.shift();
      }
      setText(el, result);
      trackUsage("smartreply");
      s.textContent = origText;
      s.style.pointerEvents = "";
    }
  }

  // ── Action ────────────────────────────────────────────────────────────────

  async function runAction(type) {
    const el = focused || lastFocused;

    if (type === "custom") {
      showCustomPromptInput(el);
      return;
    }

    const text = getText(el).trim();
    if (!text) { hideMenu(); return; }

    if (!menu) return;
    const btn = menu.querySelector(`[data-type="${type}"]`);
    if (!btn) return;
    menu.querySelectorAll(".te-btn").forEach(b => (b.disabled = true));
    btn.innerHTML = '<span class="te-btn-icon">⏳</span><span>Working...</span>';

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

  function rebuildMenu(m) {
    m.innerHTML = "";
    m.style.minWidth = "";
    ACTIONS.forEach(({ label, type, icon }, i) => {
      if (i === 4) { const div = document.createElement("div"); div.className = "te-divider"; m.appendChild(div); }
      const btn = document.createElement("button");
      btn.className = "te-btn";
      btn.dataset.type = type;
      btn.dataset.label = label;
      const iconEl = document.createElement("span"); iconEl.className = "te-btn-icon"; iconEl.textContent = icon;
      const labelEl = document.createElement("span"); labelEl.textContent = label;
      btn.appendChild(iconEl); btn.appendChild(labelEl);
      btn.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); runAction(type); });
      m.appendChild(btn);
    });
  }

  function showCustomPromptInput(el) {
    const m = getMenu();
    m.innerHTML = "";
    m.style.minWidth = "280px";

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "padding:10px;display:flex;flex-direction:column;gap:8px;";

    // Header row
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const backBtn = document.createElement("button");
    backBtn.className = "te-btn";
    backBtn.style.cssText = "padding:4px 10px;font-size:12px;width:auto;";
    backBtn.innerHTML = '<span class="te-btn-icon">←</span><span>Back</span>';
    backBtn.addEventListener("mousedown", (e) => { e.preventDefault(); rebuildMenu(m); });

    const headerLabel = document.createElement("div");
    headerLabel.textContent = "Custom instruction";
    headerLabel.style.cssText = "font-size:11px;color:#aaa;font-weight:500;flex:1;";

    topRow.appendChild(backBtn);
    topRow.appendChild(headerLabel);

    // Instruction textarea
    const textarea = document.createElement("textarea");
    textarea.value = customPrompt;
    textarea.placeholder = "Tell AI what to do, e.g:\n• Tell him I need 2 more days\n• Ask for his requirements\n• Apologize for the delay";
    textarea.rows = 4;
    textarea.style.cssText = "background:#2d2d2d;color:#fff;border:1px solid #555;border-radius:6px;padding:8px;font-size:12px;outline:none;resize:vertical;width:100%;box-sizing:border-box;font-family:inherit;line-height:1.5;";
    textarea.addEventListener("keydown", (e) => e.stopPropagation());

    // Chat context toggle
    const chatMsgs = extractChatHistory(el);
    const hasChatCtx = chatMsgs.length > 0;

    const ctxRow = document.createElement("div");
    ctxRow.style.cssText = "display:flex;align-items:center;gap:6px;";
    const ctxCheck = document.createElement("input");
    ctxCheck.type = "checkbox";
    ctxCheck.id = "te-ctx-toggle";
    ctxCheck.checked = hasChatCtx;
    ctxCheck.disabled = !hasChatCtx;
    ctxCheck.style.cssText = "accent-color:#0a66c2;cursor:pointer;";
    const ctxLabel = document.createElement("label");
    ctxLabel.htmlFor = "te-ctx-toggle";
    ctxLabel.textContent = hasChatCtx ? `Include chat (${chatMsgs.length} msgs)` : "No chat detected";
    ctxLabel.style.cssText = `font-size:11px;color:${hasChatCtx ? "#aaa" : "#555"};cursor:pointer;`;
    ctxRow.appendChild(ctxCheck);
    ctxRow.appendChild(ctxLabel);

    const runBtn = document.createElement("button");
    runBtn.className = "te-btn";
    runBtn.innerHTML = '<span class="te-btn-icon">▶</span><span>Run</span>';
    runBtn.style.cssText = "justify-content:center;background:#0a66c2;color:#fff;border-radius:8px;";
    runBtn.addEventListener("mousedown", async (e) => {
      e.preventDefault();
      const instruction = textarea.value.trim();
      if (!instruction) return;
      customPrompt = instruction;
      try { chrome.storage.local.set({ te_custom_prompt: customPrompt }); } catch (_) {}

      runBtn.innerHTML = '<span class="te-btn-icon">⏳</span><span>Working...</span>';
      runBtn.disabled = true;

      const inputText = getText(el).trim();
      const useChatCtx = ctxCheck.checked && hasChatCtx;

      // Build system + user content with optional chat context
      let system, userContent;
      if (useChatCtx) {
        const chatLines = chatMsgs.map(m =>
          `${m.role === "me" ? "Nadir (me)" : "Client"}: ${m.content}`
        ).join("\n");
        system = `You are helping Nadir Ali, a Top Rated Freelancer on Fiverr, write a message to a client. Use the chat history for context. Follow the instruction exactly. Keep the reply concise and professional (2–3 sentences max). Output ONLY the message text — no explanation.`;
        userContent = `Chat history:\n${chatLines}\n\nInstruction: ${instruction}${inputText ? `\n\nDraft: ${inputText}` : ""}\n\nWrite Nadir's reply:`;
      } else {
        system = `Follow this instruction: ${instruction}\nThe text is in <input> tags. Output ONLY the result — no explanation.`;
        userContent = `<input>${inputText || "..."}</input>`;
      }

      hideMenu();
      m.style.minWidth = "";

      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: "ollama",
            payload: {
              model: MODEL, stream: false,
              options: { temperature: 0.65, num_predict: 150 },
              messages: [
                { role: "system", content: system },
                { role: "user",   content: userContent },
              ],
            },
          }, (resp) => {
            if (chrome.runtime.lastError) return reject(new Error("Refresh page and retry"));
            if (!resp?.ok) return reject(new Error(resp?.error || "AI error"));
            resolve(clean(resp.text));
          });
        });
        if (inputText) { undoStack.push({ el, text: inputText }); if (undoStack.length > 5) undoStack.shift(); }
        setText(el, result);
        trackUsage("custom");
      } catch (_) {}
    });

    wrapper.appendChild(topRow);
    wrapper.appendChild(textarea);
    wrapper.appendChild(ctxRow);
    wrapper.appendChild(runBtn);
    m.appendChild(wrapper);
    setTimeout(() => textarea.focus(), 50);
  }

  // ── Typing detection & auto-suggest ──────────────────────────────────────

  let typingTimer  = null;
  let suggestTimer = null;

  function handleTyping(el) {
    if (!isEditable(el)) return;
    focused = el; lastFocused = el;

    clearTimeout(typingTimer);
    clearTimeout(suggestTimer);
    hideMenu();
    hideSuggest();

    positionTrigger(el);

    const text = getText(el).trim();

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
    focused = e.target; lastFocused = e.target;
    positionTrigger(e.target);
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
