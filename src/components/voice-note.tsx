import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Gauge, Mic, Pause, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/* ────────────────────────────── constants ───────────────────────────── */

/** Longest single voice note we record (server caps audio at 12 MB). */
export const MAX_VOICE_SECONDS = 180;
/** Bars in the live "recording" waveform. */
const LIVE_BARS = 32;
/** Bars in a player waveform. */
const PLAY_BARS = 40;
/** Playback speeds the little speed chip cycles through. */
const SPEEDS = [1, 1.5, 2];

/** "1:04" — the clock shown beside every waveform. */
export function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

/* ──────────────────────────── audio analysis ─────────────────────────── */

/* ─────────────────────────── the iOS audio session ───────────────────── */

/**
 * Whether a page may make noise is decided by its audio session on iOS, not by
 * the <audio> element. The default ("ambient") session obeys the Ring/Silent
 * switch, and a session still in play-and-record after a mic recording can send
 * playback to the earpiece — in both cases the timeline advances while nothing
 * is heard. Asking for "playback" while a voice note plays is what an audio app
 * does: it is audible with the phone silenced and always comes out of the
 * speaker. Safari exposes this as `navigator.audioSession` (iOS 16.4+), so it is
 * a progressive enhancement — playback is untouched where it does not exist.
 */
type AudioSessionType = "auto" | "playback" | "ambient" | "play-and-record";

function setAudioSessionType(type: AudioSessionType) {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (!session) return;
  try {
    if (session.type !== type) session.type = type;
  } catch {
    // Some transitions are rejected; the note still plays on the default route.
  }
}

/** One shared context, used only to decode audio into peaks (never to play). */
let decodeCtx: AudioContext | null = null;
function getDecodeContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!decodeCtx) decodeCtx = new Ctor();
  return decodeCtx;
}

/** A decoded voice note: its waveform bars and its real length in seconds. */
type DecodedWave = { bars: number[]; duration: number };

/** Decoding is expensive, so each source is analysed at most once. */
const waveCache = new Map<string, DecodedWave>();

async function decodeWave(src: string, bars = PLAY_BARS): Promise<DecodedWave | null> {
  const ctx = getDecodeContext();
  if (!ctx) return null;
  try {
    const bytes = await (await fetch(src)).arrayBuffer();
    const audio = await ctx.decodeAudioData(bytes.slice(0));
    const data = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / bars));
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const from = i * block;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[from + j] ?? 0);
        if (v > max) max = v;
      }
      out.push(max);
    }
    const loudest = Math.max(...out, 0.001);
    return {
      bars: out.map((v) => Math.max(0.09, Math.min(1, v / loudest))),
      // decoding reports the true length, which is the only reliable source for
      // the WebM clips MediaRecorder produces: those often report Infinity from
      // the <audio> element, leaving a duration stuck at 0:00.
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    };
  } catch {
    // Some browsers refuse to decode the container we just recorded; the
    // player still works, it just draws an approximated waveform.
    return null;
  }
}

/** Stable, speech-shaped bars for audio we could not decode. */
function fallbackPeaks(seed: string, bars = PLAY_BARS) {
  let h = 7;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 2147483647;
  return Array.from({ length: bars }, (_, i) => {
    h = (h * 1103515245 + 12345) % 2147483647;
    const envelope = 0.5 + 0.5 * Math.sin((i / bars) * Math.PI);
    return Math.max(0.12, Math.min(1, envelope * (0.4 + (h / 2147483647) * 0.8)));
  });
}

/* ─────────────────────────── waveform bars ──────────────────────────── */

/**
 * The waveform itself: capsule bars mirrored around the centre line, so the
 * strip reads as an oscilloscope envelope rather than a bar chart. Quiet
 * passages collapse to a row of dots on the axis, which is what makes the
 * shape of a spoken note recognisable at a glance.
 */
