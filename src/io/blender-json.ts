// JSON schema for camera animation. Shared by the Blender Python export addon
// (dollycurve_camera_export.py) and our TS save format. Enums are string-typed
// so JSON stays human-readable.

import {
  AutoSmoothing,
  CycleMode,
  Easing,
  Extend,
  HandleType,
  Interpolation,
  KeyType,
} from '../data/enums'
import { makeBezTriple, makeFCurve } from '../data/factories'
import {
  BezTriple,
  CameraAction,
  CameraActionMetadata,
  CameraConstraint,
  CyclesModifier,
  FCurve,
  FModifier,
  NoiseModifier,
  PathFollowConstraint,
  SplinePath,
  SplinePoint,
  Vec3,
} from '../data/types'

export const SCHEMA_VERSION = 1

export interface CameraActionJson {
  version: typeof SCHEMA_VERSION
  fps: number
  fcurves: FCurveJson[]
  metadata?: CameraActionMetadataJson
  pathFollow?: PathFollowConstraintJson
}

export interface SplinePointJson {
  co: [number, number, number]
  h1: [number, number, number]
  h2: [number, number, number]
  h1Type?: string  // HandleType enum value; omitted means AUTO
  h2Type?: string
  tilt?: number
}

export interface SplinePathJson {
  type: 'bezier'
  points: SplinePointJson[]
  closed: boolean
  resolution?: number
}

export interface PathFollowConstraintJson {
  splinePath: SplinePathJson
  speedCurve?: FCurveJson
  orientation: 'tangent' | 'lookAt' | 'free'
  lookAtTarget?: [number, number, number]
  tiltCurve?: FCurveJson
  upAxis: 'X' | 'Y' | 'Z' | [number, number, number]
  arcLengthUniform: boolean
}

export interface CameraActionMetadataJson {
  constraints?: CameraConstraintJson[]
  subjectTarget?: [number, number, number]
  markers?: { frame: number; name: string; color?: string }[]
}

export interface CameraConstraintJson {
  type: 'track_to' | 'damped_track' | 'locked_track'
  target: [number, number, number]
}

export interface FCurveJson {
  rnaPath: string
  arrayIndex: number
  extend: string
  autoSmoothing: string
  discrete: boolean
  modifiers: ModifierJson[]
  keyframes: BezTripleJson[]
  muted?: boolean
  locked?: boolean
}

export type ModifierJson = CyclesModifierJson | NoiseModifierJson

export interface FModifierBaseJson {
  muted?: boolean
  influence?: number
}

export interface CyclesModifierJson extends FModifierBaseJson {
  type: 'cycles'
  before: string
  after: string
  beforeCount: number
  afterCount: number
}

export interface NoiseModifierJson extends FModifierBaseJson {
  type: 'noise'
  modification: 'replace' | 'add' | 'sub' | 'mul'
  size: number
  strength: number
  phase: number
  offset: number
  depth: number
  lacunarity: number
  roughness: number
}

export interface BezTripleJson {
  vec: [[number, number], [number, number], [number, number]]
  ipo: string
  easing: string
  h1: string
  h2: string
  keyframeType: string
  back: number
  amplitude: number
  period: number
}

export function exportCameraActionToJson (action: CameraAction): CameraActionJson {
  const out: CameraActionJson = {
    version: SCHEMA_VERSION,
    fps: action.fps,
    fcurves: action.fcurves.map(fcurveToJson),
  }
  if (action.metadata) out.metadata = metadataToJson(action.metadata)
  if (action.pathFollow) out.pathFollow = pathFollowToJson(action.pathFollow)
  return out
}

function pathFollowToJson (pf: PathFollowConstraint): PathFollowConstraintJson {
  const out: PathFollowConstraintJson = {
    splinePath: splinePathToJson(pf.splinePath),
    orientation: pf.orientation,
    upAxis: Array.isArray(pf.upAxis) ? [pf.upAxis[0], pf.upAxis[1], pf.upAxis[2]] : pf.upAxis,
    arcLengthUniform: pf.arcLengthUniform,
  }
  if (pf.speedCurve) out.speedCurve = fcurveToJson(pf.speedCurve)
  if (pf.tiltCurve) out.tiltCurve = fcurveToJson(pf.tiltCurve)
  if (pf.lookAtTarget) out.lookAtTarget = [pf.lookAtTarget[0], pf.lookAtTarget[1], pf.lookAtTarget[2]]
  return out
}

