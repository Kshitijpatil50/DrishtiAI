/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  AssistantState,
  INITIAL_STATE,
  transitionState,
  LanguageCode,
} from './state/machine';
import { AudioCaptureService } from './audio/capture';
import { AudioPlayerService } from './audio/player';
import {
  VisionTracker,
  captureVideoThumbnail,
  encodeVideoFrameBase64,
  createSimulatedMediaStream,
  getFallbackFrameBase64,
} from './vision/frames';
import { bytesToBase64 } from './audio/wav';
import { Eye, Send, Activity } from 'lucide-react';
import { narrateScene, answerQuestion, ConversationTurn } from './services/gemini';
import { transcribeAudio, GnaniError } from './services/gnani';
import { isEchoOfAssistantSpeech, sanitizeForTTS } from './services/sanitize';
import { Orb } from './components/Orb';
import { ConfigDiagnostics } from './components/ConfigDiagnostics';
import { ManualApiKeysBox } from './components/ManualApiKeysBox';
import {
  getBrowserDeployedFlag,
  getStoredGeminiKey,
  getStoredGnaniKey,
} from './services/manualKeys';

const GREETING_EN =
  "Hi, I'm Drishti. Ask me anything anytime, and keep using your cane carefully.";
const GREETING_HI =
  'नमस्ते, मैं दृष्टि हूँ। कभी भी कुछ भी पूछें, और अपनी छड़ी ध्यान से इस्तेमाल करें।';

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(arrayBuffer));
}

