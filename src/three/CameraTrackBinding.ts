import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { CameraAction, PathFollowConstraint } from '../data/types'
import { evaluateFCurve } from '../eval/evaluate'
import { pathPos, segmentCount } from '../spline/bezier3d'
import { arcLengthToU, buildArcTable, type ArcTable } from '../spline/arc-length'
import { frameAtU, frameToQuaternion } from '../spline/orientation'

export interface CameraBindingOptions {
  /** Vertical sensor in mm (default 24, Blender's default). Used for lens→fov. */
  sensorHeight?: number
  /** Three.js Euler order. Default 'XYZ' matches Blender's most common rotation_mode. */
  eulerOrder?: 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX'
}

/**
 * Composes per-property scalars from an FCurve action into a Three.js camera
 * each frame. Ticks independently of AnimationMixer.
 *
 * Supported RNA paths (others ignored):
 *   location[0..2]            → camera.position.{x,y,z}
 *   rotation_euler[0..2]      → camera.rotation.{x,y,z}
 *   rotation_quaternion[0..3] → camera.quaternion (takes precedence over euler)
 *   scale[0..2]               → camera.scale.{x,y,z}
 *   lens                      → camera.fov via 2*atan(sensor_h / 2 / lens)
 *   sensor_height             → updates the sensor used for lens→fov
 *   clip_start / clip_end     → camera.near / camera.far
 */
export class CameraTrackBinding {
  private sensorHeight: number
  private eulerOrder: NonNullable<CameraBindingOptions['eulerOrder']>
  private tmpEuler = new Euler()
  private tmpPos = new Vector3()
  private tmpQuat = new Quaternion()
  private cachedPath: PathFollowConstraint['splinePath'] | null = null
  private cachedArcTable: ArcTable | null = null

  constructor (
    public camera: PerspectiveCamera,
    public action: CameraAction,
    opts: CameraBindingOptions = {},
  ) {
    this.sensorHeight = opts.sensorHeight ?? 24
    this.eulerOrder = opts.eulerOrder ?? 'XYZ'
  }

  private getArcTable (path: PathFollowConstraint['splinePath']): ArcTable {
    if (this.cachedPath !== path) {
      this.cachedPath = path
      this.cachedArcTable = buildArcTable(path)
    }
    return this.cachedArcTable!
  }

  evaluate (timeInSeconds: number): void {
    const frame = timeInSeconds * this.action.fps

    const byPath: Record<string, number[]> = {}
    for (const fcu of this.action.fcurves) {
      const v = evaluateFCurve(fcu, frame)
      ;(byPath[fcu.rnaPath] ??= [])[fcu.arrayIndex] = v
    }

    // Path-follow takes precedence over location FCurves: the spline drives
    // position, and (depending on `orientation`) drives rotation too. FCurves
    // for lens/clip/sensor still apply.
    const pf = this.action.pathFollow
    let pathDroveRotation = false
    if (pf) {
      this.applyPathFollow(pf, frame)
      pathDroveRotation = pf.orientation !== 'free'
    } else if (byPath.location) {
      this.tmpPos.fromArray(byPath.location)
      this.camera.position.copy(this.tmpPos)
    }

    // Quaternion takes precedence over Euler — required for any preset
    // crossing gimbal lock or rotating past ±180°.
    if (pathDroveRotation) {
      // Path already wrote rotation; skip FCurve rotation.
    } else if (byPath.rotation_quaternion) {
      const q = byPath.rotation_quaternion
      this.tmpQuat.set(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1)
      // Component-wise lerp between keys is close to slerp for small steps,
      // but renormalize so the result is always a valid unit quaternion.
      this.tmpQuat.normalize()
      this.camera.quaternion.copy(this.tmpQuat)
    } else if (byPath.rotation_euler) {
      const r = byPath.rotation_euler
      this.tmpEuler.set(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, this.eulerOrder)
      this.camera.rotation.copy(this.tmpEuler)
    }

    if (byPath.scale) {
      this.camera.scale.set(byPath.scale[0] ?? 1, byPath.scale[1] ?? 1, byPath.scale[2] ?? 1)
    }

    let projectionDirty = false

    if (byPath.sensor_height !== undefined) {
      this.sensorHeight = byPath.sensor_height[0]
    }
    if (byPath.lens !== undefined) {
      const lens = byPath.lens[0]
      if (lens > 0 && Number.isFinite(lens)) {
        const fovRad = 2 * Math.atan(this.sensorHeight / 2 / lens)
        this.camera.fov = MathUtils.radToDeg(fovRad)
        projectionDirty = true
      }
    }
    if (byPath.clip_start !== undefined) {
      this.camera.near = byPath.clip_start[0]
      projectionDirty = true
    }
    if (byPath.clip_end !== undefined) {
      this.camera.far = byPath.clip_end[0]
      projectionDirty = true
    }

    if (projectionDirty) this.camera.updateProjectionMatrix()

    // TRACK_TO constraints override FCurve rotation by aiming at a world target.
    // lookAt expects world coords, so this assumes camera has no parent (or
    // identity parent); caller must map into parent space for nested rigs.
    const constraints = this.action.metadata?.constraints
    if (constraints && constraints.length > 0) {
      for (const c of constraints) {
        if (c.type === 'track_to' || c.type === 'damped_track' || c.type === 'locked_track') {
          this.camera.lookAt(c.target[0], c.target[1], c.target[2])
        }
      }
    }
  }