function WaveBars({
  bars,
  tone,
  animate = false,
  glow = false,
}: {
  bars: number[];
  tone: "idle" | "active" | "recording";
  animate?: boolean;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center gap-[2px]",
        glow &&
          (tone === "recording"
            ? "drop-shadow-[0_0_4px_rgba(208,68,68,0.45)]"
            : "drop-shadow-[0_0_5px_rgba(143,175,138,0.65)]"),
      )}
      aria-hidden
    >
      {bars.map((h, i) => (
        <motion.span
          key={i}
          initial={animate ? { scaleY: 0.25, opacity: 0.4 } : false}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: animate ? i * 0.008 : 0 }}
          className={cn(
            "min-w-px flex-1 origin-center rounded-full",
            animate
              ? "transition-[height] duration-100 ease-out"
              : "transition-[height] duration-200",
            tone === "active" && "bg-primary",
            tone === "idle" && "bg-muted-foreground/25",
            tone === "recording" && "bg-destructive/85",
          )}
          style={{ height: `${Math.max(11, Math.round(h * 100))}%` }}
        />
      ))}
    </div>
  );
}

/* ───────────────────────────── the player ───────────────────────────── */

/**
 * An animated voice-note player: play/pause, a tappable waveform that doubles
 * as a progress bar, the length of the recording, elapsed time while playing,
 * and a playback-speed chip. The waveform is drawn from the real audio, so a
 * quiet note looks quiet, and the length is shown from the stored metadata so
 * it reads correctly the moment the note appears in the feed.
 */
