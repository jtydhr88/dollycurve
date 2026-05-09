import { describe, it, expect } from 'vitest'
import { CycleMode, HandleType, Interpolation } from '../data/enums'
import { makeBezTriple, makeFCurve, makeCyclesModifier } from '../data/factories'
import { recalcAllHandles } from './handles'
import { evaluateFCurve } from '../eval/evaluate'

// Velocity = first derivative approximated via tiny finite difference.
function velocityAt (fcu: ReturnType<typeof makeFCurve>, frame: number): number {
  const eps = 0.001
  return (evaluateFCurve(fcu, frame + eps) - evaluateFCurve(fcu, frame - eps)) / (2 * eps)
}

describe('Cycles-aware AUTO handles (fcurve.cc:1162-1225)', () => {
  it('REPEAT_OFFSET on linear ramp: handles follow ramp slope, not flatten to 0', () => {
    // y = x ramp. With REPEAT_OFFSET cycle, this should remain a smooth line of slope 1
    // across the seam. Without cycle-aware handles, the boundary keys' AUTO handles get
    // flattened (edge ease + missing prev/next neighbor) so velocity drops to ~0 near the
    // ends, betraying the linear shape. This test would fail before the cycle-aware fix.
    const a = makeBezTriple(0,  0,  { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const b = makeBezTriple(5,  5,  { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const c = makeBezTriple(10, 10, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const fcu = makeFCurve('value', [a, b, c])
    fcu.modifiers.push(makeCyclesModifier(CycleMode.REPEAT_OFFSET, CycleMode.REPEAT_OFFSET))
    recalcAllHandles(fcu)

    // First key right handle: should slope with ramp (value > 0), not flat at 0.
    expect(a.vec[2][1]).toBeGreaterThan(0.5)
    // Last key left handle: should slope with ramp (value < 10), not flat at 10.
    expect(c.vec[0][1]).toBeLessThan(9.5)

    // And velocity near the ends should be ≈ 1 (the ramp slope).
    expect(velocityAt(fcu, 0.5)).toBeCloseTo(1, 1)
    expect(velocityAt(fcu, 9.5)).toBeCloseTo(1, 1)
  })

  it('REPEAT_OFFSET cycle: shifted neighbor includes Y delta', () => {
    const a = makeBezTriple(0,  0, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const b = makeBezTriple(5,  5, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const c = makeBezTriple(10, 10, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const fcu = makeFCurve('value', [a, b, c])
    fcu.modifiers.push(makeCyclesModifier(CycleMode.REPEAT_OFFSET, CycleMode.REPEAT_OFFSET))
    recalcAllHandles(fcu)

    // First key's left handle should slope upward (anticipating a wrap from value 10 → 0+10 = 20
    // via offset). Without cycle-awareness it would be flat (CONSTANT extrap edge ease).
    expect(a.vec[0][1]).toBeLessThan(a.vec[1][1])
    // Last key's right handle should mirror — slope continues upward into next cycle.
    expect(c.vec[2][1]).toBeGreaterThan(c.vec[1][1])
  })

  it('non-cyclic curve still flattens edge handles under CONSTANT extrapolation', () => {
    const a = makeBezTriple(0, 0, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const b = makeBezTriple(5, 5, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const c = makeBezTriple(10, 0, { h1: HandleType.AUTO, h2: HandleType.AUTO, ipo: Interpolation.BEZIER })
    const fcu = makeFCurve('value', [a, b, c])  // no cycles modifier
    recalcAllHandles(fcu)

    // Edge ease: first/last AUTO handles should be horizontal (y == anchor.y).
    expect(a.vec[0][1]).toBeCloseTo(0, 6)
    expect(a.vec[2][1]).toBeCloseTo(0, 6)
    expect(c.vec[0][1]).toBeCloseTo(0, 6)
    expect(c.vec[2][1]).toBeCloseTo(0, 6)
  })
})
