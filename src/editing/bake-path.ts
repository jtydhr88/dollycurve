// CameraAction.pathFollow → location/rotation FCurves. Analog of Blender's
// CURVE_OT_to_keyframe / Bake Action.

import { Euler, PerspectiveCamera, Quaternion } from 'three'
import { Interpolation } from '../data/enums'
import { CameraAction, FCurve, SplinePath } from '../data/types'
import { makeBezTriple, makeFCurve } from '../data/factories'
import { HandleType } from '../data/enums'
import { CameraTrackBinding } from '../three/CameraTrackBinding'
import { evaluateFCurve } from '../eval/evaluate'
import { recalcAllHandles } from './handles'
import { buildArcTable } from '../spline/arc-length'

export interface BakePathOptions {
  startFrame: number
  endFrame: number
  /** Frames between samples. Default 1. Ignored when targetCount or useSplineAnchors is set. */
  step?: number
  /** Uniform sample count over [startFrame, endFrame]; min 2. */
  targetCount?: number
  /** One keyframe per spline anchor (frame from inverting speedCurve at the
   *  anchor's arc-length). Round-trips Fit → Path. Wins over step / targetCount. */
  useSplineAnchors?: boolean
  /** Bake rotation FCurves. Default true. */
  bakeRotation?: boolean
  /** Replace existing same-rnaPath FCurves. Default true. */
  replace?: boolean
  /** Delete action.pathFollow after bake. Default true. */
  clearPathFollow?: boolean
  /** When set, write rotation_euler in this order instead of rotation_quaternion. */
  rotationMode?: 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX' | null
}

