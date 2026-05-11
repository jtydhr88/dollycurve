# Changelog

## 0.3.0 — 2026-05-10

### Spline edit mode (3D path editor)

A new sidebar mode for editing the camera path directly as a 3D bezier spline. Entry/exit is data-driven — `Fit → Path` enters and `Bake → FCurves` exits; the editor auto-engages on workspace restore if `action.pathFollow` is set.

- **`Fit → Path`** defaults to one spline anchor per existing keyframe (no resampling). Each anchor's `h1` / `h2` come from reading the source FCurve `bezt` handles directly (`useFCurveHandles: true` option on `fitFCurvesToPath`) so the spline preserves the FCurve shape on entry. A blank `resample` input keeps the 1:1 mapping; setting a number switches to the legacy uniform resample.
- **`Bake → FCurves`** is the symmetric inverse. Default writes one keyframe per anchor with BEZIER interpolation; the location FCurve bezt handles mirror the spline's 3D h1/h2 per axis, rotation FCurves use AUTO_CLAMPED with `recalcAllHandles`. Output goes to `rotation_euler` (XYZ order) to match the rest of the keyframe baseline. A "Look at center" checkbox (default on) swaps `pathFollow.orientation` to `lookAt` before sampling so the camera stays framed on `action.metadata.subjectTarget` (or world origin) instead of following the path tangent.

### Per-handle types on `SplinePoint`

`SplinePoint` now carries optional `h1Type` / `h2Type` fields (`AUTO`, `VECTOR`, `ALIGN`, `FREE`, `AUTO_CLAMPED`), mirroring Blender's BezTriple handle modes in 3D. Default behavior when omitted is `AUTO` so v0.2 JSON keeps parsing.

- **`V`** cycles the active anchor's handle type. `AUTO` and `VECTOR` re-snap the handle positions immediately; `ALIGN` and `FREE` keep current positions.
- **`Shift` while dragging a handle** inverts the align/free behavior for that drag — promotes a FREE opposite handle to mirror, suppresses the mirror on an ALIGN one. Mirrors Blender's pen-tool `FREE_ALIGN_TOGGLE`.
- New `src/spline/handles.ts`: `recalcSplineHandle`, `recalcAllSplineHandles`, `applyAlignAfterDrag`, `nextHandleType`.

### ScenePathEditor

- **Line2 / LineSegments2** rendering for the curve and handle bars so pixel widths actually take effect (`LineBasicMaterial.linewidth` is driver-capped to 1px on most platforms). 3px curve, 2px handle bars; `ResizeObserver` keeps `LineMaterial.resolution` in sync.
- **Ghost-on-curve insert preview** — hover the spline to see a translucent green ball; click inserts a new anchor at that segment+t. `pickSpline` returns a continuous sub-edge parameter so the ghost / inserted anchor doesn't snap to the polyline grid. Ctrl+click still works as a modifier alternative.
- **Active-anchor focus** — handle bars and dots fade to 0.25 / 0.35 opacity for inactive anchors; the active anchor's pair is redrawn at full opacity on a `renderOrder 999.5` overlay so the control cluster reads cleanly even on a dense path.
- **New editor ops**: `cycleActiveHandleType`, `toggleClosed` (Alt+C), `extrudeFromActiveEndpoint` (E), `switchDirection` (F), `dissolvePoint` (Ctrl+X), `setPointTilt` (sidebar input + Alt+T clear).
- **`onCommit?: (label) => void` callback** plumbed through every public mutator (drag release, insert, delete, dissolve, V cycle, extrude, tilt, etc.) so the host can push undo steps with descriptive labels.

### Library API

- `fitFCurvesToPath` `useFCurveHandles` option (default true) — read each axis's bezt handles directly to compose 3D h1/h2 instead of approximating with central finite differences.
- `bakePathToFCurves` `useSplineAnchors` option — schedule one keyframe per spline anchor by inverting the speedCurve at each anchor's arc-length position. Position values come from `anchor.co` directly (binding eval can drift by inverse-tolerance amounts).
- `SplinePoint` h1Type / h2Type round-trip through `blender-json` (AUTO is omitted to keep v0.2 readers happy).

### Playground viewport additions

