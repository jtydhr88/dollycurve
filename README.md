# dollycurve

A Blender-style F-Curve / camera path editor for the web. TypeScript + Three.js.

**Live demo:** https://jtydhr88.github.io/dollycurve

## What it does

`dollycurve` is a faithful port of [Blender's F-Curve animation engine](https://docs.blender.org/manual/en/latest/animation/fcurves/index.html) to TypeScript. It evaluates Bezier curves with per-handle types, ten Penner easing modes, and the Cycles modifier — the same interpolation Blender uses for camera animation. It ships with a canvas-based Graph Editor and Timeline that look and feel like Blender's, plus a Three.js binding that drives a `PerspectiveCamera` from FCurves.

You probably want this if Three.js's built-in `AnimationClip` (linear-only between keyframes) is too coarse for cinematic camera moves, and you don't want to hand-roll cubic-bezier evaluation, auto-handles, and segment-mode dispatch yourself.

## Install

```bash
npm install dollycurve three
```

`three` is an optional peer dependency — only required if you import the Three.js binding (`CameraTrackBinding`).

## Quick start

```ts
import * as THREE from 'three'
import {
  CameraTrackBinding,
  importCameraActionFromJson,
} from 'dollycurve'

const camera = new THREE.PerspectiveCamera()
const action = importCameraActionFromJson(jsonExportedFromBlender)
const binding = new CameraTrackBinding(camera, action)

// Each render frame:
binding.evaluate(timeInSeconds)
```

## Editor widgets

```ts
import { GraphEditor, Timeline } from 'dollycurve'

const timeline = new Timeline({
  host: document.getElementById('timeline-host')!,
  action,
  getCurrentFrame: () => currentFrame,
  setCurrentFrame: (f) => { currentFrame = f },
})

const graph = new GraphEditor({
  host: document.getElementById('graph-host')!,
  action,
  // ...
})
```

See [`playground/main.ts`](playground/main.ts) for a complete example.

## What's in the box

- **Eval engine** — `evaluateFCurve(fcu, frame)` with extrapolation modes, segment-mode dispatch, Cardano cubic solver for X-monotonic Bezier evaluation, all 10 Penner easings (BACK / BOUNCE / CIRC / CUBIC / ELASTIC / EXPO / QUAD / QUART / QUINT / SINE) with IN / OUT / IN_OUT variants.
- **Editing** — insert, delete, move (time + value with handles), auto-handle calculation (AUTO, AUTO_CLAMPED, VECTOR, ALIGN, FREE), bake, clean, decimate.
- **Modifiers** — Cycles (REPEAT / REPEAT_OFFSET / REPEAT_MIRROR, before/after, finite count).
- **Three.js binding** — `CameraTrackBinding` reads FCurves into `Object3D.position`, `quaternion` / `rotation`, `PerspectiveCamera.fov` (computed from `lens` + `sensor`), `near`, `far`, etc.
- **Editor widgets** — `GraphEditor` (canvas), `Timeline` (canvas), `SimplePanel` (DOM-table editor for users who don't want a graph).
- **I/O** — Blender JSON import/export (schema v1) + a Blender Python addon for capturing camera FCurves directly from `.blend` files.

## Why mirror Blender?

Three's built-in `AnimationClip` is linear or stepwise between adjacent keyframes (with a quaternion-aware variant for rotations). It cannot represent:

- Bezier handles per side per key — what makes a cinematic camera move feel smooth instead of robotic.
- Per-segment interpolation modes — Bezier on this section, Linear on the next, hold the one after.
- Easing libraries with parameters — back-overshoot, elastic-amplitude, bounce-count.
- Cyclic extrapolation with Y-offset — looping a 4-second orbit forever, shifted by `cycdy` per cycle.

Blender's animation model has been iterated for ~20 years. Cloning the data model and eval semantics gives import/export compatibility for free — you can read FCurves from a `.blend` (via the included Python addon) and replay them identically in the browser.

## Development

```bash
npm install
npm run dev          # serve playground
npm test             # run vitest
npm run build:lib    # build npm package to dist/
npm run build        # build playground site to dist/ (deployed to GitHub Pages)
```

## Source references

Every load-bearing algorithm in `src/eval/` and `src/editing/handles.ts` is annotated inline with the exact `fcurve.cc` / `curve.cc` / `easing.cc` / `fmodifier.cc` line where Blender does the same thing. Read the source comments alongside Blender's `blenkernel/intern/fcurve.cc` and `blenlib/intern/easing.cc` to follow the algorithms.

## License

MIT — see [LICENSE](LICENSE).
