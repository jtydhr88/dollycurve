import { describe, it, expect } from 'vitest'
import { evaluateFCurve } from '../evaluate'
import { makeBezTriple, makeFCurve, makeCyclesModifier } from '../../data/factories'
import { CycleMode, Interpolation } from '../../data/enums'

describe('FModifier muted / influence', () => {
  const baseFcu = () => {
    const a = makeBezTriple(0, 0, { ipo: Interpolation.LINEAR })
    const b = makeBezTriple(10, 10, { ipo: Interpolation.LINEAR })
    return makeFCurve('location', [a, b])
  }

  it('muted modifier behaves as if absent', () => {
    const fcu = baseFcu()
    const cyc = makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT)
    cyc.muted = true
    fcu.modifiers.push(cyc)
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(10, 6)  // CONSTANT extrapolation, not cycled
  })

  it('influence=0 disables the modifier', () => {
    const fcu = baseFcu()
    const cyc = makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_OFFSET)
    cyc.influence = 0
    fcu.modifiers.push(cyc)
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(10, 6)
  })

  it('influence=1 (default) is unchanged from previous behavior', () => {
    const fcu = baseFcu()
    fcu.modifiers.push(makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_OFFSET))
    // At frame 15 (5 frames into next cycle), value = 10 + 5 = 15.
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(15, 6)
  })

  it('influence=0.5 blends value-pass output with pre-value-pass value', () => {
    const fcu = baseFcu()
    const cyc = makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_OFFSET)
    cyc.influence = 0.5
    fcu.modifiers.push(cyc)
    // Time pass cycles full-strength: frame 15 → 5 (within keys).
    // Pre-value at cycled frame: 5 (linear interp from 0..10).
    // Cycles value pass output: 5 + cycyofs(10) = 15.
    // interpf(nval=15, oldval=5, 0.5) = 10. Same shape as Blender.
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(10, 6)
  })
})
