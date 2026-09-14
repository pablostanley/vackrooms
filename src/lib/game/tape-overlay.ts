/** Transparent tape damage above both the room render and the camcorder OSD. */
export class TapeOverlay {
  private context: CanvasRenderingContext2D | null;
  private patterns: CanvasPattern[] = [];
  private lastFrame = -1;
  private lastDamage = -1;
  private lastAnomaly = -1;

  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d");
    if (!this.context) return;
    // Small reusable noise plates avoid generating a full-screen image each frame.
    let random = 19940618;
    for (let frame = 0; frame < 4; frame++) {
      const plate = document.createElement("canvas");
      plate.width = plate.height = 128;
      const context = plate.getContext("2d")!;
      const pixels = context.createImageData(128, 128);
      for (let i = 0; i < pixels.data.length; i += 4) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        const value = random >>> 0;
        // Dark oxide speckle wears into white lettering without a bright flash.
        const tint = value % 5 === 0 ? 204 : 18;
        pixels.data[i] = tint;
        pixels.data[i + 1] = tint;
        pixels.data[i + 2] = Math.floor(tint * 0.82);
        pixels.data[i + 3] = (value >>> 8) % 88;
      }
      context.putImageData(pixels, 0, 0);
      const pattern = this.context.createPattern(plate, "repeat");
      if (pattern) this.patterns.push(pattern);
    }
  }

  resize(width: number, height: number) {
    this.canvas.height = Math.min(540, height);
    this.canvas.width = Math.ceil((width / height) * this.canvas.height);
    this.lastFrame = -1;
  }

  render(time: number, damage: number, anomaly: number, steady: boolean) {
    const context = this.context;
    if (!context || !this.patterns.length) return;
    const frame = steady ? 0 : Math.floor(time * 30);
    const grainFrame = Math.floor(frame / 2);
    if (
      grainFrame === this.lastFrame &&
      damage === this.lastDamage &&
      anomaly === this.lastAnomaly
    )
      return;
    this.lastFrame = grainFrame;
    this.lastDamage = damage;
    this.lastAnomaly = anomaly;
    const { width, height } = this.canvas;
    context.clearRect(0, 0, width, height);
    if (!damage) return;
    context.globalAlpha = damage * (0.32 + anomaly * 0.7);
    context.fillStyle = this.patterns[grainFrame % this.patterns.length];
    context.save();
    const x = (grainFrame * 37) % 128,
      y = (grainFrame * 19) % 128;
    context.translate(-x, -y);
    context.fillRect(0, 0, width + 128, height + 128);
    context.restore();

    // Fine scanline losses cross the HUD as part of the same recorded image.
    context.globalAlpha = damage * 0.055;
    context.fillStyle = "#17180e";
    for (let row = 1; row < height; row += 3)
      context.fillRect(0, row, width, 0.6);

    // Band locations match tapeWarp: a quick tear, never a rolling sine wave.
    if (!steady && (anomaly > 0 || frame % 211 < 2)) {
      const strength = Math.max(anomaly, 0.12);
      for (const band of [
        (frame * 0.173 + 0.19) % 1,
        (frame * 0.317 + 0.63) % 1,
      ]) {
        const row = Math.floor(band * height);
        context.globalAlpha = damage * strength * 0.38;
        context.fillRect(0, row, width, Math.max(1, height * 0.006));
        context.globalAlpha = damage * strength * 0.15;
        context.fillRect(0, row + 4, width, 1);
      }
    }
    context.globalAlpha = 1;
  }

  dispose() {
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.patterns = [];
    this.context = null;
  }
}