function splinePathToJson (path: SplinePath): SplinePathJson {
  const out: SplinePathJson = {
    type: 'bezier',
    points: path.points.map(splinePointToJson),
    closed: path.closed,
  }
  if (path.resolution !== undefined) out.resolution = path.resolution
  return out
}

function splinePointToJson (p: SplinePoint): SplinePointJson {
  const out: SplinePointJson = {
    co: [p.co[0], p.co[1], p.co[2]],
    h1: [p.h1[0], p.h1[1], p.h1[2]],
    h2: [p.h2[0], p.h2[1], p.h2[2]],
  }
  // Omit AUTO (the default semantic) so v1 readers see the same shape.
  if (p.h1Type !== undefined && p.h1Type !== HandleType.AUTO) out.h1Type = p.h1Type
  if (p.h2Type !== undefined && p.h2Type !== HandleType.AUTO) out.h2Type = p.h2Type
  if (p.tilt !== undefined && p.tilt !== 0) out.tilt = p.tilt
  return out
}

function metadataToJson (m: CameraActionMetadata): CameraActionMetadataJson {
  const out: CameraActionMetadataJson = {}
  if (m.constraints && m.constraints.length > 0) {
    out.constraints = m.constraints.map((c) => ({
      type: c.type,
      target: [c.target[0], c.target[1], c.target[2]],
    }))
  }
  if (m.subjectTarget) {
    out.subjectTarget = [m.subjectTarget[0], m.subjectTarget[1], m.subjectTarget[2]]
  }
  if (m.markers && m.markers.length > 0) {
    out.markers = m.markers.map((mk) => ({
      frame: mk.frame,
      name: mk.name,
      ...(mk.color ? { color: mk.color } : {}),
    }))
  }
  return out
}

function fcurveToJson (fcu: FCurve): FCurveJson {
  const out: FCurveJson = {
    rnaPath: fcu.rnaPath,
    arrayIndex: fcu.arrayIndex,
    extend: fcu.extend,
    autoSmoothing: fcu.autoSmoothing,
    discrete: fcu.discrete,
    modifiers: fcu.modifiers.map(modifierToJson),
    keyframes: fcu.bezt.map(beztToJson),
  }
  if (fcu.muted) out.muted = true
  if (fcu.locked) out.locked = true
  return out
}

function modifierToJson (m: FModifier): ModifierJson {
  const base: FModifierBaseJson = {}
  if (m.muted) base.muted = true
  if (m.influence !== undefined && m.influence !== 1) base.influence = m.influence
  switch (m.type) {
    case 'cycles':
      return {
        ...base,
        type: 'cycles',
        before: m.before,
        after: m.after,
        beforeCount: m.beforeCount,
        afterCount: m.afterCount,
      }
    case 'noise':
      return {
        ...base,
        type: 'noise',
        modification: m.modification,
        size: m.size,
        strength: m.strength,
        phase: m.phase,
        offset: m.offset,
        depth: m.depth,
        lacunarity: m.lacunarity,
        roughness: m.roughness,
      }
  }
}

function beztToJson (b: BezTriple): BezTripleJson {
  return {
    vec: [
      [b.vec[0][0], b.vec[0][1]],
      [b.vec[1][0], b.vec[1][1]],
      [b.vec[2][0], b.vec[2][1]],
    ],
    ipo: b.ipo,
    easing: b.easing,
    h1: b.h1,
    h2: b.h2,
    keyframeType: b.keyframeType,
    back: b.back,
    amplitude: b.amplitude,
    period: b.period,
  }
}

