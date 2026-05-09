// Arc-length parameterization for SplinePath: cumulative-length table maps
// distance s in [0, totalLength] to bezier parameter u in [0, segmentCount].

import { SplinePath, Vec3 } from '../data/types'
import { bezierSegmentPos, segmentCount } from './bezier3d'

export interface ArcTable {
  /** Cumulative arc length at each sample (length = N+1 where N = totalSamples). */
  cumLen: Float64Array
  /** Segment index for each sample. cumLen[i] corresponds to segIdx[i] + (i % perSeg)/perSeg. */
  perSeg: number
  totalLen: number
  segments: number
}

const DEFAULT_RES = 32

export function buildArcTable (path: SplinePath): ArcTable {
  const segments = segmentCount(path)
  const perSeg = path.resolution ?? DEFAULT_RES
  if (segments === 0) {
    return { cumLen: new Float64Array([0]), perSeg, totalLen: 0, segments: 0 }
  }
  const N = segments * perSeg + 1
  const cumLen = new Float64Array(N)
  const points = path.points
  let acc = 0
  let prev: Vec3 | null = null
  let idx = 0
  for (let s = 0; s < segments; s++) {
    const a = points[s]
    const b = points[(s + 1) % points.length]
    for (let k = 0; k <= perSeg; k++) {
      // Skip duplicate sample at segment boundary (already in previous segment).
      if (s > 0 && k === 0) continue
      const t = k / perSeg
      const p = bezierSegmentPos(a, b, t)
      if (prev) {
        acc += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])
      }
      cumLen[idx++] = acc
      prev = p
    }
  }
  return { cumLen, perSeg, totalLen: acc, segments }
}

/** Map arc-length distance `s` (in [0, totalLen]) to bezier parameter u
 * (in [0, segmentCount]) via binary search + linear interpolation between
 * adjacent samples. */
export function arcLengthToU (table: ArcTable, s: number): number {
  if (table.segments === 0) return 0
  if (s <= 0) return 0
  if (s >= table.totalLen) return table.segments
  const arr = table.cumLen
  let lo = 0, hi = arr.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= s) lo = mid
    else hi = mid
  }
  const span = arr[lo + 1] - arr[lo]
  const frac = span > 0 ? (s - arr[lo]) / span : 0
  // Sample i maps to u = i / perSeg (boundaries deduped to perSeg per segment).
  return (lo + frac) / table.perSeg
}

/** Inverse of arcLengthToU: parameter u → arc-length distance s. */
export function uToArcLength (table: ArcTable, u: number): number {
  if (table.segments === 0) return 0
  if (u <= 0) return 0
  if (u >= table.segments) return table.totalLen
  const sampleF = u * table.perSeg
  const lo = Math.floor(sampleF)
  const frac = sampleF - lo
  return table.cumLen[lo] + (table.cumLen[lo + 1] - table.cumLen[lo]) * frac
}
