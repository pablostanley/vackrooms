import {
  BuildingSoundSchedule,
  footstepSurfaceAt,
  POOL_WATER_Y,
  ROOM_SOUNDS,
  roomSoundAt,
  wallsBetween,
  type BuildingSound,
  type RoomSound,
  type SoundPosition,
} from "./acoustics";
import { hash, random, type ChunkData } from "./maze";
import { ComputerDialup } from "./computer-dialup";
import { EntityAudio } from "./entity-audio";
import { InterfaceAudio, type InterfaceSound } from "./interface-audio";
import { roomImpulse } from "./room-impulse";
import { soundPath } from "./sound-path";
import {
  CREAK_RECORDINGS,
  FOOTSTEP_RECORDINGS,
  RPG_RECORDINGS,
  footstepRecording,
  footstepPerformance,
  nextWaterRecording,
  RpgRecordings,
} from "./rpg-recordings";

interface SpatialVoice {
  position: SoundPosition;
  input: GainNode;
  filter: BiquadFilterNode;
  level: GainNode;
  pan: PannerNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}
interface FixtureVoice {
  voice: SpatialVoice;
  retireAt: number | null;
}
interface RoomBus {
  input: GainNode;
  output: GainNode;
  convolver: ConvolverNode;
}

export class BackroomsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mix: DynamicsCompressorNode | null = null;
  private reflections: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastWaterRecording = -1;
  private recordings: RpgRecordings | null = null;
  private dialup: ComputerDialup | null = null;
  private entityAudio: EntityAudio | null = null;
  private interfaceAudio: InterfaceAudio | null = null;
  private interfaceLevel: GainNode | null = null;
  private rooms = new Map<RoomSound, RoomBus>();
  private fixtures = new Map<string, FixtureVoice>();
  private transients = new Set<SpatialVoice>();
  private loops: AudioScheduledSourceNode[] = [];
  private volume = 0.65;
  private active = false;
  private disposed = false;
  private entityWasPresent = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpatialUpdate = -Infinity;
  private listener: SoundPosition = { x: 0, y: 1.66, z: 0 };
  private forward: SoundPosition = { x: 0, y: 0, z: -1 };
  private chunks = new Map<string, ChunkData>();
  private schedule: BuildingSoundSchedule;
  private pending: { sound: BuildingSound; index: number; at: number } | null =
    null;
  private rng: () => number;

  constructor(private seed: number) {
    this.schedule = new BuildingSoundSchedule(seed);
    this.rng = random(seed ^ 0x6a09e667);
  }

  async start() {
    if (this.disposed) return;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (!this.ctx) this.initialize();
    void this.recordings!.preload();
    this.active = true;
    await this.ctx!.resume();
    // Pause/unmount may happen while the browser is granting audio access.
    if (this.disposed || !this.active) return;
    this.lastSpatialUpdate = -Infinity;
    this.setVolume(this.volume);
  }

  private initialize() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.recordings = new RpgRecordings(ctx);
    void this.recordings.preload();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.mix = ctx.createDynamicsCompressor();
    this.mix.threshold.value = -16;
    this.mix.knee.value = 12;
    this.mix.ratio.value = 4;
    this.mix.connect(this.master);
    this.entityAudio = new EntityAudio(ctx, this.mix, this.seed);
    // Menus remain audible while the room ambience is paused.
    this.interfaceLevel = ctx.createGain();
    this.interfaceLevel.gain.value = this.volume * 0.7;
    this.interfaceLevel.connect(ctx.destination);
    this.interfaceAudio = new InterfaceAudio(ctx, this.interfaceLevel);
    this.dialup = new ComputerDialup(ctx, this.mix);
    void this.dialup.preload();
    this.reflections = ctx.createGain();
    for (const name of Object.keys(ROOM_SOUNDS) as RoomSound[]) {
      const profile = ROOM_SOUNDS[name];
      const input = ctx.createGain(),
        filter = ctx.createBiquadFilter();
      const convolver = ctx.createConvolver(),
        output = ctx.createGain();
      input.gain.value = name === "office" ? 1 : 0;
      output.gain.value = name === "office" ? profile.wet : 0;
      filter.type = "lowpass";
      filter.frequency.value = profile.cutoff;
      convolver.buffer = this.impulse(name);
      this.reflections
        .connect(input)
        .connect(filter)
        .connect(convolver)
        .connect(output)
        .connect(this.mix);
      this.rooms.set(name, { input, output, convolver });
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    const noiseRng = random(this.seed ^ 0x3c6ef372);
    let brown = 0;
    for (let i = 0; i < samples.length; i++) {
      brown = (brown + (noiseRng() * 2 - 1) * 0.025) / 1.025;
      samples[i] = brown * 3.5;
    }
    this.noise = buffer;
    // A quiet air bed joins the localized fixtures without masking their direction.
    const air = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      level = ctx.createGain();
    air.buffer = buffer;
    air.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 380;
    level.gain.value = 0.035;
    air.connect(filter).connect(level).connect(this.mix);
    air.start();
    this.loops.push(air);
  }

  private impulse(room: RoomSound) {
    const ctx = this.ctx!;
    const channels = roomImpulse(room, ctx.sampleRate, this.seed);
    const buffer = ctx.createBuffer(
      2,
      channels[0].length,
      ctx.sampleRate,
    );
    for (let channel = 0; channel < 2; channel++)
      buffer.getChannelData(channel).set(channels[channel]);
    return buffer;
  }

  setVolume(volume: number) {
    this.volume = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0;
    if (!this.volume) this.stopComputer();
    if (this.ctx && this.interfaceLevel)
      this.interfaceLevel.gain.setTargetAtTime(
        this.volume * 0.7,
        this.ctx.currentTime,
        0.005,
      );
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        this.active ? this.volume * 0.7 : 0,
        this.ctx.currentTime,
        0.06,
      );
  }

  pause() {
    this.active = false;
    this.stopComputer();
    this.pending = null;
    this.setVolume(this.volume);
    for (const voice of this.transients) this.release(voice);
    this.suspendWhenIdle();
  }

  private suspendWhenIdle() {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (!this.active && this.ctx && !this.disposed)
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (!this.active && !this.disposed)
          void this.ctx?.suspend().catch(() => {});
      }, 600); // Let the recorded flashlight click finish while paused.
  }

  playInterface(kind: InterfaceSound = "click") {
    if (this.disposed || !this.volume) return;
    if (!this.ctx) this.initialize();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    this.interfaceAudio!.play(kind);
    void this.ctx!.resume().then(() => this.suspendWhenIdle()).catch(() => {});
  }

  playFlashlight() {
    if (this.disposed || !this.volume) return;
    if (!this.ctx) this.initialize();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const buffer = this.recordings?.get("flashlight");
    if (buffer) {
      this.interfaceAudio!.playBuffer(buffer, RPG_RECORDINGS.flashlight.gain);
    } else {
      // Keep the first switch responsive while the recording decodes; no late click.
      this.interfaceAudio!.play("click", RPG_RECORDINGS.flashlight.gain);
      void this.recordings!.preload();
    }
    void this.ctx!.resume().then(() => this.suspendWhenIdle()).catch(() => {});
  }

  powerComputer(powered: boolean) {
    if (!powered) this.stopComputer();
    this.playInterface(powered ? "power-on" : "power-off");
  }

  /** Called after a tape descent so no source or echo is carried to the new floor. */
  resetSpace(time: number, seed?: number) {
    if (seed !== undefined) {
      this.seed = seed;
      this.schedule = new BuildingSoundSchedule(seed);
      this.rng = random(seed ^ 0x6a09e667);
    }
    this.entityAudio?.reset();
    this.stopComputer();
    this.entityWasPresent = false;
    this.pending = null;
    this.schedule.defer(time);
    for (const voice of this.transients) this.release(voice);
    for (const fixture of this.fixtures.values()) this.release(fixture.voice);
    this.fixtures.clear();
    for (const bus of this.rooms.values()) {
      bus.input.gain.cancelScheduledValues(this.ctx!.currentTime);
      bus.output.gain.cancelScheduledValues(this.ctx!.currentTime);
      bus.input.gain.value = 0;
      bus.output.gain.value = 0;
      const impulse = bus.convolver.buffer;
      bus.convolver.buffer = null;
      bus.convolver.buffer = impulse;
    }
    this.lastSpatialUpdate = -Infinity;
  }

  playComputer() {
    if (!this.active || !this.ctx || !this.mix || !this.volume) return;
    this.dialup ??= new ComputerDialup(this.ctx, this.mix);
    void this.dialup.play();
  }

  stopComputer() {
    this.dialup?.stop();
  }

  entityThreat(proximity: number, squeeze: number, time: number, blackout: number) {
    if (this.active) this.entityAudio?.update(proximity, squeeze, time, blackout);
  }

  update(
    time: number,
    position: SoundPosition,
    forward: SoundPosition,
    up: SoundPosition,
    chunks: Map<string, ChunkData>,
    sections: Iterable<{ lights: readonly SoundPosition[] }>,
    entityPresent = false,
  ) {
    this.listener = { ...position };
    this.forward = { ...forward };
    this.chunks = chunks;
    if (!this.ctx || !this.active) return;
    const listener = this.ctx.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
    if (time - this.lastSpatialUpdate >= 0.2) {
      this.lastSpatialUpdate = time;
      const room = roomSoundAt(chunks, position),
        now = this.ctx.currentTime;
      for (const [name, bus] of this.rooms) {
        bus.input.gain.setTargetAtTime(name === room ? 1 : 0, now, 0.35);
        bus.output.gain.setTargetAtTime(
          name === room ? ROOM_SOUNDS[name].wet : 0,
          now,
          0.55,
        );
      }
      this.updateFixtures(sections);
      for (const voice of this.transients) this.occlude(voice);
    }
    // During a real encounter, every approaching footstep belongs to the creature.
    if (entityPresent !== this.entityWasPresent) {
      this.entityWasPresent = entityPresent;
      this.schedule.defer(time);
      this.pending = null;
    }
    const sound = entityPresent
      ? null
      : this.schedule.poll(time, chunks, position);
    if (sound && this.volume > 0) this.pending = { sound, index: 0, at: time };
    if (this.pending && time >= this.pending.at) {
      const { sound, index } = this.pending;
      if (this.volume > 0) {
        if (sound.kind === "steps")
          this.footstep(sound.positions[index], false, true);
        else this.buildingNoise(sound.positions[index], sound.kind);
      }
      this.pending.index++;
      this.pending.at = time + sound.interval;
      if (this.pending.index >= sound.positions.length) this.pending = null;
    }
  }

  private spatial(
    position: SoundPosition,
    send: number,
    refDistance = 2.5,
  ): SpatialVoice {
    const ctx = this.ctx!,
      input = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    const level = ctx.createGain(),
      pan = ctx.createPanner(),
      wet = ctx.createGain();
    filter.type = "lowpass";
    filter.Q.value = 0.5;
    pan.panningModel = "HRTF";
    pan.distanceModel = "inverse";
    pan.refDistance = refDistance;
    pan.rolloffFactor = 1.3;
    pan.maxDistance = 32;
    pan.positionX.value = position.x;
    pan.positionY.value = position.y;
    pan.positionZ.value = position.z;
    wet.gain.value = send;
    input.connect(filter).connect(level).connect(pan).connect(this.mix!);
    // Reflections inherit the same distance and wall filtering as the direct sound.
    pan.connect(wet).connect(this.reflections!);
    const voice = {
      position: { ...position },
      input,
      filter,
      level,
      pan,
      nodes: [input, filter, level, pan, wet],
      sources: [],
    };
    this.occlude(voice, true);
    return voice;
  }

  private occlude(voice: SpatialVoice, immediate = false) {
    const path = soundPath(this.chunks, this.listener, voice.position);
    // The apparent source moves to the doorway, but attenuation must still use
    // the full travelled distance, not the much closer doorway's distance.
    const apparentDistance = Math.hypot(path.position.x - this.listener.x,
      path.position.y - this.listener.y, path.position.z - this.listener.z);
    const attenuation = (distance: number) => voice.pan.refDistance /
      (voice.pan.refDistance + voice.pan.rolloffFactor * (Math.max(distance, voice.pan.refDistance) - voice.pan.refDistance));
    const gain = path.gain * attenuation(path.distance) / attenuation(apparentDistance);
    for (const axis of ["x", "y", "z"] as const) {
      const param = voice.pan[axis === "x" ? "positionX" : axis === "y" ? "positionY" : "positionZ"];
      if (immediate) param.value = path.position[axis];
      else param.setTargetAtTime(path.position[axis], this.ctx!.currentTime, 0.12);
    }
    if (immediate) {
      voice.level.gain.value = gain;
      voice.filter.frequency.value = path.cutoff;
    } else {
      voice.level.gain.setTargetAtTime(gain, this.ctx!.currentTime, 0.12);
      voice.filter.frequency.setTargetAtTime(
        path.cutoff,
        this.ctx!.currentTime,
        0.12,
      );
    }
  }

  private updateFixtures(
    sections: Iterable<{ lights: readonly SoundPosition[] }>,
  ) {
    const ctx = this.ctx!,
      now = ctx.currentTime;
    const candidates: { id: string; position: SoundPosition; score: number }[] =
      [];
    for (const section of sections)
      for (const p of section.lights) {
        const distance = Math.hypot(
          p.x - this.listener.x,
          p.y - this.listener.y,
          p.z - this.listener.z,
        );
        if (distance > 18) continue;
        const walls = wallsBetween(this.chunks, this.listener, p);
        if (walls > 1) continue;
        const id = `${p.x},${p.y},${p.z}`;
        candidates.push({
          id,
          position: p,
          score: distance + walls * 7 - (this.fixtures.has(id) ? 0.8 : 0),
        });
      }
    candidates.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    const selected = candidates.slice(0, 4),
      ids = new Set(selected.map((item) => item.id));
    for (const [id, fixture] of this.fixtures) {
      if (ids.has(id)) {
        fixture.retireAt = null;
        fixture.voice.input.gain.setTargetAtTime(0.055, now, 0.18);
        this.occlude(fixture.voice);
      } else if (fixture.retireAt !== null && now >= fixture.retireAt) {
        this.release(fixture.voice);
        this.fixtures.delete(id);
      } else if (fixture.retireAt === null) {
        fixture.voice.input.gain.setTargetAtTime(0, now, 0.08);
        fixture.retireAt = now + 0.4;
      }
    }
    for (const item of selected) {
      // Four audible fixtures plus at most four retiring ones, regardless of residency.
      if (this.fixtures.has(item.id) || this.fixtures.size >= 8) continue;
      const voice = this.spatial(item.position, 0.25);
      voice.input.gain.value = 0;
      voice.input.gain.setTargetAtTime(0.055, now, 0.18);
      const rng = random(
        hash(
          Math.round(item.position.x * 10),
          Math.round(item.position.z * 10),
          this.seed,
        ),
      );
      const detune = (rng() - 0.5) * 2;
      const ballast = ctx.createGain(), wobble = ctx.createOscillator(), depth = ctx.createGain();
      ballast.gain.value = 0.94;
      wobble.frequency.value = 0.35 + rng() * 0.65;
      depth.gain.value = 0.035;
      wobble.connect(depth).connect(ballast.gain);
      ballast.connect(voice.input);
      voice.sources.push(wobble);
      voice.nodes.push(ballast, depth);
      wobble.start();
      for (const [frequency, volume] of [
        [120, 0.5],
        [240, 0.19],
        [480, 0.07],
        [2400, 0.008],
      ]) {
        const osc = ctx.createOscillator(),
          level = ctx.createGain();
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        level.gain.value = volume * (0.85 + rng() * 0.3);
        osc.connect(level).connect(ballast);
        voice.sources.push(osc);
        voice.nodes.push(level);
        osc.start();
      }
      this.fixtures.set(item.id, { voice, retireAt: null });
    }
  }

  step(running: boolean, side: number, position = this.listener) {
    if (!this.active || !this.ctx || !this.noise || !this.volume) return;
    this.footstep(
      {
        x: position.x - this.forward.z * side * 0.14,
        // CharacterMotor's standing eye height; use the unbobbed player position.
        y: position.y - 1.66,
        z: position.z + this.forward.x * side * 0.14,
      },
      running,
      false,
    );
  }

  entityStep(position: SoundPosition, pursuing: boolean) {
    if (!this.active || !this.ctx || !this.noise || !this.volume) return;
    this.footstep(
      { x: position.x, y: 0, z: position.z },
      pursuing,
      true,
      true,
    );
  }

  jump(position: SoundPosition, boosted: boolean) {
    if (!this.active || !this.ctx || !this.volume || this.transients.size >= 12) return;
    const buffer = this.recordings?.get("jump");
    if (!buffer) return;
    const voice = this.spatial({ ...position, y: position.y - 0.5 }, 0.12, 1.7);
    voice.input.gain.value = RPG_RECORDINGS.jump.gain;
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = boosted ? 1.1 : 1;
    filter.type = "lowpass";
    filter.frequency.value = RPG_RECORDINGS.jump.cutoff;
    filter.Q.value = 0.5;
    source.connect(filter).connect(voice.input);
    voice.sources.push(source);
    voice.nodes.push(filter);
    this.track(voice);
    source.start();
  }

  enterWater(position: SoundPosition) {
    if (!this.active || !this.ctx || !this.volume || this.transients.size >= 12) return;
    this.footstep({ ...position, y: POOL_WATER_Y }, false, false);
  }

  private footstep(
    position: SoundPosition,
    running: boolean,
    distant: boolean,
    entity = false,
  ) {
    if (!this.ctx || this.transients.size >= 12) return;
    const ctx = this.ctx,
      now = ctx.currentTime;
    const surface = footstepSurfaceAt(this.chunks, position);
    if (surface === "water") this.lastWaterRecording = nextWaterRecording(this.lastWaterRecording, this.rng);
    const recording = footstepRecording(surface, running, entity, this.lastWaterRecording);
    const buffer = this.recordings?.get(recording);
    if (!buffer) return;
    const profile = FOOTSTEP_RECORDINGS[recording];
    const voice = this.spatial(
      { ...position, y: surface === "water" ? POOL_WATER_Y : position.y + 0.12 },
      surface === "carpet" ? 0.55 : 1.1,
      distant ? 3 : 1.7,
    );
    const performance = footstepPerformance(surface, running, entity, this.rng);
    voice.input.gain.value = profile.gain * performance.gain;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = performance.rate;
    filter.type = "lowpass";
    filter.frequency.value = (entity ? 1100 : profile.cutoff) * performance.brightness;
    filter.Q.value = 0.5;
    source.connect(filter).connect(voice.input);
    voice.sources.push(source);
    voice.nodes.push(filter);
    this.track(voice);
    source.start(now);
  }

  private buildingNoise(position: SoundPosition, kind: "duct" | "settle") {
    if (!this.ctx || !this.noise || this.transients.size >= 12) return;
    if (kind === "settle") {
      this.creak(position);
      return;
    }
    const ctx = this.ctx,
      now = ctx.currentTime;
    const voice = this.spatial(
      { ...position, y: 2.6 },
      0.7,
      3,
    );
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    source.playbackRate.value = 0.65;
    filter.type = "lowpass";
    filter.frequency.value = 950;
    const duration = 2.8;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.23, now + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(voice.input);
    voice.sources.push(source);
    voice.nodes.push(filter, gain);
    this.track(voice);
    source.start(now, this.rng());
    source.stop(now + duration + 0.05);
  }

  private creak(position: SoundPosition) {
    const recording = CREAK_RECORDINGS[Math.floor(this.rng() * CREAK_RECORDINGS.length)];
    const buffer = this.recordings?.get(recording);
    if (!buffer) return;
    const ctx = this.ctx!, profile = RPG_RECORDINGS[recording];
    // Keep the source anchored in the room; spatial() applies distance and walls
    // to both the direct sound and its quiet reflections as the listener moves.
    const voice = this.spatial({ ...position, y: 2.4 }, 0.45, 4.5);
    voice.input.gain.value = profile.gain;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    source.buffer = buffer;
    source.playbackRate.value = 0.9 + this.rng() * 0.15;
    filter.type = "lowpass";
    filter.frequency.value = profile.cutoff;
    filter.Q.value = 0.5;
    source.connect(filter).connect(voice.input);
    voice.sources.push(source);
    voice.nodes.push(filter);
    this.track(voice);
    source.start();
  }

  private track(voice: SpatialVoice) {
    this.transients.add(voice);
    let remaining = voice.sources.length;
    for (const source of voice.sources)
      source.onended = () => {
        if (--remaining === 0) this.release(voice);
      };
  }

  private release(voice: SpatialVoice) {
    for (const source of voice.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    for (const node of voice.nodes) node.disconnect();
    this.transients.delete(voice);
  }

  dispose() {
    this.disposed = true;
    this.active = false;
    this.dialup?.dispose();
    this.dialup = null;
    this.interfaceAudio?.dispose();
    this.interfaceAudio = null;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.resetSpace(0);
    this.entityAudio?.dispose();
    this.entityAudio = null;
    for (const source of this.loops) {
      source.stop();
      source.disconnect();
    }
    this.loops = [];
    this.rooms.clear();
    this.noise = null;
    this.recordings?.dispose();
    this.recordings = null;
    if (this.ctx) void this.ctx.close().catch(() => {});
  }
}
