import { describe, it, expect } from 'vitest'
import { evaluateFCurve } from './evaluate'
import { makeBezTriple, makeFCurve, makeCyclesModifier } from '../data/factories'
import { CycleMode, Easing, Extend, Interpolation } from '../data/enums'

function curveAtFrames (fcu: ReturnType<typeof makeFCurve>, frames: number[]): number[] {
  return frames.map((f) => evaluateFCurve(fcu, f))
}

describe('evaluateFCurve — empty / single-key', () => {
  it('empty curve returns 0', () => {
    expect(evaluateFCurve(makeFCurve('lens', []), 5)).toBe(0)
  })

  it('single-key curve holds value everywhere (CONSTANT extrapolation)', () => {
    const fcu = makeFCurve('lens', [makeBezTriple(10, 50)])
    expect(curveAtFrames(fcu, [0, 5, 10, 15, 100])).toEqual([50, 50, 50, 50, 50])
  })
})

describe('evaluateFCurve — CONSTANT interpolation', () => {
  it('holds prev value across the segment', () => {
    const fcu = makeFCurve('lens', [
      makeBezTriple(0, 50, { ipo: Interpolation.CONSTANT }),
      makeBezTriple(10, 35, { ipo: Interpolation.CONSTANT }),
    ])
    expect(evaluateFCurve(fcu, 0)).toBeCloseTo(50, 6)
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 6)
    expect(evaluateFCurve(fcu, 9.999)).toBeCloseTo(50, 6)
    expect(evaluateFCurve(fcu, 10)).toBeCloseTo(35, 6)
    expect(evaluateFCurve(fcu, 20)).toBeCloseTo(35, 6)
  })
})

describe('evaluateFCurve — LINEAR interpolation', () => {
  it('produces a straight line between keys', () => {
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
      makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
    ])
    expect(evaluateFCurve(fcu, 0)).toBeCloseTo(0, 6)
    expect(evaluateFCurve(fcu, 2.5)).toBeCloseTo(25, 6)
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 6)
    expect(evaluateFCurve(fcu, 10)).toBeCloseTo(100, 6)
  })

  it('LINEAR + extend=linear extrapolates past the ends', () => {
    const fcu = makeFCurve(
      'location',
      [
        makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
      ],
      { extend: Extend.LINEAR },
    )
    expect(evaluateFCurve(fcu, -5)).toBeCloseTo(-50, 4)
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(150, 4)
  })

  it('LINEAR + extend=constant clamps past the ends', () => {
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
      makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
    ])
    expect(evaluateFCurve(fcu, -5)).toBeCloseTo(0, 6)
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(100, 6)
  })
})

describe('evaluateFCurve — BEZIER with hand-picked handles', () => {
  it('bezier with linear-shaped handles ≈ linear', () => {
    // Anchors (0,0) and (10,100). Handles colinear with anchor line.
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, {
        leftHandle: [-3.33, -33.33], rightHandle: [10 / 3, 100 / 3],
        ipo: Interpolation.BEZIER,
      }),
      makeBezTriple(10, 100, {
        leftHandle: [20 / 3, 200 / 3], rightHandle: [13.33, 133.33],
      }),
    ])
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 3)
  })

  it('bezier with flat handles forms an S-curve through midpoint', () => {
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, {
        leftHandle: [-3.33, 0], rightHandle: [10 / 3, 0],
        ipo: Interpolation.BEZIER,
      }),
      makeBezTriple(10, 100, {
        leftHandle: [20 / 3, 100], rightHandle: [13.33, 100],
      }),
    ])
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 3)
    expect(evaluateFCurve(fcu, 2.5)).toBeLessThan(25)
    expect(evaluateFCurve(fcu, 7.5)).toBeGreaterThan(75)
  })

  it('overlong handles get clamped (no curve loop)', () => {
    // Right handle at (50, ?) — way past v4.x=10. correctBezpart clamps to (10, ?).
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, {
        leftHandle: [-10, 0], rightHandle: [50, 500],
        ipo: Interpolation.BEZIER,
      }),
      makeBezTriple(10, 100, {
        leftHandle: [-30, -200], rightHandle: [20, 100],
      }),
    ])
    // Just verify we get a finite, monotonic-ish value, not NaN.
    const y = evaluateFCurve(fcu, 5)
    expect(Number.isFinite(y)).toBe(true)
  })
})

