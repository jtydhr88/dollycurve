// 3D analog of Blender's BKE_nurb_handle_calc_simple in editcurve.cc.

import { HandleType } from '../data/enums'
import { SplinePath, SplinePoint, Vec3 } from '../data/types'

const sub  = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add  = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const muls = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const len  = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

export function h1Type (p: SplinePoint): HandleType {
  return p.h1Type ?? HandleType.AUTO
}
export function h2Type (p: SplinePoint): HandleType {
  return p.h2Type ?? HandleType.AUTO
}

// AUTO_CLAMPED is omitted — it's in the data model for FCurve compat but
// behaves like AUTO for spline edits.
const CYCLE: HandleType[] = [HandleType.AUTO, HandleType.VECTOR, HandleType.ALIGN, HandleType.FREE]

export function nextHandleType (t: HandleType): HandleType {
  const i = CYCLE.indexOf(t === HandleType.AUTO_CLAMPED ? HandleType.AUTO : t)
  return CYCLE[(i + 1) % CYCLE.length]
}

function neighbors (path: SplinePath, idx: number): { prev: SplinePoint | null; next: SplinePoint | null } {
  const N = path.points.length
  const prev = idx > 0 ? path.points[idx - 1] : path.closed ? path.points[N - 1] : null
  const next = idx < N - 1 ? path.points[idx + 1] : path.closed ? path.points[0] : null
  return { prev, next }
}

/** Resnap h1/h2 of point `idx` from neighbor positions. FREE/ALIGN sides
 * are left as-is. */
export function recalcSplineHandle (path: SplinePath, idx: number): void {
  const p = path.points[idx]
  if (!p) return
  const { prev, next } = neighbors(path, idx)
  const t1 = h1Type(p)
  const t2 = h2Type(p)

  // Catmull-Rom-style tangent through neighbors; endpoints use the lone side.
  let tan: Vec3 = [0, 0, 0]
  if (prev && next) tan = norm(sub(next.co, prev.co))
  else if (next) tan = norm(sub(next.co, p.co))
  else if (prev) tan = norm(sub(p.co, prev.co))

  if (t1 === HandleType.AUTO || t1 === HandleType.AUTO_CLAMPED) {
    const lenPrev = prev ? len(sub(p.co, prev.co)) / 3 : (next ? len(sub(next.co, p.co)) / 3 : 1)
    p.h1 = sub(p.co, muls(tan, lenPrev))
  } else if (t1 === HandleType.VECTOR) {
    if (prev) p.h1 = add(p.co, muls(sub(prev.co, p.co), 1 / 3))
    else p.h1 = sub(p.co, muls(tan, 1))
  }

  if (t2 === HandleType.AUTO || t2 === HandleType.AUTO_CLAMPED) {
    const lenNext = next ? len(sub(next.co, p.co)) / 3 : (prev ? len(sub(p.co, prev.co)) / 3 : 1)
    p.h2 = add(p.co, muls(tan, lenNext))
  } else if (t2 === HandleType.VECTOR) {
    if (next) p.h2 = add(p.co, muls(sub(next.co, p.co), 1 / 3))
    else p.h2 = add(p.co, muls(tan, 1))
  }
}

export function recalcAllSplineHandles (path: SplinePath): void {
  for (let i = 0; i < path.points.length; i++) recalcSplineHandle(path, i)
}

/** Mirror the opposite handle if its type is ALIGN, keeping its length.
 * `shiftInvert` flips the behavior for one drag (Blender pen-tool
 * FREE_ALIGN_TOGGLE). */
export function applyAlignAfterDrag (point: SplinePoint, dragged: 'h1' | 'h2', shiftInvert = false): void {
  const otherType = dragged === 'h1' ? h2Type(point) : h1Type(point)
  let mirror = otherType === HandleType.ALIGN
  if (shiftInvert) mirror = !mirror
  if (!mirror) return

  if (dragged === 'h1') {
    const dir = norm(sub(point.co, point.h1))
    if (len(dir) < 1e-9) return
    const oldLen = len(sub(point.h2, point.co))
    point.h2 = add(point.co, muls(dir, oldLen))
  } else {
    const dir = norm(sub(point.co, point.h2))
    if (len(dir) < 1e-9) return
    const oldLen = len(sub(point.h1, point.co))
    point.h1 = add(point.co, muls(dir, oldLen))
  }
}
