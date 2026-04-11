(function () {
  "use strict";

  // Don't run inside our own extension pages
  if (window.location.protocol === "chrome-extension:") return;

  const MODEL = "llama3.2";

  const ACTIONS = [
    { label: "Improve",      type: "improve" },
    { label: "Rewrite",      type: "rewrite" },
    { label: "Proofread",    type: "proofread" },
    { label: "Shorten",      type: "shorten" },
    { label: "Professional", type: "professional" },
    { label: "Friendly",     type: "friendly" },
  ];

  const SYSTEM = "";

  // Few-shot chat messages — show the model exactly what to do before the real input
  const SHOTS = {
    improve: [
      { role: "user",      content: "cant make it tmrw sry" },
      { role: "assistant", content: "I cannot make it tomorrow, sorry." },
      { role: "user",      content: "this dont make no sense" },
      { role: "assistant", content: "This does not make any sense." },
    ],
    rewrite: [
      { role: "user",      content: "I need you to send me the file" },
      { role: "assistant", content: "Please forward the file to me." },
      { role: "user",      content: "this is not working" },
      { role: "assistant", content: "The current approach is not effective." },
    ],
    proofread: [
      { role: "user",      content: "i dont no what happend yesterday" },
      { role: "assistant", content: "I don't know what happened yesterday." },
      { role: "user",      content: "its a grate opurtunity" },
      { role: "assistant", content: "It's a great opportunity." },
    ],
    shorten: [
      { role: "user",      content: "I just wanted to let you know that I will not be able to attend the meeting scheduled for tomorrow morning" },
      { role: "assistant", content: "I cannot attend tomorrow's meeting." },
      { role: "user",      content: "I really appreciate everything that you have done for me" },
      { role: "assistant", content: "I appreciate everything you have done." },
    ],
    professional: [
      { role: "user",      content: "hey can u send me that asap" },
      { role: "assistant", content: "Could you please send that at your earliest convenience?" },
      { role: "user",      content: "this is messed up and i dont have time for this" },
      { role: "assistant", content: "This situation requires urgent attention and I am unable to accommodate further delays." },
    ],
    friendly: [
      { role: "user",      content: "Please submit the report by end of day." },
      { role: "assistant", content: "Hey, could you send over the report by end of day? Thanks so much!" },
      { role: "user",      content: "Your request has been denied." },
      { role: "assistant", content: "Hey, so sorry about this — we are not able to do that one!" },
    ],
  };

  const SYSTEM_MSG = {
    improve:      "You are a text editor. The user sends raw text. Reply with ONLY the improved text — no intro, no explanation, no label, no commentary. Do not start with 'Here is', 'Sure', or any similar phrase. Output the edited text directly.",
    rewrite:      "You are a text editor. The user sends raw text. Reply with ONLY the rewritten text — no intro, no explanation, no label. Do not start with 'Here is', 'Sure', or any similar phrase. Output the rewritten text directly.",
    proofread:    "You are a text editor. The user sends raw text. Reply with ONLY the corrected text — no intro, no explanation, no label. Do not start with 'Here is', 'Sure', or any similar phrase. Output the corrected text directly.",
    shorten:      "You are a text editor. The user sends raw text. Reply with ONLY a shorter version — no intro, no explanation, no label. Do not start with 'Here is', 'Sure', or any similar phrase. Output the shortened text directly.",
    professional: "You are a text editor. The user sends raw text. Reply with ONLY a formal professional version — no intro, no explanation, no label. Do not start with 'Here is', 'Sure', or any similar phrase. Output the rewritten text directly.",
    friendly:     "You are a text editor. The user sends raw text. Reply with ONLY a warm friendly casual version — no intro, no explanation, no label. Do not start with 'Here is', 'Sure', or any similar phrase. Output the rewritten text directly.",
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
    const top  = r.bottom + window.scrollY - 28;
    const left = r.right  + window.scrollX - 28;
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

    ACTIONS.forEach(({ label, type }) => {
      const btn = document.createElement("button");
      btn.className = "te-btn";
      btn.dataset.type = type;
      btn.textContent = label;
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
    ACTIONS.forEach(({ label, type }) => {
      const btn = menu.querySelector(`[data-type="${type}"]`);
      if (btn) { btn.textContent = label; btn.disabled = false; }
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
              { role: "user", content: text },
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
    btn.textContent = "...";

    try {
      const result = await callOllama(text, type);
      setText(el, result);
      hideMenu();
    } catch (err) {
      resetBtns();
      btn.textContent = err.message;
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