describe('evaluateFCurve — easings', () => {
  it('CUBIC ease-in is below midline at t=0.5', () => {
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, { ipo: Interpolation.CUBIC, easing: Easing.IN }),
      makeBezTriple(10, 100),
    ])
    expect(evaluateFCurve(fcu, 5)).toBeLessThan(50)
  })

  it('BACK ease-out overshoots above the destination', () => {
    const fcu = makeFCurve('location', [
      makeBezTriple(0, 0, { ipo: Interpolation.BACK, easing: Easing.OUT, back: 1.7 }),
      makeBezTriple(10, 100),
    ])
    let peak = 0
    for (let f = 0.1; f < 10; f += 0.1) peak = Math.max(peak, evaluateFCurve(fcu, f))
    expect(peak).toBeGreaterThan(100)
  })
})

describe('evaluateFCurve — Cycles modifier', () => {
  it('REPEAT after-mode loops the curve', () => {
    const fcu = makeFCurve(
      'rotation_euler',
      [
        makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
      ],
      { modifiers: [makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT)] },
    )
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 4)
    // 15 -> cycled to 5
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(50, 4)
    // 25 -> cycled to 5
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(50, 4)
  })

  it('REPEAT_OFFSET after-mode adds the value delta each loop', () => {
    const fcu = makeFCurve(
      'rotation_euler',
      [
        makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
      ],
      { modifiers: [makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_OFFSET)] },
    )
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 4)
    // 15 -> 5 + cycdy*1 = 50 + 100 = 150
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(150, 4)
    // 25 -> 5 + cycdy*2 = 50 + 200 = 250
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(250, 4)
  })

  it('REPEAT_MIRROR before-mode plays odd cycles in reverse (regression)', () => {
    const fcu = makeFCurve(
      'rotation_euler',
      [
        makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
      ],
      { modifiers: [makeCyclesModifier(CycleMode.REPEAT_MIRROR, CycleMode.OFF)] },
    )
    // Cycle 0 before (frame in [-10, 0]): mirror odd → played forward in original time.
    // frame=-3 → blender's signed cyct=-3 → evalt = first - cyct = 3 → value 30 (linear).
    expect(evaluateFCurve(fcu, -3)).toBeCloseTo(30, 4)
    // Cycle 1 before (frame in [-20, -10]): even → normal repeat.
    // frame=-13 → cyct=-3 (signed) → evalt = first + cyct + cycdx = 7 → value 70.
    expect(evaluateFCurve(fcu, -13)).toBeCloseTo(70, 4)
  })

  it('REPEAT_MIRROR after-mode plays odd cycles in reverse', () => {
    const fcu = makeFCurve(
      'rotation_euler',
      [
        makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
      ],
      { modifiers: [makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_MIRROR)] },
    )
    // First cycle (0..10): forward
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(50, 4)
    // Second cycle (10..20): reverse → 15 looks like 5 from the other side → 50
    expect(evaluateFCurve(fcu, 15)).toBeCloseTo(50, 4)
    // Third cycle (20..30): forward again
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(50, 4)
  })

  it('Cycles count limit holds value beyond cycles', () => {
    const fcu = makeFCurve(
      'rotation_euler',
      [
        makeBezTriple(0, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 100, { ipo: Interpolation.LINEAR }),
      ],
      { modifiers: [makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT, 0, 1)] },
    )
    // count=1: cycle 0..1 → frames 10..20 are the 1st extra cycle.
    // Frame 25 is past the count → modifier returns frame unchanged → keyframe extrapolation.
    expect(evaluateFCurve(fcu, 25)).toBeCloseTo(100, 4)  // CONSTANT extend hold
  })
})