- **Picture-in-picture preview** of the camera-cam in the bottom-right corner, rendered into the same canvas via scissor+viewport; toolbar PiP checkbox persists with the other view-mode controls.
- **Bottom-left ViewHelper** (from three's examples) for orbit-cam axis orientation with click-to-snap; `autoClear` toggled around its render so it doesn't wipe the main color buffer.
- `previewCamHelper` and the transform gizmo auto-hide while the path camera takes the full view or the PiP region renders.

### Known limitations

- The ghost-on-curve preview can sit a few pixels off the cursor on highly-curved or near-camera-aligned segments — the polyline rendering and the bezier eval diverge slightly under those conditions.
- Multi-anchor / box select still TBD; all spline edit ops act on the single active anchor.

## 0.2.0 — 2026-05-09

### Algorithmic correctness fixes

- **CONTINUOUS_ACCELERATION smooth pass** (`curve.cc:3897 BKE_nurb_handle_smooth_fcurve`). When `autoSmoothing === 'continuous_acceleration'`, after the per-key first-pass handle calc, dollycurve now runs Blender's full tridiagonal linear system (Thomas algorithm + cyclic Sherman-Morrison) to eliminate second-derivative discontinuities at every interior AUTO/AUTO_ANIM keyframe. Sub-sequence detection (split at VECTOR / locked-final points) and cyclic boundary handling match Blender bit-for-bit.
- **Cycles-aware AUTO handles** (`fcurve.cc:1162-1225`). When the first F-modifier is Cycles with infinite count and both `before`/`after` are in `{REPEAT, REPEAT_OFFSET}`, the boundary keys' AUTO handles now use wrap-around neighbors so velocity is continuous across the loop seam. Previously every cycle had a visible "hiccup" at the boundary.
- **Edge ease no longer triggers in cyclic mode** — the CONSTANT-extrap horizontal flatten on first/last keys is suppressed when the curve is treated as cyclic, since the wrap-around already provides the right slope.

### F-Modifier pipeline

- **`muted` and `influence` fields** on every modifier (`fmodifier.cc:1443-1488`). `muted=true` or `influence=0` skips the modifier entirely (both time and value passes). Influence between 0..1 blends the value-pass output with the pre-pass value via `interpf`.
- **JSON round-trip** preserves `muted`/`influence`. Backward-compatible with v0.1 JSON: absent fields default to neutral (`muted=false`, `influence=1`).

### New: Noise modifier (`fmodifier.cc:798-883`)

Procedural Perlin-fbm noise overlay. Use for handheld camera shake, organic drift, breathing motion, etc.

```ts
import { makeNoiseModifier } from 'dollycurve'

fcu.modifiers.push(makeNoiseModifier({
  modification: 'add',  // 'replace' | 'add' | 'sub' | 'mul'
  size: 4,              // wavelength in frames
  strength: 0.05,       // amplitude (in the channel's native units)
  phase: 7.3,           // per-channel seed; different phases = uncorrelated noise
  depth: 2,             // octaves (0 = single octave)
  lacunarity: 2,        // frequency multiplier per octave
  roughness: 0.5,       // amplitude multiplier per octave
}))
```

### FCurve flags: muted and locked

- **`muted`** (FCURVE_MUTED): evaluator returns 0; the curve is dormant. Toggle in the channel list ("M" icon).
- **`locked`** (FCURVE_PROTECTED): edit ops (drag, delete, insert, cycle handle/interp) refuse to mutate the curve. Toggle in the channel list ("L" icon).
- Both flags round-trip through JSON.

### Editor UX

- **Channel groups**: Graph Editor channel list now groups fcurves under `Transform`, `Lens`, `Clipping`, `Depth of Field`, etc. Click a group header to collapse/expand.
- **Mute / lock toggles** in the channel list, between the visibility eye and the channel name.
- **Column highlight** (Shift+K): mark frames of currently-selected anchors so you can see what other channels have keys at those frames. Drag still affects only the active channel — multi-fcurve column drag will land in v0.3.

### Known limitations / deferred to v0.3

- Multi-FCurve selection / column drag — Shift+K marks the column visually but doesn't yet let you drag keys across multiple channels at once.
- Limits modifier and other secondary F-modifiers.

## 0.1.0 — 2026-05-08

Initial release. Eval engine, editing API, Three.js binding, Blender JSON I/O, Graph Editor, Timeline, Python addon.
