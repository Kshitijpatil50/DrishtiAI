# Drishti AI

# **[LIVE DEPLOYED APP: https://drishtiai-lyart.vercel.app/)**

**A hands-free, trilingual (`EN` · `हिं` · `म`) voice-first camera guide for blind and low-vision users — engineered around Gnani Prisma v3.0, Gnani Timbre v3.0 (Shivani), and Multimodal Vision.**

> **Hackathon Evaluators:** Read the **1-page Solution Pitch** right below or open the standalone **[`PITCH.md`](./PITCH.md)** document.

---

## Solution Pitch (1 Page)

### The Problem
Blind and low-vision users across India navigate crowded spaces, stairs, doorways, and daily printed text using accessibility tools that fall short in three ways:
1. **Sighted UI friction**: Force menu navigation and manual triggers instead of proactive, eyes-free assistance.
2. **Zero visual continuity**: Forget a door, staircase, or personal item seconds after the camera pans past it.
3. **Weak Indian language & voice support**: Struggle with **Hindi, Marathi, Indian English, and code-mixed speech** (*"मेरे सामने table पर क्या है?"*).

### Our Solution
**Drishti AI** transforms a smartphone's camera and microphone into a calm, zero-clutter companion. Point the camera ahead and walk—Drishti **proactively warns of hazards first**, answers spoken questions strictly in **the exact language you spoke or typed (`English`, `Hindi`, or `Marathi`)**, and searches **short-term visual frame memory** to help you locate objects or paths you passed seconds earlier.

### Why Gnani AI Is at the Core
Drishti AI is built from the ground up around **Gnani Prisma v3.0** and **Gnani Timbre v3.0 (Shivani)** with production voice-AI reliability:
- **Code-Mixed Multilingual ASR (`Prisma v3.0`)**: Supports `mr-IN,hi-IN,en-IN` and `hi-IN,en-IN,mr-IN` (`format: codemix`) fed by a custom **AudioWorklet VAD + 400ms pre-roll ring buffer** so hands-free speech never drops the first word.
- **Natural Indian Voice Prosody (`Timbre v3.0 — Shivani`)**: A custom **trilingual TTS sanitizer** converts raw digits and decimals into spoken English, Hindi (`दशमलव`), and Marathi (`दशांश`) words, strips markdown artifacts, and batches short sentences for warm, human pacing.
- **Concurrency & Hazard-Preemption Queuing**: Client (`GnaniSerialQueue`) and server (`GnaniServerQueue`) mutexes serialize Gnani calls to respect single-active-request constraints cleanly, let **urgent hazard alerts jump ahead of routine narration**, and handle rapid barge-in aborts with cooldown & retry backoff.

### Key Innovations
- **Proactive Hazard-First Vision**: Frame-diffing triggers vision inference only when scenes change meaningfully, prioritizing stairs, drops, vehicles, wet floors, and obstacles with haptic vibration.
- **Short-Term Visual Memory (`VisualFrameMemory`)**: Retains distinct recent camera keyframes with timestamps and notes to answer spatial whereabouts questions (*"Where did I see my keys?"* / *"पायऱ्या कुठे होत्या?"*).
- **Strict Same-Language Question → Answer Guarantee**: Evaluates transcript language ahead of provider metadata and anchors Gemini's output language per turn—preventing cross-turn language drift.
- **Instant Barge-In & Acoustic Echo Gating**: Speak anytime—even while Drishti is speaking—to interrupt audio playback and abort stale requests immediately without echo loops.

---

## Try It in 30 Seconds (Judge Walkthrough)

