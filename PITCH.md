# Drishti AI: Solution Pitch

**Gnani.ai Great Indian AI Internship Challenge** · *A voice-first camera guide for blind and low-vision users*

**Live app:** https://drishtiai-lyart.vercel.app/ · **Code:** https://github.com/Kshitijpatil50/DrishtiAI · **Built by:** Kshitij Patil

---

## The one-line pitch

Drishti turns any smartphone into a calm, hands-free guide that **warns you about hazards before you reach them, remembers what the camera saw, and talks to you in the language you speak**: English, Hindi or Marathi.

---

## The problem

Millions of blind and low-vision people in India move through crowded streets, stairs, doorways and printed labels every day. The tools built for them fail in three ways:

1. **They are reactive and menu-heavy.** The user must find a button and trigger a scan. A person who cannot see the screen needs help that arrives on its own.
2. **They have visual amnesia.** They describe only the current frame. Once the camera pans past a door, a staircase or a bag, it is forgotten.
3. **They struggle with how India actually speaks.** Hindi, Marathi, Indian English and code-mixed sentences such as *"मेरे सामने table पर क्या है?"* break most speech systems, and the voices sound robotic.

---

## The solution

Drishti is one screen with no menus. Point the camera ahead and walk.

- **It speaks first about danger.** Stairs, drops, vehicles, wet floors and obstacles are announced before anything else, with a haptic vibration.
- **It remembers.** Ask *"Where did I see my keys?"* or *"पायऱ्या कुठे होत्या?"* and it searches recent camera frames to answer.
- **It listens like a person.** Speak naturally in English, Hindi, Marathi or a mix. Interrupt at any time, mid-sentence.
- **It answers in your language.** English gets English, Hindi gets Hindi, Marathi gets Marathi, every turn.

**Controls:** tap anywhere to talk, double-tap for Quiet mode. That is the entire interface.

---

## Why Gnani is at the core

Voice is not an add-on here. The architecture is built around Gnani's speech stack.

| Gnani product | How Drishti uses it | What we engineered around it |
| :-- | :-- | :-- |
| **Prisma v3.0** (STT) | Code-mixed recognition for `mr-IN`, `hi-IN` and `en-IN`. | A custom `AudioWorklet` voice-activity detector with a **400 ms pre-roll buffer**, so a hands-free user's first word is never clipped. |
| **Timbre v3.0, Shivani** (TTS) | The single warm, consistent Indian voice for every reply. | A **trilingual number normalizer** (English, Hindi *दशमलव*, Marathi *दशांश*), markdown stripping and sentence batching for natural pacing. |
| **Both** | Real-time, interruptible conversation. | **Serial queues on client and server** that respect single-active-request limits, let **hazard alerts preempt routine narration**, and apply a 450 ms abort cooldown with retry backoff for barge-in. |

---

## What makes it different

| Differentiator | How it works |
| :-- | :-- |
| **Proactive, hazard-first loop** | A 450 ms thumbnail-difference loop calls Gemini Vision only when the scene changes meaningfully, which saves cost and avoids chatter. Hazards are spoken first. |
| **Short-term visual memory** | Up to 12 distinct keyframes from the last 2 minutes, with timestamps, are given to the Q&A prompt so Drishti can answer *where* and *when*. |
| **Strict same-language answers** | Transcript-first language detection plus a per-turn language lock on the server prevents drift across mixed-language conversations. |
| **True barge-in** | Speak over Drishti and playback stops, stale requests are cancelled, and echo gating stops it hearing itself. A request token invalidates every in-flight task. |
| **Resilient by design** | Hedged fallback across two Gemini models, a sticky healthy-model cache, and browser speech as a fallback if Gnani is unavailable. |

---

## Under the hood

```
Camera + Mic ──▶ AudioWorklet VAD · thumbnail change detection · VisualFrameMemory
        │
        ▼
Assistant state machine:  IDLE → OBSERVING ↔ LISTENING → TRANSCRIBING → THINKING → SPEAKING / QUIET
        │
        ▼
Server routes (keys never reach the browser)
  Gnani Prisma v3.0  → speech to text
  Gemini Vision      → hazard-first narration and visual Q&A
  Gnani Timbre v3.0  → Shivani voice
```

**Stack:** React 19, Vite, Tailwind CSS v4, TypeScript, Express and Vercel serverless functions.

**Quality:** 70 automated unit tests pass, covering the state machine, VAD, WAV encoding, TTS sanitization, Gnani concurrency, visual memory, language enforcement and routing. Type-checking is clean.

---

## Who it is for

- **Blind and low-vision users** who want eyes-free help in their own language.
- **Families and caregivers** who want to support independent movement.
- **Anyone navigating with their hands full**, including carrying bags or holding a cane.

## Where it goes next

- On-device hazard detection for low-connectivity areas
- More Indian languages through Gnani's multilingual stack
- Navigation cues, plus printed-text and currency reading
- Testing sessions with blind and low-vision users to tune pacing and verbosity

---

## Try it in 30 seconds

1. Open **https://drishtiai-lyart.vercel.app/** and allow Camera and Microphone. Add `?autostart=1` to skip the start screen.
2. Listen to Shivani greet you, then change the view and hear hazard-first narration.
3. Switch **EN / हिं / म** and ask a question in that language.
4. Ask something while Drishti is talking to see barge-in.
5. Pan past a door, then ask *"Where did you see the door?"*

*On an unconfigured preview, a Manual API Keys panel lets you test with your own Gemini and Gnani keys.*
