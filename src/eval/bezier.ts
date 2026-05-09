import { BezTriple, Vec2 } from '../data/types'
import { solveCubic } from './solveCubic'

// Port of BKE_fcurve_correct_bezpart (fcurve.cc:1377). Mutates v2 and v3.
// Without this, dragging a handle past the next key flips the curve into a loop
// and the cubic root finder picks the wrong t.
export function correctBezpart (v1: Vec2, v2: Vec2, v3: Vec2, v4: Vec2): void {
  const len = v4[0] - v1[0]
  const len1 = Math.abs(v1[0] - v2[0])
  const len2 = Math.abs(v4[0] - v3[0])
  if (len1 + len2 === 0) return

  if (len1 > len) {
    const fac = len / len1
    v2[0] = v1[0] - fac * (v1[0] - v2[0])
    v2[1] = v1[1] - fac * (v1[1] - v2[1])
  }
  if (len2 > len) {
    const fac = len / len2
    v3[0] = v4[0] - fac * (v4[0] - v3[0])
    v3[1] = v4[1] - fac * (v4[1] - v3[1])
  }
}

// Port of findzero (fcurve.cc:1535).
export function findCubicBezierT (
  x: number,
  q0: number,
  q1: number,
  q2: number,
  q3: number,
): number[] {
  const c0 = q0 - x
  const c1 = 3 * (q1 - q0)
  const c2 = 3 * (q0 - 2 * q1 + q2)
  const c3 = q3 - q0 + 3 * (q1 - q2)
  return solveCubic(c0, c1, c2, c3)
}

// Port of berekeny (fcurve.cc:1545).
export function cubicBezierY (
  t: number,
  f1: number,
  f2: number,
  f3: number,
  f4: number,
): number {
  const c0 = f1
  const c1 = 3 * (f2 - f1)
  const c2 = 3 * (f1 - 2 * f2 + f3)
  const c3 = f4 - f1 + 3 * (f2 - f3)
  return c0 + t * c1 + t * t * c2 + t * t * t * c3
}

// Port of the BEZT_IPO_BEZ branch in fcurve_eval_keyframes_interpolate (fcurve.cc:2095).
export function evalBezierSegment (prev: BezTriple, next: BezTriple, frame: number): number {
  const v1: Vec2 = [prev.vec[1][0], prev.vec[1][1]]
  const v2: Vec2 = [prev.vec[2][0], prev.vec[2][1]]
  const v3: Vec2 = [next.vec[0][0], next.vec[0][1]]
  const v4: Vec2 = [next.vec[1][0], next.vec[1][1]]

  // Flat-segment optimization (fcurve.cc:2110).
  const FLT_EPS = 1.1920929e-7
  if (
    Math.abs(v1[1] - v4[1]) < FLT_EPS &&
    Math.abs(v2[1] - v3[1]) < FLT_EPS &&
    Math.abs(v3[1] - v4[1]) < FLT_EPS
  ) {
    return v1[1]
  }

  correctBezpart(v1, v2, v3, v4)

  const ts = findCubicBezierT(frame, v1[0], v2[0], v3[0], v4[0])
  if (ts.length === 0) return 0

  return cubicBezierY(ts[0], v1[1], v2[1], v3[1], v4[1])
}
