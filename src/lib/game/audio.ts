export class BackroomsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.65;
  private active = false;
  async start() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      const compressor = ctx.createDynamicsCompressor();
      compressor.connect(this.master);
      this.hum = ctx.createGain();
      this.hum.gain.value = 0.11;
      this.hum.connect(compressor);
      for (const [frequency, gain] of [
        [60, 0.33],
        [120, 0.24],
        [180, 0.06],
        [2400, 0.006],
      ]) {
        const osc = ctx.createOscillator(),
          level = ctx.createGain();
        osc.frequency.value = frequency;
        level.gain.value = gain;
        osc.connect(level).connect(this.hum);
        osc.start();
      }
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < samples.length; i++) {
        brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
        samples[i] = brown * 3.5;
      }
      this.noise = buffer;
      const hiss = ctx.createBufferSource();
      hiss.buffer = buffer;
      hiss.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 520;
      const level = ctx.createGain();
      level.gain.value = 0.16;
      hiss.connect(filter).connect(level).connect(compressor);
      hiss.start();
    }
    await this.ctx.resume();
    this.active = true;
    this.setVolume(this.volume);
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(
        this.active ? volume * 0.7 : 0,
        this.ctx.currentTime,
        0.15,
      );
  }
  pause() {
    this.active = false;
    this.setVolume(this.volume);
  }
  update(time: number, stress: number, fluorescent: number) {
    if (this.ctx && this.hum)
      this.hum.gain.setTargetAtTime(
        0.09 +
          fluorescent * 0.04 +
          Math.sin(time * 0.7) * 0.006 +
          stress * 0.07,
        this.ctx.currentTime,
        0.2,
      );
  }
  step(running: boolean, wet: boolean, side: number) {
    if (!this.ctx || !this.master || !this.noise || !this.active) return;
    const ctx = this.ctx,
      now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = wet ? 1900 : 780;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(running ? 0.65 : 0.42, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (wet ? 0.22 : 0.16));
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * 0.2;
    source.connect(filter).connect(gain).connect(pan).connect(this.master);
    source.start(now, Math.random());
    source.stop(now + 0.25);
    const thud = ctx.createOscillator(),
      low = ctx.createGain();
    thud.frequency.setValueAtTime(wet ? 125 : 88, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.12);
    low.gain.setValueAtTime(running ? 0.15 : 0.085, now);
    low.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    thud.connect(low).connect(this.master);
    thud.start();
    thud.stop(now + 0.16);
  }
  anomaly() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx,
      now = ctx.currentTime,
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(43, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 1.8);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 350;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.3);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    osc.stop(now + 2.4);
  }
  distant(time: number) {
    if (!this.ctx || !this.master || !this.noise || !this.active) return;
    const ctx = this.ctx,
      src = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      level = ctx.createGain(),
      pan = ctx.createStereoPanner();
    src.buffer = this.noise;
    filter.type = "bandpass";
    filter.frequency.value = 300 + Math.sin(time) * 130;
    filter.Q.value = 12;
    level.gain.setValueAtTime(0.001, ctx.currentTime);
    level.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + 1);
    level.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.7);
    pan.pan.value = Math.sin(time) * 0.85;
    src.connect(filter).connect(level).connect(pan).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 3);
  }
  dispose() {
    void this.ctx?.close();
  }
}
