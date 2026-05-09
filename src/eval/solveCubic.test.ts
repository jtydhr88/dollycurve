import { describe, it, expect } from 'vitest'
import { solveCubic } from './solveCubic'

describe('solveCubic', () => {
  it('solves linear: 2x + 1 = 0 → x = -0.5 (rejected, out of [SMALL, 1])', () => {
    expect(solveCubic(1, 2, 0, 0)).toEqual([])
  })

  it('solves linear: -1 + 2x = 0 → x = 0.5', () => {
    const roots = solveCubic(-1, 2, 0, 0)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toBeCloseTo(0.5, 10)
  })

  it('solves quadratic: x^2 - 0.5x = 0 → x = 0 and 0.5', () => {
    const roots = solveCubic(0, -0.5, 1, 0).sort((a, b) => a - b)
    expect(roots).toHaveLength(2)
    expect(roots[0]).toBeCloseTo(0, 10)
    expect(roots[1]).toBeCloseTo(0.5, 10)
  })

  it('solves cubic: (x - 0.5)^3 = 0 → x = 0.5 (triple)', () => {
    // (x - 0.5)^3 = x^3 - 1.5x^2 + 0.75x - 0.125
    const roots = solveCubic(-0.125, 0.75, -1.5, 1)
    expect(roots.length).toBeGreaterThanOrEqual(1)
    for (const r of roots) expect(r).toBeCloseTo(0.5, 5)
  })

  it('solves cubic with one real root: x^3 + x = 0.5 → x ≈ 0.4258', () => {
    // x^3 + x - 0.5 = 0 → c0=-0.5, c1=1, c2=0, c3=1
    const roots = solveCubic(-0.5, 1, 0, 1)
    expect(roots).toHaveLength(1)
    // Verify by plugging back in.
    const x = roots[0]
    expect(x ** 3 + x - 0.5).toBeCloseTo(0, 6)
  })

  it('returns empty when no root in [SMALL, 1.000001]', () => {
    // 5x^3 = 1 → x = (1/5)^(1/3) ≈ 0.585  ← this IS in range
    // Use one that lands outside: x = 5
    expect(solveCubic(-125, 0, 0, 1)).toEqual([])
  })
})
