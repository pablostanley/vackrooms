import * as THREE from "three";

// Original, deliberately nonsequential room numbers; one atlas for every section.
export const HOTEL_NUMBERS = ["104", "217", "031", "608", "114", "402", "009", "318", "205", "071", "509", "126", "803", "224", "017", "612"];
export function createHotelLabels() {
  let disposed = false;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c4ac70";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 });
  const family = getComputedStyle(document.body).getPropertyValue("--font-mono").trim().split(",")[0];
  if (family) void document.fonts.load(`30px ${family}`).then((faces) => {
    if (disposed || !faces.length) return;
    ctx.fillStyle = "#51412a";
    ctx.font = `30px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    HOTEL_NUMBERS.forEach((number, i) => ctx.fillText(number, (i % 4) * 128 + 64, Math.floor(i / 4) * 64 + 32));
    texture.needsUpdate = true;
  }).catch(() => { /* Leave blank brass if Geist cannot load. */ });
  return {
    material,
    dispose() {
      disposed = true;
      texture.dispose();
      material.dispose();
    },
  };
}
