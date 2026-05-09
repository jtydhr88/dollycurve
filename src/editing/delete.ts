import { FCurve } from '../data/types'
import { recalcHandlesAround } from './handles'

/**
 * Port of BKE_fcurve_delete_key (fcurve.cc:1655). Removes the key and recomputes
 * handles for the now-adjacent neighbors so AUTO/AUTO_CLAMPED re-converge.
 */
export function deleteKeyframe (fcu: FCurve, idx: number): boolean {
  if (idx < 0 || idx >= fcu.bezt.length) return false
  fcu.bezt.splice(idx, 1)
  recalcHandlesAround(fcu, idx - 1)
  return true
}

export function deleteKeyframesAtFrames (
  fcu: FCurve,
  frames: number[],
  threshold: number = 1e-4,
): number {
  let deleted = 0
  // Descending so splicing doesn't shift indices we still need.
  const sorted = [...frames].sort((a, b) => b - a)
  for (const f of sorted) {
    const i = fcu.bezt.findIndex((b) => Math.abs(b.vec[1][0] - f) < threshold)
    if (i >= 0) {
      fcu.bezt.splice(i, 1)
      deleted++
    }
  }
  if (deleted > 0) {
    for (let i = 0; i < fcu.bezt.length; i++) recalcHandlesAround(fcu, i)
  }
  return deleted
}
