// 3D cubic Bezier evaluation for camera path splines (parametric in t,
// distinct from eval/bezier.ts which is X-monotonic via Cardano for FCurves).

import { SplinePath, SplinePoint, Vec3 } from '../data/types'

/** Position on a single cubic bezier segment at parameter t in [0, 1].
 * P0 = a.co, P1 = a.h2, P2 = b.h1, P3 = b.co. */
export function bezierSegmentPos (a: SplinePoint, b: SplinePoint, t: number): Vec3 {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return [
    w0 * a.co[0] + w1 * a.h2[0] + w2 * b.h1[0] + w3 * b.co[0],
    w0 * a.co[1] + w1 * a.h2[1] + w2 * b.h1[1] + w3 * b.co[1],
    w0 * a.co[2] + w1 * a.h2[2] + w2 * b.h1[2] + w3 * b.co[2],
  ]
}

/** First derivative (tangent direction, NOT unit length). */
export function bezierSegmentTan (a: SplinePoint, b: SplinePoint, t: number): Vec3 {
  const u = 1 - t
  // d/dt of cubic Bezier = 3 * [(P1-P0)*u² + 2*(P2-P1)*u*t + (P3-P2)*t²]
  const w0 = 3 * u * u
  const w1 = 6 * u * t
  const w2 = 3 * t * t
  return [
    w0 * (a.h2[0] - a.co[0]) + w1 * (b.h1[0] - a.h2[0]) + w2 * (b.co[0] - b.h1[0]),
    w0 * (a.h2[1] - a.co[1]) + w1 * (b.h1[1] - a.h2[1]) + w2 * (b.co[1] - b.h1[1]),
    w0 * (a.h2[2] - a.co[2]) + w1 * (b.h1[2] - a.h2[2]) + w2 * (b.co[2] - b.h1[2]),
  ]
}

export function segmentCount (path: SplinePath): number {
  if (path.points.length < 2) return 0
  return path.closed ? path.points.length : path.points.length - 1
}

function segmentEnds (path: SplinePath, segIdx: number): [SplinePoint, SplinePoint] {
  const N = path.points.length
  const a = path.points[segIdx]
  const b = path.points[(segIdx + 1) % N]
  return [a, b]
}

/** Position at parameter u in [0, segmentCount(path)]. The integer part
 * picks the segment; the fractional part is the in-segment t. Out-of-range
 * u clamps to the nearest endpoint. */
export function pathPos (path: SplinePath, u: number): Vec3 {
  const segs = segmentCount(path)
  if (segs === 0) {
    const p = path.points[0]
    return p ? [p.co[0], p.co[1], p.co[2]] : [0, 0, 0]
  }
  if (u <= 0) return [...path.points[0].co]
  if (u >= segs) {
    const last = path.closed ? path.points[0] : path.points[path.points.length - 1]
    return [...last.co]
  }
  const segIdx = Math.floor(u)
  const t = u - segIdx
  const [a, b] = segmentEnds(path, segIdx)
  return bezierSegmentPos(a, b, t)
}

/** Unit tangent at parameter u in [0, segmentCount(path)]. */
export function pathTangent (path: SplinePath, u: number): Vec3 {
  const segs = segmentCount(path)
  if (segs === 0) return [1, 0, 0]
  let segIdx: number, t: number
  if (u <= 0)        { segIdx = 0; t = 0 }
  else if (u >= segs) { segIdx = segs - 1; t = 1 }
  else                { segIdx = Math.floor(u); t = u - segIdx }
  const [a, b] = segmentEnds(path, segIdx)
  const tan = bezierSegmentTan(a, b, t)
  const len = Math.hypot(tan[0], tan[1], tan[2])
  if (len === 0) return [1, 0, 0]
  return [tan[0] / len, tan[1] / len, tan[2] / len]
}
