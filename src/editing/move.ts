import { BezTriple, FCurve } from '../data/types'
import { recalcAllHandles, recalcHandle } from './handles'
import { sortFCurve } from './sort'

/**
 * Port of BKE_fcurve_keyframe_move_time_with_handles (fcurve.cc:835).
 * Both handles ride along by the same delta so local shape is preserved.
 */
export function moveKeyframeTimeWithHandles (bezt: BezTriple, newTime: number): void {
  const dt = newTime - bezt.vec[1][0]
  bezt.vec[0][0] += dt
  bezt.vec[1][0] = newTime
  bezt.vec[2][0] += dt
}

/** Port of BKE_fcurve_keyframe_move_value_with_handles (fcurve.cc:843). */
export function moveKeyframeValueWithHandles (bezt: BezTriple, newValue: number): void {
  const dv = newValue - bezt.vec[1][1]
  bezt.vec[0][1] += dv
  bezt.vec[1][1] = newValue
  bezt.vec[2][1] += dv
}

/**
 * Move key at `idx` to `(newTime, newValue?)`. Handles ride along; if order
 * changed, re-sort and recompute all handles, else just the neighborhood.
 */
export function moveKeyframe (
  fcu: FCurve,
  idx: number,
  newTime: number,
  newValue?: number,
): { newIndex: number; reordered: boolean } {
  const bezt = fcu.bezt[idx]
  moveKeyframeTimeWithHandles(bezt, newTime)
  if (newValue !== undefined) moveKeyframeValueWithHandles(bezt, newValue)

  if (needsReorder(fcu, idx)) {
    sortFCurve(fcu)
    recalcAllHandles(fcu)
    return { newIndex: fcu.bezt.indexOf(bezt), reordered: true }
  }
  for (let i = idx - 1; i <= idx + 1; i++) {
    if (i < 0 || i >= fcu.bezt.length) continue
    const prev = i > 0 ? fcu.bezt[i - 1] : null
    const next = i < fcu.bezt.length - 1 ? fcu.bezt[i + 1] : null
    recalcHandle(fcu, fcu.bezt[i], prev, next)
  }
  return { newIndex: idx, reordered: false }
}

function needsReorder (fcu: FCurve, idx: number): boolean {
  const bezts = fcu.bezt
  const t = bezts[idx].vec[1][0]
  if (idx > 0 && bezts[idx - 1].vec[1][0] > t) return true
  if (idx < bezts.length - 1 && bezts[idx + 1].vec[1][0] < t) return true
  return false
}
