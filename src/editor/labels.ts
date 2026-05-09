import { Interpolation } from '../data/enums'

/**
 * Mirrors `bezt->ipo > BEZT_IPO_BEZ` (graph_buttons.cc:413): true for the
 * 10 easing modes (BACK..SINE) where the easing direction matters.
 */
export function isEasingInterpolation (ipo: Interpolation): boolean {
  switch (ipo) {
    case Interpolation.BACK:
    case Interpolation.BOUNCE:
    case Interpolation.CIRC:
    case Interpolation.CUBIC:
    case Interpolation.ELASTIC:
    case Interpolation.EXPO:
    case Interpolation.QUAD:
    case Interpolation.QUART:
    case Interpolation.QUINT:
    case Interpolation.SINE:
      return true
    default:
      return false
  }
}

const COMPONENT_NAMES = ['x', 'y', 'z', 'w']

export function channelLabel (rnaPath: string, arrayIndex: number): string {
  switch (rnaPath) {
    case 'location':           return `location.${COMPONENT_NAMES[arrayIndex] ?? arrayIndex}`
    case 'rotation_euler':     return `rotation.${COMPONENT_NAMES[arrayIndex] ?? arrayIndex}`
    case 'rotation_quaternion':return `rotation.${COMPONENT_NAMES[arrayIndex] ?? arrayIndex} (quat)`
    case 'scale':              return `scale.${COMPONENT_NAMES[arrayIndex] ?? arrayIndex}`
    case 'lens':               return 'lens (mm)'
    case 'sensor_height':      return 'sensor (mm)'
    case 'clip_start':         return 'clip start'
    case 'clip_end':           return 'clip end'
    case 'shift_x':            return 'shift x'
    case 'shift_y':            return 'shift y'
    case 'dof.focus_distance': return 'focus distance'
    case 'dof.aperture_fstop': return 'f-stop'
    default:                   return arrayIndex > 0 ? `${rnaPath}[${arrayIndex}]` : rnaPath
  }
}

const RNA_PATH_ORDER: Record<string, number> = {
  location: 0,
  rotation_euler: 1,
  rotation_quaternion: 2,
  scale: 3,
  lens: 10,
  sensor_height: 11,
  clip_start: 12,
  clip_end: 13,
  shift_x: 14,
  shift_y: 15,
  'dof.focus_distance': 20,
  'dof.aperture_fstop': 21,
}

export function rnaPathSortKey (rnaPath: string): number {
  return RNA_PATH_ORDER[rnaPath] ?? 100
}

/** Group an FCurve under a collapsible category in the channel list.
 * Mirrors how Blender's Graph Editor groups channels by bActionGroup. */
export function channelGroup (rnaPath: string): string {
  if (rnaPath === 'location' || rnaPath === 'rotation_euler' ||
      rnaPath === 'rotation_quaternion' || rnaPath === 'scale') return 'Transform'
  if (rnaPath === 'lens' || rnaPath === 'sensor_height' ||
      rnaPath === 'shift_x' || rnaPath === 'shift_y') return 'Lens'
  if (rnaPath === 'clip_start' || rnaPath === 'clip_end') return 'Clipping'
  if (rnaPath.startsWith('dof.')) return 'Depth of Field'
  return 'Other'
}

const GROUP_ORDER: Record<string, number> = {
  Transform: 0,
  Lens: 1,
  Clipping: 2,
  'Depth of Field': 3,
  Other: 99,
}

export function channelGroupSortKey (group: string): number {
  return GROUP_ORDER[group] ?? 50
}

/**
 * True when the rnaPath's stored values are radians (display converts to deg).
 * Quaternion components are dimensionless unit-vector parts, not angles.
 */
export function isAngleRnaPath (rnaPath: string): boolean {
  return rnaPath === 'rotation_euler'
}

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

/** Internal value → UI-friendly string (radians shown as degrees, etc.). */
export function formatValue (rnaPath: string, raw: number): string {
  if (isAngleRnaPath(rnaPath)) return (raw * RAD2DEG).toFixed(1)
  if (rnaPath === 'rotation_quaternion') return raw.toFixed(4)
  if (rnaPath === 'lens' || rnaPath === 'sensor_height') return raw.toFixed(1)
  if (rnaPath === 'location' || rnaPath === 'scale' ||
      rnaPath === 'clip_start' || rnaPath === 'clip_end' ||
      rnaPath === 'dof.focus_distance') return raw.toFixed(2)
  return raw.toFixed(3)
}

/** Parses user-typed display value back to internal; null if unparseable. */
export function parseValue (rnaPath: string, displayed: string): number | null {
  const n = parseFloat(displayed)
  if (!Number.isFinite(n)) return null
  if (isAngleRnaPath(rnaPath)) return n * DEG2RAD
  return n
}
