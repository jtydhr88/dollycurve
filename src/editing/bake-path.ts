// Sample a CameraAction's pathFollow and write the result to location/
// rotation FCurves. Mirrors Blender's CURVE_OT_to_keyframe / Bake Action.

import { Euler, PerspectiveCamera, Quaternion } from 'three'
import { Interpolation } from '../data/enums'
import { CameraAction, FCurve } from '../data/types'
import { makeBezTriple, makeFCurve } from '../data/factories'
import { HandleType } from '../data/enums'
import { CameraTrackBinding } from '../three/CameraTrackBinding'

export interface BakePathOptions {
  /** First frame to sample, inclusive. */
  startFrame: number
  /** Last frame to sample, inclusive. */
  endFrame: number
  /** Frames between samples. Default 1. Ignored when `targetCount` is set. */
  step?: number
  /** Uniformly distributed sample count over [startFrame, endFrame]; wins
   *  over `step`. Use to avoid one-key-per-frame density on long actions.
   *  Minimum 2. */
  targetCount?: number
  /** Bake rotation as well (rotation_quaternion FCurves). Default true. */
  bakeRotation?: boolean
  /** Replace existing location/rotation FCurves with the baked ones. Default true. */
  replace?: boolean
  /** Drop `action.pathFollow` after bake. Default true. */
  clearPathFollow?: boolean
  /** When set, baked rotation uses rotation_euler in this order instead of quat. */
  rotationMode?: 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX' | null
}

const VECTOR_HANDLE_OPTS = {
  ipo: Interpolation.LINEAR,
  h1: HandleType.VECTOR,
  h2: HandleType.VECTOR,
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

  const schedule: number[] = []
  if (opts.targetCount !== undefined) {
    const N = Math.max(2, Math.floor(opts.targetCount))
    for (let i = 0; i < N; i++) {
      schedule.push(opts.startFrame + ((opts.endFrame - opts.startFrame) * i) / (N - 1))
    }
  } else {
    const step = opts.step ?? 1
    for (let f = opts.startFrame; f <= opts.endFrame; f += step) schedule.push(f)
  }

  // Reuse the production binding to evaluate the path, so live-eval and bake
  // can't drift apart algorithmically.
  const cam = new PerspectiveCamera()
  const binding = new CameraTrackBinding(cam, action,
    useEuler ? { eulerOrder: opts.rotationMode! } : {})

  const samples: { frame: number; pos: [number, number, number]; quat: [number, number, number, number]; eul: [number, number, number] }[] = []
  const tmpEuler = new Euler()
  const tmpQuat = new Quaternion()
  const fps = action.fps
  for (const f of schedule) {
    binding.evaluate(f / fps)
    const samp: typeof samples[number] = {
      frame: f,
      pos: [cam.position.x, cam.position.y, cam.position.z],
      quat: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
      eul: [0, 0, 0],
    }
    if (useEuler) {
      tmpQuat.set(samp.quat[0], samp.quat[1], samp.quat[2], samp.quat[3])
      tmpEuler.setFromQuaternion(tmpQuat, opts.rotationMode!)
      samp.eul = [tmpEuler.x, tmpEuler.y, tmpEuler.z]
    }
    samples.push(samp)
  }

  // Hemisphere continuity: negate q if dot(prev, q) < 0 — without this, the
  // four scalar FCurves can pick up spurious 360° jumps when the quaternion
  // sign flips between adjacent samples (q and -q are the same rotation but
  // interpolate the long way around).
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

  const out: FCurve[] = []
  for (let axis = 0; axis < 3; axis++) {
    const fcu = makeFCurve('location', [], { arrayIndex: axis })
    for (const s of samples) {
      fcu.bezt.push(makeBezTriple(s.frame, s.pos[axis], VECTOR_HANDLE_OPTS))
    }
    action.fcurves.push(fcu)
    out.push(fcu)
  }

  if (bakeRot) {
    if (useEuler) {
      for (let axis = 0; axis < 3; axis++) {
        const fcu = makeFCurve('rotation_euler', [], { arrayIndex: axis })
        for (const s of samples) {
          fcu.bezt.push(makeBezTriple(s.frame, s.eul[axis], VECTOR_HANDLE_OPTS))
        }
        action.fcurves.push(fcu)
        out.push(fcu)
      }
    } else {
      for (let axis = 0; axis < 4; axis++) {
        const fcu = makeFCurve('rotation_quaternion', [], { arrayIndex: axis })
        for (const s of samples) {
          fcu.bezt.push(makeBezTriple(s.frame, s.quat[axis], VECTOR_HANDLE_OPTS))
        }
        action.fcurves.push(fcu)
        out.push(fcu)
      }
    }
  }

  if (clearPF) delete action.pathFollow
  return out
}
