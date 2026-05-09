import { describe, it, expect } from 'vitest'
import { makeCameraAction, makeFCurve } from '../data/factories'
import { evaluateFCurve } from '../eval/evaluate'
import { Interpolation } from '../data/enums'
import { insertOrReplaceKeyframe, insertScalarKey, insertVec3Key } from './insert'

describe('insertOrReplaceKeyframe', () => {
  it('inserts a key into an empty curve', () => {
    const fcu = makeFCurve('lens')
    const r = insertOrReplaceKeyframe(fcu, 24, 50)
    expect(r.replaced).toBe(false)
    expect(fcu.bezt).toHaveLength(1)
    expect(fcu.bezt[0].vec[1]).toEqual([24, 50])
  })

  it('inserts in chronological order', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 24, 50)
    insertOrReplaceKeyframe(fcu, 12, 35)
    insertOrReplaceKeyframe(fcu, 36, 85)
    const times = fcu.bezt.map((b) => b.vec[1][0])
    expect(times).toEqual([12, 24, 36])
  })

  it('replaces value at exact time, preserving non-overridden settings', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 24, 50, { ipo: Interpolation.LINEAR })
    const r = insertOrReplaceKeyframe(fcu, 24, 70)
    expect(r.replaced).toBe(true)
    expect(fcu.bezt).toHaveLength(1)
    expect(fcu.bezt[0].vec[1][1]).toBe(70)
    expect(fcu.bezt[0].ipo).toBe(Interpolation.LINEAR)
  })
})

describe('handle calc after insert produces smooth interpolation', () => {
  it('three keys with auto handles produce a continuous bezier through anchors', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 0)
    expect(evaluateFCurve(fcu, 0)).toBeCloseTo(0, 3)
    expect(evaluateFCurve(fcu, 10)).toBeCloseTo(50, 3)
    expect(evaluateFCurve(fcu, 20)).toBeCloseTo(0, 3)
  })

  it('AUTO_CLAMPED middle key at local Y-max does not overshoot', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 0)
    // Sample densely around the peak and verify nothing exceeds 50.
    let peak = 0
    for (let f = 0; f <= 20; f += 0.1) peak = Math.max(peak, evaluateFCurve(fcu, f))
    expect(peak).toBeLessThanOrEqual(50 + 1e-3)
    expect(peak).toBeGreaterThanOrEqual(50 - 1e-3)
  })

  it('AUTO_CLAMPED on a steep asymmetric peak triggers violate-and-mirror branch', () => {
    // Asymmetric peak: prev=0 → cur=100 (jump) → next=80 (smaller drop).
    // Without violate clamp, cur's right-handle Y would shoot above next.y=80,
    // creating a curve that overshoots the next anchor on the right side.
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 100)
    insertOrReplaceKeyframe(fcu, 20, 80)
    const peak = fcu.bezt[1]
    // ydiff1 = 0 - 100 = -100 (≤0), ydiff2 = 80 - 100 = -20 (≤0).
    // BOTH on same side → extreme branch fires → both handles flatten.
    // (This particular setup is still an extreme; we need ydiff to differ in sign.)
    // Re-test with prev rising and next still rising but slower:
    fcu.bezt.length = 0
    insertOrReplaceKeyframe(fcu, 0, 0)
    insertOrReplaceKeyframe(fcu, 10, 100)
    insertOrReplaceKeyframe(fcu, 20, 200)  // continues rising
    const mid = fcu.bezt[1]
    // ydiff1 = -100, ydiff2 = +100. Different signs → violate branch (not extreme).
    // Auto direction at mid = (rise_in/dx_in + rise_out/dx_out) ≈ steep upward.
    // Right-handle Y ≈ mid.y + slope * dx_h → can shoot past next=200.
    // Violate branch should clamp it to ≤ next.y, then mirror onto left.
    expect(mid.vec[2][1]).toBeLessThanOrEqual(200 + 1e-3)
    // Sample: check that no point on the curve overshoots above 200.
    let max = 0
    for (let f = 0; f <= 20; f += 0.1) {
      max = Math.max(max, evaluateFCurve(fcu, f))
    }
    expect(max).toBeLessThanOrEqual(200 + 1)
    void peak  // silence unused
  })

  it('first/last AUTO_CLAMPED keys with CONSTANT extend get flat edge handles', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 10)
    insertOrReplaceKeyframe(fcu, 10, 50)
    insertOrReplaceKeyframe(fcu, 20, 30)
    const first = fcu.bezt[0]
    const last = fcu.bezt[fcu.bezt.length - 1]
    expect(first.vec[0][1]).toBeCloseTo(10, 6)
    expect(first.vec[2][1]).toBeCloseTo(10, 6)
    expect(last.vec[0][1]).toBeCloseTo(30, 6)
    expect(last.vec[2][1]).toBeCloseTo(30, 6)
  })

  it('newly-inserted middle key inherits ipo from previous key', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 0, 0, { ipo: Interpolation.LINEAR })
    insertOrReplaceKeyframe(fcu, 20, 100, { ipo: Interpolation.LINEAR })
    insertOrReplaceKeyframe(fcu, 10, 60)  // no explicit ipo
    const middle = fcu.bezt.find((b) => b.vec[1][0] === 10)!
    expect(middle.ipo).toBe(Interpolation.LINEAR)
  })

  it('newly-inserted first key inherits ipo from old first (next neighbor)', () => {
    const fcu = makeFCurve('lens')
    insertOrReplaceKeyframe(fcu, 10, 100, { ipo: Interpolation.CONSTANT })
    insertOrReplaceKeyframe(fcu, 0, 0)
    const first = fcu.bezt[0]
    expect(first.ipo).toBe(Interpolation.CONSTANT)
  })
})

describe('insertVec3Key / insertScalarKey', () => {
  it('insertVec3Key creates 3 FCurves and inserts a key in each', () => {
    const action = makeCameraAction()
    insertVec3Key(action, 'location', 24, [1, 2, 3])
    expect(action.fcurves).toHaveLength(3)
    expect(action.fcurves.map((f) => f.arrayIndex).sort()).toEqual([0, 1, 2])
    for (const fcu of action.fcurves) {
      expect(fcu.bezt).toHaveLength(1)
      expect(fcu.bezt[0].vec[1][0]).toBe(24)
    }
    const xCurve = action.fcurves.find((f) => f.arrayIndex === 0)!
    expect(xCurve.bezt[0].vec[1][1]).toBe(1)
  })

  it('insertVec3Key called twice updates the same FCurves (no duplicates)', () => {
    const action = makeCameraAction()
    insertVec3Key(action, 'location', 0, [0, 0, 0])
    insertVec3Key(action, 'location', 24, [10, 20, 30])
    expect(action.fcurves).toHaveLength(3)
    for (const fcu of action.fcurves) expect(fcu.bezt).toHaveLength(2)
  })

  it('insertScalarKey creates one FCurve at arrayIndex=0', () => {
    const action = makeCameraAction()
    insertScalarKey(action, 'lens', 24, 50)
    expect(action.fcurves).toHaveLength(1)
    expect(action.fcurves[0].rnaPath).toBe('lens')
    expect(action.fcurves[0].arrayIndex).toBe(0)
  })
})
