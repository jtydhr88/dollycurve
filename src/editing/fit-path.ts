// Best-effort conversion from location FCurves to a SplinePath. One anchor
// per unique source-key time; tangents via central finite differences,
// handles 1/3 of the way to neighbors. Simpler than Schneider's iterative
// curve-fit (Blender's "Convert Animation to Curve") — for dense baked
// input, pre-decimate the source for a tighter fit.

import { CameraAction, FCurve, SplinePath, Vec3 } from '../data/types'
import { makeSplinePath } from '../data/factories'
import { evaluateFCurve } from '../eval/evaluate'

export interface FitPathOptions {
  /** Remove source location FCurves from the action after conversion. Default true. */
  consumeFCurves?: boolean
  /** Centered-difference window for tangent approximation, in frames. Default 0.5. */
  tangentEpsilon?: number
  /** Restrict to [minFrame, maxFrame] inclusive. */
  minFrame?: number
  maxFrame?: number
  /** Uniform anchor count over the frame range; useful when the source is
   *  densely baked. Minimum 2. */
  targetCount?: number
}

function locationFCurves (action: CameraAction): [FCurve | null, FCurve | null, FCurve | null] {
  const arr: [FCurve | null, FCurve | null, FCurve | null] = [null, null, null]
  for (const fcu of action.fcurves) {
    if (fcu.rnaPath === 'location' && fcu.arrayIndex >= 0 && fcu.arrayIndex <= 2) {
      arr[fcu.arrayIndex] = fcu
    }
  }
  return arr
}

function uniqueKeyFrames (fcurves: (FCurve | null)[]): number[] {
  const set = new Set<number>()
  for (const fcu of fcurves) {
    if (!fcu) continue
    for (const b of fcu.bezt) set.add(b.vec[1][0])
  }
  return [...set].sort((a, b) => a - b)
}

function evalLocation (loc: [FCurve | null, FCurve | null, FCurve | null], frame: number): Vec3 {
  return [
    loc[0] ? evaluateFCurve(loc[0], frame) : 0,
    loc[1] ? evaluateFCurve(loc[1], frame) : 0,
    loc[2] ? evaluateFCurve(loc[2], frame) : 0,
  ]
}

/** Fit a SplinePath through the action's location FCurves. Does NOT install
 * it as `action.pathFollow` — caller composes the PathFollowConstraint. */
export function fitFCurvesToPath (action: CameraAction, opts: FitPathOptions = {}): SplinePath {
  const eps = opts.tangentEpsilon ?? 0.5
  const consume = opts.consumeFCurves ?? true
  const loc = locationFCurves(action)
  if (!loc[0] && !loc[1] && !loc[2]) {
    throw new Error('fitFCurvesToPath: action has no location FCurves')
  }

  let frames = uniqueKeyFrames(loc)
  if (opts.minFrame !== undefined) frames = frames.filter((f) => f >= opts.minFrame!)
  if (opts.maxFrame !== undefined) frames = frames.filter((f) => f <= opts.maxFrame!)
  if (frames.length < 2) {
    throw new Error('fitFCurvesToPath: need at least 2 keyframes to form a spline')
  }

  if (opts.targetCount !== undefined) {
    const N = Math.max(2, Math.floor(opts.targetCount))
    const first = frames[0]
    const last = frames[frames.length - 1]
    frames = []
    for (let i = 0; i < N; i++) {
      frames.push(first + ((last - first) * i) / (N - 1))
    }
  }

  const points = frames.map((f, i) => {
    const co = evalLocation(loc, f)
    const before = evalLocation(loc, f - eps)
    const after  = evalLocation(loc, f + eps)
    const tan: Vec3 = [
      (after[0] - before[0]) / (2 * eps),
      (after[1] - before[1]) / (2 * eps),
      (after[2] - before[2]) / (2 * eps),
    ]
    const prevGap = i > 0 ? f - frames[i - 1] : (frames[1] - f)
    const nextGap = i < frames.length - 1 ? frames[i + 1] - f : prevGap
    const h1Scale = prevGap / 3
    const h2Scale = nextGap / 3
    return {
      co,
      h1: [co[0] - tan[0] * h1Scale, co[1] - tan[1] * h1Scale, co[2] - tan[2] * h1Scale] as Vec3,
      h2: [co[0] + tan[0] * h2Scale, co[1] + tan[1] * h2Scale, co[2] + tan[2] * h2Scale] as Vec3,
    }
  })

  const path = makeSplinePath(points)

  if (consume) {
    for (let i = action.fcurves.length - 1; i >= 0; i--) {
      const f = action.fcurves[i]
      if (f.rnaPath === 'location') action.fcurves.splice(i, 1)
    }
  }

  return path
}