  private applyPathFollow (pf: PathFollowConstraint, frame: number): void {
    const path = pf.splinePath
    const segs = segmentCount(path)
    if (segs === 0) return

    // 1) frame → arc-length s (or raw param u, depending on arcLengthUniform).
    const table = this.getArcTable(path)
    const total = pf.arcLengthUniform ? table.totalLen : segs
    let s: number
    if (pf.speedCurve) {
      s = evaluateFCurve(pf.speedCurve, frame)
    } else {
      // Default: traverse full path linearly over the action's frame range.
      // Without an explicit duration we fall back to "frame == s" so authors
      // can drive it with a synthetic location FCurve if needed.
      s = frame
    }
    s = Math.max(0, Math.min(total, s))
    const u = pf.arcLengthUniform ? arcLengthToU(table, s) : s

    // 2) Position
    const pos = pathPos(path, u)
    this.camera.position.set(pos[0], pos[1], pos[2])

    // 3) Orientation
    if (pf.orientation === 'tangent') {
      const tilt = pf.tiltCurve ? evaluateFCurve(pf.tiltCurve, frame) : 0
      const f = frameAtU(path, pf.upAxis, u)
      const q = frameToQuaternion(f, tilt)
      this.camera.quaternion.set(q[0], q[1], q[2], q[3])
    } else if (pf.orientation === 'lookAt' && pf.lookAtTarget) {
      this.camera.lookAt(pf.lookAtTarget[0], pf.lookAtTarget[1], pf.lookAtTarget[2])
      // Apply tilt as a roll around the camera's current forward.
      if (pf.tiltCurve) {
        const tilt = evaluateFCurve(pf.tiltCurve, frame)
        if (tilt !== 0) {
          const fwd = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
          this.tmpQuat.setFromAxisAngle(fwd, tilt)
          this.camera.quaternion.premultiply(this.tmpQuat)
        }
      }
    }
    // orientation === 'free': caller's rotation FCurves drive it (handled
    // by the existing FCurve dispatch below).
  }

  /** Reverse-derive: return FCurve values that would reproduce camera's current state. */
  captureFromCamera (): {
    location: [number, number, number]
    rotation_euler: [number, number, number]
    lens: number
  } {
    const e = new Euler().setFromQuaternion(this.camera.quaternion, this.eulerOrder)
    return {
      location: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      rotation_euler: [e.x, e.y, e.z],
      lens: this.lensFromFov(this.camera.fov),
    }
  }

  /** Inverse of the lens→fov formula in evaluate(). */
  lensFromFov (fovDeg: number): number {
    const fovRad = MathUtils.degToRad(fovDeg)
    return this.sensorHeight / 2 / Math.tan(fovRad / 2)
  }

  getSensorHeight (): number { return this.sensorHeight }
  setSensorHeight (mm: number): void { this.sensorHeight = mm }
}
