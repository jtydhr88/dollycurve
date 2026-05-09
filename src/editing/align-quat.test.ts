import { describe, it, expect } from 'vitest'
import { Interpolation } from '../data/enums'
import { makeBezTriple, makeCameraAction, makeFCurve } from '../data/factories'
import { alignQuaternionHemisphere } from './unwrap-euler'

describe('alignQuaternionHemisphere', () => {
  it('flips a single sign-inverted neighbor onto the same hemisphere', () => {
    // Identity quat (0,0,0,1) at frame 0; equivalent (0,0,0,-1) at frame 10.
    // dot = -1 < 0 → frame 10 must be flipped to (0,0,0,1).
    const quat = (idx: number, vals: number[]) =>
      makeFCurve('rotation_quaternion', vals.map((v, i) => makeBezTriple(i * 10, v, { ipo: Interpolation.LINEAR })), { arrayIndex: idx })
    const action = makeCameraAction([
      quat(0, [0, 0]),
      quat(1, [0, 0]),
      quat(2, [0, 0]),
      quat(3, [1, -1]),
    ], 24)
    const flips = alignQuaternionHemisphere(action)
    expect(flips).toBe(1)
    expect(action.fcurves[3].bezt[1].vec[1][1]).toBe(1)
  })

  it('idempotent — re-running on aligned data is a no-op', () => {
    const quat = (idx: number, vals: number[]) =>
      makeFCurve('rotation_quaternion', vals.map((v, i) => makeBezTriple(i * 10, v)), { arrayIndex: idx })
    const action = makeCameraAction([
      quat(0, [0.7, 0.6]), quat(1, [0, 0]), quat(2, [0, 0]), quat(3, [0.7, 0.8]),
    ], 24)
    const first = alignQuaternionHemisphere(action)
    const second = alignQuaternionHemisphere(action)
    expect(first).toBe(0)  // already aligned
    expect(second).toBe(0)
  })

  it('returns 0 when the four channels have mismatched key counts', () => {
    const quat = (idx: number, count: number) =>
      makeFCurve('rotation_quaternion', Array.from({ length: count }, (_, i) => makeBezTriple(i * 10, 0)), { arrayIndex: idx })
    const action = makeCameraAction([
      quat(0, 3), quat(1, 3), quat(2, 2), quat(3, 3),  // arrayIndex 2 short
    ], 24)
    expect(alignQuaternionHemisphere(action)).toBe(0)
  })

  it('handles consecutive flips: (+, -, +, -, +) realigns to all +', () => {
    const quat = (idx: number, vals: number[]) =>
      makeFCurve('rotation_quaternion', vals.map((v, i) => makeBezTriple(i * 10, v)), { arrayIndex: idx })
    const action = makeCameraAction([
      quat(0, [0, 0, 0, 0, 0]),
      quat(1, [0, 0, 0, 0, 0]),
      quat(2, [0, 0, 0, 0, 0]),
      quat(3, [1, -1, 1, -1, 1]),
    ], 24)
    const flips = alignQuaternionHemisphere(action)
    expect(flips).toBe(2)  // keys 1 and 3 get flipped
    const out = action.fcurves[3].bezt.map((b) => b.vec[1][1])
    expect(out).toEqual([1, 1, 1, 1, 1])
  })
})
