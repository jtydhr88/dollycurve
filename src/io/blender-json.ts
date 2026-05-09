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
} from '../data/types'

export const SCHEMA_VERSION = 1

export interface CameraActionJson {
  version: typeof SCHEMA_VERSION
  fps: number
  fcurves: FCurveJson[]
  metadata?: CameraActionMetadataJson
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
}

export type ModifierJson = CyclesModifierJson

export interface CyclesModifierJson {
  type: 'cycles'
  before: string
  after: string
  beforeCount: number
  afterCount: number
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
  return {
    rnaPath: fcu.rnaPath,
    arrayIndex: fcu.arrayIndex,
    extend: fcu.extend,
    autoSmoothing: fcu.autoSmoothing,
    discrete: fcu.discrete,
    modifiers: fcu.modifiers.map(modifierToJson),
    keyframes: fcu.bezt.map(beztToJson),
  }
}

function modifierToJson (m: FModifier): ModifierJson {
  switch (m.type) {
    case 'cycles':
      return {
        type: 'cycles',
        before: m.before,
        after: m.after,
        beforeCount: m.beforeCount,
        afterCount: m.afterCount,
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
  return action
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
  return fcu
}

function modifierFromJson (raw: unknown, path: string): FModifier {
  const o = expectObject(raw, path)
  const type = expectString(o.type, `${path}.type`)
  switch (type) {
    case 'cycles': {
      const m: CyclesModifier = {
        type: 'cycles',
        before: expectEnum(o.before, CycleMode, `${path}.before`),
        after: expectEnum(o.after, CycleMode, `${path}.after`),
        beforeCount: expectFiniteNumber(o.beforeCount, `${path}.beforeCount`),
        afterCount: expectFiniteNumber(o.afterCount, `${path}.afterCount`),
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
