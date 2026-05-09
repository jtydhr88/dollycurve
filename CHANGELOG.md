# Changelog

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
