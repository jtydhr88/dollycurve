import { FCurve } from '../data/types'

/**
 * Port of sort_time_fcurve (fcurve.cc:1293). Stable sort by anchor time,
 * then swap any pair of handles fully crossed past the anchor (can happen
 * when a key is dragged past its neighbor).
 */
export function sortFCurve (fcu: FCurve): void {
  fcu.bezt.sort((a, b) => a.vec[1][0] - b.vec[1][0])

  for (const bezt of fcu.bezt) {
    if (bezt.vec[0][0] > bezt.vec[1][0] && bezt.vec[2][0] < bezt.vec[1][0]) {
      const tmp = [bezt.vec[0][0], bezt.vec[0][1]] as [number, number]
      bezt.vec[0][0] = bezt.vec[2][0]
      bezt.vec[0][1] = bezt.vec[2][1]
      bezt.vec[2][0] = tmp[0]
      bezt.vec[2][1] = tmp[1]
    }
  }
}
