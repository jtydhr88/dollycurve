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

/** Common fields on every FModifier. Mirror Blender's FModifier base
 * struct (DNA_anim_types.h). Both fields default to neutral so v0.1 JSONs
 * continue to parse: muted=false, influence=1. */
export interface FModifierBase {
  muted?: boolean
  influence?: number  // 0..1 blend factor for value modifiers
}

export interface CyclesModifier extends FModifierBase {
  type: 'cycles'
  before: CycleMode
  after: CycleMode
  beforeCount: number
  afterCount: number
}

/** Procedural Perlin-fbm noise overlay. Mirrors Blender FMod_Noise
 * (DNA_anim_types.h). Use for handheld camera shake, organic drift, etc. */
export interface NoiseModifier extends FModifierBase {
  type: 'noise'
  modification: 'replace' | 'add' | 'sub' | 'mul'
  size: number       // wavelength (frames per noise unit); 0 disables
  strength: number   // amplitude
  phase: number      // 2nd noise axis — use as a per-instance seed
  offset: number     // shift the noise pattern along the time axis
  depth: number      // octaves; 0 = single octave
  lacunarity: number // frequency multiplier per octave (default 2)
  roughness: number  // amplitude multiplier per octave (default 0.5)
}

export type FModifier = CyclesModifier | NoiseModifier

export interface FCurve {
  rnaPath: string
  arrayIndex: number
  bezt: BezTriple[]       // sorted ascending by vec[1][0]
  modifiers: FModifier[]

  extend: Extend
  autoSmoothing: AutoSmoothing
  discrete: boolean       // forces hold (booleans, enums)
  /** FCURVE_MUTED — eval returns 0; skip the curve entirely. Default false. */
  muted?: boolean
  /** FCURVE_PROTECTED — edit ops refuse to mutate this curve. Default false. */
  locked?: boolean
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

export type Vec3 = [number, number, number]

/** A 3D bezier control point. `tilt` is roll around the path tangent in
 * radians. Handle types mirror Blender's BezTriple semantics in 3D
 * (AUTO / VECTOR / ALIGN / FREE / AUTO_CLAMPED); default is AUTO. */
export interface SplinePoint {
  co: Vec3
  h1: Vec3   // left handle (back along the path)
  h2: Vec3   // right handle (forward along the path)
  h1Type?: HandleType
  h2Type?: HandleType
  tilt?: number
}

/** A 3D bezier spline. Closed=true wraps the last segment to the first. */
export interface SplinePath {
  type: 'bezier'
  points: SplinePoint[]
  closed: boolean
  /** Samples per segment for the arc-length lookup table. Higher = more
   * accurate uniform-speed traversal at higher build cost. Default 32. */
  resolution?: number
}

/** Drives a camera by following a 3D path. Lives on CameraAction; when
 * present, position comes from the path (not location FCurves). Rotation
 * defaults to follow the path's tangent + tilt; can be overridden via
 * orientation='free' (then rotation FCurves drive it) or orientation='lookAt'
 * (camera aims at lookAtTarget). */
export interface PathFollowConstraint {
  splinePath: SplinePath
  /** time(s) → arc-length distance along the path. If omitted, the camera
   * traverses the full path length linearly over [0, action.fps * defaultDuration]. */
  speedCurve?: FCurve
  orientation: 'tangent' | 'lookAt' | 'free'
  lookAtTarget?: Vec3
  /** time(s) → additional roll radians around the tangent, on top of per-point tilt. */
  tiltCurve?: FCurve
  /** World up axis used to disambiguate parallel-transport at the start. */
  upAxis: 'X' | 'Y' | 'Z' | Vec3
  /** When true (default), interpret speedCurve output as arc-length distance
   * (uniform spatial speed regardless of control-point density). When false,
   * interpret it as raw bezier parameter t in [0, segments]. */
  arcLengthUniform: boolean
}

export interface CameraAction {
  fcurves: FCurve[]
  fps: number
  metadata?: CameraActionMetadata
  pathFollow?: PathFollowConstraint
}
