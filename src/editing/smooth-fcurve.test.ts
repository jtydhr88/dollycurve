import { describe, it, expect } from 'vitest'
import { AutoSmoothing, CycleMode, HandleType } from '../data/enums'
import { makeBezTriple, makeCyclesModifier, makeFCurve } from '../data/factories'
import { recalcAllHandles } from './handles'
import { evaluateFCurve } from '../eval/evaluate'

// Numerical second-derivative via central differences on first derivative.
function accelAt (fcu: ReturnType<typeof makeFCurve>, frame: number, h = 0.01): number {
  const v1 = (evaluateFCurve(fcu, frame + h)     - evaluateFCurve(fcu, frame - h))     / (2 * h)
  const v2 = (evaluateFCurve(fcu, frame + 3 * h) - evaluateFCurve(fcu, frame +     h)) / (2 * h)
  return (v2 - v1) / (2 * h)
}

describe('CONTINUOUS_ACCELERATION smooth pass (curve.cc:3897 BKE_nurb_handle_smooth_fcurve)', () => {
  it('zero acceleration discontinuity at interior keys for irregular spacing', () => {
    // Asymmetric segment widths force the smoothing to actively rebalance handles.
    const fcu = makeFCurve('value', [
      makeBezTriple(0,  0, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(2,  3, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(7,  4, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(10, 1, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
    ])
    fcu.autoSmoothing = AutoSmoothing.CONTINUOUS_ACCELERATION
    recalcAllHandles(fcu)

    // At the interior keys (frames 2 and 7), accel from the left should match accel from the right.
    for (const f of [2, 7]) {
      const aL = accelAt(fcu, f - 0.05)
      const aR = accelAt(fcu, f + 0.05)
      expect(Math.abs(aL - aR)).toBeLessThan(0.5)
    }
  })

  it('NONE smoothing leaves accel discontinuous at the same keys', () => {
    const fcu = makeFCurve('value', [
      makeBezTriple(0,  0, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(2,  3, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(7,  4, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(10, 1, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
    ])
    fcu.autoSmoothing = AutoSmoothing.NONE
    recalcAllHandles(fcu)

    // Without smoothing there's a noticeable second-derivative jump somewhere.
    let maxJump = 0
    for (const f of [2, 7]) {
      const aL = accelAt(fcu, f - 0.05)
      const aR = accelAt(fcu, f + 0.05)
      maxJump = Math.max(maxJump, Math.abs(aL - aR))
    }
    expect(maxJump).toBeGreaterThan(1)
  })

  it('VECTOR handles end the smoothing sub-sequence (locked-final)', () => {
    // The middle key has VECTOR handles → smoothing splits at it.
    const fcu = makeFCurve('value', [
      makeBezTriple(0,  0, { h1: HandleType.AUTO,   h2: HandleType.AUTO }),
      makeBezTriple(5,  3, { h1: HandleType.VECTOR, h2: HandleType.VECTOR }),
      makeBezTriple(10, 0, { h1: HandleType.AUTO,   h2: HandleType.AUTO }),
    ])
    fcu.autoSmoothing = AutoSmoothing.CONTINUOUS_ACCELERATION
    expect(() => recalcAllHandles(fcu)).not.toThrow()
    // VECTOR handles point 1/3 toward neighbors — verify they survived.
    const mid = fcu.bezt[1]
    expect(mid.vec[0][0]).toBeCloseTo(5 - 5 / 3, 5)
    expect(mid.vec[2][0]).toBeCloseTo(5 + 5 / 3, 5)
  })

  it('cyclic curve (with REPEAT_OFFSET) smooths across the seam', () => {
    const fcu = makeFCurve('value', [
      makeBezTriple(0,  0, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(3,  2, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(7,  5, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(10, 10, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
    ])
    fcu.autoSmoothing = AutoSmoothing.CONTINUOUS_ACCELERATION
    fcu.modifiers.push(makeCyclesModifier(CycleMode.REPEAT_OFFSET, CycleMode.REPEAT_OFFSET))
    expect(() => recalcAllHandles(fcu)).not.toThrow()
    // Numerical sanity: shouldn't produce NaN handles or absurd magnitudes.
    for (const b of fcu.bezt) {
      expect(Number.isFinite(b.vec[0][1])).toBe(true)
      expect(Number.isFinite(b.vec[2][1])).toBe(true)
      expect(Math.abs(b.vec[0][1])).toBeLessThan(1000)
      expect(Math.abs(b.vec[2][1])).toBeLessThan(1000)
    }
  })

  it('two-key curve does not blow up', () => {
    const fcu = makeFCurve('value', [
      makeBezTriple(0,  0, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      makeBezTriple(10, 5, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
    ])
    fcu.autoSmoothing = AutoSmoothing.CONTINUOUS_ACCELERATION
    expect(() => recalcAllHandles(fcu)).not.toThrow()
  })

  it('NONE keeps simple shape; CONT_ACCEL changes it (the option does something)', () => {
    const make = (smooth: AutoSmoothing) => {
      const fcu = makeFCurve('value', [
        makeBezTriple(0,  0, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
        makeBezTriple(2,  3, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
        makeBezTriple(7,  4, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
        makeBezTriple(10, 1, { h1: HandleType.AUTO, h2: HandleType.AUTO }),
      ])
      fcu.autoSmoothing = smooth
      recalcAllHandles(fcu)
      return fcu
    }
    const a = make(AutoSmoothing.NONE)
    const b = make(AutoSmoothing.CONTINUOUS_ACCELERATION)

    // The smoothing pass must make a measurable difference.
    let diff = 0
    for (let i = 0; i < a.bezt.length; i++) {
      diff += Math.abs(a.bezt[i].vec[0][1] - b.bezt[i].vec[0][1])
      diff += Math.abs(a.bezt[i].vec[2][1] - b.bezt[i].vec[2][1])
    }
    expect(diff).toBeGreaterThan(0.1)
  })
})
