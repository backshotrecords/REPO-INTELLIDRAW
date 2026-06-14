import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiTranscribeAudio } from "../lib/api";
import { getSoundSettings } from "../lib/soundSettings";
import { putOfflineBlob, removeOfflineBlob, upsertOfflineOperation, removeOfflineOperation } from "../lib/offlineQueue";

/* ================================================================
   VoiceMicButton — chunked voice capture for the chat bar
   ================================================================
   Modes:
   • Normal Voice Recording: continuous chunks append to the input text area.
   • Meeting Mode: continuous chunks bypass the input and enter chat processing.
   ================================================================ */

export type VoiceMode = "normal" | "meeting";

export interface VoiceTranscriptChunk {
  id: string;
  index: number;
  mode: VoiceMode;
}

interface VoiceMicButtonProps {
  onTranscript: (text: string, chunk: VoiceTranscriptChunk) => void;
  onMeetingTranscript?: (text: string, chunk: VoiceTranscriptChunk) => Promise<void> | void;
  canvasId?: string | null;
  disabled?: boolean;
  chunkLengthMinutes?: number;
}

type VoiceState = "idle" | "recording" | "processing" | "success" | "cancelled";
type VoiceChunkStatus = "transcribing" | "ready" | "chat_processing" | "complete" | "error";

interface VoiceChunkItem extends VoiceTranscriptChunk {
  status: VoiceChunkStatus;
  transcript?: string;
  error?: string;
}

const DEFAULT_CHUNK_MINUTES = 5;

function clampChunkLength(minutes?: number) {
  if (!Number.isFinite(minutes)) return DEFAULT_CHUNK_MINUTES;
  return Math.max(1, Math.min(10, Math.round(minutes || DEFAULT_CHUNK_MINUTES)));
}

function formatTime(s: number) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function modeLabel(mode: VoiceMode) {
  return mode === "meeting" ? "Meeting Mode" : "Normal Voice";
}

function chunkStatusLabel(status: VoiceChunkStatus) {
  switch (status) {
    case "transcribing": return "transcribing";
    case "ready": return "ready";
    case "chat_processing": return "processing";
    case "complete": return "done";
    case "error": return "error";
  }
}

