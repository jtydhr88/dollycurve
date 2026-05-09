import { describe, it, expect } from 'vitest'
import { Interpolation } from '../data/enums'
import { makeFCurve } from '../data/factories'
import { evaluateFCurve } from '../eval/evaluate'
import { bakeFCurve } from './bake'
import { cleanFCurve } from './clean'
import { decimateFCurve } from './decimate'
import { insertOrReplaceKeyframe } from './insert'

describe('bakeFCurve', () => {
  it('replaces existing keys in range with per-frame samples', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0, { ipo: Interpolation.LINEAR })
    insertOrReplaceKeyframe(fcu, 10, 100, { ipo: Interpolation.LINEAR })
    bakeFCurve(fcu, 0, 10, { step: 1 })
    expect(fcu.bezt).toHaveLength(11)
    for (let f = 0; f <= 10; f++) {
      expect(evaluateFCurve(fcu, f)).toBeCloseTo(f * 10, 1)
    }
  })

  it('bake at step=0.5 produces 2N+1 samples', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0, { ipo: Interpolation.LINEAR })
    insertOrReplaceKeyframe(fcu, 10, 100, { ipo: Interpolation.LINEAR })
    bakeFCurve(fcu, 0, 10, { step: 0.5 })
    expect(fcu.bezt).toHaveLength(21)
  })
})

describe('cleanFCurve', () => {
  it('removes redundant middle keys + trailing same-value last (matches Blender)', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 50)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 50)
    insertOrReplaceKeyframe(fcu, 30, 50)
    const removed = cleanFCurve(fcu, 1e-3)
    expect(removed).toBe(3)
    expect(fcu.bezt).toHaveLength(1)
    expect(fcu.bezt[0].vec[1][0]).toBe(0)
  })

  it('keeps keys where the value actually changes', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 0)
    const removed = cleanFCurve(fcu, 1e-3)
    expect(removed).toBe(0)
    expect(fcu.bezt).toHaveLength(3)
  })

  it('two-key constant curve collapses to one key', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 5)
    insertOrReplaceKeyframe(fcu, 10, 5)
    cleanFCurve(fcu, 1e-3)
    expect(fcu.bezt).toHaveLength(1)
  })

  it('keeps last key when it differs from previous (rising at the end)', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 0)
    insertOrReplaceKeyframe(fcu, 20, 100)
    cleanFCurve(fcu, 1e-3)
    // Middle key drops (matches both prev=0 and next=100? no — matches only prev),
    // but the last key (100) is preserved because it differs from prev=0.
    expect(fcu.bezt.length).toBeGreaterThanOrEqual(2)
    expect(fcu.bezt[fcu.bezt.length - 1].vec[1][1]).toBeCloseTo(100, 6)
  })
})

describe('decimateFCurve', () => {
  it('removeRatio=0 drops nothing if errorMax not set', () => {
    const fcu = makeFCurve('lens')
    for (let i = 0; i <= 10; i++) insertOrReplaceKeyframe(fcu, i, i * i)
    expect(decimateFCurve(fcu)).toBe(0)
    expect(fcu.bezt).toHaveLength(11)
  })

  it('removeRatio=0.5 drops about half the removable keys', () => {
    const fcu = makeFCurve('lens')
    // Smooth curve where middle keys are almost on the bezier between neighbors.
    for (let i = 0; i <= 20; i++) insertOrReplaceKeyframe(fcu, i, Math.sin(i / 4) * 10)
    const before = fcu.bezt.length
    const removed = decimateFCurve(fcu, { removeRatio: 0.5 })
    // 21 keys → 19 removable → target = 9
    expect(removed).toBeGreaterThanOrEqual(8)
    expect(removed).toBeLessThanOrEqual(10)
    expect(fcu.bezt.length).toBe(before - removed)
    // First and last preserved.
    expect(fcu.bezt[0].vec[1][0]).toBe(0)
    expect(fcu.bezt[fcu.bezt.length - 1].vec[1][0]).toBe(20)
  })

  it('errorMax bound stops removal once shape deviates too much', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 100)  // sharp peak — removing this hurts
    insertOrReplaceKeyframe(fcu, 20, 0)
    const removed = decimateFCurve(fcu, { removeRatio: 1, errorMax: 1 })
    expect(removed).toBe(0)  // the only removable key would deviate by >>1
  })
})
