import { FCurve } from '../data/types'
import { recalcAllHandles } from './handles'

/**
 * Port of clean_fcurve (editors/animation/keyframes_general.cc:101).
 * Drops keys that match both their last-kept predecessor and raw successor
 * within `threshold` (i.e. add no information about curve shape). First key
 * is always kept; last key kept unless it matches its predecessor.
 */
export function cleanFCurve (fcu: FCurve, threshold: number = 1e-4): number {
  const n = fcu.bezt.length
  if (n < 2) return 0

  const kept: number[] = [0]
  let removed = 0

  for (let i = 1; i < n; i++) {
    const prevV = fcu.bezt[kept[kept.length - 1]].vec[1][1]
    const curV = fcu.bezt[i].vec[1][1]
    const isLast = i === n - 1
    const matchesPrev = Math.abs(curV - prevV) <= threshold
    if (isLast) {
      if (matchesPrev) removed++
      else kept.push(i)
    } else {
      const nextV = fcu.bezt[i + 1].vec[1][1]
      const matchesNext = Math.abs(curV - nextV) <= threshold
      if (matchesPrev && matchesNext) removed++
      else kept.push(i)
    }
  }

  if (removed === 0) return 0

  fcu.bezt = kept.map((i) => fcu.bezt[i])
  recalcAllHandles(fcu)
  return removed
}
