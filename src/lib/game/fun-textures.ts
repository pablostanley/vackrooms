import { random } from "./maze";

/** Woven party carpet: wandering ribbons, little stars, no tile/grid motif. */
export function drawFunCarpet(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = "#842c24";
  ctx.fillRect(0, 0, size, size);
  const rng = random(73019);
  const colors = ["#bc7040", "#c3a257", "#b34b2e", "#69775b", "#d3bc79"];
  for (let i = 0; i < 95; i++) {
    const x = rng() * size,
      y = rng() * size;
    const angle = rng() * Math.PI * 2;
    const radius = (0.018 + rng() * 0.055) * size;
    // Draw wrapped copies, including corners, for a continuous repeating weave.
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(angle);
        ctx.strokeStyle = ctx.fillStyle = colors[i % colors.length];
        ctx.lineWidth = size * 0.004;
        ctx.beginPath();
        if (i % 3 === 0) {
          ctx.ellipse(0, 0, radius * 1.9, radius, 0, 0.15, Math.PI * 1.8);
          ctx.stroke();
          ctx.setLineDash([size * 0.007, size * 0.012]);
          ctx.beginPath();
          ctx.ellipse(0, 0, radius * 2.2, radius * 1.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (i % 3 === 1) {
          for (let point = 0; point < 10; point++) {
            const a = (point * Math.PI) / 5;
            const r = radius * (point % 2 ? 0.35 : 0.8);
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.moveTo(-radius, 0);
          ctx.bezierCurveTo(-radius, -radius, radius, radius, radius, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
  }
  const pixels = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const nap = (rng() - 0.5) * 20;
    for (let c = 0; c < 3; c++) pixels.data[i + c] += nap;
  }
  ctx.putImageData(pixels, 0, 0);
}

/** Original, slightly awkward party mascots painted directly onto the wall. */
export function drawFunMural(
  ctx: CanvasRenderingContext2D,
  size: number,
  kind: number,
) {
  ctx.save();
  ctx.scale(size / 512, size / 512);
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.lineWidth = 5;
  const ink = "#51422e",
    cream = "#d9c987",
    gold = "#caa33c";
  const shape = (path: string, fill: string, stroke = ink) => {
    const p = new Path2D(path);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.fill(p);
    ctx.stroke(p);
  };
  const line = (path: string, color = ink, width = 5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(new Path2D(path));
    ctx.lineWidth = 5;
  };
  const oval = (x: number, y: number, rx: number, ry: number, fill: string) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, -0.1, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (kind === 0) {
    // A long-trunked elephant in an ill-fitting waistcoat and party hat.
    line("M307 302 Q382 363 366 279 Q359 252 349 271", "#726b59", 9);
    shape(
      "M210 314 L256 319 L245 405 L207 412 Z M268 317 L301 307 L324 399 L288 412 Z",
      "#b37635",
    );
    oval(213, 415, 34, 13, ink);
    oval(311, 411, 35, 13, ink);
    shape(
      "M200 203 Q173 262 194 326 Q254 350 310 312 L307 213 L260 194 Z",
      "#637461",
    );
    shape("M244 210 L262 209 L278 313 L243 320 Z", cream);
    line("M198 223 Q170 278 139 244 M307 222 Q337 205 357 160", "#726b59", 15);
    oval(137, 239, 15, 18, "#898170");
    oval(359, 158, 14, 19, "#898170");
    shape(
      "M186 107 C138 48 130 158 191 188 C157 219 132 212 112 189 Q100 166 87 177 C97 242 171 253 215 200 C302 226 324 161 294 121 Q250 81 220 119 Z",
      "#827b69",
    );
    shape("M276 128 C335 77 342 188 282 191 Q251 161 276 128 Z", "#918773");
    line("M286 141 Q315 116 305 171", "#625c4d", 4);
    shape("M208 108 L237 34 L281 116 Z", "#a74e35");
    oval(237, 31, 10, 10, gold);
    line("M222 82 L264 86", cream, 9);
    oval(222, 146, 12, 18, cream);
    oval(220, 149, 5, 11, ink);
    line("M218 124 Q231 119 238 128 M213 183 Q235 197 251 181");
    shape("M235 209 L213 201 L215 225 L235 216 L257 228 L260 201 Z", "#ab5036");
  } else if (kind === 1) {
    // A grinning wedge with thin, waving arms and oversized shoes.
    line(
      "M198 344 L182 403 L153 415 M279 346 L303 394 L335 402",
      "#b8954b",
      13,
    );
    oval(153, 420, 30, 12, ink);
    oval(333, 407, 31, 12, ink);
    line(
      "M173 212 L130 186 L117 117 M323 200 L362 169 L374 104",
      "#b8954b",
      12,
    );
    for (const [x, y] of [
      [117, 117],
      [374, 104],
    ]) {
      line(`M${x} ${y} l-12 -20 m12 20 l0 -28 m0 28 l13 -22`, "#b8954b", 6);
    }
    shape("M172 122 L264 81 L327 145 L303 344 L173 360 Z", "#c9983e");
    shape("M264 81 L327 145 L303 344 L276 306 Z", "#ac702f");
    for (const [x, y, r] of [
      [194, 160, 12],
      [239, 122, 8],
      [196, 302, 10],
      [252, 322, 8],
      [255, 178, 6],
    ])
      oval(x, y, r, r * 0.65, "#a97a35");
    oval(214, 204, 14, 22, cream);
    oval(249, 200, 14, 22, cream);
    oval(217, 209, 5, 13, ink);
    oval(247, 205, 5, 13, ink);
    shape("M205 241 Q235 262 262 233 Q253 294 226 282 Z", ink);
    shape("M209 243 Q235 257 256 238 L250 255 L217 262 Z", cream, cream);
    line("M201 179 L219 175 M242 172 L258 174", ink, 4);
  } else {
    // A bird host, frozen mid-step with a tiny pennant.
    line(
      "M220 341 L206 391 L167 402 M269 343 L294 381 L326 382",
      "#a67736",
      12,
    );
    oval(170, 408, 33, 13, ink);
    oval(327, 389, 33, 13, ink);
    shape(
      "M210 203 C156 221 169 314 214 353 Q255 371 296 337 L291 213 Z",
      "#c5aa46",
    );
    shape("M202 234 Q241 254 280 229 L280 330 Q235 350 197 320 Z", cream);
    line("M198 225 Q152 265 121 225 M291 229 Q327 210 349 175", "#b99d3b", 18);
    line("M346 185 L369 96", ink, 5);
    shape("M368 97 L423 124 L357 136 Z", "#a74e35");
    shape(
      "M208 193 C172 152 192 99 219 100 L207 78 L235 90 L247 66 L260 94 C316 98 319 172 279 201 Z",
      gold,
    );
    oval(235, 135, 13, 21, cream);
    oval(264, 131, 13, 21, cream);
    oval(239, 138, 5, 11, ink);
    oval(266, 134, 5, 11, ink);
    shape("M232 162 Q266 141 295 159 L267 189 L235 181 Z", "#b77535");
    line("M240 169 L278 168", ink, 4);
    shape("M226 208 L206 198 L209 222 L228 215 L247 226 L252 201 Z", "#a74e35");
  }
  ctx.restore();
  // Slight pigment variation keeps the flat shapes from looking like stickers.
  const rng = random(8803 + kind);
  const pixels = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const pigment = (rng() - 0.5) * 11;
    for (let c = 0; c < 3; c++) pixels.data[i + c] += pigment;
  }
  ctx.putImageData(pixels, 0, 0);
}
