import { LEG_LENGTH } from "./entity-gait";
import { random } from "./maze";

export type EntityVariant = "stalker" | "pyramid";
export type HeadKind = "skull" | "bulb" | "long" | "jaw" | "pin" | "slab" | "pyramid";
export type HandKind = "long" | "splay" | "claw" | "twig" | "mitten";

export type EntityHead = {
  kind: HeadKind;
  size: number;
  /** Vertical elongation of the cranium. */
  stretch: number;
  neck: number;
  /** Outward lean of a twin neck, in radians. */
  splay: number;
  /** Resting sideways loll, in radians. */
  tilt: number;
};

export type EntityArm = {
  upper: number;
  fore: number;
  hand: HandKind;
  palm: number;
  /** A dropped shoulder, in meters. */
  droop: number;
};

/** Everything that varies between appearances. Seed 0 is the canonical body. */
export type EntityBody = {
  seed: number;
  legs: [number, number];
  torso: number;
  /** Girth of the trunk and pelvis. */
  build: number;
  /** Girth of the limbs. */
  limbs: number;
  shoulders: number;
  hunch: number;
  lean: number;
  belly: number;
  spine: number;
  arms: [EntityArm, EntityArm];
  heads: EntityHead[];
};

export const FINGERS: Record<HandKind, number> = { long: 3, splay: 5, claw: 2, twig: 4, mitten: 0 };
/** Standing clearance under the 3.15m ceilings, including the walking rise. */
export const MAX_HEIGHT = 2.88;
const LOWEST_HAND = 0.16;

export const canonicalBody = (variant: EntityVariant): EntityBody => {
  const arm: EntityArm = { upper: 0.65, fore: 0.79, hand: "long", palm: 1, droop: 0 };
  return {
    seed: 0,
    legs: [LEG_LENGTH, LEG_LENGTH],
    torso: 0.86,
    build: 1,
    limbs: 1,
    shoulders: 0.24,
    hunch: 0,
    lean: 0,
    belly: 0.1,
    spine: 0.5,
    arms: [arm, { ...arm }],
    heads: [{
      kind: variant === "pyramid" ? "pyramid" : "skull",
      size: 1, stretch: 1, neck: 0.17, splay: 0, tilt: 0,
    }],
  };
};

/** Deterministic per tape, per stalker, per appearance; never zero. */
export const entityBodySeed = (tape: number, slot: number, appearance: number) =>
  ((Math.imul(tape ^ 0x62d0a1f3, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b)
    ^ Math.imul(appearance + 7, 0xc2b2ae35)) >>> 0) || 1;

export const headTop = (head: EntityHead) =>
  0.13 + head.size * ({
    skull: 0.23 * head.stretch, bulb: 0.27, long: 0.4 * head.stretch, jaw: 0.21 * head.stretch,
    pin: 0.09, slab: 0.22 * head.stretch, pyramid: 0.38,
  })[head.kind];

export const handLength = (arm: EntityArm) =>
  arm.palm * (arm.hand === "mitten" ? 0.24 : arm.hand === "twig" || arm.hand === "claw" ? 0.33 : 0.26);

/** Height of the tallest point when standing still. */
export function standingHeight(body: EntityBody) {
  const hip = restHip(body);
  return hip + body.torso * Math.cos(body.hunch) + Math.max(...body.heads.map(head =>
    (head.neck + headTop(head)) * Math.cos(head.splay + body.hunch * 0.2)));
}

export const restHip = (body: EntityBody) => Math.min(...body.legs) * 2 + 0.03;

