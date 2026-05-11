// Convert location FCurves → SplinePath, one anchor per unique key time.

import { BezTriple, CameraAction, FCurve, SplinePath, Vec3 } from '../data/types'
import { makeSplinePath } from '../data/factories'
import { evaluateFCurve } from '../eval/evaluate'

export interface FitPathOptions {
  /** Remove source location FCurves after conversion. Default true. */
  consumeFCurves?: boolean
  /** Central-diff window for tangent approximation, in frames. Default 0.5. */
  tangentEpsilon?: number
  minFrame?: number
  maxFrame?: number
  /** Uniform anchor count instead of 1-per-key. Min 2; suppresses useFCurveHandles. */
  targetCount?: number
  /** Read 3D handles from each axis's bezt handles when an anchor frame
   *  matches an existing key (fallback: central diff). Default true. */
  useFCurveHandles?: boolean
}

const FRAME_EPS = 1e-3

function findBeztAtFrame (fcu: FCurve, frame: number): BezTriple | null {
  for (const b of fcu.bezt) {
    if (Math.abs(b.vec[1][0] - frame) < FRAME_EPS) return b
  }
  return null
}

function leftSlope (b: BezTriple): number {
  const dx = b.vec[1][0] - b.vec[0][0]
  if (Math.abs(dx) < 1e-9) return 0
  return (b.vec[1][1] - b.vec[0][1]) / dx
}

function rightSlope (b: BezTriple): number {
  const dx = b.vec[2][0] - b.vec[1][0]
  if (Math.abs(dx) < 1e-9) return 0
  return (b.vec[2][1] - b.vec[1][1]) / dx
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

/** Fit a SplinePath through the action's location FCurves. Doesn't install
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

  // Resampled frames don't lie on real keys → handle reads would all miss.
  const useHandles = (opts.useFCurveHandles ?? true) && opts.targetCount === undefined

  const points = frames.map((f, i) => {
    const co = evalLocation(loc, f)
    const lt: [number, number, number] = [0, 0, 0]
    const rt: [number, number, number] = [0, 0, 0]
    for (let a = 0; a < 3; a++) {
      const fcu = loc[a]
      const b = useHandles && fcu ? findBeztAtFrame(fcu, f) : null
      if (b) {
        lt[a] = leftSlope(b)
        rt[a] = rightSlope(b)
      } else {
        const valBefore = fcu ? evaluateFCurve(fcu, f - eps) : 0
        const valAfter  = fcu ? evaluateFCurve(fcu, f + eps) : 0
        const slope = (valAfter - valBefore) / (2 * eps)
        lt[a] = slope
        rt[a] = slope
      }
    }
    const prevGap = i > 0 ? f - frames[i - 1] : (frames[1] - f)
    const nextGap = i < frames.length - 1 ? frames[i + 1] - f : prevGap
    // 3D bezier tangent at t=0 is 3*(h2-co); matching FCurve per-frame
    // velocity puts the handle at slope*gap/3 from anchor.
    const h1Scale = prevGap / 3
    const h2Scale = nextGap / 3
    return {
      co,
      h1: [co[0] - lt[0] * h1Scale, co[1] - lt[1] * h1Scale, co[2] - lt[2] * h1Scale] as Vec3,
      h2: [co[0] + rt[0] * h2Scale, co[1] + rt[1] * h2Scale, co[2] + rt[2] * h2Scale] as Vec3,
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
