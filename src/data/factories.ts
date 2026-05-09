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
