# Drishti AI — Solution Pitch

**Built for the Gnani AI Hackathon** · Voice-First Visual Assistant for Blind & Low-Vision Users

---

### The Problem
Over 250 million people worldwide live with moderate-to-severe visual impairment, with a disproportionate share in India navigating crowded streets, stairs, doorways, and daily printed text in **English, Hindi, and Marathi**. Most vision apps today still require sighted-style touch navigation, wait silently until prompted, forget what the camera saw seconds earlier, or speak in robotic English voices that miss local Indian languages and code-mixed speech.

### The Solution
**Drishti AI** turns any smartphone camera and microphone into a calm, hands-free Indian companion. Using live multimodal vision and **Gnani AI's Prisma v3.0 STT + Timbre v3.0 TTS (Shivani voice)**, Drishti proactively warns users about hazards in real time, answers spoken questions in the exact language asked (**English, Hindi, or Marathi**), and remembers recent camera frames to guide users back to objects or exits they walked past seconds ago.

### Why Gnani AI
- **Multilingual Code-Mixed Understanding (`Prisma v3.0`)**: Accurately transcribes natural Indian English, Hindi, and Marathi—even when speakers mix English nouns into Hindi or Marathi sentences.
- **Warm, Natural Indian Voice (`Timbre v3.0 — Shivani`)**: Speaks concise, number-normalized, conversational guidance with low latency, instant barge-in cancellation, and hazard-priority queuing.

### Core Capabilities
1. **Proactive Hazard-First Narration**: Monitors camera frame changes (`450ms` visual loop) and immediately alerts on stairs, drops, obstacles, wet floors, or approaching people before routine scenery.
2. **Visual Whereabouts Memory**: Retains recent distinct keyframes with timestamps so questions like *"Where did I pass the stairs?"* or *"माझी चावी कुठे दिसली?"* locate items seen earlier.
3. **Hands-Free Barge-In & Strict Same-Language Replies**: Speak anytime—even mid-sentence—to interrupt Drishti (`AudioWorklet` VAD + `400ms` pre-roll) and receive a response strictly in the language of your question.
4. **Zero-Clutter Accessibility**: Single-tap push-to-talk, double-tap Quiet Mode toggle, accessible live captions, and haptic hazard alerts.

### Impact
Drishti AI bridges real-time computer vision and vernacular Indian voice AI so blind and low-vision users can navigate unfamiliar spaces, read medicine labels or signs, and recover misplaced objects independently—hands-free and in their own language.
