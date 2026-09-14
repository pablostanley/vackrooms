export const DIALUP_URL = "/audio/dial-up.mp3";

interface DialupVoice {
  source: AudioBufferSourceNode;
  level: GainNode;
}

/** One recording at a time, routed through the game's volume/mute bus. */
export class ComputerDialup {
  private buffer: AudioBuffer | null = null;
  private loading: Promise<AudioBuffer | null> | null = null;
  private request = 0;
  private disposed = false;
  private fetchController = new AbortController();
  private voice: DialupVoice | null = null;

  constructor(
    private ctx: BaseAudioContext,
    private output: AudioNode,
  ) {}

  /** Warm the recording on the first user gesture, before reaching a computer. */
  preload(): Promise<AudioBuffer | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.buffer) return Promise.resolve(this.buffer);
    this.loading ??= fetch(DIALUP_URL, { signal: this.fetchController.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load dial-up recording");
        return response.arrayBuffer();
      })
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buffer) => {
        if (this.disposed) return null;
        this.buffer = buffer;
        return buffer;
      })
      .catch(() => null)
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  async play() {
    this.stop(false);
    const request = this.request;
    const buffer = this.buffer ?? (await this.preload());
    // Leaving, muting, switching off, or re-entering cancels a pending start.
    if (!buffer || this.disposed || request !== this.request) return;
    const source = this.ctx.createBufferSource();
    const level = this.ctx.createGain();
    source.buffer = buffer;
    level.gain.value = 0.42;
    source.connect(level).connect(this.output);
    const voice = { source, level };
    this.voice = voice;
    source.onended = () => this.release(voice);
    source.start();
  }

  stop(fade = true) {
    this.request++;
    const voice = this.voice;
    if (!voice) return;
    if (!fade) {
      voice.source.stop();
      this.release(voice);
      return;
    }
    const now = this.ctx.currentTime;
    voice.level.gain.cancelAndHoldAtTime(now);
    voice.level.gain.linearRampToValueAtTime(0, now + 0.06);
    voice.source.stop(now + 0.06);
  }

  private release(voice: DialupVoice) {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.level.disconnect();
    if (this.voice === voice) this.voice = null;
  }

  dispose() {
    this.disposed = true;
    this.fetchController.abort();
    this.stop(false);
    this.buffer = null;
  }
}
