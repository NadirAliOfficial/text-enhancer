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

  const SYSTEM = "";

  // Few-shot chat messages — show the model exactly what to do before the real input
  const SHOTS = {
    improve: [
      { role: "user",      content: "<input>cant make it tmrw sry</input>" },
      { role: "assistant", content: "I cannot make it tomorrow, sorry." },
      { role: "user",      content: "<input>i wanna ask if u have time to review my work</input>" },
      { role: "assistant", content: "I wanted to ask if you have time to review my work." },
      { role: "user",      content: "<input>the deadline is tmrw and i havent started this is bad</input>" },
      { role: "assistant", content: "The deadline is tomorrow and I have not started yet, which is a serious problem." },
    ],
    rewrite: [
      { role: "user",      content: "<input>I am sorry for the late reply I was busy</input>" },
      { role: "assistant", content: "Please accept my apologies for the delayed response; I was occupied with other matters." },
      { role: "user",      content: "<input>I want to ask if you have time to check my work</input>" },
      { role: "assistant", content: "I was wondering if you would have time to review my work." },
      { role: "user",      content: "<input>I sent the proposal yesterday did you get a chance to look at it</input>" },
      { role: "assistant", content: "I submitted the proposal yesterday — have you had a chance to review it?" },
      { role: "user",      content: "<input>I need your help with this task can you assist</input>" },
      { role: "assistant", content: "I could use your help with this task — would you be able to assist?" },
    ],
    proofread: [
      { role: "user",      content: "<input>i dont no what happend yesterday</input>" },
      { role: "assistant", content: "I don't know what happened yesterday." },
      { role: "user",      content: "<input>i recieved ur messege and will get back to u soon as posible</input>" },
      { role: "assistant", content: "I received your message and will get back to you as soon as possible." },
      { role: "user",      content: "<input>their going to there house to pick there stuff</input>" },
      { role: "assistant", content: "They're going to their house to pick up their stuff." },
      { role: "user",      content: "<input>its a grate opurtunity and i dont want to miss it</input>" },
      { role: "assistant", content: "It's a great opportunity and I don't want to miss it." },
    ],
    shorten: [
      { role: "user",      content: "<input>I just wanted to let you know that I will not be able to attend the meeting scheduled for tomorrow morning due to a prior commitment</input>" },
      { role: "assistant", content: "I cannot make tomorrow's meeting — prior commitment." },
      { role: "user",      content: "<input>I wanted to reach out because I have been thinking about our last conversation and I feel like we did not fully address all the points that were raised</input>" },
      { role: "assistant", content: "I don't think we fully addressed everything in our last conversation." },
      { role: "user",      content: "<input>Could you please let me know at your earliest convenience whether you will be able to complete the task that was assigned to you last week</input>" },
      { role: "assistant", content: "Can you let me know if you can complete last week's task?" },
      { role: "user",      content: "<input>I sent the document to you earlier today and I was wondering if you had a chance to go through it yet</input>" },
      { role: "assistant", content: "Did you get a chance to review the document I sent today?" },
    ],
    professional: [
      { role: "user",      content: "<input>hey can u send me that asap</input>" },
      { role: "assistant", content: "Could you please send that at your earliest convenience?" },
      { role: "user",      content: "<input>i need to talk about my rate its not fair what youre paying me</input>" },
      { role: "assistant", content: "I would like to discuss my compensation, as I believe a rate adjustment is warranted." },
      { role: "user",      content: "<input>the client rejected the work and wants a refund this is crazy</input>" },
      { role: "assistant", content: "The client has rejected the deliverable and is requesting a refund." },
      { role: "user",      content: "<input>this is taking way too long and nobody is helping me</input>" },
      { role: "assistant", content: "The timeline has exceeded expectations and I have not received adequate support." },
    ],
    friendly: [
      { role: "user",      content: "<input>Please submit the report by end of day.</input>" },
      { role: "assistant", content: "Hey, could you send over the report by end of day? Thanks so much!" },
      { role: "user",      content: "<input>Your invoice has been processed and payment will be made within 30 days.</input>" },
      { role: "assistant", content: "Good news — your invoice is all set and payment should come through within 30 days!" },
      { role: "user",      content: "<input>We regret to inform you that your application has not been successful.</input>" },
      { role: "assistant", content: "Hey, so sorry to share this — unfortunately your application did not make it through this time." },
    ],
  };

  const SYSTEM_MSG = {
    improve:      "You are a text transformer. The user sends text wrapped in <input> tags. Output ONLY the improved version — better clarity and grammar, same meaning. Keep the same speaker and perspective as the original. Do NOT reply to the text. Do NOT answer questions in it. Do NOT add content not in the original. Do NOT add any intro, label, or explanation. Output just the transformed text.",
    rewrite:      "You are a text transformer. The user sends text wrapped in <input> tags. Output ONLY a rephrased version with the same meaning. Keep the same speaker and perspective as the original — if the input says 'I sent you', output must also say 'I sent you', not 'you sent me'. Do NOT reply to the text. Do NOT answer questions in it. Do NOT add any intro, label, or explanation. Output just the transformed text.",
    proofread:    "You are a text transformer. The user sends text wrapped in <input> tags. Output ONLY the corrected text with all grammar, spelling, and punctuation errors fixed. Keep the same speaker and perspective. Do NOT reply to the text. Do NOT answer questions in it. Do NOT add any intro, label, or explanation. Output just the corrected text.",
    shorten:      "You are a text transformer. The user sends text wrapped in <input> tags. Output ONLY a shorter version that keeps the key message. Keep the same speaker and perspective as the original — do not switch who is speaking or who is being addressed. Do NOT reply to the text. Do NOT answer questions in it. Do NOT add any intro, label, or explanation.",
    professional: "You are a text transformer. The user sends text wrapped in <input> tags. Output ONLY a formal professional version. Use only what is in the original — do NOT add opinions, context, or new content. Keep the same speaker and perspective. Do NOT reply to the text. Do NOT answer questions in it. Do NOT add any intro, label, or explanation. Output just the transformed text.",
    friendly:     "You are a text transformer. The user sends text wrapped in <input> tags. Output ONLY a warm, friendly, casual version. Keep the same speaker and perspective. Do NOT reply to the text. Do NOT answer questions in it. Do NOT add any intro, label, or explanation. Output just the transformed text.",
  };

  let trigger  = null; // small floating ✦ button
  let menu     = null; // action menu panel
  let focused  = null; // currently focused editable element

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isEditable(el) {
    if (!el || el.id === "te-trigger" || el.id === "te-menu") return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      return ["text","search","email","url","tel","password",""].includes(t);
    }
    return false;
  }

  function getText(el) {
    if (!el) return "";
    if (el.isContentEditable) return el.innerText || el.textContent || "";
    return el.value || "";
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
            options: { temperature: 0.3, num_predict: 300 },
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
      .replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "")
      .replace(/^(Text:|Result:|Output:)\s*/i, "")
      .replace(/^(Here(?:'s| is)[^:\n]*[:—]\s*)/i, "")
      .replace(/^(Sure[,!]?[^:\n]*[:—]?\s*)/i, "")
      .replace(/^(The (?:improved|rewritten|corrected|shortened|professional|friendly) (?:text|version)[^:\n]*[:—]\s*)/i, "")
      .trim();
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

  // ── Auto-show after typing stops ─────────────────────────────────────────

  let typingTimer = null;

  function onInput(e) {
    if (!isEditable(e.target)) return;
    focused = e.target;
    clearTimeout(typingTimer);
    hideMenu(); // hide while typing
    const text = getText(e.target).trim();
    if (text.length < 4) { hideTrigger(); return; }
    positionTrigger(e.target);
    // Auto-show menu 900ms after user stops typing
    typingTimer = setTimeout(() => {
      if (focused === e.target && getText(e.target).trim().length >= 4) {
        showMenu();
      }
    }, 900);
  }

  document.addEventListener("input", onInput);

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
        (trigger && trigger.contains(active)) ||
        (menu    && menu.contains(active))    ||
        isEditable(active)
      ) return;
      hideTrigger();
      focused = null;
    }, 200);
  });

  window.addEventListener("scroll", () => { if (focused) positionTrigger(focused); }, { passive: true });
  window.addEventListener("resize", () => { if (focused) positionTrigger(focused); }, { passive: true });

  document.addEventListener("mousedown", (e) => {
    if (trigger && trigger.contains(e.target)) return;
    if (menu    && menu.contains(e.target))    return;
    hideMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideMenu(); clearTimeout(typingTimer); }
  });

})();
