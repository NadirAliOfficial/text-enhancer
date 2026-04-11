# Text Enhancer

A Chrome browser extension that improves, rewrites, proofreads, and transforms text in any input box on any website — powered by a fully local Ollama model. Works on Fiverr, LinkedIn, Gmail, and everywhere else.

Built by **Team NAK — Nadir Ali Khan**

---

## Features

- Works on **any website** — Fiverr, LinkedIn, Gmail, Upwork, anywhere
- Auto-shows action buttons after you stop typing (no selection needed)
- 6 actions: Improve, Rewrite, Proofread, Shorten, Professional, Friendly
- Powered by local Ollama (llama3.2) — 100% private, zero API costs
- Replaces text in-place instantly
- Small floating trigger button for manual use anytime

---

## Requirements

- [Ollama](https://ollama.com) installed and running locally
- `llama3.2` model: `ollama pull llama3.2`
- Chrome browser

---

## Setup

### 1. Start Ollama

```bash
ollama serve
```

Confirm it is running at `http://localhost:11434`.

### 2. Load the Extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `text-enhancer` folder
5. Go to **Details → Site access → On all sites**

### 3. Use It

**Auto mode:**
1. Click into any text box on any website
2. Type your message
3. Stop typing — action buttons appear automatically after ~1 second
4. Click any button to transform the text in place

**Manual mode:**
1. Click into any text box
2. A small **✦** button appears at the bottom-right of the input
3. Click **✦** to open the action menu anytime

---

## Actions

| Action | What it does |
|---|---|
| **Improve** | Better clarity, grammar, and flow — same meaning |
| **Rewrite** | Completely rewritten — same core meaning |
| **Proofread** | Fixes grammar, spelling, and punctuation only |
| **Shorten** | Shorter version keeping the key message |
| **Professional** | Formal, business-appropriate tone |
| **Friendly** | Warm, casual, conversational tone |

---

## File Structure

```
text-enhancer/
├── manifest.json     # Extension config (Manifest V3)
├── content.js        # Text detection, UI, trigger button, action menu
├── background.js     # Service worker — handles Ollama API fetch
├── styles.css        # Minimal dark toolbar styling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Privacy

All AI processing runs locally via Ollama. No text is ever sent to any external server. No accounts, no API keys, no subscriptions required.

---

## Author

**Nadir Ali Khan** — Founder & CEO, Team NAK  
GitHub: [NadirAliOfficial](https://github.com/NadirAliOfficial)
