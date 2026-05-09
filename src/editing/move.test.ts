import { describe, it, expect } from 'vitest'
import { Interpolation } from '../data/enums'
import { makeFCurve } from '../data/factories'
import { evaluateFCurve } from '../eval/evaluate'
import { insertOrReplaceKeyframe } from './insert'
import {
  moveKeyframe,
  moveKeyframeTimeWithHandles,
  moveKeyframeValueWithHandles,
} from './move'

describe('moveKeyframeTimeWithHandles / moveKeyframeValueWithHandles', () => {
  it('time delta applies equally to anchor and both handles', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 10, 50)
    const bz = fcu.bezt[0]
    bz.vec[0] = [9, 50]
    bz.vec[2] = [11, 50]
    moveKeyframeTimeWithHandles(bz, 30)
    expect(bz.vec[0]).toEqual([29, 50])
    expect(bz.vec[1][0]).toBe(30)
    expect(bz.vec[2]).toEqual([31, 50])
  })

  it('value delta applies equally to anchor and both handles', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 10, 50)
    const bz = fcu.bezt[0]
    bz.vec[0][1] = 45; bz.vec[2][1] = 55
    moveKeyframeValueWithHandles(bz, 100)
    expect(bz.vec[0][1]).toBeCloseTo(95, 6)
    expect(bz.vec[1][1]).toBe(100)
    expect(bz.vec[2][1]).toBeCloseTo(105, 6)
  })
})

describe('moveKeyframe high-level', () => {
  it('in-place move (no reorder) updates only neighborhood', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 0)
    const r = moveKeyframe(fcu, 1, 12, 60)
    expect(r.reordered).toBe(false)
    expect(r.newIndex).toBe(1)
    expect(fcu.bezt[1].vec[1]).toEqual([12, 60])
    // Curve still hits the moved key exactly.
    expect(evaluateFCurve(fcu, 12)).toBeCloseTo(60, 4)
  })

  it('move past neighbor reorders and recomputes handles', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0, { ipo: Interpolation.LINEAR })
    insertOrReplaceKeyframe(fcu, 10, 50, { ipo: Interpolation.LINEAR })
    insertOrReplaceKeyframe(fcu, 20, 0, { ipo: Interpolation.LINEAR })
    const movedKey = fcu.bezt[1]
    // Drag the middle key past the third — should swap order.
    const r = moveKeyframe(fcu, 1, 25)
    expect(r.reordered).toBe(true)
    expect(r.newIndex).toBe(2)
    expect(fcu.bezt[2]).toBe(movedKey)
    expect(fcu.bezt.map((b) => b.vec[1][0])).toEqual([0, 20, 25])
  })
})
