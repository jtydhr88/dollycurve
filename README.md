# dollycurve

A Blender-style F-Curve / camera path editor for the web. TypeScript + Three.js.

**Live demo:** https://jtydhr88.github.io/dollycurve

## What it does

`dollycurve` is a faithful port of [Blender's F-Curve animation engine](https://docs.blender.org/manual/en/latest/animation/fcurves/index.html) to TypeScript. It evaluates Bezier curves with per-handle types, ten Penner easing modes, Cycles + Noise modifiers, and the same auto-handle math (with the full tridiagonal smooth-pass) Blender uses internally. It ships with a canvas-based Graph Editor and Timeline modeled on Blender's, a 3D path editor for spline-based camera moves, and a Three.js binding that drives a `PerspectiveCamera` directly from your animation data.

You probably want this if Three.js's built-in `AnimationClip` (linear-only between keyframes) is too coarse for cinematic camera moves, or if you want to author camera animation in the browser the same way you would in Blender — and round-trip it through `.blend` files.

## Install

```bash
npm install dollycurve three
```

`three` is an optional peer dependency — only required if you import the Three.js binding, the 3D path editor, or anything else under the `three/` / `editor/ScenePathEditor` paths. The pure eval / editing / I/O modules work without it.

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
import { GraphEditor, Timeline, SimplePanel } from 'dollycurve'

const timeline = new Timeline({
  container: document.getElementById('timeline-host')!,
  action,
  getCurrentFrame: () => currentFrame,
  setCurrentFrame: (f) => { currentFrame = f },
})

const graph = new GraphEditor({
  container: document.getElementById('graph-host')!,
  action,
  getCurrentFrame: () => currentFrame,
  onChanged: () => { /* refresh dependent UI */ },
  onCommit: (label) => { /* push undo step */ },
})
```

For 3D path editing in your own Three.js scene:

```ts
import { ScenePathEditor, makeSplinePath, makeSplinePoint } from 'dollycurve'

const path = makeSplinePath([
  makeSplinePoint([0, 0, 0],  [1, 0, 0]),
  makeSplinePoint([5, 0, 5],  [1, 0, 1]),
])

const editor = new ScenePathEditor(path, {
  scene, camera: viewportCam, dom: rendererCanvas, path,
  onChanged: () => { /* path was edited */ },
})
// Click a control point or handle to drag; X/Y/Z lock to axis;
// Shift+X/Y/Z lock to plane; Ctrl+click on the spline body inserts a
// new point via de Casteljau split; Esc / right-click cancels a drag.
```

See [`playground/main.ts`](playground/main.ts) for a complete demo wiring everything together (gizmo, undo, persistence).

## What's in the box

### Evaluation engine
- `evaluateFCurve(fcu, frame)` with extrapolation modes (CONSTANT / LINEAR), per-segment interpolation dispatch, Cardano cubic solver for X-monotonic Bezier evaluation, all 10 Penner easings (BACK / BOUNCE / CIRC / CUBIC / ELASTIC / EXPO / QUAD / QUART / QUINT / SINE) with IN / OUT / IN_OUT variants.
- F-Modifiers: **Cycles** (REPEAT / REPEAT_OFFSET / REPEAT_MIRROR, before/after, finite count) and **Noise** (Perlin-fbm with replace / add / sub / mul, size, strength, phase, octaves, lacunarity, roughness — handheld camera shake out of the box). Modifiers carry optional `muted` and `influence` fields with proper interpf blending.

### Editing API
- Insert / delete / move (time + value with handles).
- Auto-handle calculation: AUTO, AUTO_CLAMPED, VECTOR, ALIGN, FREE — including the **full** `BKE_nurb_handle_smooth_fcurve` tridiagonal smooth pass for `autoSmoothing: 'continuous_acceleration'` (matches Blender bit-for-bit, not the per-key length=6 approximation).
- **Cycles-aware AUTO handles** at boundary keys for cyclic curves (no velocity discontinuity at the loop seam).
- Bake (sample to per-frame keys), clean (drop near-redundant keys), decimate (Schneider-style fit-to-tolerance).
- `unwrapEulerInAction` and `alignQuaternionHemisphere` post-passes — fix the Euler 179°↔−179° wrap and quaternion sign-flip 360° spins respectively.

### 3D path follow
- `SplinePath` (3D Bezier with optional per-point tilt, closed/open, configurable resolution).
- `PathFollowConstraint` on `CameraAction.pathFollow` — when set, the spline drives camera position; tangent-aligned, lookAt, or fcurve-driven rotation; optional `speedCurve` for arc-length-uniform traversal; optional `tiltCurve` for time-varying banking.
- Parallel-transport orientation frames (no Frenet flips at zero-curvature points), with **cyclic seam-roll redistribution** so closed paths with non-zero torsion don't jolt at the loop boundary.
- `bakePathToFCurves` (path → discrete location/rotation FCurves) and `fitFCurvesToPath` (discrete keys → spline, best-effort) for round-tripping.

### Three.js binding
- `CameraTrackBinding` reads FCurves into `Object3D.position`, `quaternion` / `rotation`, `PerspectiveCamera.fov` (computed from `lens` + `sensor`), `near`, `far`. Quaternion path takes precedence over Euler when both are present. Path-follow integration: when `action.pathFollow` is set, the spline takes over location and (optionally) rotation; lens / clip / sensor FCurves still apply.

### Editor widgets
- `GraphEditor` (canvas) with channel groups, mute / lock / visibility per channel, drag/zoom/pan, multi-select, right-click context menu (Interpolation / Handle Type with active-state ✓), keyboard ops (T = cycle ipo, V = cycle handle, X = delete, A = select all, F / Shift+F = frame all/selected, Shift+K = column highlight). Out-of-range shading from `getFrameRange` callback. Shared X view with Timeline for synced pan/zoom.
- `Timeline` (canvas) with frame ruler, aggregated keyframe diamonds, draggable playhead, markers (drag/rename/delete via right-click), out-of-range shading.
- `SimplePanel` (DOM table editor) for users who want a flat list of keys per channel without a graph.
- `ScenePathEditor` (Three.js, in your scene) — render + raycast spline + control points, drag with axis/plane lock, Ctrl+click insert (de Casteljau split preserves curve shape and interpolates per-point tilt), keyboard or programmatic delete, Esc / right-click cancels mid-drag.
- `UndoStack<T>` — snapshot-per-command undo/redo with two-axis budget (steps + bytes) and KEEP_ONE baseline. Both `GraphEditor` and `SimplePanel` expose an `onCommit(label)` callback that fires once per user-intent boundary (drag commit, click, input change), suitable for direct wiring into the stack.

### I/O
- Blender JSON import/export (schema v1) covering FCurves, all modifier types, BezTriple handles, KeyType, plus pathFollow / SplinePath / metadata (markers, constraints, subjectTarget).
- Blender Python addon (`src/io/dollycurve_camera_export.py`) — drop into `Edit > Preferences > Add-ons > Install from disk`, exports the active camera's animation as JSON ready for `importCameraActionFromJson`.

## Why mirror Blender?

Three's built-in `AnimationClip` is linear or stepwise between adjacent keyframes (with a quaternion-aware variant for rotations). It cannot represent:

- Bezier handles per side per key — what makes a cinematic camera move feel smooth instead of robotic.
- Per-segment interpolation modes — Bezier on this section, Linear on the next, hold the one after.
- Easing libraries with parameters — back-overshoot, elastic-amplitude, bounce-count.
- Cyclic extrapolation with Y-offset — looping a 4-second orbit forever, shifted by `cycdy` per cycle.
- Procedural noise overlays.
- Spline-based path follow.

Blender's animation model has been iterated for ~20 years. Cloning the data model and eval semantics gives import/export compatibility for free — you can read FCurves from a `.blend` (via the included Python addon) and replay them identically in the browser.

## Development

```bash
npm install
npm run dev              # serve playground
npm test                 # run vitest
npm run build:lib        # build npm package to dist/
npm run build:playground # build demo site to dist-site/ (deployed to GitHub Pages)
```

## Source references

Every load-bearing algorithm in `src/eval/`, `src/editing/`, and `src/spline/` is annotated inline with the exact `fcurve.cc` / `curve.cc` / `easing.cc` / `fmodifier.cc` / `math_solvers.cc` / `anim_path.cc` line where Blender does the same thing. Read the source comments alongside Blender's `blenkernel/intern/` to follow the algorithms.

## License

MIT — see [LICENSE](LICENSE).