export default function App() {
  const [assistant, setAssistant] = useState<AssistantState>(INITIAL_STATE);
  const [hasStarted, setHasStarted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');

  const [customQuestion, setCustomQuestion] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [serverRuntime, setServerRuntime] = useState<string | undefined>(undefined);
  const [keysRevision, setKeysRevision] = useState(0);

  const isDeployed = getBrowserDeployedFlag(serverRuntime);
  const manualGeminiSet = isDeployed && Boolean(getStoredGeminiKey());
  const manualGnaniSet = isDeployed && Boolean(getStoredGnaniKey());
  // Reference keysRevision so UI refreshes immediately when keys are saved or cleared
  void keysRevision;

  // References to long-lived services and objects
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCaptureRef = useRef<AudioCaptureService | null>(null);
  const audioPlayerRef = useRef<AudioPlayerService | null>(null);
  const visionTrackerRef = useRef<VisionTracker>(new VisionTracker());
  const wakeLockRef = useRef<any>(null);

  // AbortController for in-flight Gemini requests
  const geminiAbortRef = useRef<AbortController | null>(null);
  // Conversation history for context (last 6 turns, shared across scene & Q&A)
  const conversationHistoryRef = useRef<ConversationTurn[]>([]);
  // Cached valid camera frame and pre-captured question snapshot from speech onset
  const lastValidFrameBase64Ref = useRef<string>('');
  const preCapturedFrameRef = useRef<{ base64: string; thumb: Uint8Array | null } | null>(null);

  // Ref to always access latest assistant state inside callbacks
  const assistantRef = useRef<AssistantState>(assistant);
  assistantRef.current = assistant;

  // Track double tap & startup guards
  const lastTapTimeRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const autostartAttemptedRef = useRef<boolean>(false);
  const lastSpokenAtRef = useRef<number>(0);
  const lastSpokenPhraseRef = useRef<string>('');

  // Audio capture & playback use server-side /api/* proxy endpoints with environment keys

  // Initialize AudioPlayer
  useEffect(() => {
    const player = new AudioPlayerService({
      onSpeakingActiveChange: (active) => {
        audioCaptureRef.current?.setAssistantSpeaking(active);
        if (!active && lastSpokenAtRef.current > 0) {
          lastSpokenAtRef.current = Date.now();
        }
      },
      onTextPrepared: (text, isNarration) => {
        setErrorMessage(null);
        setAssistant((prev) => {
          const recent =
            isNarration && prev.recentNarration[0] !== text
              ? [text, ...prev.recentNarration].slice(0, 3)
              : prev.recentNarration;
          return {
            ...prev,
            lastSpokenText: text,
            recentNarration: recent,
          };
        });
      },
      onStartSpeaking: (text, isNarration) => {
        setErrorMessage(null);
        lastSpokenPhraseRef.current = text;
        lastSpokenAtRef.current = Date.now();
        setAssistant((prev) =>
          transitionState(prev, { type: 'SPEAKING_START', text, isNarration })
        );
      },
      onFinishedSpeaking: () => {
        lastSpokenAtRef.current = Date.now();
        setAssistant((prev) =>
          transitionState(prev, {
            type: prev.state === 'THINKING' ? 'REQUEST_FAILED' : 'SPEAKING_FINISHED',
          })
        );
      },
      onTtsError: (message) => {
        setErrorMessage(message);
      },
    });
    audioPlayerRef.current = player;

    return () => {
      player.stopAll();
      audioCaptureRef.current?.stop();
      geminiAbortRef.current?.abort();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  // Request Wake Lock to prevent screen sleep
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Ignore wake lock denial
    }
  };

  /**
   * Speak error message and display it
   */
  const speakAndShowError = useCallback(async (message: string) => {
    setErrorMessage(message);
    const token = assistantRef.current.requestToken;
    const played = await audioPlayerRef.current?.speak(message, {
      lang: assistantRef.current.language,
      requestToken: token,
    });
    if (!played && assistantRef.current.requestToken === token) {
      setAssistant((prev) => transitionState(prev, { type: 'REQUEST_FAILED' }));
    }
  }, []);

  /**
   * Proactive Scene Narration Execution
   */
  const executeSceneNarration = useCallback(async () => {
    const current = assistantRef.current;
    if (
      current.state !== 'OBSERVING' ||
      current.isQuiet ||
      visionTrackerRef.current.isBusy ||
      !videoRef.current
    ) {
      return;
    }

    const thumbnail = captureVideoThumbnail(videoRef.current);
    if (!thumbnail) return;

    const { trigger } = visionTrackerRef.current.checkShouldTrigger(thumbnail);
    if (!trigger) return;

    const frameBase64 = encodeVideoFrameBase64(videoRef.current, 320, 0.5);
    if (!frameBase64) return;
    lastValidFrameBase64Ref.current = frameBase64;

    visionTrackerRef.current.markProcessing(true);
    const currentToken = current.requestToken;

    // Abort previous Gemini call if any
    geminiAbortRef.current?.abort();
    const abortController = new AbortController();
    geminiAbortRef.current = abortController;

    try {
      const result = await narrateScene(
        frameBase64,
        current.recentNarration,
        current.language,
        abortController.signal
      );

      // Check if state changed or barge-in occurred
      if (
        assistantRef.current.requestToken !== currentToken ||
        assistantRef.current.state !== 'OBSERVING'
      ) {
        return;
      }

      if (result.urgency === 'silent' || !result.speech.trim()) {
        return;
      }

      // Record narration thumbnail & add to conversational memory so follow-up questions have full context
      visionTrackerRef.current.markNarrationSpoken(thumbnail);
      const displayNarration = sanitizeForTTS(result.speech, result.language || current.language) || result.speech;
      conversationHistoryRef.current = [
        ...conversationHistoryRef.current.slice(-5),
        { role: 'assistant', text: displayNarration },
      ];

      const isHazard = result.urgency === 'hazard';
      if (isHazard && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }

      // Speak narration while keeping isBusy=true until TTS synthesis/playback finishes or aborts
      await audioPlayerRef.current?.speak(result.speech, {
        lang: result.language || current.language,
        isHazard,
        isNarration: true,
        requestToken: currentToken,
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Scene narration error:', err);
      }
    } finally {
      visionTrackerRef.current.markProcessing(false);
    }
  }, []);

  // Vision Loop: Every 450ms while OBSERVING with immediate trigger on state entry
  useEffect(() => {
    if (!hasStarted) return;

    // Immediately trigger narration check when entering OBSERVING
    if (assistant.state === 'OBSERVING' && !assistant.isQuiet) {
      executeSceneNarration();
    }

    const interval = setInterval(() => {
      if (assistant.state === 'OBSERVING' && !assistant.isQuiet) {
        executeSceneNarration();
      }
    }, 450);

    return () => clearInterval(interval);
  }, [hasStarted, assistant.state, assistant.isQuiet, executeSceneNarration]);

  /**
   * Captures current video frame + thumbnail pair for instant question answering.
   */
  const snapshotQuestionFrame = useCallback(() => {
    let base64 = '';
    let thumb: Uint8Array | null = null;
    if (videoRef.current) {
      const encodedFrame = encodeVideoFrameBase64(videoRef.current, 448, 0.65);
      if (encodedFrame) {
        base64 = encodedFrame;
        lastValidFrameBase64Ref.current = encodedFrame;
      }
      thumb = captureVideoThumbnail(videoRef.current);
    }
    if (!base64 && lastValidFrameBase64Ref.current) {
      base64 = lastValidFrameBase64Ref.current;
    }
    if (!base64) {
      base64 = getFallbackFrameBase64();
    }
    return { base64, thumb };
  }, []);

  /**
   * Handle captured speech audio from VAD or tap
   */
  const handleSpeechCaptured = useCallback(async (wavBlob: Blob, fallbackTranscript?: string) => {
    const cleanFallback = (fallbackTranscript || '').trim();
    setInterimTranscript('');
    // Skip empty/short noise clips (<400ms emits 44-byte WAV header only)
    if (wavBlob.size <= 44 && !cleanFallback) {
      preCapturedFrameRef.current = null;
      setAssistant((prev) => transitionState(prev, { type: 'TRANSCRIPTION_EMPTY' }));
      return;
    }

    // Grab the visual frame right as the user finished speaking so we answer what they pointed at
    const capturedFrame = preCapturedFrameRef.current || snapshotQuestionFrame();
    preCapturedFrameRef.current = null;

    setErrorMessage(null);
    setAssistant((prev) => {
      const next = transitionState(prev, { type: 'SPEECH_CAPTURED' });
      return cleanFallback ? { ...next, lastTranscript: cleanFallback } : next;
    });

    const currentToken = assistantRef.current.requestToken;
    let transcript = '';
    let detectedLang = assistantRef.current.language;

    try {
      const sttResult = await transcribeAudio(wavBlob);
      transcript = (sttResult.transcript || '').trim();
      detectedLang = sttResult.detectedLanguage || detectedLang;
    } catch (err: any) {
      if (assistantRef.current.requestToken !== currentToken) return;

      console.warn('Gnani STT error, checking fallback transcript or direct audio:', err);

      if (cleanFallback) {
        transcript = cleanFallback;
        if (/[\u0900-\u097F]/.test(transcript)) {
          detectedLang = 'hi';
        }
      } else if (err instanceof GnaniError && (err.status === 401 || err.status === 402 || err.status === 403)) {
        speakAndShowError("My voice service isn't accepting the key.");
        return;
      }
    }

    if (assistantRef.current.requestToken !== currentToken) return;

    // Also use browser SpeechRecognition fallback if Gnani STT returned HTTP 200 with empty transcript
    if (!transcript && cleanFallback) {
      transcript = cleanFallback;
      if (/[\u0900-\u097F]/.test(transcript)) {
        detectedLang = 'hi';
      }
    }

    // Only base64-encode WAV audio for multimodal Gemini fallback if we still have no transcript
    let audioBase64 = '';
    if (!transcript && wavBlob.size > 44) {
      try {
        audioBase64 = await blobToBase64(wavBlob);
      } catch {
        // ignore
      }
    }

    if (!transcript && !audioBase64) {
      // Empty transcript and no audio is treated as noise, ignore silently
      setAssistant((prev) => {
        const next = transitionState(prev, { type: 'TRANSCRIPTION_EMPTY' });
        if (next.consecutiveSttFailures >= 2) {
          speakAndShowError("I couldn't hear that. Please try again, or tap and speak.");
        }
        return next;
      });
      return;
    }

    // Discard acoustic echo if captured text matches Drishti's own recently spoken output
    if (transcript && lastSpokenPhraseRef.current) {
      const msSinceSpoken = Date.now() - lastSpokenAtRef.current;
      if (isEchoOfAssistantSpeech(transcript, lastSpokenPhraseRef.current, msSinceSpoken)) {
        setAssistant((prev) => transitionState(prev, { type: 'TRANSCRIPTION_EMPTY' }));
        return;
      }
    }

    setAssistant((prev) =>
      transitionState(prev, {
        type: 'TRANSCRIPTION_SUCCESS',
        transcript: transcript || (detectedLang === 'hi' ? 'आपका सवाल' : 'Your question'),
        detectedLanguage: detectedLang,
      })
    );

    // Reuse the frame snapped when the user asked (fall back to live frame if unavailable)
    const imageBase64 = capturedFrame.base64;

    // Call Gemini with user question and history context
    geminiAbortRef.current?.abort();
    const abortController = new AbortController();
    geminiAbortRef.current = abortController;

    try {
      const questionRes = await answerQuestion(
        transcript,
        imageBase64,
        conversationHistoryRef.current,
        detectedLang,
        abortController.signal,
        audioBase64 || undefined
      );

      if (assistantRef.current.requestToken !== currentToken) return;

      const answerText = questionRes.speech.trim();
      const replyLang = questionRes.language || detectedLang;
      const finalQuestion =
        questionRes.question ||
        transcript ||
        (detectedLang === 'hi' ? 'सामने क्या है?' : 'What is in front of me?');

      // Update conversation history
      conversationHistoryRef.current = [
        ...conversationHistoryRef.current.slice(-5),
        { role: 'user', text: finalQuestion },
        { role: 'assistant', text: answerText },
      ];

      // Show answer text immediately on screen as soon as Gemini responds, while Gnani Shivani audio prepares
      const displayAnswer = sanitizeForTTS(answerText, replyLang) || answerText;
      lastSpokenPhraseRef.current = displayAnswer;
      setAssistant((prev) => ({
        ...prev,
        lastTranscript: finalQuestion,
        lastSpokenText: displayAnswer,
      }));

      await audioPlayerRef.current?.speak(answerText, {
        lang: replyLang,
        requestToken: currentToken,
      });

      if (assistantRef.current.requestToken === currentToken) {
        visionTrackerRef.current.markSceneAcknowledged(capturedFrame.thumb, 1800);
      }
    } catch (err: any) {
      if (assistantRef.current.requestToken !== currentToken) return;
      if (err.name !== 'AbortError') {
        console.error('Answer question error:', err);
        speakAndShowError(
          assistantRef.current.language === 'hi'
            ? 'माफ़ कीजिए, मैं अभी उत्तर नहीं दे पा रही हूँ। कृपया दोबारा पूछें।'
            : "I couldn't answer that right now. Please try again."
        );
      }
    }
  }, [snapshotQuestionFrame, speakAndShowError]);

  /**
   * Directly asks Drishti a question about the current camera view
   */
  const askDirectQuestion = useCallback(
    async (questionText: string) => {
      const q = questionText.trim();
      if (!q) return;

      setErrorMessage(null);
      setInterimTranscript('');
      audioPlayerRef.current?.unlockAudio();
      audioCaptureRef.current?.cancelCurrentSpeech();
      audioPlayerRef.current?.stopAll();
      geminiAbortRef.current?.abort();

      const currentToken = assistantRef.current.requestToken + 1;
      setAssistant((prev) => {
        const next = transitionState(prev, { type: 'BARGE_IN_OR_TAP' });
        return {
          ...next,
          state: 'THINKING',
          lastTranscript: q,
          requestToken: currentToken,
        };
      });

      const capturedFrame = snapshotQuestionFrame();
      const imageBase64 = capturedFrame.base64;

      const abortController = new AbortController();
      geminiAbortRef.current = abortController;

      try {
        const isHindi = /[\u0900-\u097F]/.test(q);
        const lang = isHindi ? 'hi' : assistantRef.current.language;
        const questionRes = await answerQuestion(
          q,
          imageBase64,
          conversationHistoryRef.current,
          lang,
          abortController.signal
        );

        if (assistantRef.current.requestToken !== currentToken) return;

        const answerText = questionRes.speech.trim();
        const replyLang = questionRes.language || lang;

        conversationHistoryRef.current = [
          ...conversationHistoryRef.current.slice(-5),
          { role: 'user', text: q },
          { role: 'assistant', text: answerText },
        ];

        const displayAnswer = sanitizeForTTS(answerText, replyLang) || answerText;
        lastSpokenPhraseRef.current = displayAnswer;
        setAssistant((prev) => ({
          ...prev,
          lastSpokenText: displayAnswer,
        }));

        await audioPlayerRef.current?.speak(answerText, {
          lang: replyLang,
          requestToken: currentToken,
        });

        if (assistantRef.current.requestToken === currentToken) {
          visionTrackerRef.current.markSceneAcknowledged(capturedFrame.thumb, 1800);
        }
      } catch (err: any) {
        if (assistantRef.current.requestToken !== currentToken) return;
        if (err.name !== 'AbortError') {
          console.error('Answer direct question error:', err);
          speakAndShowError(
            assistantRef.current.language === 'hi'
              ? 'माफ़ कीजिए, मैं अभी उत्तर नहीं दे पा रही हूँ। कृपया दोबारा पूछें।'
              : "I couldn't answer that right now. Please try again."
          );
        }
      }
    },
    [snapshotQuestionFrame, speakAndShowError]
  );

  /**
   * Handle VAD Speech Start (Hands-free barge-in or normal voice start)
   */
  const handleSpeechStart = useCallback(
    (isBargeIn: boolean) => {
      if (isBargeIn) {
        // Barge-in: stop audio immediately, abort in-flight requests
        audioPlayerRef.current?.stopAll();
        geminiAbortRef.current?.abort();
      }
      setInterimTranscript('');
      // Pre-snap camera frame right at speech onset so "what is this?" matches what they were pointing at
      preCapturedFrameRef.current = snapshotQuestionFrame();

      setAssistant((prev) =>
        transitionState(prev, {
          type: isBargeIn ? 'BARGE_IN_OR_TAP' : 'START_LISTENING',
        })
      );
    },
    [snapshotQuestionFrame]
  );

  /**
   * Starts Drishti AI (User Gesture required for MediaDevices + AudioContext)
   */
  const startAssistant = async () => {
    if (isStartingRef.current || hasStarted) return;
    isStartingRef.current = true;
    setErrorMessage(null);
    audioPlayerRef.current?.unlockAudio();

    const startToken = assistantRef.current.requestToken;
    try {
      setHasStarted(true);
      await requestWakeLock();

      // Request rear camera and microphone (or fallback in simulated/headless environment)
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } catch {
          stream = createSimulatedMediaStream();
        }
      }

      mediaStreamRef.current = stream;

      // Assign video stream if video element is already available
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.play().catch(() => {});
      }

      const initialLang = assistantRef.current.language;
      // Initialize mic capture service
      const audioCapture = new AudioCaptureService();
      audioCaptureRef.current = audioCapture;
      audioCapture.setLanguage(initialLang);
      await audioCapture.start(stream, {
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: (blob, _durationMs, fallbackTranscript) => {
          handleSpeechCaptured(blob, fallbackTranscript);
        },
        onInterimTranscript: (partial) => {
          setInterimTranscript(partial);
        },
        onRmsUpdate: (rms) => {
          if (orbRef.current) {
            orbRef.current.style.setProperty('--orb-rms', rms.toFixed(4));
          }
        },
      });

      if (assistantRef.current.requestToken !== startToken) {
        return;
      }

      // Speak greeting (onStartSpeaking updates caption + SPEAKING state once audio starts)
      const greeting = initialLang === 'hi' ? GREETING_HI : GREETING_EN;
      await audioPlayerRef.current?.speak(greeting, {
        lang: initialLang,
        requestToken: startToken,
      });

      // Enter OBSERVING only if not interrupted during greeting
      if (assistantRef.current.requestToken === startToken) {
        setAssistant((prev) => transitionState(prev, { type: 'START' }));
      }
    } catch (err: any) {
      console.error('Initialization error:', err);
      isStartingRef.current = false;
      setHasStarted(false);
      speakAndShowError(
        'I need camera and microphone access to help you. Please allow them and reopen the app.'
      );
    }
  };

  /**
   * Screen Tap Handler
   * Double-tap: Toggle Quiet mode
   * Single-tap:
   *  - In SPEAKING/THINKING/TRANSCRIBING: stop everything and go to LISTENING now
   *  - In OBSERVING: go to LISTENING (push-to-talk)
   *  - In LISTENING: end capture now and send
   */
  const handleScreenTap = (e: React.MouseEvent | React.TouchEvent) => {
    audioPlayerRef.current?.unlockAudio();
    // Prevent interfering with buttons if user tapped on a specific control
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    // Detect double-tap (within 350ms)
    if (timeSinceLastTap < 350) {
      // Toggle QUIET mode
      const isCurrentlyQuiet = assistantRef.current.isQuiet;
      const willBeQuiet = !isCurrentlyQuiet;
      const nextToken = assistantRef.current.requestToken + 1;
      const currentLang = assistantRef.current.language;

      // Cancel any ongoing capture or playback
      audioCaptureRef.current?.cancelCurrentSpeech();
      audioPlayerRef.current?.stopAll();
      geminiAbortRef.current?.abort();

      setAssistant((prev) => transitionState(prev, { type: 'TOGGLE_QUIET' }));

      const announcement =
        currentLang === 'hi'
          ? willBeQuiet
            ? 'शांत मोड चालू'
            : 'शांत मोड बंद'
          : willBeQuiet
          ? 'Quiet mode on'
          : 'Quiet mode off';

      audioPlayerRef.current?.speak(announcement, {
        lang: currentLang,
        requestToken: nextToken,
      });
      return;
    }

    // Single-tap interactions:
    const currentState = assistantRef.current.state;

    if (
      currentState === 'SPEAKING' ||
      currentState === 'THINKING' ||
      currentState === 'TRANSCRIBING'
    ) {
      // Stop everything and go to LISTENING now
      audioPlayerRef.current?.stopAll();
      geminiAbortRef.current?.abort();
      setAssistant((prev) => transitionState(prev, { type: 'BARGE_IN_OR_TAP' }));
      audioCaptureRef.current?.forceStartListening();
    } else if (currentState === 'OBSERVING' || currentState === 'QUIET') {
      // Push-to-talk: start listening
      setAssistant((prev) => transitionState(prev, { type: 'BARGE_IN_OR_TAP' }));
      audioCaptureRef.current?.forceStartListening();
    } else if (currentState === 'LISTENING') {
      // End capture now and send
      audioCaptureRef.current?.forceEndCaptureNow();
    }
  };

  /**
   * Toggle language between English and Hindi
   */
  const toggleLanguage = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newLang: LanguageCode = assistant.language === 'en' ? 'hi' : 'en';
    audioCaptureRef.current?.setLanguage(newLang);
    setAssistant((prev) =>
      transitionState(prev, { type: 'SET_LANGUAGE', language: newLang })
    );
  };

  // Ensure video element receives the stream as soon as active screen mounts into DOM
  useEffect(() => {
    if (hasStarted && videoRef.current && mediaStreamRef.current) {
      const v = videoRef.current;
      if (v.srcObject !== mediaStreamRef.current) {
        v.srcObject = mediaStreamRef.current;
        v.muted = true;
        v.setAttribute('playsinline', 'true');
        v.play().catch(() => {});
      }
    }
  }, [hasStarted]);

  /**
   * Toggle Quiet mode via button
   */
  const toggleQuietMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    const willBeQuiet = !assistantRef.current.isQuiet;
    const nextToken = assistantRef.current.requestToken + 1;
    const currentLang = assistantRef.current.language;

    audioCaptureRef.current?.cancelCurrentSpeech();
    audioPlayerRef.current?.stopAll();
    geminiAbortRef.current?.abort();

    setAssistant((prev) => transitionState(prev, { type: 'TOGGLE_QUIET' }));

    const announcement =
      currentLang === 'hi'
        ? willBeQuiet
          ? 'शांत मोड चालू'
          : 'शांत मोड बंद'
        : willBeQuiet
        ? 'Quiet mode on'
        : 'Quiet mode off';

    audioPlayerRef.current?.speak(announcement, {
      lang: currentLang,
      requestToken: nextToken,
    });
  };

  // Support ?autostart=1 query parameter for automated testing
  useEffect(() => {
    if (autostartAttemptedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' && !hasStarted) {
      autostartAttemptedRef.current = true;
      startAssistant();
    }
  }, [hasStarted]);

  // Offline / Online listeners
  useEffect(() => {
    const handleOffline = () => {
      speakAndShowError("I've lost my connection. I'll keep trying.");
    };
    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, [speakAndShowError]);

  // 1. Initial Launch / Start Screen
  if (!hasStarted) {
    return (
      <main
        className="w-screen h-[100dvh] bg-[#F9FAFB] text-[#000000] flex flex-col justify-between p-5 sm:p-6 select-none cursor-pointer overflow-y-auto overflow-x-hidden"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('input, button, a, form')) return;
          startAssistant();
        }}
      >
        {/* Header */}
        <header className="flex items-center justify-between pt-1 shrink-0">
          <span className="font-serif-heading text-2xl tracking-tight text-ink font-normal">
            Drishti AI
          </span>
          <button
            type="button"
            onClick={toggleLanguage}
            className="text-xs px-2.5 py-1 bg-white border border-line rounded-[8px] text-ink font-medium tracking-wide active:bg-gray-100 transition-colors cursor-pointer"
            aria-label={`Switch language. Current: ${assistant.language === 'en' ? 'English' : 'Hindi'}`}
          >
            {assistant.language === 'en' ? 'EN | हि' : 'हि | EN'}
          </button>
        </header>

        {/* Center Prompt */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-2 py-4">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startAssistant();
            }}
            className="flex flex-col items-center justify-center text-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F3BE0] rounded-xl p-3"
            aria-label="Tap to start Drishti AI"
          >
            <div className="mb-4">
              <Orb state="OBSERVING" />
            </div>
            <h1 className="font-serif-heading text-3xl font-normal text-ink mb-2.5 leading-snug">
              {assistant.language === 'hi'
                ? 'शुरू करने के लिए कहीं भी टैप करें'
                : 'Tap anywhere to start'}
            </h1>
            <p className="text-sm text-muted max-w-xs leading-relaxed">
              {assistant.language === 'hi'
                ? 'हैंड्स-फ़्री वॉइस कैमरा गाइड। आपके सामने क्या है बताती है और सवालों के जवाब देती है।'
                : 'Hands-free voice camera guide. Describes what is in front of you and answers questions.'}
            </p>
          </button>

          <div
            className="mt-3 w-full max-w-xs space-y-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            {isDeployed && (
              <ManualApiKeysBox
                compact
                language={assistant.language}
                onKeysChanged={() => setKeysRevision((r) => r + 1)}
              />
            )}
            <ConfigDiagnostics
              compact
              manualGeminiSet={manualGeminiSet}
              manualGnaniSet={manualGnaniSet}
              onConfigLoaded={(cfg) => {
                if (cfg.runtime && cfg.runtime !== serverRuntime) {
                  setServerRuntime(cfg.runtime);
                }
              }}
            />
          </div>

          {errorMessage && (
            <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-[8px] max-w-xs">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="text-center pb-1 shrink-0">
          <p className="text-[11px] text-muted">
            Built with Gnani Prisma and Timbre
          </p>
        </footer>
      </main>
    );
  }

  // 2. Active Single-Screen Experience
  const isTurnPending =
    assistant.state === 'LISTENING' ||
    assistant.state === 'TRANSCRIBING' ||
    assistant.state === 'THINKING';

  return (
    <main
      data-state={assistant.state}
      className="w-screen h-[100dvh] bg-[#F9FAFB] text-[#000000] flex flex-col justify-between px-4 py-2.5 sm:py-3 select-none overflow-y-auto overflow-x-hidden touch-manipulation"
      onClick={handleScreenTap}
      role="application"
      aria-label="Drishti AI active camera screen. Tap anywhere to talk, double-tap for quiet mode."
    >
      {/* 1. Header row */}
      <header className="flex items-center justify-between shrink-0 h-9 px-1">
        <div className="flex items-center gap-2">
          <span className="font-serif-heading text-2xl tracking-tight text-ink font-normal">
            Drishti AI
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowDiagnostics((prev) => !prev);
            }}
            aria-expanded={showDiagnostics}
            aria-label="Toggle API diagnostics"
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 border rounded-[8px] font-medium transition-colors cursor-pointer ${
              showDiagnostics
                ? 'bg-[#2F3BE0] text-white border-[#2F3BE0]'
                : 'bg-white text-ink border-line hover:bg-gray-50'
            }`}
          >
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            <span>API</span>
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="text-xs px-2.5 py-1 bg-white border border-line rounded-[8px] text-ink font-medium tracking-wide active:bg-gray-100 transition-colors cursor-pointer"
            aria-label={`Switch language. Current: ${assistant.language === 'en' ? 'English' : 'Hindi'}`}
          >
            {assistant.language === 'en' ? 'EN | हि' : 'हि | EN'}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div
          className="mx-auto mb-1 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-[8px] max-w-md text-center shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setErrorMessage(null);
          }}
        >
          {errorMessage}
        </div>
      )}

      {showDiagnostics && (
        <div
          className="fixed inset-x-0 top-12 z-30 flex justify-center px-4 max-h-[80dvh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-xs space-y-2.5 shadow-lg rounded-[10px]">
            {isDeployed && (
              <ManualApiKeysBox
                compact
                language={assistant.language}
                onKeysChanged={() => setKeysRevision((r) => r + 1)}
              />
            )}
            <ConfigDiagnostics
              manualGeminiSet={manualGeminiSet}
              manualGnaniSet={manualGnaniSet}
              onConfigLoaded={(cfg) => {
                if (cfg.runtime && cfg.runtime !== serverRuntime) {
                  setServerRuntime(cfg.runtime);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* 2. Camera preview card */}
      <div className="w-full flex-1 min-h-[190px] flex items-center justify-center my-1">
        <div className="relative w-full max-w-[400px] sm:max-w-[580px] md:max-w-[760px] h-full min-h-[190px] max-h-[39dvh] sm:max-h-[48dvh] bg-black rounded-[10px] border border-line overflow-hidden flex items-center justify-center shadow-xs">
          <video
            ref={(el) => {
              videoRef.current = el;
              if (el && mediaStreamRef.current && el.srcObject !== mediaStreamRef.current) {
                el.srcObject = mediaStreamRef.current;
                el.muted = true;
                el.setAttribute('playsinline', 'true');
                el.play().catch(() => {});
              }
            }}
            onLoadedMetadata={(e) => {
              e.currentTarget.play().catch(() => {});
            }}
            playsInline
            muted
            autoPlay
            className="w-full h-full object-cover"
            aria-hidden="true"
          />
          {/* Subtle live indicator */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/45 backdrop-blur-xs px-2.5 py-1 rounded-[4px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-medium text-white tracking-wider uppercase">
              LIVE
            </span>
          </div>
        </div>
      </div>

      {/* 3. Caption block: serif heading + live/muted user transcript */}
      <div
        className="w-full px-2 py-1 text-center shrink-0 min-h-[60px] flex flex-col items-center justify-center gap-1"
        aria-live="polite"
      >
        <p
          className={`font-serif-heading text-[19px] sm:text-[23px] font-normal text-ink leading-snug line-clamp-3 max-w-xl transition-opacity duration-200 ${
            isTurnPending ? 'opacity-45' : 'opacity-100'
          }`}
        >
          {assistant.lastSpokenText ||
            (assistant.language === 'hi'
              ? 'दृष्टि सुन रही है...'
              : 'Drishti is right here...')}
        </p>
        {(interimTranscript || assistant.lastTranscript) && (
          <p className="text-xs text-muted font-sans line-clamp-1 max-w-md transition-opacity duration-150">
            You: {interimTranscript || assistant.lastTranscript}
          </p>
        )}
      </div>

      {/* 4. Voice Orb centered with uppercase label + Quick Actions */}
      <div className="w-full flex flex-col items-center justify-center shrink-0 py-0.5 gap-1.5">
        <Orb state={assistant.state} orbRef={orbRef} />

        {/* Quick Question / Actions Bar */}
        <div
          className="w-full max-w-xs sm:max-w-sm flex flex-col items-center gap-1.5 px-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const prompt =
                assistant.language === 'hi'
                  ? 'मेरे सामने क्या है बताइए'
                  : "Tell me what's in front of me";
              askDirectQuestion(prompt);
            }}
            disabled={assistant.state === 'THINKING'}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-[#2F3BE0] hover:bg-[#2530c0] active:scale-[0.98] text-white text-xs sm:text-sm font-medium rounded-[8px] transition-all shadow-xs cursor-pointer disabled:opacity-50"
            aria-label={assistant.language === 'hi' ? 'मेरे सामने क्या है बताइए' : "Tell me what's in front of me"}
          >
            <Eye className="w-4 h-4" />
            <span>
              {assistant.language === 'hi'
                ? 'सामने क्या है बताइए'
                : "Tell me what's in front of me"}
            </span>
          </button>

          {/* Accessible typed question query input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customQuestion.trim()) {
                askDirectQuestion(customQuestion);
                setCustomQuestion('');
              }
            }}
            className="w-full flex items-center gap-1.5"
          >
            <input
              type="text"
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder={
                assistant.language === 'hi'
                  ? 'या सवाल टाइप कीजिए...'
                  : 'Or type a question...'
              }
              className="flex-1 text-xs px-2.5 py-1.5 bg-white border border-line rounded-[8px] text-ink focus:outline-none focus:border-[#2F3BE0] placeholder:text-gray-400"
              aria-label="Type a question for Drishti"
            />
            <button
              type="submit"
              disabled={!customQuestion.trim() || assistant.state === 'THINKING'}
              className="p-1.5 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 border border-line rounded-[8px] text-ink disabled:opacity-40 transition-colors cursor-pointer"
              aria-label="Send question"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>

      {/* 5. Footer: Built with Gnani Prisma and Timbre + square-cornered Quiet mode button */}
      <footer className="w-full flex items-center justify-between shrink-0 pt-1.5 border-t border-line">
        <span className="text-[10px] text-muted tracking-tight">
          Built with Gnani Prisma and Timbre
        </span>

        <button
          type="button"
          onClick={toggleQuietMode}
          className={`text-xs px-3 py-1.5 rounded-none font-medium border border-line transition-colors cursor-pointer ${
            assistant.isQuiet ? 'bg-[#2F3BE0] text-white' : 'bg-cream text-ink'
          }`}
          aria-label={assistant.isQuiet ? 'Turn quiet mode off' : 'Turn quiet mode on'}
        >
          {assistant.isQuiet
            ? assistant.language === 'hi'
              ? 'शांत मोड चालू'
              : 'Quiet: ON'
            : assistant.language === 'hi'
            ? 'शांत मोड'
            : 'Quiet mode'}
        </button>
      </footer>
    </main>
  );
}
