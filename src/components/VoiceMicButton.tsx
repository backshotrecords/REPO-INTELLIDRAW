import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiTranscribeAudio } from "../lib/api";
import { getSoundSettings } from "../lib/soundSettings";

/* ================================================================
   VoiceMicButton — Voice-to-text input for the chat bar
   ================================================================
   State machine: idle → recording → processing → success → idle
                                   ↘ cancelled → idle

   Interaction modes:
   • Tap-to-record: tap to start, tap to stop → text lands in input
   • Push-to-talk:  hold ≥300ms to start, release to stop → auto-send
   • Cancel:        X button on waveform, or slide-left during PTT
   ================================================================ */

interface VoiceMicButtonProps {
  onTranscript: (text: string) => void;
  onAutoSendTranscript?: (text: string) => void;
  disabled?: boolean;
}

type VoiceState = "idle" | "recording" | "processing" | "success" | "cancelled";

const HOLD_THRESHOLD_MS = 300;
const SLIDE_CANCEL_PX = 100;

export default function VoiceMicButton({ onTranscript, onAutoSendTranscript, disabled }: VoiceMicButtonProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [slideOffset, setSlideOffset] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Push-to-talk refs (used in async/timer callbacks to get latest values)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const isPushToTalkRef = useRef(false);
  const cancelledRef = useRef(false);
  const autoSendRef = useRef(false);
  const isHoldingRef = useRef(false);
  const slideOffsetRef = useRef(0);
  const stateRef = useRef<VoiceState>("idle");

  // Keep stateRef in sync with state
  useEffect(() => { stateRef.current = state; }, [state]);

  const isCancelZone = slideOffset < -SLIDE_CANCEL_PX;

  // ── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Format timer ─────────────────────────────────────────────
  const formatTime = (s: number) => {
    const m = String(Math.floor(s / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${m}:${sec}`;
  };

  // ── Waveform drawing ────────────────────────────────────────
  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Light background to match app theme
      ctx.fillStyle = "#f4f3f9";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle grid lines
      ctx.strokeStyle = "rgba(70, 70, 79, 0.06)";
      ctx.lineWidth = 0.5;
      for (let y = 0; y < canvas.height; y += 12) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Main waveform line — app primary/teal
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#00897b";
      ctx.shadowColor = "rgba(0, 137, 123, 0.35)";
      ctx.shadowBlur = 8;
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      // Second pass — subtle glow
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0, 137, 123, 0.2)";
      ctx.shadowBlur = 14;
      ctx.stroke();

      ctx.shadowBlur = 0;
    };

    draw();
  }, []);

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  // ── Start waveform AFTER canvas is rendered ──────────────────
  useEffect(() => {
    if (state === "recording" && analyserRef.current && canvasRef.current) {
      drawWaveform();
    }
    return () => {
      if (state !== "recording") {
        stopWaveform();
      }
    };
  }, [state, drawWaveform, stopWaveform]);

  // ── Start recording ──────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setErrorMsg(null);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      // Set up Web Audio analyser for waveform
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());

        if (cancelledRef.current) {
          cancelledRef.current = false;
          return; // Cancelled — don't transcribe
        }

        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        sendForTranscription(blob, autoSendRef.current);
        autoSendRef.current = false;
      };

      mediaRecorder.start();
      setState("recording");

      // Timer
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);

      // NOTE: waveform is started by the useEffect above once canvas renders
    } catch {
      setErrorMsg("Microphone access denied.");
      setTimeout(() => setErrorMsg(null), 3000);
    }
  }, []);

  // ── Stop recording ───────────────────────────────────────────
  const stopRecording = useCallback((autoSend = false) => {
    autoSendRef.current = autoSend;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopWaveform();
    setIsPushToTalk(false);
    isPushToTalkRef.current = false;
    setSlideOffset(0);
    slideOffsetRef.current = 0;
    setState("processing");
  }, [stopWaveform]);

  // ── Cancel recording (discard — no API call) ─────────────────
  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    // Stop mic stream
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopWaveform();

    // Close audio context
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    // Reset
    audioChunksRef.current = [];
    setIsPushToTalk(false);
    isPushToTalkRef.current = false;
    setSlideOffset(0);
    slideOffsetRef.current = 0;

    // Show cancelled state with trash animation, then return to idle
    setState("cancelled");
    setTimeout(() => setState("idle"), 1200);
  }, [stopWaveform]);

  // ── Send for transcription ───────────────────────────────────
  const sendForTranscription = async (blob: Blob, autoSend = false) => {
    try {
      const text = await apiTranscribeAudio(blob);

      if (autoSend && onAutoSendTranscript) {
        onAutoSendTranscript(text);
      } else {
        onTranscript(text);
      }

      // Play voice transcription sound, respecting master settings
      const settings = getSoundSettings();
      if (settings.enabled && settings.volume > 0) {
        const audio = new Audio(settings.voiceSoundUrl);
        audio.volume = settings.volume;
        audio.play().catch(() => {});
      }

      setState("success");
      setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      console.error("Transcription error:", err);
      setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
      setState("idle");
      setTimeout(() => setErrorMsg(null), 4000);
    }
  };

  // ── Pointer handlers (tap vs. hold detection) ────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled && stateRef.current !== "recording") return;
    if (stateRef.current === "processing" || stateRef.current === "cancelled") return;

    e.preventDefault();
    isHoldingRef.current = true;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    slideOffsetRef.current = 0;
    setSlideOffset(0);

    // Capture pointer so we get move/up events even outside the button
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (stateRef.current === "recording") {
      // Already recording in tap mode — pointer up will stop it
      return;
    }

    // Start hold detection timer
    holdTimerRef.current = setTimeout(async () => {
      if (!isHoldingRef.current) return; // User released before threshold
      // Hold threshold reached → push-to-talk mode
      isPushToTalkRef.current = true;
      setIsPushToTalk(true);
      await startRecording();
      // If user released during getUserMedia, cancel silently
      if (!isHoldingRef.current && stateRef.current === "recording") {
        cancelRecording();
      }
    }, HOLD_THRESHOLD_MS);
  }, [disabled, startRecording, cancelRecording]);

  const handlePointerUp = useCallback(() => {
    isHoldingRef.current = false;

    // Clear hold timer if it hasn't fired yet (tap was < 300ms)
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    // ── Push-to-talk release ──
    if (isPushToTalkRef.current) {
      if (stateRef.current === "recording") {
        if (slideOffsetRef.current < -SLIDE_CANCEL_PX) {
          cancelRecording();
        } else {
          stopRecording(true); // autoSend = true
        }
      }
      // If state isn't "recording" yet (getUserMedia pending),
      // the async check in handlePointerDown will handle it
      isPushToTalkRef.current = false;
      setIsPushToTalk(false);
      return;
    }

    // ── Tap mode ──
    if (stateRef.current === "recording") {
      stopRecording(false);
    } else if (stateRef.current === "idle" || stateRef.current === "success") {
      startRecording();
    }
  }, [startRecording, stopRecording, cancelRecording]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPushToTalkRef.current || stateRef.current !== "recording") return;
    if (!pointerStartRef.current) return;

    const deltaX = e.clientX - pointerStartRef.current.x;
    slideOffsetRef.current = deltaX;
    setSlideOffset(deltaX);
  }, []);

  // ── Keyboard accessibility ──────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (disabled && stateRef.current !== "recording") return;
    if (stateRef.current === "processing" || stateRef.current === "cancelled") return;

    // Keyboard always uses tap mode
    if (stateRef.current === "recording") {
      stopRecording(false);
    } else if (stateRef.current === "idle" || stateRef.current === "success") {
      startRecording();
    }
  }, [disabled, startRecording, stopRecording]);

  // ── Button class ─────────────────────────────────────────────
  const btnClass = [
    "voice-mic-btn",
    state === "recording" && "voice-recording",
    state === "processing" && "voice-processing",
    state === "success" && "voice-success",
    state === "cancelled" && "voice-cancelled-state",
    disabled && "voice-disabled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="voice-mic-wrapper">
      {/* ── Floating waveform panel (portaled to body to escape parent transforms) ── */}
      {(state === "recording") && createPortal(
        <div className={`voice-waveform-panel ${isPushToTalk ? "voice-ptt-mode" : ""}`}>
          <div
            className={`voice-waveform-inner ${isCancelZone ? "voice-waveform-cancel" : ""}`}
            style={isPushToTalk && slideOffset < 0 ? {
              transform: `translateX(${Math.max(slideOffset * 0.15, -20)}px)`,
              transition: "transform 0.05s ease-out",
            } : undefined}
          >
            <div className="voice-waveform-status">
              <div className="voice-rec-dot" />
              <span className="voice-rec-label">
                {isPushToTalk ? "Push to talk" : "Recording"}
              </span>
              <span className="voice-timer">{formatTime(seconds)}</span>
              {/* Cancel X button */}
              <button
                type="button"
                className="voice-cancel-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelRecording();
                }}
                aria-label="Cancel recording"
                title="Cancel recording"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
            <canvas
              ref={canvasRef}
              className="voice-waveform-canvas"
              width={480}
              height={64}
            />
            {/* Slide to cancel hint (PTT only) */}
            {isPushToTalk && (
              <div className={`voice-slide-hint ${isCancelZone ? "voice-slide-cancel-active" : ""}`}>
                {isCancelZone ? (
                  <>
                    <span
                      className="material-symbols-outlined voice-slide-trash-icon"
                      style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}
                    >
                      delete
                    </span>
                    <span>Release to cancel</span>
                  </>
                ) : (
                  <>
                    <span className="voice-slide-chevron">‹</span>
                    <span>Slide to cancel</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── Success toast (portaled) ── */}
      {state === "success" && createPortal(
        <div className="voice-success-toast">
          <span className="material-symbols-outlined voice-success-icon" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
          <span>Transcribed</span>
        </div>,
        document.body
      )}

      {/* ── Cancelled toast (portaled) — trash can animation ── */}
      {state === "cancelled" && createPortal(
        <div className="voice-cancelled-toast">
          <span
            className="material-symbols-outlined voice-trash-icon"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            delete
          </span>
          <span>Cancelled</span>
        </div>,
        document.body
      )}

      {/* ── Error toast (portaled) ── */}
      {errorMsg && createPortal(
        <div className="voice-error-toast">
          <span className="material-symbols-outlined voice-error-icon" style={{ fontVariationSettings: "'FILL' 1" }}>
            error
          </span>
          <span>{errorMsg}</span>
        </div>,
        document.body
      )}

      {/* ── Mic button ───────────────────────────────────────── */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
        className={btnClass}
        aria-label={
          state === "recording" ? "Stop recording" : state === "processing" ? "Transcribing..." : "Start voice input"
        }
        title={
          state === "recording"
            ? (isPushToTalk ? "Release to send" : "Tap to stop")
            : state === "processing"
              ? "Transcribing..."
              : "Voice input"
        }
        disabled={disabled && state !== "recording"}
      >
        {/* Mic icon (idle / success / cancelled) */}
        {(state === "idle" || state === "success" || state === "cancelled") && (
          <svg className="voice-icon" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z"
              fill="currentColor"
            />
            <path
              d="M19 10v1a7 7 0 0 1-14 0v-1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M12 19v4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}

        {/* Stop icon (recording) */}
        {state === "recording" && (
          <svg className="voice-icon" viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
        )}

        {/* Spinner (processing) */}
        {state === "processing" && (
          <svg className="voice-icon" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z"
              fill="currentColor"
            />
            <path
              d="M19 10v1a7 7 0 0 1-14 0v-1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M12 19v4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
