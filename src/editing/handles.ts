import { AutoSmoothing, CycleMode, Extend, HandleType } from '../data/enums'
import { BezTriple, CyclesModifier, FCurve } from '../data/types'
import { smoothFCurve } from './smooth-fcurve'

// Port of calchandleNurb_intern (curve.cc:3067-3305) plus the edge-ease +
// X-clamp pre-pass from BKE_fcurve_handles_recalc_ex (fcurve.cc:1149).

const MAGIC = 2.5614
const SMOOTH_FACTOR = 6 / MAGIC
const X_CLAMP_THRESHOLD = 0.001

function isAuto (h: HandleType): boolean {
  return h === HandleType.AUTO || h === HandleType.AUTO_CLAMPED
}
function isAlign (h: HandleType): boolean {
  return h === HandleType.ALIGN
}

// Without this, dragging a handle onto the anchor would set its X to anchor.x,
// then the auto-handle algorithm would divide by zero. Port of fcurve.cc:1190-1193.
function clampHandleX (bezt: BezTriple): void {
  const a = bezt.vec[1][0]
  if (bezt.vec[0][0] > a - X_CLAMP_THRESHOLD) bezt.vec[0][0] = a - X_CLAMP_THRESHOLD
  if (bezt.vec[2][0] < a + X_CLAMP_THRESHOLD) bezt.vec[2][0] = a + X_CLAMP_THRESHOLD
}

/** Returns true when the AUTO_CLAMPED clamp branch fired (local-extreme
 * flatten OR slope-mirror violation correction). The smooth pass needs
 * to know this — clamped points are treated as fixed (HD_AUTOTYPE_LOCKED_FINAL
 * in Blender) and skipped from the linear system. */
