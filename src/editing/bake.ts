import { Easing, HandleType, Interpolation, KeyType } from '../data/enums'
import { BezTriple, FCurve } from '../data/types'
import { evaluateFCurve } from '../eval/evaluate'
import { recalcAllHandles } from './handles'

export interface BakeOptions {
  /** Frame step. 1.0 = bake to integer frames. Default 1. */
  step?: number
  /** Replace existing keys in [start, end] before baking. Default true. */
  removeExisting?: boolean
}

/**
 * Port of bake_fcurve (animrig/intern/fcurve.cc:572). Samples [start, end]
 * inclusive at `step` and writes BEZIER + AUTO_CLAMPED keys; switch to LINEAR
 * ipo afterwards if you want the per-frame stairstep preserved.
 */
export function bakeFCurve (
  fcu: FCurve,
  start: number,
  end: number,
  opts: BakeOptions = {},
): void {
  const step = opts.step ?? 1
  if (step <= 0) throw new Error('bakeFCurve: step must be > 0')
  const removeExisting = opts.removeExisting ?? true

  // Sample BEFORE mutating; otherwise samples would see partially-replaced keys.
  const sampleCount = Math.floor((end - start) / step) + 1
  const samples: { t: number; v: number }[] = []
  for (let i = 0; i < sampleCount; i++) {
    const t = start + i * step
    samples.push({ t, v: evaluateFCurve(fcu, t) })
  }

  if (removeExisting) {
    fcu.bezt = fcu.bezt.filter(
      (b) => b.vec[1][0] < start - 1e-6 || b.vec[1][0] > end + 1e-6,
    )
  }

  for (const s of samples) {
    const bz: BezTriple = {
      vec: [[s.t - 1, s.v], [s.t, s.v], [s.t + 1, s.v]],
      ipo: Interpolation.BEZIER,
      easing: Easing.AUTO,
      h1: HandleType.AUTO_CLAMPED,
      h2: HandleType.AUTO_CLAMPED,
      keyframeType: KeyType.GENERATED,
      back: 1.70158,
      amplitude: 0.8,
      period: 4.1,
      selected: { h1: false, anchor: false, h2: false },
    }
    fcu.bezt.push(bz)
  }
  fcu.bezt.sort((a, b) => a.vec[1][0] - b.vec[1][0])
  recalcAllHandles(fcu)
}
