import {
  BuildingSoundSchedule,
  hardFloorAt,
  ROOM_SOUNDS,
  roomSoundAt,
  transmission,
  wallsBetween,
  type BuildingSound,
  type RoomSound,
  type SoundPosition,
} from "./acoustics";
import { hash, random, type ChunkData } from "./maze";

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
  private rooms = new Map<RoomSound, RoomBus>();
  private fixtures = new Map<string, FixtureVoice>();
  private transients = new Set<SpatialVoice>();
  private loops: AudioScheduledSourceNode[] = [];
  private volume = 0.65;
  private active = false;
  private disposed = false;
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
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.mix = ctx.createDynamicsCompressor();
    this.mix.threshold.value = -16;
    this.mix.knee.value = 12;
    this.mix.ratio.value = 4;
    this.mix.connect(this.master);
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
      convolver.buffer = this.impulse(profile.decay);
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

  private impulse(decay: number) {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(
      2,
      Math.ceil(ctx.sampleRate * decay),
      ctx.sampleRate,
    );
    const rng = random(this.seed + Math.round(decay * 1000));
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < samples.length; i++) {
        const t = i / ctx.sampleRate;
        smooth = smooth * 0.65 + (rng() * 2 - 1) * 0.35;
        // No dry impulse; soft early reflections give way to a diffuse, damped tail.
        if (t > 0.014)
          samples[i] =
            smooth *
            Math.min(1, (t - 0.014) / 0.025) *
            Math.exp((-6.9 * t) / decay);
      }
      for (const t of [0.019, 0.037, 0.061]) {
        const index = Math.floor((t + channel * 0.003) * ctx.sampleRate);
        samples[index] += 0.3 * Math.exp((-6.9 * t) / decay);
      }
    }
    return buffer;
  }

  setVolume(volume: number) {
    this.volume = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        this.active ? this.volume * 0.7 : 0,
        this.ctx.currentTime,
        0.06,
      );
  }

  pause() {
    this.active = false;
    this.pending = null;
    this.setVolume(this.volume);
    for (const voice of this.transients) this.release(voice);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    if (this.ctx && !this.disposed)
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (!this.active && !this.disposed)
          void this.ctx?.suspend().catch(() => {});
      }, 400);
  }

  /** Called after a tape descent so no source or echo is carried to the new floor. */
  resetSpace(time: number) {
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

  update(
    time: number,
    position: SoundPosition,
    forward: SoundPosition,
    up: SoundPosition,
    chunks: Map<string, ChunkData>,
    sections: Iterable<{ lights: readonly SoundPosition[] }>,
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
    const sound = this.schedule.poll(time, chunks, position);
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
    const distance = Math.hypot(
      voice.position.x - this.listener.x,
      voice.position.y - this.listener.y,
      voice.position.z - this.listener.z,
    );
    const path = transmission(
      wallsBetween(this.chunks, this.listener, voice.position),
      distance,
    );
    const gain = distance >= 32 ? 0 : path.gain;
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
        osc.connect(level).connect(voice.input);
        voice.sources.push(osc);
        voice.nodes.push(level);
        osc.start();
      }
      this.fixtures.set(item.id, { voice, retireAt: null });
    }
  }

  step(running: boolean, side: number) {
    if (!this.active || !this.ctx || !this.noise || !this.volume) return;
    this.footstep(
      {
        x: this.listener.x - this.forward.z * side * 0.14,
        y: 0.12,
        z: this.listener.z + this.forward.x * side * 0.14,
      },
      running,
      false,
    );
  }

  private footstep(
    position: SoundPosition,
    running: boolean,
    distant: boolean,
  ) {
    if (!this.ctx || !this.noise || this.transients.size >= 12) return;
    const ctx = this.ctx,
      now = ctx.currentTime;
    const hard = hardFloorAt(this.chunks, position);
    const voice = this.spatial(position, 1, distant ? 3 : 1.7);
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = this.noise;
    source.playbackRate.value = 0.85 + this.rng() * 0.3;
    filter.type = "lowpass";
    filter.frequency.value = hard ? 2400 : 720;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(running ? 0.48 : 0.3, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (hard ? 0.19 : 0.14));
    source.connect(filter).connect(gain).connect(voice.input);
    const thud = ctx.createOscillator(),
      low = ctx.createGain();
    thud.frequency.setValueAtTime(hard ? 115 : 82, now);
    thud.frequency.exponentialRampToValueAtTime(40, now + 0.1);
    low.gain.setValueAtTime(running ? 0.08 : 0.045, now);
    low.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    thud.connect(low).connect(voice.input);
    voice.sources.push(source, thud);
    voice.nodes.push(filter, gain, low);
    this.track(voice);
    source.start(now, this.rng());
    source.stop(now + 0.24);
    thud.start(now);
    thud.stop(now + 0.15);
  }

  private buildingNoise(position: SoundPosition, kind: "duct" | "settle") {
    if (!this.ctx || !this.noise || this.transients.size >= 12) return;
    const ctx = this.ctx,
      now = ctx.currentTime;
    const voice = this.spatial(
      { ...position, y: kind === "duct" ? 2.6 : 0.8 },
      0.7,
      3,
    );
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = this.noise;
    source.loop = true;
    source.playbackRate.value = kind === "duct" ? 0.65 : 1.15;
    filter.type = "lowpass";
    filter.frequency.value = kind === "duct" ? 950 : 1500;
    const duration = kind === "duct" ? 2.8 : 0.45;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      kind === "duct" ? 0.23 : 0.32,
      now + (kind === "duct" ? 0.8 : 0.018),
    );
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(voice.input);
    voice.sources.push(source);
    voice.nodes.push(filter, gain);
    this.track(voice);
    source.start(now, this.rng());
    source.stop(now + duration + 0.05);
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
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.resetSpace(0);
    for (const source of this.loops) {
      source.stop();
      source.disconnect();
    }
    this.loops = [];
    this.rooms.clear();
    this.noise = null;
    if (this.ctx) void this.ctx.close().catch(() => {});
  }
}