export function importCameraActionFromJson (raw: unknown): CameraAction {
  const data = expectObject(raw, 'root')
  const version = data.version
  if (version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${String(version)}; expected ${SCHEMA_VERSION}`)
  }
  const fps = expectFiniteNumber(data.fps, 'fps')
  const fcurvesRaw = expectArray(data.fcurves, 'fcurves')
  const fcurves = fcurvesRaw.map((f, i) => fcurveFromJson(f, `fcurves[${i}]`))

  const action: CameraAction = { fcurves, fps }
  if (data.metadata !== undefined && data.metadata !== null) {
    action.metadata = metadataFromJson(data.metadata, 'metadata')
  }
  if (data.pathFollow !== undefined && data.pathFollow !== null) {
    action.pathFollow = pathFollowFromJson(data.pathFollow, 'pathFollow')
  }
  return action
}

function pathFollowFromJson (raw: unknown, path: string): PathFollowConstraint {
  const o = expectObject(raw, path)
  const splinePath = splinePathFromJson(o.splinePath, `${path}.splinePath`)
  const orientation = expectString(o.orientation, `${path}.orientation`)
  if (orientation !== 'tangent' && orientation !== 'lookAt' && orientation !== 'free') {
    throw new Error(`${path}.orientation: unsupported "${orientation}"`)
  }
  let upAxis: PathFollowConstraint['upAxis']
  if (typeof o.upAxis === 'string') {
    if (o.upAxis !== 'X' && o.upAxis !== 'Y' && o.upAxis !== 'Z') {
      throw new Error(`${path}.upAxis: unsupported "${o.upAxis}"`)
    }
    upAxis = o.upAxis
  } else {
    const arr = expectArray(o.upAxis, `${path}.upAxis`)
    if (arr.length !== 3) throw new Error(`${path}.upAxis: expected length 3`)
    upAxis = [
      expectFiniteNumber(arr[0], `${path}.upAxis[0]`),
      expectFiniteNumber(arr[1], `${path}.upAxis[1]`),
      expectFiniteNumber(arr[2], `${path}.upAxis[2]`),
    ]
  }
  const out: PathFollowConstraint = {
    splinePath,
    orientation,
    upAxis,
    arcLengthUniform: expectBoolean(o.arcLengthUniform, `${path}.arcLengthUniform`),
  }
  if (o.speedCurve !== undefined) out.speedCurve = fcurveFromJson(o.speedCurve, `${path}.speedCurve`)
  if (o.tiltCurve !== undefined) out.tiltCurve = fcurveFromJson(o.tiltCurve, `${path}.tiltCurve`)
  if (o.lookAtTarget !== undefined) {
    const arr = expectArray(o.lookAtTarget, `${path}.lookAtTarget`)
    if (arr.length !== 3) throw new Error(`${path}.lookAtTarget: expected length 3`)
    out.lookAtTarget = [
      expectFiniteNumber(arr[0], `${path}.lookAtTarget[0]`),
      expectFiniteNumber(arr[1], `${path}.lookAtTarget[1]`),
      expectFiniteNumber(arr[2], `${path}.lookAtTarget[2]`),
    ]
  }
  return out
}

function splinePathFromJson (raw: unknown, path: string): SplinePath {
  const o = expectObject(raw, path)
  if (o.type !== 'bezier') throw new Error(`${path}.type: expected 'bezier', got "${String(o.type)}"`)
  const pointsArr = expectArray(o.points, `${path}.points`)
  const points = pointsArr.map((p, i) => splinePointFromJson(p, `${path}.points[${i}]`))
  const out: SplinePath = {
    type: 'bezier',
    points,
    closed: expectBoolean(o.closed, `${path}.closed`),
  }
  if (o.resolution !== undefined) out.resolution = expectFiniteNumber(o.resolution, `${path}.resolution`)
  return out
}

function splinePointFromJson (raw: unknown, path: string): SplinePoint {
  const o = expectObject(raw, path)
  const readVec3 = (v: unknown, p: string): Vec3 => {
    const arr = expectArray(v, p)
    if (arr.length !== 3) throw new Error(`${p}: expected length 3`)
    return [
      expectFiniteNumber(arr[0], `${p}[0]`),
      expectFiniteNumber(arr[1], `${p}[1]`),
      expectFiniteNumber(arr[2], `${p}[2]`),
    ]
  }
  const out: SplinePoint = {
    co: readVec3(o.co, `${path}.co`),
    h1: readVec3(o.h1, `${path}.h1`),
    h2: readVec3(o.h2, `${path}.h2`),
  }
  if (o.h1Type !== undefined) out.h1Type = parseHandleType(o.h1Type, `${path}.h1Type`)
  if (o.h2Type !== undefined) out.h2Type = parseHandleType(o.h2Type, `${path}.h2Type`)
  if (o.tilt !== undefined) out.tilt = expectFiniteNumber(o.tilt, `${path}.tilt`)
  return out
}

function parseHandleType (raw: unknown, path: string): HandleType {
  if (typeof raw !== 'string') throw new Error(`${path}: expected string, got ${typeof raw}`)
  const valid = Object.values(HandleType) as string[]
  if (!valid.includes(raw)) throw new Error(`${path}: unknown handle type "${raw}"`)
  return raw as HandleType
}

function metadataFromJson (raw: unknown, path: string): CameraActionMetadata {
  const o = expectObject(raw, path)
  const out: CameraActionMetadata = {}
  if (o.constraints !== undefined) {
    const arr = expectArray(o.constraints, `${path}.constraints`)
    out.constraints = arr.map((c, i) => constraintFromJson(c, `${path}.constraints[${i}]`))
  }
  if (o.subjectTarget !== undefined) {
    const arr = expectArray(o.subjectTarget, `${path}.subjectTarget`)
    if (arr.length !== 3) throw new Error(`${path}.subjectTarget: expected length 3`)
    out.subjectTarget = [
      expectFiniteNumber(arr[0], `${path}.subjectTarget[0]`),
      expectFiniteNumber(arr[1], `${path}.subjectTarget[1]`),
      expectFiniteNumber(arr[2], `${path}.subjectTarget[2]`),
    ]
  }
  if (o.markers !== undefined) {
    const arr = expectArray(o.markers, `${path}.markers`)
    out.markers = arr.map((m, i) => {
      const mp = `${path}.markers[${i}]`
      const obj = expectObject(m, mp)
      const marker: { frame: number; name: string; color?: string } = {
        frame: expectFiniteNumber(obj.frame, `${mp}.frame`),
        name: expectString(obj.name, `${mp}.name`),
      }
      if (obj.color !== undefined) marker.color = expectString(obj.color, `${mp}.color`)
      return marker
    })
  }
  return out
}

function constraintFromJson (raw: unknown, path: string): CameraConstraint {
  const o = expectObject(raw, path)
  const type = expectString(o.type, `${path}.type`)
  if (type !== 'track_to' && type !== 'damped_track' && type !== 'locked_track') {
    throw new Error(`${path}.type: unsupported constraint type "${type}"`)
  }
  const tArr = expectArray(o.target, `${path}.target`)
  if (tArr.length !== 3) throw new Error(`${path}.target: expected length 3`)
  const target: [number, number, number] = [
    expectFiniteNumber(tArr[0], `${path}.target[0]`),
    expectFiniteNumber(tArr[1], `${path}.target[1]`),
    expectFiniteNumber(tArr[2], `${path}.target[2]`),
  ]
  return { type, target }
}

function fcurveFromJson (raw: unknown, path: string): FCurve {
  const o = expectObject(raw, path)
  const rnaPath = expectString(o.rnaPath, `${path}.rnaPath`)
  const arrayIndex = expectFiniteNumber(o.arrayIndex, `${path}.arrayIndex`)
  const extend = expectEnum(o.extend, Extend, `${path}.extend`)
  const autoSmoothing = expectEnum(o.autoSmoothing, AutoSmoothing, `${path}.autoSmoothing`)
  const discrete = expectBoolean(o.discrete, `${path}.discrete`)
  const modifiers = expectArray(o.modifiers, `${path}.modifiers`)
    .map((m, i) => modifierFromJson(m, `${path}.modifiers[${i}]`))
  const keyframes = expectArray(o.keyframes, `${path}.keyframes`)
    .map((b, i) => beztFromJson(b, `${path}.keyframes[${i}]`))

  const fcu = makeFCurve(rnaPath, keyframes, {
    arrayIndex,
    extend,
    autoSmoothing,
    discrete,
    modifiers,
  })
  if (o.muted !== undefined && expectBoolean(o.muted, `${path}.muted`)) fcu.muted = true
  if (o.locked !== undefined && expectBoolean(o.locked, `${path}.locked`)) fcu.locked = true
  return fcu
}

function modifierFromJson (raw: unknown, path: string): FModifier {
  const o = expectObject(raw, path)
  const type = expectString(o.type, `${path}.type`)
  const base: { muted?: boolean; influence?: number } = {}
  if (o.muted !== undefined) base.muted = expectBoolean(o.muted, `${path}.muted`)
  if (o.influence !== undefined) base.influence = expectFiniteNumber(o.influence, `${path}.influence`)
  switch (type) {
    case 'cycles': {
      const m: CyclesModifier = {
        ...base,
        type: 'cycles',
        before: expectEnum(o.before, CycleMode, `${path}.before`),
        after: expectEnum(o.after, CycleMode, `${path}.after`),
        beforeCount: expectFiniteNumber(o.beforeCount, `${path}.beforeCount`),
        afterCount: expectFiniteNumber(o.afterCount, `${path}.afterCount`),
      }
      return m
    }
    case 'noise': {
      const mode = expectString(o.modification, `${path}.modification`)
      if (mode !== 'replace' && mode !== 'add' && mode !== 'sub' && mode !== 'mul') {
        throw new Error(`${path}.modification: unsupported "${mode}"`)
      }
      const m: NoiseModifier = {
        ...base,
        type: 'noise',
        modification: mode,
        size: expectFiniteNumber(o.size, `${path}.size`),
        strength: expectFiniteNumber(o.strength, `${path}.strength`),
        phase: expectFiniteNumber(o.phase, `${path}.phase`),
        offset: expectFiniteNumber(o.offset, `${path}.offset`),
        depth: expectFiniteNumber(o.depth, `${path}.depth`),
        lacunarity: expectFiniteNumber(o.lacunarity, `${path}.lacunarity`),
        roughness: expectFiniteNumber(o.roughness, `${path}.roughness`),
      }
      return m
    }
    default:
      throw new Error(`${path}.type: unsupported modifier type "${type}"`)
  }
}

function beztFromJson (raw: unknown, path: string): BezTriple {
  const o = expectObject(raw, path)
  const vec = expectArray(o.vec, `${path}.vec`)
  if (vec.length !== 3) {
    throw new Error(`${path}.vec: expected length 3, got ${vec.length}`)
  }
  const v = vec.map((p, i) => expectVec2(p, `${path}.vec[${i}]`)) as [
    [number, number], [number, number], [number, number]
  ]

  return makeBezTriple(v[1][0], v[1][1], {
    leftHandle: v[0],
    rightHandle: v[2],
    ipo: expectEnum(o.ipo, Interpolation, `${path}.ipo`),
    easing: expectEnum(o.easing, Easing, `${path}.easing`),
    h1: expectEnum(o.h1, HandleType, `${path}.h1`),
    h2: expectEnum(o.h2, HandleType, `${path}.h2`),
    keyframeType: expectEnum(o.keyframeType, KeyType, `${path}.keyframeType`),
    back: expectFiniteNumber(o.back, `${path}.back`),
    amplitude: expectFiniteNumber(o.amplitude, `${path}.amplitude`),
    period: expectFiniteNumber(o.period, `${path}.period`),
  })
}

function expectObject (v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${path}: expected object, got ${typeof v}`)
  }
  return v as Record<string, unknown>
}

function expectArray (v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${path}: expected array, got ${typeof v}`)
  return v
}

function expectString (v: unknown, path: string): string {
  if (typeof v !== 'string') throw new Error(`${path}: expected string, got ${typeof v}`)
  return v
}

function expectBoolean (v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${path}: expected boolean, got ${typeof v}`)
  return v
}

function expectFiniteNumber (v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${path}: expected finite number, got ${typeof v === 'number' ? v : typeof v}`)
  }
  return v
}

function expectVec2 (v: unknown, path: string): [number, number] {
  const arr = expectArray(v, path)
  if (arr.length !== 2) throw new Error(`${path}: expected length 2, got ${arr.length}`)
  return [
    expectFiniteNumber(arr[0], `${path}[0]`),
    expectFiniteNumber(arr[1], `${path}[1]`),
  ]
}

function expectEnum<T extends Record<string, string>> (v: unknown, e: T, path: string): T[keyof T] {
  const s = expectString(v, path)
  const allowed = Object.values(e)
  if (!allowed.includes(s)) {
    throw new Error(`${path}: invalid value "${s}", expected one of ${allowed.join(', ')}`)
  }
  return s as T[keyof T]
}
