# WebGL tone-mapping regression

`webgl-tone.ts` runs the actual game renderer in a browser, compares readback
against its direct-render reference, toggles quality/contact settings repeatedly,
and disposes every renderer and scene resource. A forced byte-target run checks
the no-float capability branch with an in-range color and neutral tape pass.
The normal run includes an HDR channel above 1 to catch premature clipping.
Both runs first render with tape and contact shadows requested, matching defaults.
The byte check keeps requesting contact shadows: the renderer must disable
unsupported GTAO automatically while preserving the tape pass. Byte targets
clip HDR values by design; the byte test does not claim HDR parity.

To run locally, temporarily create `src/app/tone-check/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { checkWebGLTone } from "../../../tests/browser/webgl-tone";
let task: Promise<unknown>;
export default function Check() {
  const [result, setResult] = useState("running");
  useEffect(() => {
    task ??= (async () => ({
      hdr: await checkWebGLTone(),
      byte: await checkWebGLTone(true),
    }))();
    void task.then(value => setResult(JSON.stringify(value)))
      .catch(error => setResult(String(error)));
  }, []);
  return <pre>{result}</pre>;
}
```

Open `/tone-check?renderer=webgl` on the dev server. Each run must return
`maxDifference <= 1` and 16 samples; any GL error fails. Run it in an isolated
browser page because the byte check temporarily intercepts extension discovery.
Remove the temporary route afterward; it is not a game interface or production page.

Verified in Chromium: before the repair, the same flat surface changed from
RGB `[170,193,246]` to `[118,179,255]` when contact shadows were enabled.
After the repair all 16 HDR permutations match exactly, and the 16 byte-target
permutations also match their direct reference exactly. This numerical check
complements visual checks of the bright fluorescent opening room.
