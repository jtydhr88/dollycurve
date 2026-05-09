import { FCurve } from '../data/types'
import { evaluateFCurve } from '../eval/evaluate'
import { recalcAllHandles } from './handles'

export interface DecimateOptions {
  /** Fraction of removable keys (excluding first/last) to drop. Default 0. */
  removeRatio?: number
  /** Max acceptable absolute deviation per sample after removal. Default Infinity. */
  errorMax?: number
  /** Curve samples used to score each candidate's removal cost. Default 12. */
  scoreSampleCount?: number
}

/**
 * Iterative-removal decimator approximating BKE_curve_decimate_bezt_array.
 * Greedy-removes the cheapest key until target count is reached or the next
 * cheapest exceeds errorMax. First and last keys are always preserved.
 */
export function decimateFCurve (fcu: FCurve, opts: DecimateOptions = {}): number {
  const removeRatio = opts.removeRatio ?? 0
  const errorMax = opts.errorMax ?? Infinity
  const samples = opts.scoreSampleCount ?? 12

  const total = fcu.bezt.length
  if (total < 3) return 0

  const removable = total - 2
  const targetRemovals = Math.max(0, Math.floor(removable * removeRatio))
  let removed = 0

  while (true) {
    if (fcu.bezt.length < 3) break
    let bestIdx = -1
    let bestErr = Infinity

    for (let i = 1; i < fcu.bezt.length - 1; i++) {
      const err = scoreRemoval(fcu, i, samples)
      if (err < bestErr) {
        bestErr = err
        bestIdx = i
      }
    }

    if (bestIdx < 0) break
    if (removed >= targetRemovals || bestErr > errorMax) break

    fcu.bezt.splice(bestIdx, 1)
    recalcAllHandles(fcu)
    removed++
  }

  return removed
}

function scoreRemoval (fcu: FCurve, idx: number, sampleCount: number): number {
  const prev = fcu.bezt[idx - 1]
  const next = fcu.bezt[idx + 1]
  const a = prev.vec[1][0]
  const b = next.vec[1][0]
  if (b - a <= 0) return Infinity

  const originals: number[] = []
  for (let i = 0; i <= sampleCount; i++) {
    const t = a + (b - a) * (i / sampleCount)
    originals.push(evaluateFCurve(fcu, t))
  }

  const removed = fcu.bezt.splice(idx, 1)[0]
  recalcPair(fcu, idx - 1)

  let maxErr = 0
  for (let i = 0; i <= sampleCount; i++) {
    const t = a + (b - a) * (i / sampleCount)
    maxErr = Math.max(maxErr, Math.abs(evaluateFCurve(fcu, t) - originals[i]))
  }

  fcu.bezt.splice(idx, 0, removed)
  recalcPair(fcu, idx)
  return maxErr
}

import { recalcHandle } from './handles'
function recalcPair (fcu: FCurve, anchorIdx: number): void {
  for (let i = anchorIdx - 1; i <= anchorIdx + 1; i++) {
    if (i < 0 || i >= fcu.bezt.length) continue
    const prev = i > 0 ? fcu.bezt[i - 1] : null
    const next = i < fcu.bezt.length - 1 ? fcu.bezt[i + 1] : null
    recalcHandle(fcu, fcu.bezt[i], prev, next)
  }
}
