import { describe, it, expect } from 'vitest'
import { Vec2 } from '../data/types'
import { correctBezpart, findCubicBezierT, cubicBezierY, evalBezierSegment } from './bezier'
import { Easing, HandleType, Interpolation, KeyType } from '../data/enums'
import { BezTriple } from '../data/types'

function bz (t: number, v: number, lh: [number, number], rh: [number, number]): BezTriple {
  return {
    vec: [[lh[0], lh[1]], [t, v], [rh[0], rh[1]]],
    ipo: Interpolation.BEZIER,
    easing: Easing.AUTO,
    h1: HandleType.AUTO_CLAMPED,
    h2: HandleType.AUTO_CLAMPED,
    keyframeType: KeyType.KEYFRAME,
    back: 1.7, amplitude: 0, period: 0,
    selected: { h1: false, anchor: false, h2: false },
  }
}

describe('correctBezpart', () => {
  it('leaves handles alone when they fit within segment span', () => {
    const v1: Vec2 = [0, 0]
    const v2: Vec2 = [1, 1]
    const v3: Vec2 = [2, 1]
    const v4: Vec2 = [3, 0]
    correctBezpart(v1, v2, v3, v4)
    expect(v2).toEqual([1, 1])
    expect(v3).toEqual([2, 1])
  })

  it('clamps right handle of v2 when len1 > len', () => {
    const v1: Vec2 = [0, 0]
    const v2: Vec2 = [10, 5]   // way past v4
    const v3: Vec2 = [2.5, 1]
    const v4: Vec2 = [3, 0]
    correctBezpart(v1, v2, v3, v4)
    // len = 3, len1 = 10, fac = 0.3, v2 ← v1 - 0.3*(v1-v2) = 0 - 0.3*(-10,-5) = (3, 1.5)
    expect(v2[0]).toBeCloseTo(3, 8)
    expect(v2[1]).toBeCloseTo(1.5, 8)
  })

  it('clamps left handle of v3 when len2 > len', () => {
    const v1: Vec2 = [0, 0]
    const v2: Vec2 = [0.5, 1]
    const v3: Vec2 = [-7, 1]   // way past v1
    const v4: Vec2 = [3, 0]
    correctBezpart(v1, v2, v3, v4)
    // len = 3, len2 = 10, fac = 0.3, v3 ← v4 - 0.3*(v4-v3) = 3 - 0.3*(10, -1) = (0, 0.3)
    expect(v3[0]).toBeCloseTo(0, 8)
    expect(v3[1]).toBeCloseTo(0.3, 8)
  })
})

describe('findCubicBezierT + cubicBezierY', () => {
  it('linear-handle bezier degenerates to t = (x - q0)/(q3 - q0)', () => {
    // q0=0, q1=1, q2=2, q3=3 — handles colinear with anchors → bezier = linear in [0,3].
    const ts = findCubicBezierT(1.5, 0, 1, 2, 3)
    expect(ts).toHaveLength(1)
    expect(ts[0]).toBeCloseTo(0.5, 8)

    const y = cubicBezierY(ts[0], 0, 10, 20, 30)
    expect(y).toBeCloseTo(15, 8)  // linear in y too
  })

  it('symmetric ease-in-out maps midpoint to midpoint', () => {
    // x: 0, 0, 1, 1 — flat handles → x lingers at 0 and 1.
    // y: 0, 0, 1, 1 — same shape → S-curve through (0.5, 0.5)
    const ts = findCubicBezierT(0.5, 0, 0, 1, 1)
    expect(ts).toHaveLength(1)
    const y = cubicBezierY(ts[0], 0, 0, 1, 1)
    expect(y).toBeCloseTo(0.5, 6)
  })
})

describe('evalBezierSegment', () => {
  it('returns flat value when all 4 y components match', () => {
    const prev = bz(0, 5, [-1, 5], [1, 5])
    const next = bz(2, 5, [1, 5], [3, 5])
    expect(evalBezierSegment(prev, next, 1)).toBeCloseTo(5, 10)
  })

  it('linear handles produce linear interpolation', () => {
    // Anchors (0,0) → (10,100). Right handle of prev at (3.33, 33.33),
    // left handle of next at (6.67, 66.67) — colinear → linear.
    const prev = bz(0, 0, [-3.33, -33.33], [10 / 3, 100 / 3])
    const next = bz(10, 100, [20 / 3, 200 / 3], [13.33, 133.33])
    expect(evalBezierSegment(prev, next, 5)).toBeCloseTo(50, 4)
  })

  it('S-curve with flat handles dips below halfway', () => {
    // Anchor: (0,0), (10,100). Both handles flat (h2 of prev at (3.33, 0),
    // h1 of next at (6.67, 100)) → ease-in-out S curve.
    const prev = bz(0, 0, [-3.33, 0], [10 / 3, 0])
    const next = bz(10, 100, [20 / 3, 100], [13.33, 100])
    // At t=0.5 of an ease-in-out cubic, value ≈ 0.5 (symmetry).
    expect(evalBezierSegment(prev, next, 5)).toBeCloseTo(50, 4)
    // At t=0.25 of x, the y value < 25 (curve is concave-up here).
    expect(evalBezierSegment(prev, next, 2.5)).toBeLessThan(25)
  })
})
