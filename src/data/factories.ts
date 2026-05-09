import {
  AutoSmoothing,
  CycleMode,
  Easing,
  Extend,
  HandleType,
  Interpolation,
  KeyType,
} from './enums'
import {
  BezTriple,
  CameraAction,
  CyclesModifier,
  FCurve,
  NoiseModifier,
  PathFollowConstraint,
  SplinePath,
  SplinePoint,
  Vec3,
} from './types'

export interface MakeBezTripleOpts {
  ipo?: Interpolation
  easing?: Easing
  h1?: HandleType
  h2?: HandleType
  keyframeType?: KeyType
  back?: number
  amplitude?: number
  period?: number
  // Explicit handle positions; if omitted, seeded with a small offset.
  leftHandle?: [number, number]
  rightHandle?: [number, number]
}

export function makeBezTriple (
  time: number,
  value: number,
  opts: MakeBezTripleOpts = {},
): BezTriple {
  const left = opts.leftHandle ?? [time - 1, value]
  const right = opts.rightHandle ?? [time + 1, value]
  return {
    vec: [
      [left[0], left[1]],
      [time, value],
      [right[0], right[1]],
    ],
    ipo: opts.ipo ?? Interpolation.BEZIER,
    easing: opts.easing ?? Easing.AUTO,
    h1: opts.h1 ?? HandleType.AUTO_CLAMPED,
    h2: opts.h2 ?? HandleType.AUTO_CLAMPED,
    keyframeType: opts.keyframeType ?? KeyType.KEYFRAME,
    // Defaults match initialize_bezt (animrig/intern/fcurve.cc:340-345).
    back: opts.back ?? 1.70158,
    amplitude: opts.amplitude ?? 0.8,
    period: opts.period ?? 4.1,
    selected: { h1: false, anchor: false, h2: false },
  }
}

export interface MakeFCurveOpts {
  arrayIndex?: number
  extend?: Extend
  autoSmoothing?: AutoSmoothing
  discrete?: boolean
  modifiers?: FCurve['modifiers']
}

export function makeFCurve (
  rnaPath: string,
  bezt: BezTriple[] = [],
  opts: MakeFCurveOpts = {},
): FCurve {
  return {
    rnaPath,
    arrayIndex: opts.arrayIndex ?? 0,
    bezt,
    modifiers: opts.modifiers ?? [],
    extend: opts.extend ?? Extend.CONSTANT,
    autoSmoothing: opts.autoSmoothing ?? AutoSmoothing.CONTINUOUS_ACCELERATION,
    discrete: opts.discrete ?? false,
  }
}

export function makeCameraAction (
  fcurves: FCurve[] = [],
  fps: number = 24,
  metadata?: CameraAction['metadata'],
): CameraAction {
  return metadata ? { fcurves, fps, metadata } : { fcurves, fps }
}

export function makeCyclesModifier (
  before: CycleMode = CycleMode.OFF,
  after: CycleMode = CycleMode.OFF,
  beforeCount: number = 0,
  afterCount: number = 0,
): CyclesModifier {
  return { type: 'cycles', before, after, beforeCount, afterCount }
}

export function makeNoiseModifier (opts: Partial<Omit<NoiseModifier, 'type'>> = {}): NoiseModifier {
  return {
    type: 'noise',
    modification: opts.modification ?? 'replace',
    size: opts.size ?? 1,
    strength: opts.strength ?? 1,
    phase: opts.phase ?? 0,
    offset: opts.offset ?? 0,
    depth: opts.depth ?? 0,
    lacunarity: opts.lacunarity ?? 2,
    roughness: opts.roughness ?? 0.5,
    ...(opts.muted !== undefined && { muted: opts.muted }),
    ...(opts.influence !== undefined && { influence: opts.influence }),
  }
}

/** Make a SplinePoint at `co` with auto handles aligned to the tangent
 * vector `tan`. If `tan` is zero, handles default to (1,0,0). */
export function makeSplinePoint (co: Vec3, tan: Vec3 = [1, 0, 0], handleLen = 1, tilt = 0): SplinePoint {
  const len = Math.hypot(tan[0], tan[1], tan[2])
  const t: Vec3 = len > 0
    ? [tan[0] / len * handleLen, tan[1] / len * handleLen, tan[2] / len * handleLen]
    : [handleLen, 0, 0]
  return {
    co: [co[0], co[1], co[2]],
    h1: [co[0] - t[0], co[1] - t[1], co[2] - t[2]],
    h2: [co[0] + t[0], co[1] + t[1], co[2] + t[2]],
    ...(tilt !== 0 && { tilt }),
  }
}

export function makeSplinePath (points: SplinePoint[], opts: { closed?: boolean; resolution?: number } = {}): SplinePath {
  return {
    type: 'bezier',
    points,
    closed: opts.closed ?? false,
    ...(opts.resolution !== undefined && { resolution: opts.resolution }),
  }
}

export function makePathFollowConstraint (
  splinePath: SplinePath,
  opts: Partial<Omit<PathFollowConstraint, 'splinePath'>> = {},
): PathFollowConstraint {
  return {
    splinePath,
    orientation: opts.orientation ?? 'tangent',
    upAxis: opts.upAxis ?? 'Y',
    arcLengthUniform: opts.arcLengthUniform ?? true,
    ...(opts.speedCurve && { speedCurve: opts.speedCurve }),
    ...(opts.lookAtTarget && { lookAtTarget: opts.lookAtTarget }),
    ...(opts.tiltCurve && { tiltCurve: opts.tiltCurve }),
  }
}
