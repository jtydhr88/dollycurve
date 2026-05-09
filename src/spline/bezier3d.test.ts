import { describe, it, expect } from 'vitest'
import { makeSplinePath, makeSplinePoint } from '../data/factories'
import { bezierSegmentPos, pathPos, pathTangent, segmentCount } from './bezier3d'

describe('3D Bezier spline eval', () => {
  it('endpoints match anchor positions', () => {
    const a = makeSplinePoint([0, 0, 0], [1, 0, 0])
    const b = makeSplinePoint([10, 0, 0], [1, 0, 0])
    expect(bezierSegmentPos(a, b, 0)).toEqual([0, 0, 0])
    expect(bezierSegmentPos(a, b, 1)).toEqual([10, 0, 0])
  })

  it('straight line: midpoint at expected fraction', () => {
    // Linear handles → segment is a straight ramp.
    const a = makeSplinePoint([0, 0, 0], [1, 0, 0])
    const b = makeSplinePoint([10, 0, 0], [1, 0, 0])
    const path = makeSplinePath([a, b])
    expect(pathPos(path, 0.5)).toEqual([5, 0, 0])
  })

  it('clamps out-of-range u to endpoints', () => {
    const a = makeSplinePoint([0, 0, 0])
    const b = makeSplinePoint([5, 0, 0])
    const path = makeSplinePath([a, b])
    expect(pathPos(path, -1)).toEqual([0, 0, 0])
    expect(pathPos(path, 99)).toEqual([5, 0, 0])
  })

  it('tangent points along the curve direction', () => {
    const a = makeSplinePoint([0, 0, 0], [1, 0, 0])
    const b = makeSplinePoint([10, 0, 0], [1, 0, 0])
    const path = makeSplinePath([a, b])
    const t = pathTangent(path, 0.5)
    expect(t[0]).toBeCloseTo(1, 6)
    expect(Math.abs(t[1])).toBeLessThan(1e-6)
    expect(Math.abs(t[2])).toBeLessThan(1e-6)
  })

  it('closed loop wraps last segment to first', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 5, 0], [0, 1, 0]),
    ], { closed: true })
    expect(segmentCount(path)).toBe(3)
    // u = 3.0 wraps to first anchor
    expect(pathPos(path, 3.0)).toEqual([0, 0, 0])
  })

  it('open path has segmentCount = points - 1', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([5, 0, 0]),
      makeSplinePoint([5, 5, 0]),
    ])
    expect(segmentCount(path)).toBe(2)
  })

  it('tangent on perpendicular segments differs', () => {
    // First seg goes +X, second seg goes +Y. Mid of seg 0 should be ~+X,
    // mid of seg 1 should be ~+Y.
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 0, 0], [0, 1, 0]),
      makeSplinePoint([5, 5, 0], [0, 1, 0]),
    ])
    const t0 = pathTangent(path, 0.5)
    const t1 = pathTangent(path, 1.5)
    expect(t0[0]).toBeGreaterThan(0.9)  // +X dominant
    expect(t1[1]).toBeGreaterThan(0.9)  // +Y dominant
  })
})
