// Portable water functions resolved by vgpu and called from Three node materials.
fn poolSlope(p: vec2f, seconds: f32) -> vec2f {
  let a = dot(p, vec2f(1.7, 0.9)) + seconds * 0.72;
  let b = dot(p, vec2f(-0.8, 2.1)) - seconds * 0.53;
  let c = dot(p, vec2f(3.4, -2.5)) + seconds * 0.37;
  return vec2f(1.7, 0.9) * cos(a) * 0.017
    + vec2f(-0.8, 2.1) * cos(b) * 0.012
    + vec2f(3.4, -2.5) * cos(c) * 0.004;
}

export fn waterPosition(position: vec3f, seconds: f32) -> vec3f {
  let p = position.xz;
  let ripple = sin(dot(p, vec2f(1.7, 0.9)) + seconds * 0.72) * 0.017
    + sin(dot(p, vec2f(-0.8, 2.1)) - seconds * 0.53) * 0.012;
  return position + vec3f(0.0, ripple, 0.0);
}

export fn waterColor(position: vec3f, eye: vec3f, seconds: f32) -> vec3f {
  let p = position.xz;
  let slope = poolSlope(p, seconds);
  let normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
  let view = normalize(eye - position);
  let fresnel = 0.035 + 0.965 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  let reflection = reflect(-view, normal);
  // Analytical reflections of the actual 4.8m fluorescent ceiling rhythm.
  let ceilingHit = p + reflection.xz * (6.98 / max(reflection.y, 0.045));
  let fixture = abs(fract(ceilingHit / 4.8) - 0.5) * 4.8;
  let glow = (1.0 - smoothstep(1.08, 1.32, fixture.x))
    * (1.0 - smoothstep(0.23, 0.43, fixture.y));
  let q = p + slope * 3.5;
  let causticA = sin(q.x * 2.9 + sin(q.y * 1.8 + seconds * 0.24));
  let causticB = sin(q.y * 3.1 - sin(q.x * 1.6 - seconds * 0.21));
  let caustic = pow(1.0 - abs(causticA * causticB), 12.0);
  let body = vec3f(0.30, 0.34, 0.145) + caustic * vec3f(0.10, 0.105, 0.055);
  let reflectedRoom = vec3f(0.53, 0.50, 0.29) + glow * vec3f(1.1, 1.05, 0.68);
  return mix(body, reflectedRoom, 0.18 + fresnel * 0.72);
}
