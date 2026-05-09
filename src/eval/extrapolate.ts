import { Extend, Interpolation } from '../data/enums'
import { BezTriple, FCurve } from '../data/types'

// Port of fcurve_eval_keyframes_extrapolate (fcurve.cc:1974).
// dir = +1 when frame is before first key (endpointIdx=0); -1 when frame is past last key.
export function extrapolate (
  fcu: FCurve,
  bezts: BezTriple[],
  frame: number,
  endpointIdx: number,
  dir: 1 | -1,
): number {
  const endpoint = bezts[endpointIdx]
  const neighbor = bezts[endpointIdx + dir]

  if (
    endpoint.ipo === Interpolation.CONSTANT ||
    fcu.extend === Extend.CONSTANT ||
    fcu.discrete
  ) {
    return endpoint.vec[1][1]
  }

  if (endpoint.ipo === Interpolation.LINEAR) {
    if (bezts.length === 1) return endpoint.vec[1][1]
    const dx = endpoint.vec[1][0] - frame
    let fac = neighbor.vec[1][0] - endpoint.vec[1][0]
    if (fac === 0) return endpoint.vec[1][1]
    fac = (neighbor.vec[1][1] - endpoint.vec[1][1]) / fac
    return endpoint.vec[1][1] - fac * dx
  }

  // BEZIER + easings: extend gradient of the outer handle (vec[0] for first key, vec[2] for last).
  const handleIdx = dir > 0 ? 0 : 2
  const dx = endpoint.vec[1][0] - frame
  let fac = endpoint.vec[1][0] - endpoint.vec[handleIdx][0]
  if (fac === 0) return endpoint.vec[1][1]
  fac = (endpoint.vec[1][1] - endpoint.vec[handleIdx][1]) / fac
  return endpoint.vec[1][1] - fac * dx
}
