import { nextLifeSeed } from "./encounter-effects";
import type { GenerationVersion } from "./generation";

export interface Tape {
  seed: number;
  generation: GenerationVersion;
}

/** Unversioned shared tapes remain legacy; new recordings use generation 2. */
export function parseTape(params: URLSearchParams, newSeed: () => number): Tape {
  const provided = params.get("tape");
  const valid = provided !== null && /^\d{1,9}$/.test(provided);
  const version = params.get("generation");
  return {
    seed: valid ? Number(provided) : newSeed(),
    // Unsupported explicit versions fall back to legacy, never the newest version.
    generation: version === null ? (valid ? 1 : 2) : version === "2" ? 2 : 1,
  };
}

export function tapeUrl(href: string, tape: Tape) {
  const url = new URL(href);
  url.searchParams.set("tape", String(tape.seed));
  url.searchParams.set("generation", String(tape.generation));
  return url;
}

export function nextTape(tape: Tape): Tape {
  return { ...tape, seed: nextLifeSeed(tape.seed) };
}
