"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackroomsEngine,
  GameStats,
} from "@/lib/game/engine";
import { defaultSettings, loadSettings, qualityPresets, saveSettings, setVolume, toggleMute, type QualityPreset, type SavedSettings } from "@/lib/game/settings";
import { parseTape, tapeUrl, type Tape } from "@/lib/game/tape";
import { PAD, type GamepadFrame } from "@/lib/game/gamepad";
const qualityDescriptions: Record<QualityPreset, string> = {
  auto: "Adjusts resolution while you play to keep movement smooth.",
  high: "Sharper picture. Uses more graphics power.",
  balanced: "A softer picture with less work for your device.",
  low: "Lowest resolution, with contact shadows off. Try this if movement feels slow.",
};
const initialStats: GameStats = {
  seconds: 0,
  distance: 0,
  depth: 0,
  nearPortal: false,
  nearComputer: false,
  browsing: false,
  noclipProgress: 0,
  signal: 98,
  flashlight: false,
  backend: "",
  gamepad: false,
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
    currentTape = useRef<Tape | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(false),
    [started, setStarted] = useState(false),
    [playing, setPlaying] = useState(false);
  const [savedSettings, setSettings] = useState<SavedSettings | null>(null),
    [stats, setStats] = useState(initialStats),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const settings = savedSettings ?? defaultSettings;
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
    const tape = parseTape(new URLSearchParams(window.location.search), () =>
      100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
    );
    currentTape.current = tape;
    void import("@/lib/game/engine")
      .then(({ BackroomsEngine }) => {
        if (disposed || !container.current) return;
        const initial = loadSettings(matchMedia("(prefers-reduced-motion: reduce)").matches);
        setSeed(tape.seed);
        setSettings(initial);
        instance = new BackroomsEngine(
          container.current,
          tape.seed,
          {
            ready: () => setReady(true),
            play: () => {
              setPlaying(true);
              setStarted(true);
            },
            pause: () => setPlaying(false),
            settings: () => {
              instance?.pause();
              dialog.current?.showModal();
            },
            mute: () => setSettings((s) => toggleMute(s ?? initial)),
            gamepadMenu: (input) => {
              if (!dialog.current?.open) return false;
              navigateSettings(dialog.current, input, (update) =>
                setSettings((s) => update(s ?? initial)),
              );
              return true;
            },
            stats: setStats,
            message: announce,
            tape: (next) => {
              currentTape.current = next;
              setSeed(next.seed);
              const url = tapeUrl(location.href, next);
              history.replaceState(null, "", url);
            },
            error: setError,
          },
          initial,
          tapeOverlay.current,
          tape.generation,
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
    if (!savedSettings) return;
    engine.current?.updateSettings(savedSettings);
    saveSettings(savedSettings);
  }, [savedSettings]);
  function start() {
    engine.current?.start();
  }
  function openSettings() {
    engine.current?.pause();
    dialog.current?.showModal();
  }
  function retryCompatibleCamera() {
    saveSettings({
      ...settings,
      quality: "low",
      contactShadows: false,
      tapeEffects: false,
    });
    const url = currentTape.current
      ? tapeUrl(location.href, currentTape.current)
      : new URL(location.href);
    url.searchParams.set("renderer", "webgl");
    location.assign(url.toString());
  }
  async function copyTape() {
    try {
      if (!currentTape.current) return;
      const url = tapeUrl(location.href, currentTape.current);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      const tape = currentTape.current;
      setMessage(tape
        ? `Could not copy the link. Tape ${tape.seed}, generation ${tape.generation}.`
        : "Could not copy the link. Try again.");
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
              data-sound="flashlight"
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
                setSettings((s) => toggleMute(s ?? defaultSettings))
              }
              disabled={!savedSettings}
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
              disabled={!savedSettings}
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
          {stats.gamepad ? (
            <p>LEFT STICK WALK · RIGHT STICK LOOK · A/× RECORD</p>
          ) : (
            <>
              <p className="desktop-hint">
                WASD WALK &nbsp; MOUSE LOOK &nbsp; SHIFT RUN
                <br />
                SPACE JUMP &nbsp; SPACE AGAIN BIG JUMP
              </p>
              <p className="mobile-hint">
                LEFT THUMB TO MOVE · SWIPE TO LOOK
                <br />
                TAP JUMP · TAP AGAIN FOR A BIG JUMP
              </p>
            </>
          )}
          <div className="credits">
            <a
              className="credit"
              href="https://pablostanley.com"
              target="_blank"
              rel="noreferrer"
            >
              MADE BY PABLO STANLEY
            </a>
            <a
              className="credit"
              href="https://github.com/pablostanley/vackrooms"
              target="_blank"
              rel="noreferrer"
            >
              SOURCE ON GITHUB
            </a>
          </div>
        </div>
      )}
      {error && (
        <div className="record-prompt error-message" role="alert">
          <p>{error}</p>
          <button className="record-button" onClick={() => location.reload()}>
            RELOAD TAPE
          </button>
          <button className="record-button" onClick={retryCompatibleCamera}>
            TRY COMPATIBILITY MODE
          </button>
          <p>Uses simpler graphics. If it still won’t start, try opening the link in Chrome or Safari outside the Reddit app.</p>
        </div>
      )}
      {playing && !stats.browsing && !stats.attacking && (
        <>
          <span className="reticle" aria-hidden="true" />
          {stats.nearComputer && (
            <button
              className="portal-hint computer-hint"
              onClick={() => engine.current?.useComputer()}
            >
              <kbd>{stats.gamepad ? "A/×" : "E"}</kbd> · USE COMPUTER
            </button>
          )}
          {stats.nearPortal && !stats.nearComputer && (
            <div className="portal-hint">
              <span className={stats.gamepad ? undefined : "desktop-hint"}>
                HOLD <kbd>{stats.gamepad ? "A/×" : "E"}</kbd> · NOCLIP
              </span>
              <span className="clip-progress">
                <i style={{ width: `${stats.noclipProgress * 100}%` }} />
              </span>
            </div>
          )}
          <TouchControls engine={engine} portal={stats.nearPortal} />
        </>
      )}
      {playing && stats.canEscape && (
        <button className="portal-hint escape-hint" onPointerDown={(e) => { e.preventDefault(); engine.current?.jump(); }}
          onClick={(e) => { if (e.detail === 0) engine.current?.jump(); }}>
          <span className="desktop-hint">{stats.gamepad ? "A/×" : "SPACE"} · JUMP FREE</span>
          <span className="mobile-hint">TAP · JUMP FREE</span>
        </button>
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
        {stats.encounter ? (
          <button className="encounter-preview" onClick={() => engine.current?.previewEncounter()}>
            {stats.encounter} · REPLAY ENCOUNTER
          </button>
        ) : <span>16BIT</span>}
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
        <label className="setting-row quality-setting">
          <span>PICTURE QUALITY</span>
          <select
            aria-label="Picture quality"
            aria-describedby="quality-description"
            value={settings.quality}
            onChange={(e) => setSettings({ ...settings, quality: e.target.value as QualityPreset })}
          >
            <option value="auto">Auto</option>
            <option value="high">High</option>
            <option value="balanced">Balanced</option>
            <option value="low">Low</option>
          </select>
          <small id="quality-description">{qualityDescriptions[settings.quality]}</small>
        </label>
        <label className="motion-toggle">
          <span>
            CONTACT SHADOWS
            <small>{settings.quality === "low" ? "Off with Low quality." : "Turn off for faster rendering."}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.contactShadows && settings.quality !== "low"}
            disabled={settings.quality === "low"}
            onChange={(e) => setSettings({ ...settings, contactShadows: e.target.checked })}
          />
        </label>
        <label className="motion-toggle">
          <span>
            TAPE EFFECTS<small>Turn off distortion and grain to save graphics power.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.tapeEffects}
            onChange={(e) => setSettings({ ...settings, tapeEffects: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>
            SOUND<output>{Math.round(settings.volume * 100)}%</output>
          </span>
          <input
            aria-label="Sound volume"
            data-setting="volume"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={settings.volume}
            onChange={(e) =>
              setSettings(setVolume(settings, Number(e.target.value)))
            }
          />
        </label>
        <label className="setting-row">
          <span>
            LOOK SENSITIVITY<output>{settings.sensitivity.toFixed(1)}×</output>
          </span>
          <input
            aria-label="Look sensitivity"
            data-setting="sensitivity"
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
            disabled={!settings.tapeEffects}
            data-setting="tape"
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
        <label className="motion-toggle">
          <span>
            ENTITIES<small>Turn off to explore without being chased.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.entities}
            onChange={(e) => setSettings({ ...settings, entities: e.target.checked })}
          />
        </label>
        <dl className="controls-list">
          <div>
            <dt>{stats.gamepad ? "LEFT STICK" : "WASD / ARROWS"}</dt>
            <dd>WALK</dd>
          </div>
          <div>
            <dt>{stats.gamepad ? "RIGHT STICK" : "MOUSE / DRAG"}</dt>
            <dd>LOOK</dd>
          </div>
          <div>
            <dt>{stats.gamepad ? "L3 / RT / R2" : "SHIFT"}</dt>
            <dd>RUN</dd>
          </div>
          <div>
            <dt>SPACE</dt>
            <dd>JUMP ONTO LOW OBJECTS</dd>
          </div>
          <div>
            <dt>SPACE AGAIN</dt>
            <dd>BIG JUMP WHILE AIRBORNE</dd>
          </div>
          <div>
            <dt>{stats.gamepad ? "Y / △" : "F"}</dt>
            <dd>LIGHT</dd>
          </div>
          <div>
            <dt>{stats.gamepad ? "A / ×" : "E"}</dt>
            <dd>USE A NEARBY COMPUTER</dd>
          </div>
          <div>
            <dt>{stats.gamepad ? "HOLD A / ×" : "HOLD E"}</dt>
            <dd>NOCLIP AT UNSTABLE WALLS</dd>
          </div>
          <div>
            <dt>{stats.gamepad ? "B / ○" : "ESC"}</dt>
            <dd>LEAVE COMPUTER / PAUSE</dd>
          </div>
          {stats.gamepad && (
            <>
              <div><dt>MENU / OPTIONS</dt><dd>RECORD / PAUSE</dd></div>
              <div><dt>VIEW / SHARE</dt><dd>SETTINGS</dd></div>
              <div><dt>X / □</dt><dd>MUTE</dd></div>
              <div><dt>D-PAD · A / ×</dt><dd>ADJUST · SELECT</dd></div>
            </>
          )}
        </dl>
        <p className="settings-note">
          Preferences stay in this browser on this device.
          {stats.gamepad ? " Click Record once to enable sound. Use mouse or touch inside computer websites." : " Press a button on a connected controller to use it."}
        </p>
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
function navigateSettings(
  dialog: HTMLDialogElement,
  input: GamepadFrame,
  update: (change: (settings: SavedSettings) => SavedSettings) => void,
) {
  const pressed = input.pressed;
  if (!pressed.size) return;
  if (pressed.has(PAD.back) || pressed.has(PAD.menu) || pressed.has(PAD.settings)) {
    dialog.close();
    return;
  }
  const controls = [...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
  const current = controls.findIndex((control) => control === document.activeElement);
  const direction = Number(pressed.has(PAD.down)) - Number(pressed.has(PAD.up));
  if (direction && controls.length) {
    controls[(current + direction + controls.length) % controls.length].focus();
    return;
  }
  const focused = controls[current];
  if (!focused) return;
  if (focused instanceof HTMLSelectElement) {
    const delta = Number(pressed.has(PAD.right)) - Number(pressed.has(PAD.left));
    if (delta) update((settings) => ({
      ...settings,
      quality: qualityPresets[Math.max(0, Math.min(qualityPresets.length - 1, qualityPresets.indexOf(settings.quality) + delta))],
    }));
  } else if (focused instanceof HTMLInputElement && focused.type === "range") {
    const delta = Number(pressed.has(PAD.right)) - Number(pressed.has(PAD.left));
    const key = focused.dataset.setting;
    if (!delta || (key !== "volume" && key !== "sensitivity" && key !== "tape")) return;
    const min = Number(focused.min), max = Number(focused.max), step = Number(focused.step);
    update((settings) => {
      const value = Math.max(min, Math.min(max, Number((settings[key] + delta * step).toFixed(2))));
      return key === "volume" ? setVolume(settings, value) : { ...settings, [key]: value };
    });
  } else if (pressed.has(PAD.interact)) focused.click();
}
function TouchControls({
  engine,
  portal,
}: {
  engine: React.RefObject<BackroomsEngine | null>;
  portal: boolean;
}) {
  const origin = useRef<{ pointerId: number; x: number; y: number; radius: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  function movePointer(e: React.PointerEvent<HTMLDivElement>) {
    if (!origin.current || origin.current.pointerId !== e.pointerId) return;
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
  }
  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (origin.current?.pointerId !== e.pointerId) return;
    origin.current = null;
    setOffset({ x: 0, y: 0 });
    engine.current?.move(0, 0);
  }
  return (
    <div className="touch-controls">
      <div
        className="joystick"
        role="group"
        aria-label="Movement joystick"
        onPointerDown={(e) => {
          if (origin.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          origin.current = {
            pointerId: e.pointerId,
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            radius: r.width * 0.36,
          };
          movePointer(e);
        }}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={endPointer}
      >
        <span style={{ transform: `translate(${offset.x}px,${offset.y}px)` }} />
      </div>
      <div className="touch-right">
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            engine.current?.jump();
          }}
          onClick={(e) => {
            if (e.detail === 0) engine.current?.jump();
          }}
          aria-label="Jump; tap again in the air for a big jump"
        >
          Jump
        </button>
        <button
          onClick={() => engine.current?.toggleFlashlight()}
          data-sound="flashlight"
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
