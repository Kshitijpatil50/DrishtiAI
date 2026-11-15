# Drishti AI — Solution Pitch

**Gnani AI Hackathon Submission** · *Voice-First Multimodal Vision Guide for Blind & Low-Vision Users*
**Live App:** https://ais-pre-u3yx2mmipfypvnj7c6t5ze-782659439587.asia-southeast1.run.app

---

### The Problem
Blind and low-vision users across India navigate unfamiliar spaces, stairs, doorways, and printed labels using accessibility apps that fail in three critical ways:
1. **Menu-heavy, reactive UX**: Requiring sighted screen taps instead of proactive, eyes-free hazard warnings.
2. **Visual amnesia**: Answering only the current frame—forgetting an exit, staircase, or object seen seconds earlier.
3. **English-only, robotic speech**: Breaking down on **Hindi, Marathi, Indian English, and code-mixed** natural speech.

### The Solution
**Drishti AI** turns any smartphone camera and microphone into a calm, hands-free Indian companion. Point the camera ahead and Drishti proactively warns about hazards first, answers spoken questions in **English, Hindi, or Marathi**, and recalls recent camera frames to guide users back to objects or paths they passed moments ago.

### Built Around Gnani Prisma v3.0 & Timbre v3.0
Rather than treating voice as an afterthought, Drishti's architecture is engineered specifically around Gnani's speech stack:
- **Multilingual Code-Mixed STT (`Gnani Prisma v3.0`)**: Captures natural Indian English, Hindi, and Marathi (`format: "codemix"`, `mr-IN,hi-IN,en-IN` / `hi-IN,en-IN,mr-IN`) via a custom `AudioWorklet` Voice Activity Detector with a **400ms pre-roll buffer** so opening syllables are never clipped.
- **Expressive Indian TTS (`Gnani Timbre v3.0 — Shivani`)**: Speaks concise guidance through a **trilingual digit-to-word sanitizer** (converting English, Hindi, and Marathi numbers and decimals into natural spoken words) with sentence batching for crisp pacing.
- **Concurrency & Hazard-Priority Queuing**: Dual client/server serial queues enforce Gnani single-flight execution, allow **hazard alerts to preempt routine narration**, and apply barge-in abort cooldowns so interruptions stay fast and reliable.

### Key Differentiators
- **Proactive Hazard-First Loop**: Thumbnail-difference tracking triggers Gemini Vision only on meaningful scene shifts, speaking obstacles/stairs first alongside haptic vibration.
- **Short-Term Visual Frame Memory**: Buffers distinct recent frames with timestamps so whereabouts questions (*"Where did we pass the stairs?"* / *"पायऱ्या कुठे होत्या?"*) locate items seen moments earlier.
- **Strict Same-Language Answers**: Transcript-first language resolution + anti-drift server rules ensure English questions get English replies, Hindi gets Hindi, and Marathi gets Marathi—even across mixed-language turns.
- **True Barge-In & Accessible Controls**: Speak mid-sentence (with acoustic echo suppression) or tap anywhere to interrupt, double-tap for Quiet Mode, and view high-contrast live captions—backed by **65 automated unit tests**.
