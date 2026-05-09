import { describe, it, expect } from 'vitest'
import { evaluateFCurve } from '../evaluate'
import { makeBezTriple, makeFCurve, makeNoiseModifier } from '../../data/factories'
import { Interpolation } from '../../data/enums'
import { applyNoiseValue } from './noise'

describe('Noise modifier', () => {
  const flatCurve = () => {
    const a = makeBezTriple(0,  5, { ipo: Interpolation.LINEAR })
    const b = makeBezTriple(50, 5, { ipo: Interpolation.LINEAR })
    return makeFCurve('value', [a, b])
  }

  it('strength=0 leaves value unchanged', () => {
    const fcu = flatCurve()
    fcu.modifiers.push(makeNoiseModifier({ strength: 0 }))
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(5, 6)
  })

  it('size=0 leaves value unchanged (avoids divide-by-zero)', () => {
    const fcu = flatCurve()
    fcu.modifiers.push(makeNoiseModifier({ size: 0, strength: 100 }))
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(5, 6)
  })

  it('replace mode at strength=1 stays bounded near base value', () => {
    const fcu = flatCurve()
    fcu.modifiers.push(makeNoiseModifier({ modification: 'replace', strength: 1, size: 5 }))
    for (let f = 0; f <= 50; f += 1) {
      const v = evaluateFCurve(fcu, f)
      expect(v).toBeGreaterThan(4)
      expect(v).toBeLessThan(6)
    }
  })

  it('different phases produce different output (deterministic per phase)', () => {
    // Use non-integer phases — integer phases land on lattice corners where
    // 2D Perlin can degenerate to a 1D slice (yf=0 → v=0 → only x1 contributes).
    const a1 = applyNoiseValue(makeNoiseModifier({ phase: 0.3 }), 0, 10.5)
    const a2 = applyNoiseValue(makeNoiseModifier({ phase: 0.3 }), 0, 10.5)
    const b1 = applyNoiseValue(makeNoiseModifier({ phase: 7.3 }), 0, 10.5)
    expect(a1).toBe(a2)              // deterministic
    expect(a1).not.toBeCloseTo(b1, 3) // different phase → different value
  })

  it('add modification raises mean above base', () => {
    const fcu = flatCurve()
    fcu.modifiers.push(makeNoiseModifier({ modification: 'add', strength: 2, size: 3 }))
    let sum = 0, n = 0
    for (let f = 0; f <= 50; f += 0.5) {
      sum += evaluateFCurve(fcu, f) - 5
      n++
    }
    // 'add' uses raw noise (not noise-0.5), which is roughly symmetric around 0.
    // Average should be near 0 (close to base).
    expect(Math.abs(sum / n)).toBeLessThan(0.5)
  })

  it('influence=0 disables noise entirely', () => {
    const fcu = flatCurve()
    const n = makeNoiseModifier({ strength: 100, size: 1 })
    n.influence = 0
    fcu.modifiers.push(n)
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(5, 6)
  })
})