/** Bisection inverse of a monotonic FCurve. */
function inverseFCurve (fcu: FCurve, targetValue: number, lo: number, hi: number): number {
  const TOL = 1e-4
  const vLo = evaluateFCurve(fcu, lo)
  const vHi = evaluateFCurve(fcu, hi)
  if (targetValue <= vLo) return lo
  if (targetValue >= vHi) return hi
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const v = evaluateFCurve(fcu, mid)
    if (Math.abs(v - targetValue) < TOL) return mid
    if (v < targetValue) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const VECTOR_HANDLE_OPTS = {
  ipo: Interpolation.LINEAR,
  h1: HandleType.VECTOR,
  h2: HandleType.VECTOR,
}
// Handle positions are overwritten by setLocationHandlesFromSpline; FREE
// keeps recalcHandles from undoing the assignment.
const SMOOTH_LOC_OPTS = {
  ipo: Interpolation.BEZIER,
  h1: HandleType.FREE,
  h2: HandleType.FREE,
}
const SMOOTH_ROT_OPTS = {
  ipo: Interpolation.BEZIER,
  h1: HandleType.AUTO_CLAMPED,
  h2: HandleType.AUTO_CLAMPED,
}

/** Set each baked location FCurve's bezt handles to mirror the 3D spline's
 * h1/h2 per axis. Inverse of fitFCurvesToPath's useFCurveHandles read. */
function setLocationHandlesFromSpline (
  fcu: FCurve,
  axis: 0 | 1 | 2,
  splinePath: SplinePath,
  samples: { frame: number; anchorIdx?: number }[],
): void {
  const N = fcu.bezt.length
  for (let i = 0; i < N; i++) {
    const s = samples[i]
    if (s.anchorIdx === undefined) continue
    const anchor = splinePath.points[s.anchorIdx]
    const bezt = fcu.bezt[i]
    if (i < N - 1) {
      const gap = samples[i + 1].frame - s.frame
      bezt.vec[2] = [s.frame + gap / 3, anchor.h2[axis]]
    }
    if (i > 0) {
      const gap = s.frame - samples[i - 1].frame
      bezt.vec[0] = [s.frame - gap / 3, anchor.h1[axis]]
    }
  }
}

function removeExisting (action: CameraAction, rnaPath: string, arrayIndex?: number): void {
  for (let i = action.fcurves.length - 1; i >= 0; i--) {
    const f = action.fcurves[i]
    if (f.rnaPath === rnaPath && (arrayIndex === undefined || f.arrayIndex === arrayIndex)) {
      action.fcurves.splice(i, 1)
    }
  }
}

/** Bake `action.pathFollow` to per-frame location (and rotation) FCurves. */
export function bakePathToFCurves (action: CameraAction, opts: BakePathOptions): FCurve[] {
  if (!action.pathFollow) {
    throw new Error('bakePathToFCurves: action has no pathFollow constraint')
  }
  const bakeRot = opts.bakeRotation ?? true
  const replace = opts.replace ?? true
  const clearPF = opts.clearPathFollow ?? true
  const useEuler = opts.rotationMode != null

  // anchorIdx (when set) pins the sample's position to the spline anchor —
  // the binding's path eval can drift in useSplineAnchors mode.
  type SampleSpec = { frame: number; anchorIdx?: number }
  const schedule: SampleSpec[] = []
  if (opts.useSplineAnchors) {
    const pf = action.pathFollow
    const arc = buildArcTable(pf.splinePath)
    const perSeg = arc.perSeg
    const N = pf.splinePath.points.length
    for (let i = 0; i < N; i++) {
      const sIdx = Math.min(i * perSeg, arc.cumLen.length - 1)
      const sLen = arc.cumLen[sIdx]
      let frame: number
      if (pf.speedCurve && pf.arcLengthUniform) {
        frame = inverseFCurve(pf.speedCurve, sLen, opts.startFrame, opts.endFrame)
      } else if (pf.speedCurve) {
        frame = inverseFCurve(pf.speedCurve, i, opts.startFrame, opts.endFrame)
      } else {
        frame = N === 1 ? opts.startFrame
                        : opts.startFrame + ((opts.endFrame - opts.startFrame) * i) / (N - 1)
      }
      schedule.push({ frame, anchorIdx: i })
    }
  } else if (opts.targetCount !== undefined) {
    const N = Math.max(2, Math.floor(opts.targetCount))
    for (let i = 0; i < N; i++) {
      schedule.push({ frame: opts.startFrame + ((opts.endFrame - opts.startFrame) * i) / (N - 1) })
    }
  } else {
    const step = opts.step ?? 1
    for (let f = opts.startFrame; f <= opts.endFrame; f += step) schedule.push({ frame: f })
  }

  // Reuse the production binding so bake and live-eval can't drift apart.
  const cam = new PerspectiveCamera()
  const binding = new CameraTrackBinding(cam, action,
    useEuler ? { eulerOrder: opts.rotationMode! } : {})

  const samples: { frame: number; pos: [number, number, number]; quat: [number, number, number, number]; eul: [number, number, number] }[] = []
  const tmpEuler = new Euler()
  const tmpQuat = new Quaternion()
  const fps = action.fps
  for (const spec of schedule) {
    binding.evaluate(spec.frame / fps)
    const samp: typeof samples[number] = {
      frame: spec.frame,
      pos: [cam.position.x, cam.position.y, cam.position.z],
      quat: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      eul: [0, 0, 0],
    }
    if (spec.anchorIdx !== undefined) {
      // Pin position to the anchor; rotation/lens still come from binding.
      const a = action.pathFollow.splinePath.points[spec.anchorIdx]
      samp.pos = [a.co[0], a.co[1], a.co[2]]
    }
    if (useEuler) {
      tmpQuat.set(samp.quat[0], samp.quat[1], samp.quat[2], samp.quat[3])
      tmpEuler.setFromQuaternion(tmpQuat, opts.rotationMode!)
      samp.eul = [tmpEuler.x, tmpEuler.y, tmpEuler.z]
    }
    samples.push(samp)
  }

  // Hemisphere continuity: q and -q are the same rotation but the four
  // scalar FCurves would pick up a spurious 360° spin on sign flip.
  if (bakeRot && !useEuler) {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].quat
      const b = samples[i].quat
      const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
      if (d < 0) samples[i].quat = [-b[0], -b[1], -b[2], -b[3]]
    }
  }

  if (replace) {
    removeExisting(action, 'location')
    if (bakeRot) {
      removeExisting(action, useEuler ? 'rotation_euler' : 'rotation_quaternion')
    }
  }

  // Sparse anchor-aligned mode needs bezier between keys; dense uniform
  // sampling stays LINEAR (adjacent samples are visually indistinguishable).
  const useSmooth = opts.useSplineAnchors === true
  const locOpts = useSmooth ? SMOOTH_LOC_OPTS : VECTOR_HANDLE_OPTS
  const rotOpts = useSmooth ? SMOOTH_ROT_OPTS : VECTOR_HANDLE_OPTS

  const out: FCurve[] = []
  for (let axis = 0; axis < 3; axis++) {
    const fcu = makeFCurve('location', [], { arrayIndex: axis })
    for (const s of samples) {
      fcu.bezt.push(makeBezTriple(s.frame, s.pos[axis], locOpts))
    }
    if (useSmooth) {
      setLocationHandlesFromSpline(fcu, axis as 0 | 1 | 2, action.pathFollow.splinePath, schedule)
    }
    action.fcurves.push(fcu)
    out.push(fcu)
  }

  if (bakeRot) {
    if (useEuler) {
      for (let axis = 0; axis < 3; axis++) {
        const fcu = makeFCurve('rotation_euler', [], { arrayIndex: axis })
        for (const s of samples) {
          fcu.bezt.push(makeBezTriple(s.frame, s.eul[axis], rotOpts))
        }
        if (useSmooth) recalcAllHandles(fcu)
        action.fcurves.push(fcu)
        out.push(fcu)
      }
    } else {
      for (let axis = 0; axis < 4; axis++) {
        const fcu = makeFCurve('rotation_quaternion', [], { arrayIndex: axis })
        for (const s of samples) {
          fcu.bezt.push(makeBezTriple(s.frame, s.quat[axis], rotOpts))
        }
        if (useSmooth) recalcAllHandles(fcu)
        action.fcurves.push(fcu)
        out.push(fcu)
      }
    }
  }

  if (clearPF) delete action.pathFollow
  return out
}
