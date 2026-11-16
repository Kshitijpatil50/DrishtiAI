<div align="center">

# 👁️ Drishti AI - https://drishtiai-lyart.vercel.app

### A hands-free, voice-first camera guide for blind and low-vision users, in English, Hindi and Marathi.

Point the phone ahead and walk. Drishti warns you about hazards first, remembers what the camera saw a few seconds ago, and answers your questions out loud in the language you spoke.

[![Live App](https://img.shields.io/badge/Live%20App-Open%20Drishti-2ea44f?style=for-the-badge)](https://drishtiai-lyart.vercel.app/)
[![Pitch](https://img.shields.io/badge/Read-1%20Page%20Pitch-blue?style=for-the-badge)](./PITCH.md)

![Tests](https://img.shields.io/badge/tests-70%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6)
![React](https://img.shields.io/badge/React-19-61dafb)
![Languages](https://img.shields.io/badge/voice-EN%20%C2%B7%20%E0%A4%B9%E0%A4%BF%E0%A4%82%20%C2%B7%20%E0%A4%AE-orange)
![License](https://img.shields.io/badge/license-Apache%202.0-lightgrey)

**Built for the Gnani.ai Great Indian AI Internship Challenge on Gnani Prisma v3.0, Gnani Timbre v3.0 (Shivani) and Gemini Vision.**

**[Try the live app](https://drishtiai-lyart.vercel.app/)** · **[Judge walkthrough](#try-it-in-30-seconds)** · **[Engineering deep dive](#engineering-deep-dive)** · **[Run locally](#run-it-locally)**

</div>

---

## Why this exists

Most accessibility apps for blind and low-vision users are built for people who can see the screen. In India, they also tend to fall short in three ways:

| Gap | What it looks like in practice |
| :-- | :-- |
| **Menu-heavy, reactive UX** | The user has to find buttons and trigger a scan, instead of getting eyes-free, proactive help. |
| **Visual amnesia** | The app only sees the current frame. Once the camera pans past a door, a staircase or a bag, it is gone. |
| **Weak Indian-language voice** | Hindi, Marathi, Indian English and code-mixed speech (*"मेरे सामने table पर क्या है?"*) break most speech stacks. |

Drishti (दृष्टि, "vision") fixes all three with one calm, zero-clutter screen. The whole screen is the control.

---

## What it does

- **Hazard-first guidance.** Stairs, drops, vehicles, wet floors and obstacles are spoken first and trigger a haptic vibration. Routine scene description comes after.
- **Short-term visual memory.** Ask *"Where did I see my keys?"* or *"पायऱ्या कुठे होत्या?"* and Drishti searches recent camera keyframes, with timestamps, to answer.
- **Trilingual, code-mixed voice.** Speak or type in English, Hindi or Marathi. Mixed sentences work.
- **Same-language answers.** An English question gets an English reply, Hindi gets Hindi, Marathi gets Marathi. The language is locked per turn, so it does not drift.
- **True barge-in.** Talk over Drishti at any time. Playback stops, stale requests are aborted, and it does not hear its own voice.
- **One-screen controls.** Tap anywhere to talk, double-tap for Quiet mode (proactive narration off, Q&A still ready). Live captions are high-contrast.

---

## Try it in 30 seconds

> **[Open the live app](https://drishtiai-lyart.vercel.app/)** and allow Camera and Microphone access. Add `?autostart=1` to the URL to skip the start screen.

1. **Hear proactive guidance.** Drishti greets you in Shivani's voice and starts hazard-first narration when the view changes.
2. **Switch language.** Use **EN / हिं / म** in the top-right header, or just ask in that language.
3. **Test barge-in.** Ask something while Drishti is mid-sentence, or tap anywhere. It interrupts instantly.
4. **Test visual memory.** Pan past a door or an object, then ask *"Where did you see the door?"*
5. **Try Quiet mode.** Double-tap anywhere to silence proactive narration while keeping Q&A on.

> **No server keys on a preview deployment?** A compact **Manual API Keys** panel appears so you can test with your own Gemini and Gnani keys.

---

## How it works

```
Browser (React 19 + Vite + Tailwind CSS v4)
 ├── AudioCaptureService  → AudioWorklet VAD, 400 ms pre-roll buffer, 16 kHz WAV, echo gating
 ├── VisionTracker        → 32×24 thumbnail change detection (450 ms loop) + VisualFrameMemory
 ├── AudioPlayerService   → Gnani MP3 playback, sentence batching, speechSynthesis fallback
 └── Assistant FSM        → IDLE → OBSERVING ↔ LISTENING → TRANSCRIBING → THINKING → SPEAKING / QUIET
        │
        ▼  /api/*  (Express locally, Vercel serverless in production)
 ├── POST /api/gnani/stt        → Gnani Prisma v3.0   (code-mixed speech-to-text)
 ├── POST /api/gnani/tts        → Gnani Timbre v3.0   (Shivani voice, MP3)
 ├── POST /api/gemini/scene     → Gemini Vision       (proactive, hazard-first JSON narration)
 ├── POST /api/gemini/question  → Gemini Vision       (Q&A + frame memory + language lock)
 └── GET  /api/config           → Non-secret runtime diagnostics
```

API keys never reach the browser. Every Gnani and Gemini call goes through the server routes above.

### The assistant state machine

Every interaction runs through one explicit finite state machine (`src/state/machine.ts`):

| State | Meaning |
| :-- | :-- |
| `IDLE` | Waiting for the user to start. |
| `OBSERVING` | Camera live, watching for meaningful scene changes. |
| `LISTENING` | User is speaking (hands-free VAD or tap). |
| `TRANSCRIBING` | Audio sent to Gnani Prisma. |
| `THINKING` | Gemini is reasoning over the current frame and memory. |
| `SPEAKING` | Gnani Timbre is playing the reply. |
| `QUIET` | Proactive narration off, Q&A still available. |

A barge-in or tap increments a request token, which invalidates every in-flight task from the previous turn. This is what makes interruptions clean instead of racy.

---

## Engineering deep dive

Voice products usually fail on the edges. These are the edges we built for.

| Problem | Solution | Where |
| :-- | :-- | :-- |
| **Gnani allows one active request, and barge-in creates races** | Serial queues on the client and server. Hazard alerts jump ahead of routine narration. 450 ms abort cooldown and exponential retry backoff on `429` and transient errors. | `src/services/gnani.ts` · `server/gnaniConcurrency.ts` |
| **Hands-free VAD clips the first syllable** | Custom `AudioWorklet` with a **400 ms circular pre-roll buffer**, adaptive noise floor, and downsampling to 16 kHz PCM WAV. | `src/audio/capture.ts` · `vad.ts` · `wav.ts` |
| **TTS hears itself, and numbers sound robotic** | Post-playback echo suppression plus an overlap echo detector. A trilingual normalizer turns digits and decimals into spoken words (English, Hindi *दशमलव*, Marathi *दशांश*) and strips markdown before synthesis. | `src/services/sanitize.ts` · `src/audio/player.ts` |
| **Language drifts between turns** | Transcript-first language detection (`mr` / `hi` / `en`, with guarded Romanized detection) plus a per-turn language lock in the server prompt. | `src/state/machine.ts` · `server/language.ts` |
| **"Where did I pass X?" needs memory** | `VisualFrameMemory` keeps up to 12 distinct keyframes from the last 2 minutes. It deduplicates near-identical frames with thumbnail mean-absolute-difference and sends recent frames with elapsed seconds to the Q&A prompt. | `src/vision/memory.ts` · `differ.ts` |
| **Vision latency and cold-model timeouts** | Hedged parallel Gemini fallback (`gemini-3.1-flash-lite` and `gemini-4-hydrogen`), a sticky cache of the last healthy model, and abort propagation when the client disconnects. | `server/geminiFallback.ts` |
| **Don't spend a vision call on a still scene** | A 450 ms thumbnail loop only triggers Gemini when the scene changes meaningfully. | `src/vision/differ.ts` · `src/App.tsx` |

### Graceful degradation

If the Gnani key is not configured, Drishti falls back to the browser's built-in speech so the app still works. If one Gemini model is slow or unavailable, the other takes over.

---

## Tech stack

| Layer | Tools |
| :-- | :-- |
| **Frontend** | React 19, Vite, Tailwind CSS v4, Motion, Lucide |
| **Voice** | Gnani Prisma v3.0 (STT), Gnani Timbre v3.0 / Shivani (TTS), Web Audio `AudioWorklet` |
| **Vision and reasoning** | Google Gemini via `@google/genai` |
| **Backend** | Express (local and self-hosted), Vercel serverless functions (production) |
| **Quality** | TypeScript, `node:test` via `tsx` |

---

## Run it locally

**Prerequisites:** Node.js 20+, a [Gemini API key](https://aistudio.google.com/apikey) and a Gnani API key (sent as `X-API-Key-ID` to `https://api.vachana.ai`).

```bash
git clone https://github.com/Kshitijpatil50/DrishtiAI.git
cd DrishtiAI
npm install --legacy-peer-deps
cp .env.example .env
# add GEMINI_API_KEY and GNANI_API_KEY to .env
npm run dev
```

Open <http://localhost:3000> (add `?autostart=1` to jump straight into the camera view). Camera and microphone access need `localhost` or HTTPS.

### Environment variables

| Variable | Required | Purpose |
| :-- | :-- | :-- |
| `GEMINI_API_KEY` | Yes | Scene narration, hazard detection and visual Q&A. |
| `GNANI_API_KEY` | Recommended | Prisma STT and Shivani TTS. Falls back to browser speech if unset. |
| `PORT` | No | Production server port (default `3000`). |

### Scripts

```bash
npm run dev     # Express + Vite dev server
npm test        # 70 unit tests (src/**/*.test.ts, server/**/*.test.ts)
npm run lint    # tsc --noEmit
npm run build   # production Vite build to dist/
npm start       # production Express server
```

### Test coverage

70 unit tests cover state transitions, VAD math, WAV encoding, TTS sanitization, Gnani concurrency and queue priority, visual memory, frame differencing, Gemini fallback, language enforcement, config diagnostics and Vercel routing.

---

## Deploy to Vercel

1. Import the repository into Vercel. `vercel.json` already configures the Vite build and `/api/*` serverless functions.
2. Add `GEMINI_API_KEY` and `GNANI_API_KEY` under **Project → Settings → Environment Variables** for Production, Preview and Development.
3. Deploy.

---

## Project structure

```text
├── api/                  # Vercel serverless endpoints (config, gemini/*, gnani/*)
├── server/
│   ├── app.ts            # Express routes and Gnani / Gemini proxy handlers
│   ├── geminiFallback.ts # Hedged and sequential Gemini fallback with abort signals
│   ├── gnaniConcurrency.ts # Server-side serial queue and interrupt cooldown
│   ├── language.ts       # Per-question language resolution and switch detection
│   └── configStatus.ts   # Environment and header key diagnostics
├── src/
│   ├── audio/            # AudioWorklet VAD, WAV encoder, audio player
│   ├── components/       # Orb visualizer, ConfigDiagnostics, ManualApiKeysBox
│   ├── services/         # Gnani and Gemini clients, trilingual TTS sanitizer
│   ├── state/            # Finite state machine and language detector
│   ├── vision/           # Frame differencing, VisualFrameMemory, camera
│   └── App.tsx           # Single-screen, voice-first application
├── PITCH.md              # One-page solution pitch
├── .env.example          # Environment variable template
└── vercel.json           # Build and routing configuration
```

---

## Roadmap

- Offline hazard detection with an on-device model for low-connectivity areas
- More Indian languages through Gnani's multilingual stack
- Indoor and outdoor navigation cues (turn-by-turn style guidance)
- Printed-text and currency reading modes
- Testing sessions with blind and low-vision users to tune pacing and verbosity

---

## Credits

Built by **[Kshitij Patil](https://github.com/Kshitijpatil50)** and Khushi Kumari for the **Gnani.ai Great Indian AI Internship Challenge**.

Voice by **Gnani.ai** (Prisma v3.0 and Timbre v3.0). Vision and reasoning by **Google Gemini**.

## License

Licensed under the Apache License, Version 2.0.