export function recalcHandle (
  fcu: FCurve,
  bezt: BezTriple,
  prev: BezTriple | null,
  next: BezTriple | null,
): boolean {
  if (bezt.h1 === HandleType.FREE && bezt.h2 === HandleType.FREE) {
    clampHandleX(bezt)
    return false
  }
  if (prev === null && next === null) return false

  clampHandleX(bezt)

  const p2x = bezt.vec[1][0]
  const p2y = bezt.vec[1][1]

  let p1x: number, p1y: number
  if (prev === null) {
    p1x = 2 * p2x - next!.vec[1][0]
    p1y = 2 * p2y - next!.vec[1][1]
  } else {
    p1x = prev.vec[1][0]
    p1y = prev.vec[1][1]
  }
  let p3x: number, p3y: number
  if (next === null) {
    p3x = 2 * p2x - prev!.vec[1][0]
    p3y = 2 * p2y - prev!.vec[1][1]
  } else {
    p3x = next.vec[1][0]
    p3y = next.vec[1][1]
  }

  const dvec_a_x = p2x - p1x
  const dvec_a_y = p2y - p1y
  const dvec_b_x = p3x - p2x
  const dvec_b_y = p3y - p2y

  let len_a = dvec_a_x || 1
  let len_b = dvec_b_x || 1

  let leftviolate = false
  let rightviolate = false
  let localExtreme = false

  if (isAuto(bezt.h1) || isAuto(bezt.h2)) {
    const tvec_x = dvec_b_x / len_b + dvec_a_x / len_a
    const tvec_y = dvec_b_y / len_b + dvec_a_y / len_a

    let len: number
    if (fcu.autoSmoothing === AutoSmoothing.CONTINUOUS_ACCELERATION) {
      len = SMOOTH_FACTOR
    } else {
      len = tvec_x
    }
    len *= MAGIC

    if (len !== 0 && fcu.autoSmoothing === AutoSmoothing.NONE) {
      len_a = Math.min(len_a, 5 * len_b)
      len_b = Math.min(len_b, 5 * len_a)
    }

    if (len !== 0) {
      if (isAuto(bezt.h1)) {
        const f = -len_a / len
        bezt.vec[0][0] = p2x + tvec_x * f
        bezt.vec[0][1] = p2y + tvec_y * f

        // AUTO_CLAMPED clamp branch (curve.cc:3169-3189).
        if (bezt.h1 === HandleType.AUTO_CLAMPED && prev !== null && next !== null) {
          const ydiff1 = prev.vec[1][1] - p2y
          const ydiff2 = next.vec[1][1] - p2y
          if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
            bezt.vec[0][1] = p2y  // local extreme → flatten
            localExtreme = true
          } else if (ydiff1 <= 0) {
            if (prev.vec[1][1] > bezt.vec[0][1]) {
              bezt.vec[0][1] = prev.vec[1][1]
              leftviolate = true
            }
          } else {
            if (prev.vec[1][1] < bezt.vec[0][1]) {
              bezt.vec[0][1] = prev.vec[1][1]
              leftviolate = true
            }
          }
        }
      }
      if (isAuto(bezt.h2)) {
        const f = len_b / len
        bezt.vec[2][0] = p2x + tvec_x * f
        bezt.vec[2][1] = p2y + tvec_y * f

        if (bezt.h2 === HandleType.AUTO_CLAMPED && prev !== null && next !== null) {
          const ydiff1 = prev.vec[1][1] - p2y
          const ydiff2 = next.vec[1][1] - p2y
          if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
            bezt.vec[2][1] = p2y
            localExtreme = true
          } else if (ydiff1 <= 0) {
            if (next.vec[1][1] < bezt.vec[2][1]) {
              bezt.vec[2][1] = next.vec[1][1]
              rightviolate = true
            }
          } else {
            if (next.vec[1][1] > bezt.vec[2][1]) {
              bezt.vec[2][1] = next.vec[1][1]
              rightviolate = true
            }
          }
        }
      }

      // Violation correction (curve.cc:3219-3231): mirror the clamped side's
      // slope through the anchor so handles stay aligned through p2.
      if (leftviolate || rightviolate) {
        const h1_x = bezt.vec[0][0] - p2x
        const h2_x = p2x - bezt.vec[2][0]
        if (leftviolate && h1_x !== 0) {
          bezt.vec[2][1] = p2y + ((p2y - bezt.vec[0][1]) / h1_x) * h2_x
        } else if (rightviolate && h2_x !== 0) {
          bezt.vec[0][1] = p2y + ((p2y - bezt.vec[2][1]) / h2_x) * h1_x
        }
      }
    }
  }

  if (bezt.h1 === HandleType.VECTOR) {
    bezt.vec[0][0] = p2x - dvec_a_x / 3
    bezt.vec[0][1] = p2y - dvec_a_y / 3
  }
  if (bezt.h2 === HandleType.VECTOR) {
    bezt.vec[2][0] = p2x + dvec_b_x / 3
    bezt.vec[2][1] = p2y + dvec_b_y / 3
  }

  const lockedFinal = leftviolate || rightviolate || localExtreme

  // ALIGN reflection (curve.cc:3242-3301). Skip when any handle is FREE.
  if (bezt.h1 === HandleType.FREE || bezt.h2 === HandleType.FREE) return lockedFinal
  if (!isAlign(bezt.h1) && !isAlign(bezt.h2)) return lockedFinal

  const h1dx = bezt.vec[0][0] - p2x
  const h1dy = bezt.vec[0][1] - p2y
  const h2dx = bezt.vec[2][0] - p2x
  const h2dy = bezt.vec[2][1] - p2y
  const len_h1 = Math.hypot(h1dx, h1dy) || 1
  const len_h2 = Math.hypot(h2dx, h2dy) || 1
  const ratio = len_h1 / len_h2
  const eps = 1e-5

  if (isAlign(bezt.h2) && len_h1 > eps) {
    const f = 1 / ratio
    bezt.vec[2][0] = p2x + f * (p2x - bezt.vec[0][0])
    bezt.vec[2][1] = p2y + f * (p2y - bezt.vec[0][1])
  }
  if (isAlign(bezt.h1) && len_h2 > eps) {
    const f = ratio
    bezt.vec[0][0] = p2x + f * (p2x - bezt.vec[2][0])
    bezt.vec[0][1] = p2y + f * (p2y - bezt.vec[2][1])
  }
  return lockedFinal
}

// Flatten first/last AUTO handles to horizontal under CONSTANT extend so the
// curve doesn't lean past the boundary. Port of fcurve.cc:1199-1209. Returns
// true when the flatten ran (point becomes locked-final for the smooth pass).
function applyEdgeEase (fcu: FCurve, idx: number): boolean {
  if (fcu.extend !== Extend.CONSTANT) return false
  if (idx !== 0 && idx !== fcu.bezt.length - 1) return false
  const bezt = fcu.bezt[idx]
  if (!isAuto(bezt.h1) && !isAuto(bezt.h2)) return false
  bezt.vec[0][1] = bezt.vec[1][1]
  bezt.vec[2][1] = bezt.vec[1][1]
  return true
}

