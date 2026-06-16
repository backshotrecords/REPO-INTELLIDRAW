import { useState, useRef, useEffect, useCallback, type CSSProperties } from "react";
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
  meetingSilenceStopSeconds?: number;
  externalStopSignal?: number;
  inputBarHeight?: number;
  onChunkQueueChange?: (chunks: VoiceQueueChunk[]) => void;
}

type VoiceState = "idle" | "recording" | "processing" | "success" | "cancelled";
export type VoiceChunkStatus = "transcribing" | "ready" | "chat_processing" | "complete" | "error";

export interface VoiceQueueChunk extends VoiceTranscriptChunk {
  status: VoiceChunkStatus;
  transcript?: string;
  error?: string;
}

const DEFAULT_CHUNK_MINUTES = 5;
const MENU_WIDTH_PX = 220;
const MENU_HEIGHT_PX = 96;
const SILENCE_INDICATOR_MS = 2000;
const SILENCE_RMS_THRESHOLD = 0.015;

function clampChunkLength(minutes?: number) {
  if (!Number.isFinite(minutes)) return DEFAULT_CHUNK_MINUTES;
  return Math.max(1, Math.min(10, Math.round(minutes || DEFAULT_CHUNK_MINUTES)));
}

function clampSilenceStopSeconds(seconds?: number) {
  if (!Number.isFinite(seconds)) return 120;
  return Math.max(0, Math.min(600, Math.round(seconds || 0)));
}

function formatTime(s: number) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function modeLabel(mode: VoiceMode) {
  return mode === "meeting" ? "Meeting Mode" : "Normal Voice";
}

