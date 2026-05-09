import { describe, it, expect } from 'vitest'
import { makeSplinePath, makeSplinePoint } from '../data/factories'
import { buildFrames, frameAtU, frameToQuaternion } from './orientation'

describe('parallel-transport orientation', () => {
  it('straight line: up vector stays equal to seed', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ])
    const frames = buildFrames(path, 'Y', 8)
    for (const f of frames) {
      expect(f.up[0]).toBeCloseTo(0, 5)
      expect(f.up[1]).toBeCloseTo(1, 5)  // unchanged
      expect(f.up[2]).toBeCloseTo(0, 5)
    }
  })

  it('frames are continuous (consecutive ups don\'t flip suddenly)', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0]),
      makeSplinePoint([5, 5, 0],  [1, 1, 0]),
      makeSplinePoint([10, 0, 5], [1, -1, 1]),
    ])
    const frames = buildFrames(path, 'Y', 32)
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].up
      const b = frames[i].up
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      expect(dot).toBeGreaterThan(0.85)  // no sudden flip
    }
  })

  it('forward = unit tangent', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ])
    const frames = buildFrames(path, 'Y', 4)
    for (const f of frames) {
      const len = Math.hypot(f.forward[0], f.forward[1], f.forward[2])
      expect(len).toBeCloseTo(1, 5)
    }
  })

  it('right is orthogonal to forward and up', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 5, 0], [1, 1, 0]),
    ])
    const frames = buildFrames(path, 'Y', 8)
    for (const f of frames) {
      const dotFR = f.forward[0] * f.right[0] + f.forward[1] * f.right[1] + f.forward[2] * f.right[2]
      const dotUR = f.up[0] * f.right[0] + f.up[1] * f.right[1] + f.up[2] * f.right[2]
      expect(Math.abs(dotFR)).toBeLessThan(1e-5)
      expect(Math.abs(dotUR)).toBeLessThan(1e-5)
    }
  })

  it('upAxis seed parallel to tangent falls back to a perpendicular', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [0, 1, 0]),  // tangent = +Y
      makeSplinePoint([0, 10, 0], [0, 1, 0]),
    ])
    // Seed up = +Y too — degenerate. Should not produce NaN.
    const frames = buildFrames(path, 'Y', 4)
    for (const f of frames) {
      expect(Number.isFinite(f.up[0])).toBe(true)
      expect(Number.isFinite(f.up[1])).toBe(true)
      expect(Number.isFinite(f.up[2])).toBe(true)
      const len = Math.hypot(f.up[0], f.up[1], f.up[2])
      expect(len).toBeCloseTo(1, 4)
    }
  })

  it('cyclic curve: seam-roll redistribution closes the loop', () => {
    // A 3D loop with non-zero torsion (helix-like cycle) — naive parallel
    // transport leaves a visible roll discontinuity at the seam. Mirrors
    // Blender's curve.cc:2248-2309 fix.
    const path = makeSplinePath([
      makeSplinePoint([5,  0, 0], [0, 1, 0]),
      makeSplinePoint([0,  5, 1], [-1, 0, 0]),
      makeSplinePoint([-5, 0, 2], [0, -1, 0]),
      makeSplinePoint([0, -5, 1], [1, 0, 0]),
    ], { closed: true })
    const frames = buildFrames(path, 'Z', 64)
    // After redistribution, last sample's up (rotated into first's tangent
    // plane to account for any tangent change at the seam) should match
    // first sample's up to within a small tolerance.
    const N = frames.length
    const last = frames[N - 1]
    const first = frames[0]
    // The two should now agree closely on roll.
    const dotUp = last.up[0] * first.up[0] + last.up[1] * first.up[1] + last.up[2] * first.up[2]
    expect(dotUp).toBeGreaterThan(0.99)  // < ~8° residual
  })

  it('frameAtU(0) matches buildFrames first sample', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 0, 5], [1, 0, 1]),
    ])
    const frames = buildFrames(path, 'Y', 16)
    const single = frameAtU(path, 'Y', 0, 16)
    expect(single.forward[0]).toBeCloseTo(frames[0].forward[0], 5)
    expect(single.forward[1]).toBeCloseTo(frames[0].forward[1], 5)
    expect(single.forward[2]).toBeCloseTo(frames[0].forward[2], 5)
  })
})

describe('frameToQuaternion', () => {
  it('produces a unit quaternion', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 5, 0], [1, 1, 0]),
    ])
    const frames = buildFrames(path, 'Y', 8)
    for (const f of frames) {
      const q = frameToQuaternion(f)
      const len = Math.hypot(q[0], q[1], q[2], q[3])
      expect(len).toBeCloseTo(1, 4)
    }
  })

  it('zero roll: produces same quaternion as no roll arg', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ])
    const f = buildFrames(path, 'Y', 4)[0]
    const a = frameToQuaternion(f)
    const b = frameToQuaternion(f, 0)
    for (let i = 0; i < 4; i++) expect(a[i]).toBeCloseTo(b[i], 6)
  })
})
