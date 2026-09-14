"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackroomsEngine,
  GameSettings,
  GameStats,
} from "@/lib/game/engine";
const defaults: GameSettings = {
  volume: 0.65,
  sensitivity: 1,
  tape: 0.65,
  reducedMotion: false,
};
const initialStats: GameStats = {
  seconds: 0,
  distance: 0,
  depth: 0,
  nearPortal: false,
  noclipProgress: 0,
  signal: 98,
  flashlight: false,
  backend: "",
};
function timecode(seconds: number) {
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    Math.floor(seconds) % 60,
    Math.floor((seconds % 1) * 30),
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export default function Backrooms() {
  const container = useRef<HTMLDivElement>(null),
    tapeOverlay = useRef<HTMLCanvasElement>(null),
    engine = useRef<BackroomsEngine | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false),
    [started, setStarted] = useState(false),
    [playing, setPlaying] = useState(false);
  const [settings, setSettings] = useState(defaults),
    [stats, setStats] = useState(initialStats),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [seed, setSeed] = useState(0),
    [copied, setCopied] = useState(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 6200);
  }, []);
  useEffect(() => {
    let disposed = false;
    let instance: BackroomsEngine | undefined;
    const provided = new URLSearchParams(window.location.search).get("tape");
    const tape =
      provided && /^\d{1,9}$/.test(provided)
        ? Number(provided)
        : 100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
    const initial = {
      ...defaults,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    void import("@/lib/game/engine")
      .then(({ BackroomsEngine }) => {
        if (disposed || !container.current) return;
        setSeed(tape);
        setSettings(initial);
        instance = new BackroomsEngine(
          container.current,
          tape,
          {
            ready: () => setReady(true),
            pause: () => setPlaying(false),
            stats: setStats,
            message: announce,
            error: setError,
          },
          initial,
          tapeOverlay.current,
        );
        engine.current = instance;
      })
      .catch(() => {
        if (!disposed)
          setError(
            "The recording could not load. Check your connection and reload.",
          );
      });
    return () => {
      disposed = true;
      instance?.dispose();
      engine.current = null;
      if (messageTimer.current) clearTimeout(messageTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [announce]);
  useEffect(() => {
    engine.current?.updateSettings(settings);
  }, [settings]);
  function start() {
    engine.current?.start();
    setPlaying(true);
    setStarted(true);
  }
  function openSettings() {
    engine.current?.pause();
    dialog.current?.showModal();
  }
  async function copyTape() {
    try {
      const url = new URL(location.href);
      url.searchParams.set("tape", String(seed));
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage("Could not copy the link. Tape number: " + seed);
    }
  }
  const battery = Math.max(2, 22 - Math.floor(stats.seconds / 90));
  return (
    <main className={`experience ${playing ? "is-playing" : ""}`}>
      <h1 className="sr-only">vackrooms</h1>
      <div className="world" ref={container} />
      <div className="camera-vignette" aria-hidden="true" />
      <div className="viewfinder camera-osd" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="camera-top camera-osd">
        <div className="camera-status">
          <div
            className="recording"
            aria-label={playing ? "Recording" : "Standby"}
          >
            <span
              className={`record-dot ${playing ? "record-dot-live" : ""}`}
              aria-hidden="true"
            />
            {playing ? "REC" : "STBY"}
          </div>
          <span
            className="battery"
            role="img"
            aria-label={`Battery ${battery}%`}
          >
            <i style={{ width: `${battery}%` }} />
          </span>
        </div>
        <div className="camera-time" aria-label="Recording time">
          <span>
            <span className="play-mark" aria-hidden="true">
              ▶
            </span>{" "}
            {timecode(stats.seconds)}
          </span>
          <nav className="hud-actions" aria-label="Camcorder controls">
            <button
              onClick={() => engine.current?.toggleFlashlight()}
              disabled={!ready || !!error}
              aria-label={
                stats.flashlight ? "Turn flashlight off" : "Turn flashlight on"
              }
              aria-pressed={stats.flashlight}
              title={
                stats.flashlight ? "Turn flashlight off" : "Turn flashlight on"
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7h10l-3 5v9h-4v-9zM10 12h4M10 16h4" />
                {stats.flashlight ? (
                  <path d="M12 1v3M5 2l2 2m12-2-2 2" />
                ) : (
                  <path d="m4 21 16-18" />
                )}
              </svg>
            </button>
            <button
              onClick={() => (playing ? engine.current?.pause() : start())}
              disabled={!ready || !!error}
              aria-label={playing ? "Pause recording" : "Play recording"}
              title={playing ? "Pause recording" : "Play recording"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={playing ? "M7 5v14M17 5v14" : "m7 4 13 8-13 8z"} />
              </svg>
            </button>
            <button
              onClick={() =>
                setSettings((s) => ({ ...s, volume: s.volume ? 0 : 0.65 }))
              }
              aria-label={settings.volume ? "Mute sound" : "Unmute sound"}
              aria-pressed={settings.volume > 0}
              title={settings.volume ? "Mute sound" : "Unmute sound"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 9h4l5-4v14l-5-4H3z" />
                {settings.volume ? (
                  <>
                    <path d="M16 8c2 2 2 6 0 8" />
                    <path d="M19 5c4 4 4 10 0 14" />
                  </>
                ) : (
                  <path d="m16 9 6 6m0-6-6 6" />
                )}
              </svg>
            </button>
            <button
              className="cassette-button"
              onClick={openSettings}
              aria-label="Open settings"
              title="Settings"
            >
              <svg viewBox="0 0 32 22" aria-hidden="true">
                <path d="M1 1h30v20H1zM10 6h12M10 16h12" />
                <circle cx="10" cy="11" r="5" />
                <circle cx="22" cy="11" r="5" />
              </svg>
            </button>
          </nav>
        </div>
      </div>
      {!ready && !error && (
        <p className="loading-screen" role="status">
          SEARCHING FOR SIGNAL<span>...</span>
        </p>
      )}
      {!playing && ready && !error && (
        <div className="record-prompt">
          <span className="tape-id">
            {started
              ? "RECORDING PAUSED"
              : `TAPE ${String(seed).padStart(6, "0")}`}
          </span>
          <button className="record-button" onClick={start}>
            <span aria-hidden="true">{started ? "▶" : "●"}</span>
            {started ? "RESUME" : "RECORD"}
          </button>
          <p className="desktop-hint">
            WASD WALK &nbsp; MOUSE LOOK &nbsp; SHIFT RUN
          </p>
          <p className="mobile-hint">LEFT THUMB TO MOVE · SWIPE TO LOOK</p>
        </div>
      )}
      {error && (
        <div className="record-prompt error-message" role="alert">
          <p>{error}</p>
          <button className="record-button" onClick={() => location.reload()}>
            RELOAD TAPE
          </button>
        </div>
      )}
      {playing && (
        <>
          <span className="reticle" aria-hidden="true" />
          {stats.nearPortal && (
            <div className="portal-hint">
              <span className="desktop-hint">
                HOLD <kbd>E</kbd> · NOCLIP
              </span>
              <span className="clip-progress">
                <i style={{ width: `${stats.noclipProgress * 100}%` }} />
              </span>
            </div>
          )}
          <TouchControls engine={engine} portal={stats.nearPortal} />
        </>
      )}
      <p
        className={`subtitles ${message && playing ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      <div className="camera-bottom camera-osd">
        <span>JUN. 18 1994</span>
        <span>16BIT</span>
      </div>
      <canvas className="camera-grain" ref={tapeOverlay} aria-hidden="true" />
      <dialog
        ref={dialog}
        className="settings-dialog"
        aria-labelledby="setup-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="settings-heading">
          <h2 id="setup-title">CAMCORDER SETUP</h2>
          <button
            onClick={() => dialog.current?.close()}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>
        <label className="setting-row">
          <span>
            SOUND<output>{Math.round(settings.volume * 100)}%</output>
          </span>
          <input
            aria-label="Sound volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={settings.volume}
            onChange={(e) =>
              setSettings({ ...settings, volume: Number(e.target.value) })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            LOOK SENSITIVITY<output>{settings.sensitivity.toFixed(1)}×</output>
          </span>
          <input
            aria-label="Look sensitivity"
            type="range"
            min=".3"
            max="2.5"
            step=".1"
            value={settings.sensitivity}
            onChange={(e) =>
              setSettings({ ...settings, sensitivity: Number(e.target.value) })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            TAPE DAMAGE<output>{Math.round(settings.tape * 100)}%</output>
          </span>
          <input
            aria-label="Tape damage"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={settings.tape}
            onChange={(e) =>
              setSettings({ ...settings, tape: Number(e.target.value) })
            }
          />
        </label>
        <label className="motion-toggle">
          <span>
            STEADY CAMERA<small>Reduce sway and flashing.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) =>
              setSettings({ ...settings, reducedMotion: e.target.checked })
            }
          />
        </label>
        <dl className="controls-list">
          <div>
            <dt>WASD / ARROWS</dt>
            <dd>WALK</dd>
          </div>
          <div>
            <dt>MOUSE / DRAG</dt>
            <dd>LOOK</dd>
          </div>
          <div>
            <dt>SHIFT</dt>
            <dd>RUN</dd>
          </div>
          <div>
            <dt>F</dt>
            <dd>LIGHT</dd>
          </div>
          <div>
            <dt>HOLD E</dt>
            <dd>NOCLIP AT UNSTABLE WALLS</dd>
          </div>
          <div>
            <dt>ESC</dt>
            <dd>PAUSE</dd>
          </div>
        </dl>
        <div className="settings-tape">
          <span>TAPE {seed}</span>
          <button onClick={copyTape}>
            {copied ? "LINK COPIED" : "COPY TAPE LINK"}
          </button>
        </div>
        <button
          className="settings-done"
          onClick={() => dialog.current?.close()}
        >
          DONE
        </button>
      </dialog>
    </main>
  );
}
function TouchControls({
  engine,
  portal,
}: {
  engine: React.RefObject<BackroomsEngine | null>;
  portal: boolean;
}) {
  const origin = useRef<{ x: number; y: number; radius: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  return (
    <div className="touch-controls">
      <div
        className="joystick"
        role="group"
        aria-label="Movement joystick"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          origin.current = {
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            radius: r.width * 0.36,
          };
        }}
        onPointerMove={(e) => {
          if (!origin.current) return;
          let x = e.clientX - origin.current.x,
            y = e.clientY - origin.current.y;
          const length = Math.hypot(x, y);
          const radius = origin.current.radius;
          if (length > radius) {
            x = (x / length) * radius;
            y = (y / length) * radius;
          }
          setOffset({ x, y });
          engine.current?.move(x / radius, y / radius);
        }}
        onPointerUp={() => {
          origin.current = null;
          setOffset({ x: 0, y: 0 });
          engine.current?.move(0, 0);
        }}
        onPointerCancel={() => {
          origin.current = null;
          setOffset({ x: 0, y: 0 });
          engine.current?.move(0, 0);
        }}
      >
        <span style={{ transform: `translate(${offset.x}px,${offset.y}px)` }} />
      </div>
      <div className="touch-right">
        <button
          onClick={() => engine.current?.toggleFlashlight()}
          aria-label="Toggle flashlight"
        >
          Light
        </button>
        {portal && (
          <button
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              engine.current?.noclip(true);
            }}
            onPointerUp={() => engine.current?.noclip(false)}
            onPointerCancel={() => engine.current?.noclip(false)}
          >
            Hold to noclip
          </button>
        )}
      </div>
    </div>
  );
}
