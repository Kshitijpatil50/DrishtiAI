# Drishti AI

**A hands-free, multilingual voice-first camera companion for blind and low-vision users — powered by Gnani Prisma v3.0, Gnani Timbre v3.0 (Shivani), and Gemini Multimodal Vision.**

> **Hackathon Submission Note:** Looking for the 1-page pitch? Read the **[Solution Pitch](#solution-pitch-1-page)** right below or open the standalone **[`PITCH.md`](./PITCH.md)** document.

---

## Solution Pitch (1 Page)

### Problem
For blind and low-vision users—especially across India—existing visual assistance tools often force menu-heavy touch interactions, stay silent until manually triggered, forget what the camera saw seconds ago, and struggle with natural Indian English, Hindi, Marathi, or code-mixed speech.

### Solution
**Drishti AI** turns a phone's rear camera and microphone into an always-ready, warm spoken guide. Point the camera ahead and Drishti proactively calls out hazards first, answers spoken or typed questions with low-latency visual reasoning, remembers recent camera frames to answer whereabouts queries (*"Where did we pass the stairs?"*), and replies strictly in the language you ask in (**English**, **Hindi**, or **Marathi**).

### How It Uses Gnani AI
- **Gnani Prisma v3.0 (`/stt/v3`)**: Multilingual, code-mixed speech-to-text (`mr-IN,hi-IN,en-IN` / `hi-IN,en-IN,mr-IN`) that transcribes natural Indian English, Hindi, and Marathi questions.
- **Gnani Timbre v3.0 (`/api/v1/tts/inference`, voice `Shivani`)**: Natural, warm Indian voice synthesis paired with text-to-speech normalization (converting digits and decimals into spoken words in English, Hindi, and Marathi) and instant barge-in cancellation.
- **Serial Concurrency & Priority Queue**: Custom client and server queues serialize active Gnani requests, jump hazard alerts ahead of routine narration, and enforce cooldowns on mid-speech interrupts.

### Key Innovations
- **Proactive Hazard-First Narration**: Thumbnail-diff vision tracking triggers scene narration only on meaningful visual changes and prioritizes stairs, vehicles, obstacles, or approaching people.
- **Short-Term Visual Frame Memory**: Stores distinct recent camera keyframes with timestamps and notes, allowing users to ask where an object, doorway, or path appeared moments earlier.
- **Hands-Free Voice Activity Detection & Barge-In**: Custom `AudioWorklet` VAD with a `400ms` pre-roll buffer, acoustic echo suppression, and token-based cancellation lets users interrupt Drishti mid-sentence just by speaking.
- **Strict Same-Language Question → Answer Enforcement**: Evaluates transcript language ahead of provider locale tags and guards conversation history so English, Hindi, and Marathi questions always receive answers in that exact language.

---

## Features at a Glance

| Capability | Details |
| :--- | :--- |
| **Languages** | **English (`EN`)**, **Hindi (`हिं`)**, and **Marathi (`म`)** across UI, STT, vision Q&A, TTS, and number-to-word sanitization |
| **Voice Input** | Hands-free `AudioWorklet` VAD + `400ms` pre-roll, native `SpeechRecognition` fallback, multimodal Gemini audio fallback, and accessible typed query bar |
| **Voice Output** | Gnani Timbre v3.0 (`Shivani`) primary playback with automatic browser `speechSynthesis` resilience and haptic vibration on hazards |
| **Vision & Memory** | Real-time rear-camera narration (`450ms` tracker loop) + chronological `VisualFrameMemory` for spatial whereabouts questions |
| **Accessibility UX** | Tap anywhere to talk/interrupt, double-tap (or footer button) for **Quiet Mode**, high-contrast readable live captions, and screen-reader labels |
| **Resilient Backend** | Express API + Vercel Serverless Functions (`/api/*`), Gemini model fallback (`gemini-3.1-flash-lite` → `gemini-4-hydrogen`), and optional deployed-only manual API key entry |

---

## Architecture

```
Browser (React 19 + Vite + Tailwind CSS)
 ├── AudioCaptureService (AudioWorklet VAD, 16kHz WAV encoder, echo gating)
 ├── VisionTracker + VisualFrameMemory (thumbnail diffing & recent frame buffer)
 ├── AudioPlayerService (MP3 playback, sentence batching, barge-in abort)
 └── Assistant State Machine (IDLE → OBSERVING ↔ LISTENING → TRANSCRIBING → THINKING → SPEAKING / QUIET)
        │
        ▼  /api/* (Express dev/prod server & Vercel Serverless Functions)
 ├── POST /api/gnani/stt       ──▶ Gnani Prisma v3.0 (queued + backoff retry)
 ├── POST /api/gnani/tts       ──▶ Gnani Timbre v3.0 — Shivani (queued + abort cooldown)
 ├── POST /api/gemini/scene    ──▶ Gemini Vision (proactive hazard & scene JSON)
 ├── POST /api/gemini/question ──▶ Gemini Vision + Visual Memory + Strict Language Rules
 └── GET  /api/config          ──▶ Non-secret server key & runtime diagnostics
```

---

## Project Structure

```text
├── api/                     # Vercel serverless entrypoints (/api/config, /api/gemini/*, /api/gnani/*)
├── server/
│   ├── app.ts               # Express API routes, Gnani & Gemini proxy handlers
│   ├── geminiFallback.ts    # Active Flash model fallback, hedged question calls, timeouts
│   ├── gnaniConcurrency.ts  # Server-side serial queue & abort cooldown for Gnani API
│   ├── language.ts          # Question language detection & explicit switch resolution
│   └── configStatus.ts      # Safe environment/header key resolution & diagnostics
├── server.ts                # Unified Express + Vite dev/production server (port 3000)
├── src/
│   ├── audio/               # AudioWorklet VAD, 16kHz PCM WAV encoder, audio player
│   ├── components/          # Orb visualizer, API diagnostics, deployed-mode key entry
│   ├── services/            # Gnani STT/TTS client queue, Gemini client, TTS sanitizer
│   ├── state/               # Finite state machine & multilingual text language detector
│   ├── vision/              # Frame differencing, stream capture, VisualFrameMemory
│   └── App.tsx              # Accessible voice-first single-screen application
├── PITCH.md                 # Standalone 1-page hackathon solution pitch
├── .env.example             # Environment variables template
└── vercel.json              # Vercel build & SPA/API routing config
```

---

## Getting Started (Local Development)

### Prerequisites
- **Node.js 20+**
- A **Gemini API Key** ([Google AI Studio](https://aistudio.google.com/apikey))
- A **Gnani API Key** (`X-API-Key-ID` for `api.vachana.ai`)

### 1. Clone & Install
```bash
git clone <your-github-repo-url>
cd <your-repo-folder>
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
GNANI_API_KEY="YOUR_GNANI_API_KEY"
```

### 3. Run Locally
```bash
npm run dev
```
Open `http://localhost:3000` (append `?autostart=1` to skip the tap-to-start screen during testing).

---

## Scripts & Verification

```bash
npm test    # Run unit tests via tsx + node:test (src/**/*.test.ts & server/**/*.test.ts)
npm run lint # TypeScript type-check (tsc --noEmit)
npm run build # Production Vite client build (dist/)
npm start   # Run Express production server
```

---

## Deploying to Vercel

1. Import this repository into Vercel (`vercel.json` is pre-configured for Vite + `/api/*` Serverless Functions).
2. Add `GEMINI_API_KEY` and `GNANI_API_KEY` in **Vercel Dashboard → Project → Settings → Environment Variables** (Production, Preview, Development).
3. Deploy. If server keys are omitted in a deployed preview, the built-in **Manual API Keys** panel lets testers supply temporary keys locally in browser `localStorage` via secure request headers.

---

## License

Licensed under the Apache License, Version 2.0. See file headers for details.
