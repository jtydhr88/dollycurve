import {
  AutoSmoothing,
  CycleMode,
  Easing,
  Extend,
  HandleType,
  Interpolation,
  KeyType,
} from './enums'

export type Vec2 = [number, number]

export interface BezTriple {
  // [left_handle, anchor, right_handle], each [time, value].
  vec: [Vec2, Vec2, Vec2]

  // Mode of the segment STARTING at this key (Blender convention; see fcurve.cc:2087).
  ipo: Interpolation
  easing: Easing
  h1: HandleType
  h2: HandleType
  keyframeType: KeyType

  // Per-key easing parameters (live on BezTriple in Blender, not on FCurve).
  back: number
  amplitude: number
  period: number

  selected: { h1: boolean; anchor: boolean; h2: boolean }
}

export interface CyclesModifier {
  type: 'cycles'
  before: CycleMode
  after: CycleMode
  beforeCount: number
  afterCount: number
}

export type FModifier = CyclesModifier

export interface FCurve {
  rnaPath: string
  arrayIndex: number
  bezt: BezTriple[]       // sorted ascending by vec[1][0]
  modifiers: FModifier[]

  extend: Extend
  autoSmoothing: AutoSmoothing
  discrete: boolean       // forces hold (booleans, enums)
}

// Post-eval orientation-locking constraints (Blender's TRACK_TO family).
// Override FCurve-driven rotation by aiming at a fixed world-space target.
export interface TrackToConstraint {
  type: 'track_to' | 'damped_track' | 'locked_track'
  target: [number, number, number]
}

export type CameraConstraint = TrackToConstraint

export interface Marker {
  frame: number
  name: string
  color?: string
}

export interface CameraActionMetadata {
  constraints?: CameraConstraint[]
  // Pure metadata (NOT consumed by the evaluator): anchor for yaw/pathScale
  // rotation center in tuning UIs. Same coord system as the action.
  subjectTarget?: [number, number, number]
  markers?: Marker[]
}

export interface CameraAction {
  fcurves: FCurve[]
  fps: number
  metadata?: CameraActionMetadata
}
