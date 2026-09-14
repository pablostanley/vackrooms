const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const LEG_LENGTH = 0.65;
export const gaitUrgency = (speed: number) => clamp((speed - 1.5) / 3, 0, 1);
export const stepLength = (speed: number) => 0.9 + gaitUrgency(speed) * 0.4;

/** Two equal leg bones solve toward a planted foot, with the knee always forward.
 * Each stance covers exactly one traveled step; the return swing lifts the toes.
 */
export function solveEntityLeg(
  gait: number,
  speed: number,
  motion: number,
  hipHeight: number,
) {
  const phase = ((((gait + Math.PI / 2) / (Math.PI * 2)) % 1) + 1) % 1;
  const swinging = phase >= 0.5;
  const swing = (phase - 0.5) * 2;
  const reach = stepLength(speed) * motion;
  const smooth = swing * swing * (3 - 2 * swing);
  const footZ = swinging ? (smooth - 0.5) * reach : (0.5 - phase * 2) * reach;
  const lift = swinging
    ? Math.sin(swing * Math.PI) * (0.15 + gaitUrgency(speed) * 0.18) * motion
    : 0;
  const footY = 0.05 + lift;
  const drop = hipHeight - footY;
  const length = clamp(Math.hypot(drop, footZ), 0.1, LEG_LENGTH * 2 - 0.001);
  const knee = Math.acos(
    clamp(
      (length * length - 2 * LEG_LENGTH ** 2) / (2 * LEG_LENGTH ** 2),
      -1,
      1,
    ),
  );
  const hip = Math.atan2(-footZ, drop) - knee / 2;
  const ankle =
    -hip - knee - (swinging ? Math.sin(swing * Math.PI) * 0.16 * motion : 0);
  return { hip, knee, ankle, footY, footZ, swinging };
}