export default function VoiceMicButton({
  onTranscript,
  onMeetingTranscript,
  canvasId,
  disabled,
  chunkLengthMinutes = DEFAULT_CHUNK_MINUTES,
  meetingSilenceStopSeconds = 120,
  externalStopSignal = 0,
  inputBarHeight = 60,
  onChunkQueueChange,
}: VoiceMicButtonProps) {
  const [mode, setMode] = useState<VoiceMode>("normal");
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(1);
  const [chunks, setChunks] = useState<VoiceQueueChunk[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [silenceDetected, setSilenceDetected] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderMimeTypeRef = useRef("audio/webm");
  const audioStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef<VoiceState>("idle");
  const modeRef = useRef<VoiceMode>("normal");
  const sessionModeRef = useRef<VoiceMode>("normal");
  const cancelledRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const pendingChunkCountRef = useRef(0);
  const nextChunkIndexRef = useRef(1);
  const silenceStartedAtRef = useRef<number | null>(null);
  const silenceDetectedRef = useRef(false);
  const silenceAutoStopTriggeredRef = useRef(false);
  const chunkLengthRef = useRef(clampChunkLength(chunkLengthMinutes));
  const silenceStopSecondsRef = useRef(clampSilenceStopSeconds(meetingSilenceStopSeconds));
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const lastExternalStopSignalRef = useRef(externalStopSignal);
  const onTranscriptRef = useRef(onTranscript);
  const onMeetingTranscriptRef = useRef(onMeetingTranscript);
  const waveformBottom = Math.max(90, inputBarHeight + 32);
  const mobileWaveformBottom = Math.max(154, inputBarHeight + 148);
  const waveformStyle = {
    "--voice-waveform-bottom": `${waveformBottom}px`,
    "--voice-waveform-mobile-bottom": `${mobileWaveformBottom}px`,
  } as CSSProperties;

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { chunkLengthRef.current = clampChunkLength(chunkLengthMinutes); }, [chunkLengthMinutes]);
  useEffect(() => {
    silenceStopSecondsRef.current = clampSilenceStopSeconds(meetingSilenceStopSeconds);
  }, [meetingSilenceStopSeconds]);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onMeetingTranscriptRef.current = onMeetingTranscript;
  }, [onTranscript, onMeetingTranscript]);

  useEffect(() => {
    onChunkQueueChange?.(chunks);
  }, [chunks, onChunkQueueChange]);

  const updateMenuPosition = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH_PX),
      Math.max(8, window.innerWidth - MENU_WIDTH_PX - 8)
    );
    const top = Math.max(8, rect.top - MENU_HEIGHT_PX - 10);
    setMenuPosition({ left, top });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  const updateChunk = useCallback((id: string, updates: Partial<VoiceQueueChunk>) => {
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

  const updateSilenceIndicator = useCallback((rms: number) => {
    const now = performance.now();
    const isBelowGate = rms < SILENCE_RMS_THRESHOLD;

    if (isBelowGate) {
      silenceStartedAtRef.current ??= now;
      if (!silenceDetectedRef.current && now - silenceStartedAtRef.current >= SILENCE_INDICATOR_MS) {
        silenceDetectedRef.current = true;
        setSilenceDetected(true);
      }
      const silenceStopMs = silenceStopSecondsRef.current * 1000;
      if (
        sessionModeRef.current === "meeting" &&
        silenceStopMs > 0 &&
        !silenceAutoStopTriggeredRef.current &&
        now - silenceStartedAtRef.current >= silenceStopMs
      ) {
        silenceAutoStopTriggeredRef.current = true;
        stopRecordingRef.current?.();
      }
      return;
    }

    silenceStartedAtRef.current = null;
    if (silenceDetectedRef.current) {
      silenceDetectedRef.current = false;
      setSilenceDetected(false);
    }
  }, []);

  const resetSilenceIndicator = useCallback(() => {
    silenceStartedAtRef.current = null;
    silenceDetectedRef.current = false;
    silenceAutoStopTriggeredRef.current = false;
    setSilenceDetected(false);
  }, []);

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

      let energySum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const centered = (dataArray[i] - 128) / 128;
        energySum += centered * centered;
      }
      updateSilenceIndicator(Math.sqrt(energySum / bufferLength));

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
  }, [updateSilenceIndicator]);

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
      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
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

  const cleanupRecordingResources = useCallback(() => {
    resetSilenceIndicator();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    mediaRecorderRef.current = null;
    recorderChunksRef.current = [];
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
  }, [resetSilenceIndicator]);

  const startRecorderChunk = useCallback(() => {
    const stream = audioStreamRef.current;
    if (!stream || cancelledRef.current) return;

    recorderChunksRef.current = [];
    const recorderOptions = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus" }
      : undefined;
    const mediaRecorder = new MediaRecorder(stream, recorderOptions);
    mediaRecorderRef.current = mediaRecorder;
    recorderMimeTypeRef.current = mediaRecorder.mimeType || recorderOptions?.mimeType || "audio/webm";

    const chunkIndex = nextChunkIndexRef.current;
    setCurrentChunkIndex(chunkIndex);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recorderChunksRef.current.push(event.data);
    };

    mediaRecorder.onstop = () => {
      if (chunkTimerRef.current) {
        clearTimeout(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }

      const blobParts = recorderChunksRef.current;
      recorderChunksRef.current = [];

      if (cancelledRef.current) {
        pendingChunkCountRef.current = 0;
        cancelledRef.current = false;
        cleanupRecordingResources();
        return;
      }

      if (blobParts.some((part) => part.size > 0)) {
        const mimeType = recorderMimeTypeRef.current || blobParts.find((part) => part.type)?.type || "audio/webm";
        const blob = new Blob(blobParts, { type: mimeType });
        const chunk: VoiceTranscriptChunk = {
          id: crypto.randomUUID(),
          index: chunkIndex,
          mode: sessionModeRef.current,
        };
        nextChunkIndexRef.current += 1;
        setCurrentChunkIndex(nextChunkIndexRef.current);
        void sendForTranscription(blob, chunk);
      }

      if (recordingActiveRef.current) {
        startRecorderChunk();
        return;
      }

      cleanupRecordingResources();
      setState(pendingChunkCountRef.current > 0 ? "processing" : "success");
      settleIfComplete();
    };

    mediaRecorder.start();
    chunkTimerRef.current = setTimeout(() => {
      if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, chunkLengthRef.current * 60 * 1000);
  }, [cleanupRecordingResources, sendForTranscription, settleIfComplete]);

  const startRecording = useCallback(async () => {
    setErrorMsg(null);
    setMenuOpen(false);
    resetSilenceIndicator();
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

      startRecorderChunk();
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
  }, [resetSilenceIndicator, startRecorderChunk]);

  const stopRecording = useCallback(() => {
    recordingActiveRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopWaveform();
    setState("processing");
  }, [cleanupRecordingResources, stopWaveform]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    if (lastExternalStopSignalRef.current === externalStopSignal) return;
    lastExternalStopSignalRef.current = externalStopSignal;
    if (
      externalStopSignal > 0 &&
      sessionModeRef.current === "meeting" &&
      stateRef.current === "recording"
    ) {
      stopRecording();
    }
  }, [externalStopSignal, stopRecording]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    recordingActiveRef.current = false;

    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopWaveform();
    setChunks([]);

    setState("cancelled");
    setTimeout(() => setState("idle"), 1200);
  }, [cleanupRecordingResources, stopWaveform]);

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

  return (
    <div className="voice-mic-wrapper" ref={wrapperRef}>
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
          if (!menuOpen) updateMenuPosition();
          setMenuOpen((open) => !open);
        }}
        aria-label="Choose voice recording mode"
        title="Choose voice recording mode"
        disabled={state === "recording" || state === "processing"}
      >
        <span className="material-symbols-outlined">expand_more</span>
      </button>

      {menuOpen && menuPosition && createPortal(
        <div className="voice-mode-menu" style={{ left: menuPosition.left, top: menuPosition.top }}>
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
        </div>,
        document.body
      )}

      {(state === "recording") && createPortal(
        <div className="voice-waveform-panel" style={waveformStyle}>
          <div className="voice-waveform-inner">
            <div className="voice-waveform-status">
              <div className="voice-rec-dot" />
              <span className="voice-rec-label">{modeLabel(sessionModeRef.current)}</span>
              <span className="voice-chunk-live">Chunk #{currentChunkIndex}</span>
              {silenceDetected && (
                <span className="voice-silence-badge">
                  <span className="material-symbols-outlined">volume_off</span>
                  Quiet
                </span>
              )}
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