/** One of many malformed relatives: proportions drift, parts repeat or wither. */
export function rollEntityBody(variant: EntityVariant, seed: number): EntityBody {
  if (!seed) return canonicalBody(variant);
  const rng = random(seed ^ 0x626f6479);
  const range = (min: number, max: number) => min + rng() * (max - min);
  const chance = (p: number) => rng() < p;
  const pick = <T>(items: readonly T[]) => items[Math.floor(rng() * items.length)];
  const leg = range(0.6, 0.73);
  const legs: [number, number] = [leg, leg];
  // A shorter leg forces a limp: the longer one stays bent through stance.
  if (chance(0.22)) legs[chance(0.5) ? 0 : 1] -= range(0.035, 0.07);
  const hands: HandKind[] = ["long", "long", "splay", "claw", "twig", "mitten"];
  const hand = pick(hands);
  const upper = range(0.56, 0.7), fore = range(0.66, 0.88), palm = range(0.85, 1.3);
  const arms: [EntityArm, EntityArm] = [0, 1].map(() => ({
    upper: upper * range(0.97, 1.03), fore: fore * range(0.97, 1.03),
    hand, palm: palm * range(0.95, 1.05), droop: 0,
  })) as [EntityArm, EntityArm];
  if (chance(0.2)) arms[chance(0.5) ? 0 : 1].hand = pick(hands);
  if (chance(0.3)) {
    // One arm has kept growing; its shoulder sags under the weight.
    const long = arms[chance(0.5) ? 0 : 1];
    const growth = range(1.18, 1.42);
    long.upper *= growth;
    long.fore *= growth;
    long.palm *= range(1, 1.2);
    long.droop = range(0.03, 0.08);
  }
  const heads: EntityHead[] = [];
  if (variant === "pyramid") {
    heads.push({ kind: "pyramid", size: range(0.88, 1.08), stretch: 1, neck: range(0.12, 0.22), splay: 0, tilt: range(-0.12, 0.12) });
  } else {
    const kinds: HeadKind[] = ["skull", "skull", "bulb", "long", "jaw", "jaw", "pin", "slab"];
    const kind = pick(kinds);
    const twin = chance(0.2);
    heads.push({
      kind,
      size: kind === "pin" ? range(0.8, 1.1) : range(0.85, 1.18),
      stretch: range(0.88, 1.2),
      neck: kind === "pin" ? range(0.24, 0.4) : range(0.1, 0.3),
      splay: twin ? range(0.22, 0.4) : 0,
      tilt: chance(0.35) ? range(0.12, 0.34) * (chance(0.5) ? -1 : 1) : range(-0.06, 0.06),
    });
    if (twin) {
      // The second head is always the lesser one: smaller, often different.
      const other = chance(0.55) ? kind : pick(kinds);
      heads.push({
        kind: other,
        size: heads[0].size * range(0.62, 0.92),
        stretch: range(0.88, 1.15),
        neck: range(0.1, 0.26),
        splay: -range(0.25, 0.48),
        tilt: range(0.1, 0.4) * (chance(0.5) ? -1 : 1),
      });
    }
  }
  const build = range(0.85, 1.28);
  const body: EntityBody = {
    seed,
    legs,
    torso: range(0.74, 1.02),
    build,
    limbs: range(0.86, 1.32),
    shoulders: range(0.21, 0.29) * Math.sqrt(build),
    hunch: chance(0.35) ? range(0.12, 0.36) : range(0, 0.07),
    lean: range(-0.07, 0.07),
    belly: chance(0.28) ? range(0.45, 1) : range(0, 0.2),
    spine: range(0.2, 1),
    arms,
    heads,
  };
  fitEntityBody(body);
  return body;
}

/** Shrinks the trunk and necks under the ceiling, and lifts hands off the floor. */
function fitEntityBody(body: EntityBody) {
  for (let pass = 0; pass < 8 && standingHeight(body) > MAX_HEIGHT; pass++) {
    const excess = standingHeight(body) - MAX_HEIGHT;
    const trim = Math.min(excess, body.torso - 0.7);
    body.torso -= trim;
    if (excess - trim > 0) for (const head of body.heads) head.neck = Math.max(0.06, head.neck - (excess - trim));
  }
  const shoulder = restHip(body) + body.torso * Math.cos(body.hunch);
  for (const arm of body.arms) {
    const room = shoulder - arm.droop - LOWEST_HAND - handLength(arm);
    const reach = arm.upper + arm.fore;
    if (reach > room) {
      arm.upper *= room / reach;
      arm.fore *= room / reach;
    }
  }
}
