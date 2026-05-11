import { describe, it, expect } from 'vitest'
import { HandleType } from '../data/enums'
import { makeSplinePath, makeSplinePoint } from '../data/factories'
import {
  applyAlignAfterDrag,
  nextHandleType,
  recalcAllSplineHandles,
  recalcSplineHandle,
} from './handles'

describe('nextHandleType', () => {
  it('cycles AUTO → VECTOR → ALIGN → FREE → AUTO', () => {
    expect(nextHandleType(HandleType.AUTO)).toBe(HandleType.VECTOR)
    expect(nextHandleType(HandleType.VECTOR)).toBe(HandleType.ALIGN)
    expect(nextHandleType(HandleType.ALIGN)).toBe(HandleType.FREE)
    expect(nextHandleType(HandleType.FREE)).toBe(HandleType.AUTO)
  })

  it('treats AUTO_CLAMPED like AUTO for the cycle entry point', () => {
    expect(nextHandleType(HandleType.AUTO_CLAMPED)).toBe(HandleType.VECTOR)
  })
})

describe('recalcSplineHandle — VECTOR', () => {
  it('snaps an interior point\'s VECTOR handles to 1/3 toward each neighbor', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([3, 0, 0]),
      makeSplinePoint([6, 0, 0]),
    ])
    path.points[1].h1Type = HandleType.VECTOR
    path.points[1].h2Type = HandleType.VECTOR
    recalcSplineHandle(path, 1)
    // h1 should be 1/3 from p1.co toward p0.co = [3,0,0] + ([0,0,0] - [3,0,0])/3 = [2,0,0]
    expect(path.points[1].h1).toEqual([2, 0, 0])
    // h2 = [3,0,0] + ([6,0,0] - [3,0,0])/3 = [4,0,0]
    expect(path.points[1].h2).toEqual([4, 0, 0])
  })
})

describe('recalcSplineHandle — AUTO', () => {
  it('places interior AUTO handles along the Catmull-Rom tangent at gap/3', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([3, 0, 0]),
      makeSplinePoint([6, 0, 0]),
    ])
    // (default types are AUTO when omitted)
    recalcSplineHandle(path, 1)
    // tangent = normalize([6,0,0] - [0,0,0]) = [1,0,0]
    // h1 = [3,0,0] - [1,0,0]*(|[3,0,0]-[0,0,0]|/3) = [3,0,0] - [1,0,0] = [2,0,0]
    // h2 = [3,0,0] + [1,0,0]*1                                          = [4,0,0]
    expect(path.points[1].h1[0]).toBeCloseTo(2, 6)
    expect(path.points[1].h2[0]).toBeCloseTo(4, 6)
  })

  it('endpoint with no prev neighbor uses the lone next-vector', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([3, 0, 0]),
    ])
    recalcSplineHandle(path, 0)
    // tangent = normalize([3,0,0] - [0,0,0]) = [1,0,0]
    // h2 = co + tan * (|next - co|/3) = [0,0,0] + [1,0,0]*1 = [1,0,0]
    expect(path.points[0].h2[0]).toBeCloseTo(1, 6)
  })
})

describe('recalcSplineHandle — leaves FREE/ALIGN handles alone', () => {
  it('FREE side keeps its existing position', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([3, 0, 0]),
      makeSplinePoint([6, 0, 0]),
    ])
    path.points[1].h1Type = HandleType.FREE
    path.points[1].h2Type = HandleType.FREE
    path.points[1].h1 = [3, 5, 0]   // arbitrary
    path.points[1].h2 = [3, -5, 0]
    recalcSplineHandle(path, 1)
    expect(path.points[1].h1).toEqual([3, 5, 0])
    expect(path.points[1].h2).toEqual([3, -5, 0])
  })
})

describe('applyAlignAfterDrag', () => {
  it('mirrors h2 direction through the anchor when h2Type is ALIGN', () => {
    const p = makeSplinePoint([0, 0, 0], [1, 0, 0])
    // Pre-drag: h1 = [-1,0,0], h2 = [1,0,0]. Both length 1.
    p.h2Type = HandleType.ALIGN
    // User drags h1 to [0, 1, 0] (now points up along Y).
    p.h1 = [0, 1, 0]
    applyAlignAfterDrag(p, 'h1')
    // h2 should now point opposite of h1 from anchor, length kept at 1.
    expect(p.h2[0]).toBeCloseTo(0, 6)
    expect(p.h2[1]).toBeCloseTo(-1, 6)
    expect(p.h2[2]).toBeCloseTo(0, 6)
  })

  it('does nothing when the opposite side isn\'t ALIGN', () => {
    const p = makeSplinePoint([0, 0, 0], [1, 0, 0])
    p.h2Type = HandleType.FREE
    p.h1 = [0, 1, 0]
    applyAlignAfterDrag(p, 'h1')
    expect(p.h2).toEqual([1, 0, 0])  // unchanged
  })

  it('shiftInvert promotes a FREE opposite handle to mirror behavior', () => {
    const p = makeSplinePoint([0, 0, 0], [1, 0, 0])
    p.h2Type = HandleType.FREE
    p.h1 = [0, 1, 0]
    applyAlignAfterDrag(p, 'h1', true)
    expect(p.h2[0]).toBeCloseTo(0, 6)
    expect(p.h2[1]).toBeCloseTo(-1, 6)
    expect(p.h2[2]).toBeCloseTo(0, 6)
  })

  it('shiftInvert suppresses the mirror when the opposite is ALIGN', () => {
    const p = makeSplinePoint([0, 0, 0], [1, 0, 0])
    p.h2Type = HandleType.ALIGN
    p.h1 = [0, 1, 0]
    applyAlignAfterDrag(p, 'h1', true)
    expect(p.h2).toEqual([1, 0, 0])  // unchanged because Shift inverted
  })
})

describe('recalcAllSplineHandles', () => {
  it('settles every AUTO point in one sweep', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([3, 0, 0]),
      makeSplinePoint([6, 0, 0]),
    ])
    // Trash the handles to confirm the recalc actually runs.
    for (const p of path.points) { p.h1 = [99, 99, 99]; p.h2 = [99, 99, 99] }
    recalcAllSplineHandles(path)
    // Center point lands exactly on x-axis tangent.
    expect(path.points[1].h1[1]).toBeCloseTo(0, 6)
    expect(path.points[1].h2[1]).toBeCloseTo(0, 6)
  })
})
