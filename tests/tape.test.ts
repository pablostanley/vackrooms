import assert from "node:assert/strict";
import test from "node:test";
import { nextTape, parseTape, tapeUrl } from "../src/lib/game/tape";

test("old tape URLs remain v1 while new recordings default to v2", () => {
  const parse = (query: string) => parseTape(new URLSearchParams(query), () => 456789);
  assert.deepEqual(parse("tape=199307"), { seed: 199307, generation: 1 });
  assert.deepEqual(parse("tape=0"), { seed: 0, generation: 1 });
  assert.deepEqual(parse(""), { seed: 456789, generation: 2 });
  for (const invalid of ["", "abc", "-1", "1000000000", "1.5"])
    assert.deepEqual(parse(`tape=${invalid}`), { seed: 456789, generation: 2 });
  assert.deepEqual(parse("tape=199307&generation=2"), { seed: 199307, generation: 2 });
  assert.deepEqual(parse("generation=1"), { seed: 456789, generation: 1 });
  for (const unsupported of ["", "3", "02", "latest", "-1"])
    assert.equal(parse(`tape=199307&generation=${unsupported}`).generation, 1);
  assert.equal(parse("generation=999").generation, 1);
  parseTape(new URLSearchParams("tape=123"), () => { throw Error("valid tape must not consume random seed"); });
});

test("copied and compatible-camera URLs preserve seed, version and other parameters", () => {
  for (const generation of [1, 2] as const)
    for (const seed of [0, 199307]) {
      const tape = { seed, generation };
      const url = tapeUrl("https://vackrooms.vercel.app/?visit=poolroom&renderer=webgpu#recording", tape);
      assert.equal(url.searchParams.get("visit"), "poolroom");
      assert.equal(url.hash, "#recording");
      assert.deepEqual(parseTape(url.searchParams, () => 999), tape);
      url.searchParams.set("renderer", "webgl");
      assert.deepEqual(parseTape(url.searchParams, () => 999), tape);
    }
});

test("next-life tape links preserve generation through repeated death and reload", () => {
  for (const generation of [1, 2] as const) {
    let tape = { seed: 199307, generation };
    for (let life = 0; life < 5; life++) {
      const next = nextTape(tape);
      assert.notEqual(next.seed, tape.seed);
      assert.equal(next.generation, generation);
      assert.deepEqual(nextTape(tape), next);
      tape = parseTape(tapeUrl("https://vackrooms.vercel.app/", next).searchParams, () => 999);
      assert.deepEqual(tape, next);
    }
  }
});
