import { useState, useRef, useEffect, useCallback } from "react";
import { apiTranscribeAudio } from "../lib/api";

/* ================================================================
   VoiceMicButton — Voice-to-text input for the chat bar
   ================================================================
   State machine: idle → recording → processing → success → idle
   ================================================================ */

interface VoiceMicButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

type VoiceState = "idle" | "recording" | "processing" | "success";

export default function VoiceMicButton({ onTranscript, disabled }: VoiceMicButtonProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
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
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        sendForTranscription(blob);
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
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopWaveform();
    setState("processing");
  }, [stopWaveform]);

  // ── Send for transcription ───────────────────────────────────
  const sendForTranscription = async (blob: Blob) => {
    try {
      const text = await apiTranscribeAudio(blob);
      onTranscript(text);
      setState("success");
      setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      console.error("Transcription error:", err);
      setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
      setState("idle");
      setTimeout(() => setErrorMsg(null), 4000);
    }
  };

  // ── Toggle handler ───────────────────────────────────────────
  const handleClick = () => {
    if (disabled || state === "processing") return;
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle" || state === "success") {
      startRecording();
    }
  };

  // ── Button class ─────────────────────────────────────────────
  const btnClass = [
    "voice-mic-btn",
    state === "recording" && "voice-recording",
    state === "processing" && "voice-processing",
    state === "success" && "voice-success",
    disabled && "voice-disabled",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="voice-mic-wrapper">
      {/* ── Floating waveform panel ──────────────────────────── */}
      {(state === "recording") && (
        <div className="voice-waveform-panel">
          <div className="voice-waveform-inner">
            <div className="voice-waveform-status">
              <div className="voice-rec-dot" />
              <span className="voice-rec-label">Recording</span>
              <span className="voice-timer">{formatTime(seconds)}</span>
            </div>
            <canvas
              ref={canvasRef}
              className="voice-waveform-canvas"
              width={480}
              height={64}
            />
          </div>
        </div>
      )}

      {/* ── Success toast ────────────────────────────────────── */}
      {state === "success" && (
        <div className="voice-success-toast">
          <span className="material-symbols-outlined voice-success-icon" style={{ fontVariationSettings: "'FILL' 1" }}>
            check_circle
          </span>
          <span>Transcribed</span>
        </div>
      )}

      {/* ── Error toast ──────────────────────────────────────── */}
      {errorMsg && (
        <div className="voice-error-toast">
          <span className="material-symbols-outlined voice-error-icon" style={{ fontVariationSettings: "'FILL' 1" }}>
            error
          </span>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Mic button ───────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleClick}
        className={btnClass}
        aria-label={
          state === "recording" ? "Stop recording" : state === "processing" ? "Transcribing..." : "Start voice input"
        }
        title={
          state === "recording" ? "Tap to stop" : state === "processing" ? "Transcribing..." : "Voice input"
        }
        disabled={disabled && state !== "recording"}
      >
        {/* Mic icon (idle / success) */}
        {(state === "idle" || state === "success") && (
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
