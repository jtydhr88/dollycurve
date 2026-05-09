import { FCurve, FModifier } from '../data/types'
import { extrapolate } from './extrapolate'
import { interpolate } from './interpolate'
import { applyCyclesTime, applyCyclesValue, makeCyclesStorage } from './modifiers/cycles'
import { applyNoiseValue } from './modifiers/noise'

function modInfluence (m: FModifier): number {
  if (m.muted) return 0
  return m.influence ?? 1
}

// Port of evaluate_fcurve_ex (fcurve.cc:2349) + fcurve_eval_keyframes (fcurve.cc:2290).
// Pipeline: time-modifying modifiers → keyframe eval → value-modifying modifiers.
// Mute (muted=true) and influence=0 both fully skip the modifier on BOTH passes.
export function evaluateFCurve (fcu: FCurve, evalFrame: number): number {
  if (fcu.muted) return 0
  if (fcu.bezt.length === 0) return 0

  const active = fcu.modifiers
    .map((m) => ({ m, inf: modInfluence(m) }))
    .filter(({ inf }) => inf > 0)

  let frame = evalFrame
  const cycStorage = makeCyclesStorage()
  for (const { m } of active) {
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

  for (const { m, inf } of active) {
    let nval = value
    if (m.type === 'cycles') nval = applyCyclesValue(m, value, cycStorage)
    else if (m.type === 'noise') nval = applyNoiseValue(m, value, evalFrame)
    if (inf >= 1) value = nval
    else value = value * (1 - inf) + nval * inf  // interpf
  }
  return value
}