export default function VoiceMicButton({
  onTranscript,
  onMeetingTranscript,
  canvasId,
  disabled,
  chunkLengthMinutes = DEFAULT_CHUNK_MINUTES,
}: VoiceMicButtonProps) {
  const [mode, setMode] = useState<VoiceMode>("normal");
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(1);
  const [chunks, setChunks] = useState<VoiceChunkItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef<VoiceState>("idle");
  const modeRef = useRef<VoiceMode>("normal");
  const sessionModeRef = useRef<VoiceMode>("normal");
  const cancelledRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const pendingChunkCountRef = useRef(0);
  const nextChunkIndexRef = useRef(1);
  const chunkLengthRef = useRef(clampChunkLength(chunkLengthMinutes));
  const onTranscriptRef = useRef(onTranscript);
  const onMeetingTranscriptRef = useRef(onMeetingTranscript);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { chunkLengthRef.current = clampChunkLength(chunkLengthMinutes); }, [chunkLengthMinutes]);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onMeetingTranscriptRef.current = onMeetingTranscript;
  }, [onTranscript, onMeetingTranscript]);

  const updateChunk = useCallback((id: string, updates: Partial<VoiceChunkItem>) => {
    setChunks((current) => current.map((chunk) => chunk.id === id ? { ...chunk, ...updates } : chunk));
  }, []);

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  const settleIfComplete = useCallback(() => {
    if (recordingActiveRef.current || pendingChunkCountRef.current > 0 || cancelledRef.current) return;
    if (stateRef.current !== "processing" && stateRef.current !== "recording") return;

    setState("success");
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setState("idle");
      setChunks((current) => current.filter((chunk) => chunk.status === "error").slice(-3));
    }, 1800);
  }, []);

  const finishPendingChunk = useCallback(() => {
    pendingChunkCountRef.current = Math.max(0, pendingChunkCountRef.current - 1);
    settleIfComplete();
  }, [settleIfComplete]);

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
      ctx.fillStyle = "#f4f3f9";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(70, 70, 79, 0.06)";
      ctx.lineWidth = 0.5;
      for (let y = 0; y < canvas.height; y += 12) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = modeRef.current === "meeting" ? "#0058bc" : "#00897b";
      ctx.shadowColor = modeRef.current === "meeting" ? "rgba(0, 88, 188, 0.32)" : "rgba(0, 137, 123, 0.35)";
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
      ctx.shadowBlur = 0;
    };

    draw();
  }, []);

  useEffect(() => {
    if (state === "recording" && analyserRef.current && canvasRef.current) {
      drawWaveform();
    }
    return () => {
      if (state !== "recording") stopWaveform();
    };
  }, [state, drawWaveform, stopWaveform]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      void audioCtxRef.current?.close();
    };
  }, []);

  const sendForTranscription = useCallback(async (blob: Blob, chunk: VoiceTranscriptChunk) => {
    pendingChunkCountRef.current += 1;
    setChunks((current) => [...current, { ...chunk, status: "transcribing" }]);

    const operationId = `transcription:${crypto.randomUUID()}`;
    const blobKey = `${operationId}:audio`;
    await putOfflineBlob(blobKey, blob);
    upsertOfflineOperation({
      id: operationId,
      type: "transcription",
      canvasId: canvasId || null,
      payload: {
        canvasId: canvasId || null,
        blobKey,
        autoSend: chunk.mode === "meeting",
        mimeType: blob.type || "audio/webm",
        mode: chunk.mode,
        chunkIndex: chunk.index,
      },
    });

    try {
      const text = await apiTranscribeAudio(blob);
      updateChunk(chunk.id, { transcript: text, status: chunk.mode === "meeting" ? "ready" : "complete" });

      if (chunk.mode === "meeting") {
        updateChunk(chunk.id, { status: "chat_processing" });
        await onMeetingTranscriptRef.current?.(text, chunk);
        updateChunk(chunk.id, { status: "complete" });
      } else {
        onTranscriptRef.current(text, chunk);
      }

      const settings = getSoundSettings();
      if (settings.enabled && settings.volume > 0) {
        const audio = new Audio(settings.voiceSoundUrl);
        audio.volume = settings.volume;
        audio.play().catch(() => {});
      }

      removeOfflineOperation(operationId);
      void removeOfflineBlob(blobKey);
    } catch (err) {
      console.error("Transcription error:", err);
      const message = err instanceof Error ? err.message : "Transcription failed";
      updateChunk(chunk.id, { status: "error", error: message });
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      finishPendingChunk();
    }
  }, [canvasId, finishPendingChunk, updateChunk]);

  const startRecording = useCallback(async () => {
    setErrorMsg(null);
    setMenuOpen(false);
    cancelledRef.current = false;
    recordingActiveRef.current = true;
    pendingChunkCountRef.current = 0;
    nextChunkIndexRef.current = 1;
    setCurrentChunkIndex(1);
    setChunks([]);
    sessionModeRef.current = modeRef.current;

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorderOptions = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : undefined;
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (cancelledRef.current || event.data.size === 0) return;

        const index = nextChunkIndexRef.current;
        nextChunkIndexRef.current += 1;
        setCurrentChunkIndex(nextChunkIndexRef.current);

        const chunk: VoiceTranscriptChunk = {
          id: crypto.randomUUID(),
          index,
          mode: sessionModeRef.current,
        };
        void sendForTranscription(event.data, chunk);
      };

      mediaRecorder.onstop = () => {
        recordingActiveRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        void audioCtxRef.current?.close();
        audioCtxRef.current = null;

        if (cancelledRef.current) {
          pendingChunkCountRef.current = 0;
          cancelledRef.current = false;
          return;
        }

        setState(pendingChunkCountRef.current > 0 ? "processing" : "success");
        settleIfComplete();
      };

      const chunkMs = chunkLengthRef.current * 60 * 1000;
      mediaRecorder.start(chunkMs);
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((value) => value + 1);
      }, 1000);
    } catch {
      recordingActiveRef.current = false;
      setErrorMsg("Microphone access denied.");
      setTimeout(() => setErrorMsg(null), 3000);
    }
  }, [sendForTranscription, settleIfComplete]);

  const stopRecording = useCallback(() => {
    recordingActiveRef.current = false;

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

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    recordingActiveRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopWaveform();
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setChunks([]);

    setState("cancelled");
    setTimeout(() => setState("idle"), 1200);
  }, [stopWaveform]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (disabled && stateRef.current !== "recording") return;
    if (stateRef.current === "processing" || stateRef.current === "cancelled") return;

    event.preventDefault();
    if (stateRef.current === "recording") {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [disabled, startRecording, stopRecording]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (disabled && stateRef.current !== "recording") return;
    if (stateRef.current === "recording") stopRecording();
    else if (stateRef.current === "idle" || stateRef.current === "success") void startRecording();
  }, [disabled, startRecording, stopRecording]);

  const btnClass = [
    "voice-mic-btn",
    state === "recording" && "voice-recording",
    state === "processing" && "voice-processing",
    state === "success" && "voice-success",
    state === "cancelled" && "voice-cancelled-state",
    disabled && "voice-disabled",
    mode === "meeting" && "voice-meeting-mode",
  ].filter(Boolean).join(" ");

  const visibleChunks = chunks.slice(-4);
  const activeChunk = visibleChunks.find((chunk) => chunk.status !== "complete") || visibleChunks[visibleChunks.length - 1];
  const activeCount = chunks.filter((chunk) => chunk.status !== "complete").length;

  return (
    <div className="voice-mic-wrapper">
      {activeChunk && (
        <div className="voice-chunk-pill" title={`Voice chunks: ${chunks.length}`}>
          <span className={`voice-chunk-dot voice-chunk-${activeChunk.status}`} />
          <span className="voice-chunk-label">#{activeChunk.index} {chunkStatusLabel(activeChunk.status)}</span>
          {activeCount > 1 && <span className="voice-chunk-count">{activeCount}</span>}
        </div>
      )}

      <button
        type="button"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className={btnClass}
        aria-label={
          state === "recording" ? "Stop recording" : state === "processing" ? "Processing recording chunks" : "Start voice input"
        }
        title={
          state === "recording"
            ? "Stop recording"
            : state === "processing"
              ? "Processing recording chunks"
              : `${modeLabel(mode)} (${chunkLengthRef.current} min chunks)`
        }
        disabled={disabled && state !== "recording"}
      >
        {(state === "idle" || state === "success" || state === "cancelled") && (
          <svg className="voice-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z" fill="currentColor" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 19v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}

        {state === "recording" && (
          <svg className="voice-icon" viewBox="0 0 24 24" fill="none">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
        )}

        {state === "processing" && (
          <svg className="voice-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4Z" fill="currentColor" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 19v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="voice-mode-menu-btn"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (state === "recording" || state === "processing") return;
          setMenuOpen((open) => !open);
        }}
        aria-label="Choose voice recording mode"
        title="Choose voice recording mode"
        disabled={state === "recording" || state === "processing"}
      >
        <span className="material-symbols-outlined">expand_more</span>
      </button>

      {menuOpen && (
        <div className="voice-mode-menu">
          {(["normal", "meeting"] as VoiceMode[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`voice-mode-option ${mode === item ? "is-selected" : ""}`}
              onClick={() => {
                setMode(item);
                setMenuOpen(false);
              }}
            >
              <span className="material-symbols-outlined">{item === "meeting" ? "groups" : "keyboard_voice"}</span>
              <span>{modeLabel(item)}</span>
              {mode === item && <span className="material-symbols-outlined voice-mode-check">check</span>}
            </button>
          ))}
        </div>
      )}

      {(state === "recording") && createPortal(
        <div className="voice-waveform-panel">
          <div className="voice-waveform-inner">
            <div className="voice-waveform-status">
              <div className="voice-rec-dot" />
              <span className="voice-rec-label">{modeLabel(sessionModeRef.current)}</span>
              <span className="voice-chunk-live">Chunk #{currentChunkIndex}</span>
              <span className="voice-timer">{formatTime(seconds)}</span>
              <button
                type="button"
                className="voice-cancel-btn"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  cancelRecording();
                }}
                aria-label="Cancel recording"
                title="Cancel recording"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
            <canvas ref={canvasRef} className="voice-waveform-canvas" width={480} height={64} />
          </div>
        </div>,
        document.body
      )}

      {state === "success" && createPortal(
        <div className="voice-success-toast">
          <span className="material-symbols-outlined voice-success-icon" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <span>Transcribed</span>
        </div>,
        document.body
      )}

      {state === "cancelled" && createPortal(
        <div className="voice-cancelled-toast">
          <span className="material-symbols-outlined voice-trash-icon" style={{ fontVariationSettings: "'FILL' 1" }}>delete</span>
          <span>Cancelled</span>
        </div>,
        document.body
      )}

      {errorMsg && createPortal(
        <div className="voice-error-toast">
          <span className="material-symbols-outlined voice-error-icon" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
          <span>{errorMsg}</span>
        </div>,
        document.body
      )}
    </div>
  );
}