// Curve treated as cyclic for AUTO-handle smoothing iff the first modifier
// is an unmuted Cycles with infinite count, both before/after in {REPEAT,
// REPEAT_OFFSET}, and the boundary keys both have AUTO/AUTO_CLAMPED handles.
// Mirrors BKE_fcurve_get_cycle_type at fcurve.cc:1086-1119.
function cyclicForHandles (fcu: FCurve): CyclesModifier | null {
  const m = fcu.modifiers[0]
  if (!m || m.type !== 'cycles' || m.muted) return null
  if (m.beforeCount !== 0 || m.afterCount !== 0) return null
  const ok = (mode: CycleMode) => mode === CycleMode.REPEAT || mode === CycleMode.REPEAT_OFFSET
  if (!ok(m.before) || !ok(m.after)) return null
  const bezts = fcu.bezt
  if (bezts.length < 2) return null
  const first = bezts[0]
  const last = bezts[bezts.length - 1]
  if (!isAuto(first.h1) || !isAuto(first.h2)) return null
  if (!isAuto(last.h1) || !isAuto(last.h2)) return null
  return m
}

// Port of cycle_offset_triple (fcurve.cc:1126-1146): shift `in` by
// (to.anchor - from.anchor) so it lives in the previous or next cycle window.
// Returns a fresh BezTriple — does NOT mutate `inBz`.
function cycleOffsetTriple (inBz: BezTriple, from: BezTriple, to: BezTriple): BezTriple {
  const dx = to.vec[1][0] - from.vec[1][0]
  const dy = to.vec[1][1] - from.vec[1][1]
  return {
    ...inBz,
    vec: [
      [inBz.vec[0][0] + dx, inBz.vec[0][1] + dy],
      [inBz.vec[1][0] + dx, inBz.vec[1][1] + dy],
      [inBz.vec[2][0] + dx, inBz.vec[2][1] + dy],
    ],
  }
}

function neighborsFor (fcu: FCurve, idx: number, cyclic: boolean): { prev: BezTriple | null; next: BezTriple | null } {
  const bezts = fcu.bezt
  const N = bezts.length
  let prev: BezTriple | null = idx > 0 ? bezts[idx - 1] : null
  let next: BezTriple | null = idx < N - 1 ? bezts[idx + 1] : null
  if (cyclic && N >= 2) {
    if (idx === 0)     prev = cycleOffsetTriple(bezts[N - 2], bezts[N - 1], bezts[0])
    if (idx === N - 1) next = cycleOffsetTriple(bezts[1],     bezts[0],     bezts[N - 1])
  }
  return { prev, next }
}

/** Recompute handles for the given index and its immediate neighbors. */
export function recalcHandlesAround (fcu: FCurve, idx: number): void {
  // For local recalc we just need correct first-pass handles around idx.
  // The global smooth pass needs the WHOLE curve, so re-run all-handles
  // when the user has continuous_acceleration enabled — touching one key
  // perturbs the linear system globally.
  if (fcu.autoSmoothing === AutoSmoothing.CONTINUOUS_ACCELERATION) {
    recalcAllHandles(fcu)
    return
  }
  const bezts = fcu.bezt
  const cyclic = cyclicForHandles(fcu) !== null
  for (let i = idx - 1; i <= idx + 1; i++) {
    if (i < 0 || i >= bezts.length) continue
    const { prev, next } = neighborsFor(fcu, i, cyclic)
    recalcHandle(fcu, bezts[i], prev, next)
    if (!cyclic) applyEdgeEase(fcu, i)
  }
}

export function recalcAllHandles (fcu: FCurve): void {
  const bezts = fcu.bezt
  const cyclic = cyclicForHandles(fcu) !== null
  const lockedFinal: boolean[] = new Array(bezts.length).fill(false)
  for (let i = 0; i < bezts.length; i++) {
    const { prev, next } = neighborsFor(fcu, i, cyclic)
    const clamped = recalcHandle(fcu, bezts[i], prev, next)
    if (clamped) lockedFinal[i] = true
    if (!cyclic) {
      const eased = applyEdgeEase(fcu, i)
      if (eased) lockedFinal[i] = true
    }
  }

  // Cyclic-symmetry pass (fcurve.cc:1222-1228): if either endpoint clamped,
  // flatten BOTH endpoints' handles to keep the loop seam smooth.
  if (cyclic && bezts.length >= 2 && (lockedFinal[0] || lockedFinal[bezts.length - 1])) {
    const first = bezts[0]
    const last = bezts[bezts.length - 1]
    first.vec[0][1] = first.vec[2][1] = first.vec[1][1]
    last.vec[0][1]  = last.vec[2][1]  = last.vec[1][1]
    lockedFinal[0] = true
    lockedFinal[bezts.length - 1] = true
  }

  // Second pass for AUTO smoothing: solve a tridiagonal linear system
  // making the second derivative continuous everywhere.
  if (fcu.autoSmoothing !== AutoSmoothing.NONE) {
    smoothFCurve(fcu, lockedFinal, cyclic)
  }
}
