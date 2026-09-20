Always commit and push changes. Prefer a concise pull request for review.

Deployment: the Vercel project is `pablostanley/vackrooms` in Pabs' projects, production at vackrooms.vercel.app. Only share and verify `*-pablostanley.vercel.app` preview links, never `playground-vercel.tools`. A stale, inaccessible project in `vercel-internal-playground` is still git-connected to this repo; the `ignoreCommand` in `vercel.json` cancels its builds. Keep that guard until that project is deleted or disconnected.

Use the installed vgpu documentation as the API authority. Validate authored WGSL using `npm run check:shaders`; a Next.js build does not validate shaders. Keep gameplay client-side, deterministic by tape seed, and bounded in resident sections. Verify connectivity and matching boundary gates when changing generation. Use the real browser to check visual or interaction changes. Main office rooms should feel oppressively fluorescent and bright; the optional flashlight starts off.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Visual direction: bright fluorescent illumination with soft spatial shadows; sickly ochre, cream, or greenish yellow walls; restrained damp brown carpet; no natural blue hues. The one exception is the rare indoor neighborhood street, whose warehouse walls are painted sky blue. Avoid heavy grunge, contrasty lighting, and blacked-out main offices. Use Three.js PointerLockControls and Rapier character movement instead of custom player collision.

Interface: only the VHS camcorder HUD, no extra header, landing-page UI, promotional text, or commercial logos. Use Geist Mono for the HUD and Geist Sans for supporting settings text. No other font families. Scale HUD type, spacing, and marks together with the viewport. Keep interaction hints concise and contextual. Do not add tiled grid wall or floor themes.
