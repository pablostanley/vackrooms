// Portable, texture-free pool surface. Keep the explicit GLSL fallback in sync.
// xy is the analytic height gradient, z is displacement. The normal and mesh
// use the same local coordinates, so translated resident pools stay in phase.
fn poolWave(p: vec2f, direction: vec2f, phase: f32, amplitude: f32) -> vec3f {
  let angle = dot(p, direction) + phase;
  return vec3f(direction * cos(angle) * amplitude, sin(angle) * amplitude);
}

fn poolWaves(p: vec2f, seconds: f32) -> vec3f {
  return poolWave(p, vec2f(1.7, 0.9), seconds * 0.72, 0.017)
    + poolWave(p, vec2f(-0.8, 2.1), -seconds * 0.53, 0.012)
    + poolWave(p, vec2f(3.4, -2.5), seconds * 0.37, 0.006);
}

export fn waterPosition(position: vec3f, seconds: f32) -> vec3f {
  return position + vec3f(0.0, poolWaves(position.xz, seconds).z, 0.0);
}

export fn waterSurface(position: vec3f, local: vec3f, eye: vec3f, seconds: f32) -> vec4f {
  let p = local.xz;
  let distanceToEye = length(eye - position);
  // Fade the fine capillary waves before they become noisy subpixel sparkle.
  let detail = 1.0 - smoothstep(8.0, 32.0, distanceToEye);
  let drift = poolWaves(p, seconds);
  let fine = poolWave(p, vec2f(7.3, 4.8), -seconds * 1.13, 0.004)
    + poolWave(p, vec2f(-5.7, 9.2), seconds * 0.91, 0.003)
    + poolWave(p, vec2f(13.1, -7.4), seconds * 1.31, 0.0012);
  let slope = drift.xy + fine.xy * detail;
  let normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
  let view = normalize(eye - position);
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  let fresnel = 0.025 + 0.975 * pow(1.0 - facing, 5.0);

  // Analytical warm fluorescent reflections: broken by ripples, with a soft
  // shoulder rather than hard rectangles. No scene capture or extra samplers.
  let reflection = reflect(-view, normal);
  let ceilingHit = position.xz + reflection.xz * (6.98 / max(reflection.y, 0.06));
  let fixture = abs(fract(ceilingHit / 4.8) - 0.5) * 4.8;
  let blur = 0.07 + (1.0 - facing) * 0.16;
  // At grazing angles the ray meets the room walls before the ceiling. Fade
  // the repeated fixture approximation to avoid an infinite sparkling grid.
  let ceilingVisibility = smoothstep(0.12, 0.38, reflection.y);
  let core = ceilingVisibility * (1.0 - smoothstep(1.04 - blur, 1.20 + blur, fixture.x))
    * (1.0 - smoothstep(0.15, 0.27 + blur, fixture.y));
  let halo = ceilingVisibility * (1.0 - smoothstep(0.95, 1.48, fixture.x))
    * (1.0 - smoothstep(0.20, 0.65, fixture.y));
  let reflectedRoom = vec3f(0.48, 0.47, 0.29)
    + (core * 1.65 + halo * 0.16) * vec3f(1.0, 0.97, 0.72);

  // Bend the procedural light pattern toward the 1.22m-deep basin floor.
  // Broad, irregular interference avoids a repeating crosshatch on the water.
  let ray = refract(-view, normal, 0.75);
  let floorPoint = p + ray.xz * (1.22 / max(-ray.y, 0.2));
  let q = floorPoint + drift.xy * 2.6;
  let a = sin(q.x * 2.7 + sin(q.y * 1.9 - seconds * 0.31) + seconds * 0.23);
  let b = sin(q.y * 2.4 + sin(q.x * 1.6 + seconds * 0.27) - seconds * 0.19);
  let caustic = pow(1.0 - abs((a + b) * 0.5), 10.0);
  let broad = sin(q.x * 0.43 + q.y * 0.31 + seconds * 0.12)
    * sin(q.y * 0.57 - q.x * 0.23 - seconds * 0.09);
  let absorption = 1.0 - exp(-0.32 / max(facing, 0.22));
  let body = mix(vec3f(0.29, 0.34, 0.19), vec3f(0.19, 0.25, 0.12), absorption)
    + broad * vec3f(0.012, 0.016, 0.008)
    + caustic * vec3f(0.055, 0.061, 0.029) * (1.0 - fresnel);
  let reflectance = 0.10 + fresnel * 0.80;
  let color = mix(body, reflectedRoom, reflectance);
  // Looking down reveals real lane markings; grazing views catch the ceiling.
  let opacity = clamp(0.43 + absorption * 0.18 + fresnel * 0.36 + core * 0.08, 0.0, 0.94);
  return vec4f(color, opacity);
}
