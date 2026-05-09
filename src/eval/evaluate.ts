import { FCurve } from '../data/types'
import { extrapolate } from './extrapolate'
import { interpolate } from './interpolate'
import { applyCyclesTime, applyCyclesValue, makeCyclesStorage } from './modifiers/cycles'

// Port of evaluate_fcurve_ex (fcurve.cc:2349) + fcurve_eval_keyframes (fcurve.cc:2290).
// Pipeline: time-modifying modifiers → keyframe eval → value-modifying modifiers.
export function evaluateFCurve (fcu: FCurve, evalFrame: number): number {
  if (fcu.bezt.length === 0) return 0

  let frame = evalFrame
  const cycStorage = makeCyclesStorage()
  for (const m of fcu.modifiers) {
    if (m.type === 'cycles') frame = applyCyclesTime(fcu, m, frame, cycStorage)
  }

  const bezts = fcu.bezt
  let value: number
  if (frame <= bezts[0].vec[1][0]) {
    value = extrapolate(fcu, bezts, frame, 0, +1)
  } else if (frame >= bezts[bezts.length - 1].vec[1][0]) {
    value = extrapolate(fcu, bezts, frame, bezts.length - 1, -1)
  } else {
    value = interpolate(fcu, bezts, frame)
  }

  for (const m of fcu.modifiers) {
    if (m.type === 'cycles') value = applyCyclesValue(m, value, cycStorage)
  }
  return value
}