1. Open the **[Live Deployed App](https://ais-pre-u3yx2mmipfypvnj7c6t5ze-782659439587.asia-southeast1.run.app)** and allow Camera + Microphone access *(or add `?autostart=1` to skip the start screen)*.
2. **Hear Proactive Guidance**: Drishti greets you in **Shivani's voice** and begins hazard-first scene narration when the view changes.
3. **Test Multilingual Q&A & Barge-In**:
   - Switch between **`EN`**, **`हिं`**, and **`म`** in the top-right header—or ask directly in **English, Hindi, or Marathi** by voice or via the bottom input bar.
   - Ask a question **while Drishti is mid-sentence** (or tap anywhere) to see instant **barge-in preemption**.
   - Pan past an item and ask *"Where did you see the door/stairs?"* to test **VisualFrameMemory**.
   - **Double-tap anywhere** (or click **Quiet mode**) to silence proactive narration while keeping Q&A ready.

> *Note on deployed testing:* Environment keys power `/api/*` automatically when configured; if testing on an unconfigured preview deployment, a compact **Manual API Keys** panel appears so evaluators can test with their own Gemini & Gnani keys directly.

---

## Engineering Deep Dive

| Challenge | Engineering Solution in Drishti AI | Implementation |
| :--- | :--- | :--- |
| **Gnani active-request concurrency & barge-in races** | Client & server serial queues with hazard priority jumping, abort cooldown (`450ms`), and exponential busy retry backoff (`429` / transient errors) | `src/services/gnani.ts`, `server/gnaniConcurrency.ts` |
| **Clipped opening syllables on hands-free VAD** | Custom `AudioWorklet` (`vader-processor`) capturing at native rate with a **400ms circular pre-roll buffer**, adaptive noise floor, and 16kHz PCM WAV downsampling | `src/audio/capture.ts`, `src/audio/vad.ts`, `src/audio/wav.ts` |
| **TTS eating its own voice & robotic numerals** | Post-playback acoustic echo suppression + overlap echo detector, plus English/Hindi/Marathi number-to-word & decimal normalizer | `src/services/sanitize.ts`, `src/audio/player.ts` |
| **Cross-turn language drift in multilingual Q&A** | Transcript-first STT language detection (`mr` / `hi` / `en` + guarded Romanized detection) paired with server-side per-turn language locks | `src/state/machine.ts`, `server/language.ts`, `server/app.ts` |
| **Spatial forgetfulness ("where did I pass X?")** | `VisualFrameMemory` deduplicates static frames via thumbnail MAD diffing and injects chronological recent frames + elapsed seconds into Q&A prompts | `src/vision/memory.ts`, `src/vision/differ.ts` |
| **Vision latency / cold-model timeouts** | Hedged parallel fallback (`gemini-3.1-flash-lite` → `gemini-4-hydrogen`) with sticky healthy-model cache and client disconnect abort propagation | `server/geminiFallback.ts`, `server/app.ts` |

---

## Architecture

```
Browser (React 19 + Vite + Tailwind CSS v4)
 ├── AudioCaptureService   ──▶ AudioWorklet VAD (400ms pre-roll) + 16kHz WAV + echo gating
 ├── VisionTracker         ──▶ Thumbnail MAD change detection (450ms loop) + VisualFrameMemory
 ├── AudioPlayerService    ──▶ Gnani MP3 playback + sentence batching + speechSynthesis resilience
 └── Assistant FSM         ──▶ IDLE → OBSERVING ↔ LISTENING → TRANSCRIBING → THINKING → SPEAKING / QUIET
        │
        ▼  /api/* (Express Server & Vercel Serverless Functions)
 ├── POST /api/gnani/stt       ──▶ Gnani Prisma v3.0 (codemix STT, queued + retry backoff)
 ├── POST /api/gnani/tts       ──▶ Gnani Timbre v3.0 (Shivani 24kHz MP3, queued + abort cooldown)
 ├── POST /api/gemini/scene    ──▶ Gemini Vision (proactive hazard-first JSON narration)
 ├── POST /api/gemini/question ──▶ Gemini Vision + VisualFrameMemory + Strict Language Enforcement
 └── GET  /api/config          ──▶ Non-secret injection & runtime diagnostics
```

---

## Repository Structure

```text
├── api/                     # Explicit Vercel serverless endpoints (/api/config, /api/gemini/*, /api/gnani/*)
├── server/
│   ├── app.ts               # Express API routes, Gnani & Gemini proxy handlers
│   ├── geminiFallback.ts    # Hedged & sequential Gemini model fallback with abort signals
│   ├── gnaniConcurrency.ts  # Server-side serial queue & interrupt cooldown
│   ├── language.ts          # Per-question language resolution & explicit switch detection
│   └── configStatus.ts      # Environment & header API key diagnostics
├── server.ts                # Express + Vite server entry point (port 3000)
├── src/
│   ├── audio/               # AudioWorklet VAD, 16kHz WAV encoder, audio player
│   ├── components/          # Dynamic Orb visualizer, ConfigDiagnostics, ManualApiKeysBox
│   ├── services/            # Gnani STT/TTS client & queue, Gemini client, trilingual TTS sanitizer
│   ├── state/               # Finite state machine & English/Hindi/Marathi detector
│   ├── vision/              # Frame differencing, simulated stream fallback, VisualFrameMemory
│   └── App.tsx              # Accessible voice-first single-screen application
├── PITCH.md                 # Standalone 1-page hackathon solution pitch
├── .env.example             # Environment variables template
└── vercel.json              # Vercel build & SPA/API routing configuration
```

---

## Local Setup & Verification

### Prerequisites
- **Node.js 20+**
- **Gemini API Key** ([Google AI Studio](https://aistudio.google.com/apikey))
- **Gnani API Key** (`X-API-Key-ID` for `https://api.vachana.ai`)

### Run Locally
```bash
git clone <your-github-repo-url>
cd <your-repo-folder>
npm install
cp .env.example .env
# Add GEMINI_API_KEY and GNANI_API_KEY to .env
npm run dev
```
Open `http://localhost:3000` (append `?autostart=1` to jump directly into the active camera view).

### Automated Tests & Quality Checks
Verified with **65/65 passing unit tests** covering state transitions, VAD math, WAV encoding, TTS sanitization, Gnani concurrency, visual memory, Vercel routing, and language enforcement:

```bash
npm test     # Runs 65 unit tests across src/**/*.test.ts & server/**/*.test.ts via tsx + node:test
npm run lint # TypeScript static type-check (tsc --noEmit)
npm run build # Production Vite build (dist/)
npm start    # Production Express server
```

---

## Deploying to Vercel

1. Import this repository into Vercel (`vercel.json` is pre-configured for Vite + `/api/*` Serverless Functions).
2. Add `GEMINI_API_KEY` and `GNANI_API_KEY` in **Vercel Dashboard → Project → Settings → Environment Variables** (`Production`, `Preview`, `Development`).
3. Deploy.

---

## License

Licensed under the Apache License, Version 2.0.
