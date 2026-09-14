struct CrtParams {
  mode: f32,
}
@group(0) @binding(0) var<uniform> params: CrtParams;

// Output maps are applied by the browser compositor to the live HTML surface.
// This pass never reads or captures pixels from the cross-origin website.
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let p = uv - 0.5;
  let radius = dot(p, p);
  // Maximum displacement is seven CSS pixels on a 1000 x 750 screen.
  let barrel = p * radius * 0.028;
  if (params.mode < 0.5) {
    let displacement = barrel * vec2f(1000.0, 750.0);
    return vec4f(0.5 + displacement / 20.0, 0.5, 1.0);
  }

  let glassUv = uv + barrel;
  let edge = smoothstep(0.10, 0.47, radius);
  let vignette = 1.0 - edge * 0.15;
  let scan = 0.5 + 0.5 * cos(glassUv.y * 250.0 * 6.2831853);
  // Soft phosphor rows, with a very faint RGB triad. No moving roll or flicker.
  let rows = 1.0 - scan * 0.038;
  let triad = 0.5 + 0.5 * cos(glassUv.x * 333.0 * 6.2831853 + vec3f(0.0, 2.0944, 4.1888));
  let phosphor = vec3f(1.0) - triad * 0.011;
  let warmWhite = vec3f(0.992, 0.983, 0.957);
  let reflection = exp(-dot((uv - vec2f(0.28, 0.08)) * vec2f(1.2, 3.2), (uv - vec2f(0.28, 0.08)) * vec2f(1.2, 3.2))) * 0.017;
  let grade = min(warmWhite * phosphor * rows * vignette + reflection, vec3f(1.0));
  return vec4f(grade, 1.0);
}