export function AudioWavePlayer({
  src,
  durationHintMs,
  name = "Voice note",
  compact = false,
  className,
}: {
  src: string;
  durationHintMs?: number;
  name?: string;
  /** Slimmer styling for comment threads. */
  compact?: boolean;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState((durationHintMs ?? 0) / 1000);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(
    () => waveCache.get(src)?.bars ?? null,
  );
  const speed = SPEEDS[speedIndex];

  // Draw the real waveform once per source, and fill in the length from the
  // decode whenever the stored duration is missing or the file reports none.
  useEffect(() => {
    const keepDecodedDuration = (decoded?: number) => {
      if (!decoded || !Number.isFinite(decoded) || decoded <= 0) return;
      setDuration((prev) => (Number.isFinite(prev) && prev > 0 ? prev : decoded));
    };

    const cached = waveCache.get(src);
    if (cached) {
      setPeaks(cached.bars);
      keepDecodedDuration(cached.duration);
      return;
    }

    let alive = true;
    void decodeWave(src).then((decoded) => {
      if (!alive) return;
      const bars = decoded?.bars ?? fallbackPeaks(src);
      waveCache.set(src, { bars, duration: decoded?.duration ?? 0 });
      setPeaks(bars);
      keepDecodedDuration(decoded?.duration);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrent(el.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  // Never leave a voice note playing behind a closed thread.
  useEffect(() => {
    return () => {
      stopLoop();
      const el = audioRef.current;
      if (el) el.pause();
      setAudioSessionType("auto");
    };
  }, [stopLoop]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      stopLoop();
      setAudioSessionType("auto");
      return;
    }
    if (el.ended || (duration > 0 && el.currentTime >= duration - 0.05)) {
      el.currentTime = 0;
    }
    // Claim the session inside the tap itself, before play(), so iOS starts the
    // note on the speaker instead of the silent/mic route it was left on.
    setAudioSessionType("playback");
    try {
      await el.play();
      // Rate is applied after playback has started: iOS ignores a rate set on a
      // paused element, which is also why the speed chip looked inert there.
      el.playbackRate = speed;
      setPlaying(true);
      startLoop();
    } catch {
      setPlaying(false);
      setAudioSessionType("auto");
    }
  };

  const seek = (ratio: number) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const t = Math.max(0, Math.min(duration, ratio * duration));
    el.currentTime = t;
    setCurrent(t);
  };

  const cycleSpeed = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    const el = audioRef.current;
    if (el) el.playbackRate = SPEEDS[next];
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const bars = peaks ?? Array.from({ length: PLAY_BARS }, () => 0.12);

  return (
    <div
      className={cn(
        "group/voice relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-r from-muted/45 via-muted/20 to-muted/10 backdrop-blur-sm transition-colors duration-300",
        playing &&
          "border-primary/45 from-primary/[0.14] via-primary/[0.06] to-transparent shadow-[0_2px_18px_-10px_rgba(85,114,76,0.75)]",
        compact ? "px-2.5 py-1.5" : "px-3 py-2.5",
        className,
      )}
    >
      {/* Clipped, not `display: none`: iOS keeps a hidden media element out of
          the render tree, which has historically cost it its audio output. */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onPlay={() => {
          setPlaying(true);
          startLoop();
        }}
        onPause={() => {
          // Also fires when iOS interrupts us (a call, Siri, another app), so the
          // button never claims a note is playing while it is silent.
          setPlaying(false);
          stopLoop();
        }}
        onEnded={() => {
          setPlaying(false);
          stopLoop();
          setCurrent(0);
          setAudioSessionType("auto");
        }}
        className="sr-only"
      />

      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        title={playing ? "Pause" : `Play ${name}`}
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-[0_2px_10px_-2px_rgba(85,114,76,0.65)] transition-transform hover:scale-105",
          playing && "ring-2 ring-primary/25",
          compact ? "h-8 w-8" : "h-10 w-10",
        )}
      >
        {playing && (
          <motion.span
            className="absolute inset-0 rounded-full bg-primary/40"
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {playing ? (
          <Pause className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        ) : (
          <Play
            className={cn(
              compact ? "h-3.5 w-3.5" : "h-4 w-4",
              "translate-x-[1px]",
            )}
          />
        )}
      </motion.button>

      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek voice note"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - rect.left) / rect.width);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(progress + 0.05);
            if (e.key === "ArrowLeft") seek(Math.max(0, progress - 0.05));
          }}
          className={cn(
            "relative cursor-pointer select-none",
            compact ? "h-8" : "h-10",
          )}
        >
          {/* The axis the bars are mirrored across, so the strip reads as a
              scope rather than as a row of columns. */}
          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />

          {/* The whole note, quiet. */}
          <div className="absolute inset-0">
            <WaveBars bars={bars} tone="idle" animate />
          </div>

          {/* The played portion, revealed with a clip so no bar re-mounts. */}
          <div
            className="absolute inset-0 transition-[clip-path] duration-100 ease-linear"
            style={{ clipPath: `inset(0 ${100 - progress * 100}% 0 0)` }}
          >
            <WaveBars bars={bars} tone="active" glow />
          </div>

          {/* Playhead: a lit needle with a bead on the axis. */}
          <span
            className={cn(
              "pointer-events-none absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded-full bg-primary shadow-[0_0_10px_rgba(143,175,138,0.85)] transition-[left] duration-100 ease-linear",
              progress === 0 && "opacity-0",
            )}
            style={{ left: `${progress * 100}%` }}
          >
            <span className="absolute top-1/2 left-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground/85" />
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1.5">
          {/* How long the recording is — the number a reader wants before
              deciding to press play. */}
          <span
            title={`Voice note · ${formatClock(duration)}`}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-card/70 font-semibold tabular-nums text-foreground/80 transition-colors",
              playing && "border-primary/40 bg-primary/10 text-primary",
              compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
            )}
          >
            <Mic
              className={cn("text-primary", compact ? "h-2.5 w-2.5" : "h-3 w-3")}
            />
            {formatClock(duration)}
          </span>
          {(playing || current > 0) && (
            <motion.span
              className={cn(
                "flex items-center gap-1 font-semibold tabular-nums",
                compact ? "text-[9px]" : "text-[10px]",
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {formatClock(current)}
              <span className="font-normal text-muted-foreground/60">
                -{formatClock(Math.max(0, duration - current))}
              </span>
            </motion.span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        title="Playback speed"
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-card/70 px-2 py-1 text-[10px] font-medium tabular-nums text-muted-foreground transition-colors hover:text-primary",
          speed !== 1 && "border-primary/40 bg-primary/10 text-primary",
        )}
      >
        <Gauge className="h-3 w-3" />
        {speed}×
      </button>
    </div>
  );
}

/** Same player, resolved from a stored attachment. */
export function VoiceNotePlayer({
  storageId,
  postId,
  durationHintMs,
  name,
  compact,
  className,
}: {
  storageId: string;
  postId: string;
  durationHintMs?: number;
  name?: string;
  compact?: boolean;
  className?: string;
}) {
  const url = useQuery(api.posts.getMediaUrl, {
    storageId,
    postId: postId as never,
  });

  if (!url) {
    // The stored duration is already known, so the length shows up straight
    // away even while the file's URL is still resolving.
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/30 px-3 py-2.5",
          compact && "px-2.5 py-1.5",
          className,
        )}
      >
        <div
          className={cn(
            "shrink-0 animate-pulse rounded-full bg-muted",
            compact ? "h-8 w-8" : "h-10 w-10",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className={cn("flex items-center gap-[2px]", compact ? "h-7" : "h-9")}>
            {Array.from({ length: PLAY_BARS }).map((_, i) => (
              <span
                key={i}
                className="min-w-px flex-1 animate-pulse rounded-full bg-muted-foreground/25"
                style={{ height: `${25 + ((i * 37) % 55)}%` }}
              />
            ))}
          </div>
          <div
            className={cn(
              "mt-1 flex items-center gap-1 font-semibold tabular-nums text-muted-foreground",
              compact ? "text-[9px]" : "text-[10px]",
            )}
          >
            <Mic
              className={cn("text-primary/70", compact ? "h-2.5 w-2.5" : "h-3 w-3")}
            />
            {formatClock((durationHintMs ?? 0) / 1000)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <AudioWavePlayer
      src={url as string}
      durationHintMs={durationHintMs}
      name={name}
      compact={compact}
      className={className}
    />
  );
}

/* ──────────────────────────── the recorder ──────────────────────────── */

export type RecordedVoiceNote = {
  blob: Blob;
  durationMs: number;
  mimeType: string;
};

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return "";
}

function micErrorMessage(err: unknown) {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked — allow it in your browser settings.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone found on this device.";
  }
  if (name === "NotReadableError") {
    return "Your microphone is in use by another app.";
  }
  return "Could not start recording.";
}

/**
 * Record a voice note.
 *
 * Renders as a single mic button; while recording it becomes a strip with the
 * live frequency wave, a timer, and cancel / stop buttons. `onRecorded` fires
 * with the finished clip, so the caller decides what to do with it (attach it,
 * upload it, show it back to the sender).
 */
export function VoiceRecorder({
  onRecorded,
  disabled = false,
  maxSeconds = MAX_VOICE_SECONDS,
  className,
}: {
  onRecorded: (note: RecordedVoiceNote) => void;
  disabled?: boolean;
  maxSeconds?: number;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "requesting" | "recording">(
    "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const releaseMic = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    // The mic left iOS in play-and-record; hand the session back so the note we
    // just recorded (and everything after it) plays through the speaker.
    setAudioSessionType("auto");
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    releaseMic();
  }, [releaseMic]);
  stopRef.current = stop;

  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
    setStatus("idle");
    setSeconds(0);
    setLevels([]);
  }, [stop]);

  const start = useCallback(async () => {
    if (disabled || status !== "idle") return;
    setError(null);
    setLevels([]);
    setSeconds(0);
    discardRef.current = false;
    setStatus("requesting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Live frequency wave straight off the mic.
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const pump = () => {
          const a = analyserRef.current;
          if (!a) return;
          a.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const level = Math.min(1, sum / data.length / 80 + 0.05);
          setLevels((prev) => {
            const next = prev.length >= LIVE_BARS ? prev.slice(1) : prev.slice();
            next.push(level);
            return next;
          });
          rafRef.current = requestAnimationFrame(pump);
        };
        rafRef.current = requestAnimationFrame(pump);
      }

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        const durationMs = Math.max(600, Date.now() - startedAtRef.current);
        setStatus("idle");
        setSeconds(0);
        if (!discardRef.current && blob.size > 0) {
          onRecorded({ blob, durationMs, mimeType: type });
        }
        setLevels([]);
      };

      startedAtRef.current = Date.now();
      recorder.start(250);
      setStatus("recording");
      tickRef.current = window.setInterval(() => {
        const s = (Date.now() - startedAtRef.current) / 1000;
        setSeconds(s);
        if (s >= maxSeconds) stopRef.current();
      }, 200);
    } catch (err) {
      releaseMic();
      recorderRef.current = null;
      setStatus("idle");
      setError(micErrorMessage(err));
    }
  }, [disabled, maxSeconds, onRecorded, releaseMic, status]);

  useEffect(() => {
    return () => {
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseMic();
    };
  }, [releaseMic]);

  if (status === "recording") {
    const remaining = Math.max(0, maxSeconds - Math.floor(seconds));
    const elapsed = Math.min(1, seconds / maxSeconds);
    const liveBars =
      levels.length >= LIVE_BARS
        ? levels.slice(levels.length - LIVE_BARS)
        : levels;
    return (
      <div
        className={cn(
          "relative flex items-center gap-2.5 overflow-hidden rounded-2xl border border-destructive/35 bg-gradient-to-r from-destructive/[0.10] via-destructive/[0.04] to-transparent px-2.5 py-2",
          className,
        )}
      >
        {/* Record light: a breathing halo, a ring that ripples outward, and a
            bright core — it reads as "live" at a glance. */}
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-full bg-destructive/15"
            animate={{ scale: [0.85, 1.1, 0.85], opacity: [0.55, 0.2, 0.55] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            className="absolute h-4 w-4 rounded-full border border-destructive/45"
            animate={{ scale: [0.9, 1.6], opacity: [0.8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          />
          <span className="relative h-2 w-2 rounded-full bg-destructive shadow-[0_0_8px_rgba(208,68,68,0.9)]" />
        </span>

        <div className="min-w-0 flex-1">
          {/* Live scope, mirrored around its axis like the player. */}
          <div className="relative h-7">
            <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-destructive/20" />
            <div className="absolute inset-0">
              <WaveBars bars={liveBars} tone="recording" animate glow />
            </div>
          </div>

          {/* Elapsed time, and how much of the limit is spent. */}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-destructive">
              {formatClock(seconds)}
            </span>
            <span className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-destructive/15">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-destructive/60 to-destructive transition-[width] duration-200 ease-linear"
                style={{ width: `${elapsed * 100}%` }}
              />
            </span>
            {remaining <= 15 && (
              <span className="shrink-0 text-[10px] font-medium tabular-nums text-destructive/80">
                {formatClock(remaining)} left
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={cancel}
          title="Discard recording"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-destructive/25 bg-card/60 text-destructive/70 transition-colors hover:border-destructive/50 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          onClick={stop}
          title="Stop and attach"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-br from-destructive to-destructive/85 px-3 text-[11px] font-semibold text-white shadow-[0_2px_10px_-2px_rgba(208,68,68,0.7)] transition-colors hover:from-destructive/90"
        >
          <span className="h-2.5 w-2.5 rounded-[3px] bg-white" />
          Stop
        </motion.button>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={start}
        disabled={disabled || status === "requesting"}
        title="Record a voice note"
        aria-label="Record a voice note"
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
          "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
          (disabled || status === "requesting") && "cursor-not-allowed opacity-50",
        )}
      >
        {status === "requesting" ? (
          <motion.span
            className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
        {status === "requesting" ? "Allowing…" : "Voice"}
      </button>
      {error && (
        <span className="text-[10px] text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/* ────────────────────── drafts the composer holds ───────────────────── */

/** A recorded but not yet uploaded voice note, with its preview URL. */
export type VoiceDraft = {
  key: string;
  blob: Blob;
  url: string;
  durationMs: number;
  mimeType: string;
};

let draftSeq = 0;

export function createVoiceDraft(note: RecordedVoiceNote): VoiceDraft {
  draftSeq += 1;
  return {
    key: `voice-${Date.now()}-${draftSeq}`,
    blob: note.blob,
    url: URL.createObjectURL(note.blob),
    durationMs: note.durationMs,
    mimeType: note.mimeType,
  };
}

export function releaseVoiceDrafts(drafts: VoiceDraft[]) {
  for (const d of drafts) URL.revokeObjectURL(d.url);
}

/** A draft shown back to the sender, with a remove button. */
export function VoiceDraftPlayer({
  draft,
  onRemove,
  compact,
}: {
  draft: VoiceDraft;
  onRemove?: () => void;
  compact?: boolean;
}) {
  return (
    <div className="relative">
      <AudioWavePlayer
        src={draft.url}
        durationHintMs={draft.durationMs}
        name="your recording"
        compact={compact}
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Discard voice note"
          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-destructive"
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
