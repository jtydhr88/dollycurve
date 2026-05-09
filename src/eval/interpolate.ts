import { Interpolation } from '../data/enums'
import { BezTriple, FCurve } from '../data/types'
import { evalBezierSegment } from './bezier'
import { bezBinarySearch } from './binarySearch'
import { dispatchEase, linearEase } from './easing'

// Port of fcurve_eval_keyframes_interpolate (fcurve.cc:2026).
export function interpolate (fcu: FCurve, bezts: BezTriple[], frame: number): number {
  const { idx, exact } = bezBinarySearch(bezts, frame, 0.0001)
  if (exact) return bezts[idx].vec[1][1]

  // idx is "first key with anchor >= frame" — bracket [prev, next].
  // Segment mode comes from prev.ipo (Blender stores ipo on the LEFT key of the segment).
  const next = bezts[idx]
  const prev = idx > 0 ? bezts[idx - 1] : next

  const EPS = 1e-8
  if (Math.abs(next.vec[1][0] - frame) < EPS) return next.vec[1][1]

  const begin = prev.vec[1][1]
  const change = next.vec[1][1] - prev.vec[1][1]
  const duration = next.vec[1][0] - prev.vec[1][0]
  const t = frame - prev.vec[1][0]

  if (
    prev.ipo === Interpolation.CONSTANT ||
    fcu.discrete ||
    duration === 0
  ) {
    return prev.vec[1][1]
  }

  if (prev.ipo === Interpolation.LINEAR) {
    return linearEase(t, begin, change, duration)
  }

  if (prev.ipo === Interpolation.BEZIER) {
    return evalBezierSegment(prev, next, frame)
  }

  return dispatchEase(prev.ipo, prev.easing, {
    time: t,
    begin,
    change,
    duration,
    back: prev.back,
    amplitude: prev.amplitude,
    period: prev.period,
  })
}
