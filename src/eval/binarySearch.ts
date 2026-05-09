import { BezTriple } from '../data/types'

export interface BezSearchResult {
  idx: number
  exact: boolean
}

// Port of BKE_fcurve_bezt_binarysearch_index_ex (fcurve.cc).
// Returns the index of the first BezTriple whose anchor time is >= frame.
// `threshold` is for "close-enough = exact" (Blender uses 0.0001 for eval).
export function bezBinarySearch (
  bezt: BezTriple[],
  frame: number,
  threshold: number = 0.0001,
): BezSearchResult {
  const n = bezt.length
  if (n === 0) return { idx: 0, exact: false }
  if (frame < bezt[0].vec[1][0] - threshold) return { idx: 0, exact: false }
  if (frame > bezt[n - 1].vec[1][0] + threshold) return { idx: n, exact: false }

  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const t = bezt[mid].vec[1][0]
    if (Math.abs(t - frame) <= threshold) return { idx: mid, exact: true }
    if (t < frame) lo = mid + 1
    else hi = mid
  }
  return { idx: lo, exact: false }
}
