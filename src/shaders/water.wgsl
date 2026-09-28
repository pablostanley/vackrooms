// Portable pool surface. Keep the explicit GLSL fallback in pool-water.ts in
// sync. Pure functions only: Three samples the scene color, depth, and planar
// reflection in TSL and hands the results to waterShade().
//
// Wave helpers return xy = analytic height gradient, z = displacement. Broad
// waves use mesh-local XZ so translated pools stay in phase with their mesh;
// ripples use world XZ because they are dropped at world positions.
fn poolWave(p: vec2f, direction: vec2f, phase: f32, amplitude: f32) -> vec3f {
  let angle = dot(p, direction) + phase;
  return vec3f(direction * cos(angle) * amplitude, sin(angle) * amplitude);
}

fn poolWaves(p: vec2f, seconds: f32) -> vec3f {
  return poolWave(p, vec2f(1.7, 0.9), seconds * 0.72, 0.017)
    + poolWave(p, vec2f(-0.8, 2.1), -seconds * 0.53, 0.012)
    + poolWave(p, vec2f(3.4, -2.5), seconds * 0.37, 0.006);
}

// Short-crested capillary chop. Many non-parallel directions avoid the
// corduroy look of a few long sines.
fn poolChop(p: vec2f, seconds: f32) -> vec2f {
  return (poolWave(p, vec2f(7.3, 4.8), -seconds * 1.13, 0.004)
    + poolWave(p, vec2f(-5.7, 9.2), seconds * 0.91, 0.003)
    + poolWave(p, vec2f(13.1, -7.4), seconds * 1.31, 0.0012)
    + poolWave(p, vec2f(-11.6, -9.9), seconds * 1.57, 0.0011)
    + poolWave(p, vec2f(19.3, 6.1), -seconds * 1.83, 0.0006)
    + poolWave(p, vec2f(-4.2, -17.8), seconds * 2.09, 0.0005)).xy;
}

// A dispersive ring packet: a leading crest and a few trailing rings that
// spread and weaken. r = (world x, world z, start seconds, strength).
fn ripple(p: vec2f, r: vec4f, seconds: f32) -> vec2f {
  let age = seconds - r.z;
  if (r.w <= 0.0 || age < 0.0 || age > 5.0) {
    return vec2f(0.0);
  }
  let offset = p - r.xy;
  let dist = length(offset);
  let front = 0.08 + age * 0.58;
  let k = 18.0 - min(age, 3.0) * 2.5;
  let behind = front - dist;
  let packet = exp(-behind * behind * 5.0) * select(1.0, 0.55, behind > 0.0);
  let fade = r.w * exp(-age * 0.9) / (1.0 + dist * 1.8);
  let slope = cos(behind * k) * k * 0.0055 * packet * fade;
  return offset / max(dist, 0.001) * slope;
}

export fn waterPosition(position: vec3f, seconds: f32) -> vec3f {
  return position + vec3f(0.0, poolWaves(position.xz, seconds).z, 0.0);
}

export fn waterNormal(
  local: vec3f, world: vec3f, eye: vec3f, seconds: f32,
  r0: vec4f, r1: vec4f, r2: vec4f, r3: vec4f,
  r4: vec4f, r5: vec4f, r6: vec4f, r7: vec4f,
) -> vec3f {
  // Fade fine chop before it turns into subpixel sparkle in the distance.
  let detail = 1.0 - smoothstep(8.0, 32.0, length(eye - world));
  let q = world.xz;
  let rings = ripple(q, r0, seconds) + ripple(q, r1, seconds)
    + ripple(q, r2, seconds) + ripple(q, r3, seconds)
    + ripple(q, r4, seconds) + ripple(q, r5, seconds)
    + ripple(q, r6, seconds) + ripple(q, r7, seconds);
  let slope = poolWaves(local.xz, seconds).xy + poolChop(local.xz, seconds) * detail
    + rings * mix(0.45, 1.0, detail);
  return normalize(vec3f(-slope.x, 1.0, -slope.y));
}

// Iterated interference that forms the bright, cell-like filaments seen on a
// pool floor. The iteration is exactly 2pi-periodic in p, so wrapping keeps
// large pools precise and seamless.
fn causticField(p: vec2f, seconds: f32) -> f32 {
  let tau = 6.2831853;
  let q = p - tau * floor(p / tau);
  let t = seconds * 0.42 + 23.0;
  var i = q;
  var c = 1.0;
  for (var n = 0; n < 4; n++) {
    let s = t * (1.0 - 3.5 / f32(n + 1));
    i = q + vec2f(cos(s - i.x) + sin(s + i.y), sin(s - i.y) + cos(s + i.x));
    c += 1.0 / length(vec2f(1.25 / sin(i.x + s), 1.25 / cos(i.y + s)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}

// Repeating fluorescent troffers, used only when the planar reflection is
// unavailable (low quality or the compatible renderer).
fn ceilingFixtures(position: vec3f, reflection: vec3f, facing: f32) -> vec3f {
  let hit = position.xz + reflection.xz * (6.98 / max(reflection.y, 0.06));
  let fixture = abs(fract(hit / 4.8) - 0.5) * 4.8;
  let blur = 0.07 + (1.0 - facing) * 0.16;
  let visible = smoothstep(0.12, 0.38, reflection.y);
  let core = visible * (1.0 - smoothstep(1.04 - blur, 1.20 + blur, fixture.x))
    * (1.0 - smoothstep(0.15, 0.27 + blur, fixture.y));
  let halo = visible * (1.0 - smoothstep(0.95, 1.48, fixture.x))
    * (1.0 - smoothstep(0.20, 0.65, fixture.y));
  return vec3f(0.48, 0.47, 0.29) + (core * 1.65 + halo * 0.16) * vec3f(1.0, 0.97, 0.72);
}

// normal/view: world unit vectors. behind: linear scene colour seen through the
// refracted ray. thickness: metres of water along that ray. reflected: linear
// planar reflection, used with weight `mirror` (0 falls back to fixtures).
export fn waterShade(
  normal: vec3f, view: vec3f, position: vec3f, local: vec3f, seconds: f32,
  behind: vec3f, thickness: f32, reflected: vec3f, mirror: f32,
) -> vec4f {
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  // Schlick with water's F0 (n = 1.333): ~2% straight down, total at grazing.
  let fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  let ray = refract(-view, normal, 0.75);
  let depth = max(thickness, 0.0);
  let vertical = depth * clamp(-ray.y, 0.0, 1.0);

  // Caustics land on whatever the refracted ray reaches: floor, lane lines,
  // basin walls, legs. Sharpest at mid-depth, absent at the waterline.
  let floorPoint = local.xz + ray.xz * depth;
  let focus = smoothstep(0.04, 0.45, vertical) * (1.0 - smoothstep(2.4, 4.5, vertical));
  let pattern = causticField(floorPoint * 2.6, seconds);
  let lit = behind * (1.0 + (pattern * 2.8 - 0.3) * focus);

  // Beer-Lambert absorption plus in-scattering. Red and blue are absorbed
  // faster than green, keeping the chlorinated olive-green of the halls.
  let transmittance = exp(-depth * vec3f(0.40, 0.24, 0.70));
  let scatter = vec3f(0.15, 0.18, 0.07);
  let transmitted = lit * transmittance + scatter * (1.0 - transmittance);

  let mirrored = mix(ceilingFixtures(position, reflect(-view, normal), facing), reflected, mirror);
  return vec4f(mix(transmitted, mirrored, fresnel), 1.0);
}
