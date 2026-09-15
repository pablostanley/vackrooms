import * as THREE from "three";
import { random, type Theme } from "./maze";

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 512,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
function grain(
  ctx: CanvasRenderingContext2D,
  size: number,
  strength: number,
  seed: number,
) {
  const rng = random(seed),
    image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (rng() - 0.5) * strength;
    image.data[i] += n;
    image.data[i + 1] += n;
    image.data[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}
export function createMaterials() {
  const textures: THREE.Texture[] = [];
  const texture = (
    draw: (ctx: CanvasRenderingContext2D, size: number) => void,
    size?: number,
  ) => {
    const t = canvasTexture(draw, size);
    textures.push(t);
    return t;
  };
  const wallpaper = texture((ctx, s) => {
    ctx.fillStyle = "#c9bc6b";
    ctx.fillRect(0, 0, s, s);
    // Nearly flat paper: the dated motif is visible only close to a wall.
    ctx.strokeStyle = "rgba(119,111,48,.035)";
    ctx.lineWidth = 0.7;
    for (let x = 16; x < s; x += 32)
      for (let y = 0; y < s; y += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y - 12);
        ctx.bezierCurveTo(x - 7, y, x - 5, y + 5, x, y + 12);
        ctx.bezierCurveTo(x + 5, y + 5, x + 7, y, x, y - 12);
        ctx.stroke();
      }
    grain(ctx, s, 3, 83);
  });
  const carpet = texture((ctx, s) => {
    ctx.fillStyle = "#a39157";
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 7, 129);
    const rng = random(31);
    for (let i = 0; i < 5; i++) {
      const x = rng() * s,
        y = rng() * s,
        r = 65 + rng() * 95;
      const stain = ctx.createRadialGradient(x, y, 0, x, y, r);
      stain.addColorStop(0, "rgba(92,73,31,.035)");
      stain.addColorStop(1, "rgba(92,73,31,0)");
      ctx.fillStyle = stain;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const ceiling = texture((ctx, s) => {
    ctx.fillStyle = "#beb579";
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 2, 871);
    ctx.strokeStyle = "rgba(139,129,69,.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, s, s);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
  });
  const tile = texture((ctx, s) => {
    ctx.fillStyle = "#aaa577";
    ctx.fillRect(0, 0, s, s);
    grain(ctx, s, 4, 566);
  });
  const lightMap = texture((ctx, s) => {
    ctx.fillStyle = "#edeacf";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 5) {
      ctx.fillStyle = "rgba(114,121,90,.14)";
      ctx.fillRect(0, y, s, 1);
    }
    grain(ctx, s, 9, 143);
  });
  const ao = texture((ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "rgba(60,49,16,.23)");
    g.addColorStop(0.2, "rgba(60,49,16,.07)");
    g.addColorStop(1, "rgba(13,12,4,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 128);
  const wall = new THREE.MeshStandardMaterial({
    map: wallpaper,
    roughness: 0.97,
    color: "#ffffff",
    emissive: "#ccbc5f",
    emissiveIntensity: 0.035,
  });
  const floor = new THREE.MeshStandardMaterial({
    map: carpet,
    roughness: 1,
    emissive: "#ab9552",
    emissiveIntensity: 0.025,
  });
  const top = new THREE.MeshStandardMaterial({
    map: ceiling,
    roughness: 1,
    color: "#ffffff",
    emissive: "#c4b976",
    emissiveIntensity: 0.075,
  });
  const tileWall = new THREE.MeshStandardMaterial({
    map: tile,
    roughness: 0.48,
    bumpMap: tile,
    bumpScale: 0.025,
    color: "#b0bb92",
  });
  const tileFloor = new THREE.MeshStandardMaterial({
    map: tile,
    roughness: 0.38,
    color: "#818d72",
  });
  const service = wall.clone();
  service.color.set("#91a38a");
  const archive = wall.clone();
  archive.color.set("#ccbea5");
  const trim = new THREE.MeshStandardMaterial({
    color: "#a99b55",
    roughness: 0.85,
  });
  const fixtures = new THREE.MeshStandardMaterial({
    color: "#bab37e",
    roughness: 0.7,
    metalness: 0.35,
  });
  const luminous = new THREE.MeshBasicMaterial({
    map: lightMap,
    color: "#ffffdd",
    toneMapped: false,
  });
  const deadLight = new THREE.MeshStandardMaterial({
    color: "#b2ad78",
    roughness: 0.8,
  });
  const lampGlow = new THREE.MeshBasicMaterial({ color: "#ffe0a0", toneMapped: false });
  const shadow = new THREE.MeshBasicMaterial({
    map: ao,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: "#4a3017",
    roughness: 0.8,
  });
  const fabric = new THREE.MeshStandardMaterial({
    color: "#535843",
    roughness: 1,
  });
  const upholstery = new THREE.MeshStandardMaterial({
    color: "#8b7c53",
    roughness: 1,
  });
  const enamel = new THREE.MeshStandardMaterial({
    color: "#b4a052",
    roughness: 0.72,
    metalness: 0.08,
  });
  const fadedRed = new THREE.MeshStandardMaterial({
    color: "#9b5942",
    roughness: 0.88,
  });
  const cream = new THREE.MeshStandardMaterial({
    color: "#c8bc91",
    roughness: 0.86,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#32392d",
    metalness: 0.65,
    roughness: 0.55,
  });
  const paper = new THREE.MeshStandardMaterial({
    color: "#b0aa7e",
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const darkness = new THREE.MeshBasicMaterial({ color: "#060806" });
  return {
    wall,
    floor,
    top,
    tileWall,
    tileFloor,
    trim,
    fixtures,
    luminous,
    lampGlow,
    deadLight,
    shadow,
    wood,
    fabric,
    upholstery,
    enamel,
    fadedRed,
    cream,
    metal,
    paper,
    darkness,
    forTheme: (theme: Theme) => ({
      wall:
        theme === "service" ? service : theme === "archive" ? archive : wall,
      floor,
    }),
    dispose: () => {
      textures.forEach((t) => t.dispose());
      [
        wall,
        floor,
        top,
        tileWall,
        tileFloor,
        service,
        archive,
        trim,
        fixtures,
        luminous,
        lampGlow,
        deadLight,
        shadow,
        wood,
        fabric,
        upholstery,
        enamel,
        fadedRed,
        cream,
        metal,
        paper,
        darkness,
      ].forEach((m) => m.dispose());
    },
  };
}
export type Materials = ReturnType<typeof createMaterials>;
