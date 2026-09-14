import { tapeNoise } from './noise.wgsl';

export fn tapeWarp(uv: vec2f, seconds: f32, damage: f32, anomaly: f32) -> vec2f {
  let center = uv - 0.5;
  let barrel = uv + center * dot(center, center) * 0.032 * damage;
  let line = floor(uv.y * 480.0);
  let jitter = (tapeNoise(vec2f(line, floor(seconds * 24.0))) - 0.5) * 0.0012;
  let track = exp(-pow((uv.y - fract(seconds * 0.041)) * 95.0, 2.0));
  let tearing = sin(uv.y * 80.0 + seconds * 21.0) * anomaly * 0.032;
  return clamp(barrel + vec2f((jitter + track * 0.006 + tearing) * damage, 0.0), vec2f(0.001), vec2f(0.999));
}

export fn tapeGrade(color: vec3f, uv: vec2f, seconds: f32, damage: f32, anomaly: f32) -> vec4f {
  let grain = tapeNoise(floor(uv * vec2f(1280.0, 960.0)) + floor(seconds * 29.97)) - 0.5;
  let scans = sin(uv.y * 480.0 * 3.14159265) * 0.003;
  let vignette = pow(clamp(uv.x * (1.0-uv.x) * uv.y * (1.0-uv.y) * 16.0, 0.0, 1.0), 0.065);
  let tracking = smoothstep(0.962, 0.998, uv.y) * tapeNoise(vec2f(floor(uv.y * 500.0), floor(seconds * 20.0)));
  let luma = dot(color, vec3f(0.299, 0.587, 0.114));
  var graded = mix(color, vec3f(luma), damage * 0.10);
  graded = graded * mix(1.0, vignette * 0.97, damage * 0.8);
  graded += (grain * 0.013 + scans + tracking * 0.13) * damage;
  graded += anomaly * grain * 0.13 * damage;
  return vec4f(max(graded, vec3f(0.0)), 1.0);
}
