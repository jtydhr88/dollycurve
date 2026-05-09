import { describe, it, expect } from 'vitest'
import {
  linearEase,
  cubicEaseIn, cubicEaseOut, cubicEaseInOut,
  quadEaseIn, quadEaseOut,
  sineEaseIn, sineEaseOut, sineEaseInOut,
  expoEaseIn, expoEaseOut,
  bounceEaseOut,
  circEaseIn, circEaseOut,
  backEaseIn, backEaseOut,
  dispatchEase,
} from './easing'
import { Easing, Interpolation } from '../data/enums'

// All Penner easings must satisfy f(0)=begin and f(duration)=begin+change.
const D = 1, B = 0, C = 10
const cases: Array<[string, (t: number, b: number, c: number, d: number) => number]> = [
  ['linear', linearEase],
  ['cubic in', cubicEaseIn],
  ['cubic out', cubicEaseOut],
  ['cubic inout', cubicEaseInOut],
  ['quad in', quadEaseIn],
  ['quad out', quadEaseOut],
  ['sine in', sineEaseIn],
  ['sine out', sineEaseOut],
  ['sine inout', sineEaseInOut],
  ['bounce out', bounceEaseOut],
  ['circ in', circEaseIn],
  ['circ out', circEaseOut],
]

describe('easing endpoints', () => {
  for (const [name, fn] of cases) {
    it(`${name}: f(0) = begin`, () => {
      expect(fn(0, B, C, D)).toBeCloseTo(B, 5)
    })
    it(`${name}: f(duration) = begin + change`, () => {
      expect(fn(D, B, C, D)).toBeCloseTo(B + C, 5)
    })
  }
})

describe('easing midpoints (rough shape checks)', () => {
  it('linear midpoint = halfway', () => {
    expect(linearEase(0.5, 0, 10, 1)).toBeCloseTo(5, 10)
  })
  it('cubic ease-in is convex (below midline at t=0.5)', () => {
    expect(cubicEaseIn(0.5, 0, 10, 1)).toBeLessThan(5)
  })
  it('cubic ease-out is concave (above midline at t=0.5)', () => {
    expect(cubicEaseOut(0.5, 0, 10, 1)).toBeGreaterThan(5)
  })
  it('cubic ease-in-out passes through midpoint at t=0.5', () => {
    expect(cubicEaseInOut(0.5, 0, 10, 1)).toBeCloseTo(5, 5)
  })
  it('back ease-out overshoots positive change', () => {
    // overshoot=1.7, ease-out at t≈0.4 should peak above the destination.
    let peak = 0
    for (let i = 1; i < 100; i++) peak = Math.max(peak, backEaseOut(i / 100, 0, 10, 1, 1.7))
    expect(peak).toBeGreaterThan(10)
  })
  it('back ease-in undershoots below begin', () => {
    let trough = 0
    for (let i = 1; i < 100; i++) trough = Math.min(trough, backEaseIn(i / 100, 0, 10, 1, 1.7))
    expect(trough).toBeLessThan(0)
  })
  it('expo ease-in stays low until late, then accelerates', () => {
    // Blender's expo is normalized so f(0.5) ≈ 0.03; f(0.95) ≈ 7.0.
    expect(expoEaseIn(0.5, 0, 10, 1)).toBeLessThan(0.5)
    expect(expoEaseIn(0.95, 0, 10, 1)).toBeGreaterThan(5)
  })
  it('expo ease-out front-loads (well past midline by t=0.5)', () => {
    expect(expoEaseOut(0.5, 0, 10, 1)).toBeGreaterThan(9)
    expect(expoEaseOut(0.2, 0, 10, 1)).toBeGreaterThan(5)
  })
})

describe('dispatchEase AUTO routing', () => {
  // Per fcurve.cc:2151+ : BACK/BOUNCE/ELASTIC default to OUT; the rest default to IN.
  const params = (time: number) => ({
    time, begin: 0, change: 10, duration: 1, back: 1.7, amplitude: 0, period: 0,
  })

  it('BACK auto = OUT (overshoot above destination)', () => {
    let peak = 0
    for (let i = 1; i < 100; i++) {
      peak = Math.max(peak, dispatchEase(Interpolation.BACK, Easing.AUTO, params(i / 100)))
    }
    expect(peak).toBeGreaterThan(10)
  })

  it('CUBIC auto = IN (below midline at t=0.5)', () => {
    expect(dispatchEase(Interpolation.CUBIC, Easing.AUTO, params(0.5)))
      .toBeLessThan(5)
  })

  it('BOUNCE auto = OUT (lands at destination, multiple bounces below)', () => {
    expect(dispatchEase(Interpolation.BOUNCE, Easing.AUTO, params(1))).toBeCloseTo(10, 4)
  })
})
