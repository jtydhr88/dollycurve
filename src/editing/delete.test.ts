import { describe, it, expect } from 'vitest'
import { makeFCurve } from '../data/factories'
import { evaluateFCurve } from '../eval/evaluate'
import { insertOrReplaceKeyframe } from './insert'
import { deleteKeyframe, deleteKeyframesAtFrames } from './delete'

describe('deleteKeyframe', () => {
  it('removes the key at idx and re-runs handle calc on neighbors', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 0)
    expect(deleteKeyframe(fcu, 1)).toBe(true)
    expect(fcu.bezt).toHaveLength(2)
    // Curve now interpolates 0 → 0 across [0, 20]; sampled in middle should be ~0.
    expect(evaluateFCurve(fcu, 10)).toBeCloseTo(0, 6)
  })

  it('returns false on out-of-range idx', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 10, 50)
    expect(deleteKeyframe(fcu, -1)).toBe(false)
    expect(deleteKeyframe(fcu, 5)).toBe(false)
  })
})

describe('deleteKeyframesAtFrames', () => {
  it('deletes multiple keys by frame value', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 25)
    insertOrReplaceKeyframe(fcu, 30, 0)
    const n = deleteKeyframesAtFrames(fcu, [10, 20])
    expect(n).toBe(2)
    expect(fcu.bezt.map((b) => b.vec[1][0])).toEqual([0, 30])
  })
})
