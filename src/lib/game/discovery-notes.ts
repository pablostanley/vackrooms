import * as THREE from "three";

export const discoveryNotes = [
  ["WALL COUNT", "Checked twice.", "Different each time."],
  ["LIGHTING CHECK", "Power isolated.", "Lamps still on."],
  ["ROOM SURVEY", "This room was", "not on the tape."],
] as const;

/** Shared across resident sections; defer lettering until the real Geist face loads. */
export function createDiscoveryNotes() {
  let disposed = false;
  const canvases = discoveryNotes.map(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e0d7ad";
    ctx.fillRect(0, 0, 512, 512);
    return canvas;
  });
  const textures = canvases.map((canvas) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
  const materials = textures.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 1 }));
  // next/font supplies the actual generated family name through this variable.
  const family = getComputedStyle(document.body).getPropertyValue("--font-mono").trim().split(",")[0];
  if (family) {
    void document.fonts.load(`24px ${family}`).then((faces) => {
      if (disposed || faces.length === 0) return;
      canvases.forEach((canvas, index) => {
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#554f35";
        ctx.font = `24px ${family}`;
        ctx.fillText("FACILITIES / 03", 44, 59);
        ctx.fillRect(44, 83, 424, 2);
        ctx.font = `28px ${family}`;
        ctx.fillText(discoveryNotes[index][0], 44, 148);
        ctx.font = `26px ${family}`;
        ctx.fillText(discoveryNotes[index][1], 44, 248);
        ctx.fillText(discoveryNotes[index][2], 44, 293);
        ctx.fillRect(44, 388, 150, 1);
        ctx.font = `18px ${family}`;
        ctx.fillText("RECHECK REQUIRED", 44, 425);
        textures[index].needsUpdate = true;
      });
    }).catch(() => {
      // A failed font load leaves blank paper rather than a different typeface.
    });
  }
  return {
    materials,
    dispose() {
      disposed = true;
      textures.forEach((texture) => texture.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
