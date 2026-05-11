import { describe, it, expect } from 'vitest'
import { Interpolation } from '../data/enums'
import { makeBezTriple, makeCameraAction, makeFCurve } from '../data/factories'
import { fitFCurvesToPath } from './fit-path'
import { pathPos } from '../spline/bezier3d'

describe('fitFCurvesToPath', () => {
  it('linear path through 3 keyframes recovers spline that passes through them', () => {
    const action = makeCameraAction([
      makeFCurve('location', [
        makeBezTriple(0,  0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 5, { ipo: Interpolation.LINEAR }),
        makeBezTriple(20, 10, { ipo: Interpolation.LINEAR }),
      ], { arrayIndex: 0 }),
      makeFCurve('location', [
        makeBezTriple(0,  0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(20, 0, { ipo: Interpolation.LINEAR }),
      ], { arrayIndex: 1 }),
      makeFCurve('location', [
        makeBezTriple(0,  0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(10, 0, { ipo: Interpolation.LINEAR }),
        makeBezTriple(20, 0, { ipo: Interpolation.LINEAR }),
      ], { arrayIndex: 2 }),
    ], 24)

    const path = fitFCurvesToPath(action, { consumeFCurves: false })
    expect(path.points.length).toBe(3)
    expect(path.points[0].co).toEqual([0, 0, 0])
    expect(path.points[1].co).toEqual([5, 0, 0])
    expect(path.points[2].co).toEqual([10, 0, 0])
  })

  it('consumeFCurves=true removes location FCurves after fit', () => {
    const action = makeCameraAction([
      makeFCurve('location', [makeBezTriple(0, 0), makeBezTriple(10, 5)], { arrayIndex: 0 }),
      makeFCurve('location', [makeBezTriple(0, 0), makeBezTriple(10, 0)], { arrayIndex: 1 }),
      makeFCurve('location', [makeBezTriple(0, 0), makeBezTriple(10, 0)], { arrayIndex: 2 }),
      makeFCurve('lens',     [makeBezTriple(0, 35)]),  // unrelated, should survive
    ], 24)
    fitFCurvesToPath(action)
    expect(action.fcurves.filter((f) => f.rnaPath === 'location').length).toBe(0)
    expect(action.fcurves.filter((f) => f.rnaPath === 'lens').length).toBe(1)
  })

  it('round-trip: fit then sample reproduces the original endpoints', () => {
    const action = makeCameraAction([
      makeFCurve('location', [makeBezTriple(0, 0), makeBezTriple(10, 8)], { arrayIndex: 0 }),
      makeFCurve('location', [makeBezTriple(0, 0), makeBezTriple(10, 4)], { arrayIndex: 1 }),
      makeFCurve('location', [makeBezTriple(0, 0), makeBezTriple(10, 2)], { arrayIndex: 2 }),
    ], 24)
    const path = fitFCurvesToPath(action, { consumeFCurves: false })
    const start = pathPos(path, 0)
    const end = pathPos(path, 1)
    expect(start[0]).toBeCloseTo(0, 4)
    expect(start[1]).toBeCloseTo(0, 4)
    expect(end[0]).toBeCloseTo(8, 4)
    expect(end[1]).toBeCloseTo(4, 4)
    expect(end[2]).toBeCloseTo(2, 4)
  })

  it('throws when no location FCurves exist', () => {
    const action = makeCameraAction([
      makeFCurve('lens', [makeBezTriple(0, 35)]),
    ], 24)
    expect(() => fitFCurvesToPath(action)).toThrow(/location/)
  })

  it('throws when fewer than 2 keyframes', () => {
    const action = makeCameraAction([
      makeFCurve('location', [makeBezTriple(0, 0)], { arrayIndex: 0 }),
    ], 24)
    expect(() => fitFCurvesToPath(action)).toThrow(/2 keyframes/)
  })

  it('targetCount overrides per-key strategy with uniform sampling', () => {
    // Source has 100 keys (dense bake). targetCount=5 should produce 5 anchors.
    const xKeys = []
    const yKeys = []
    const zKeys = []
    for (let f = 0; f < 100; f++) {
      xKeys.push(makeBezTriple(f, f * 0.1))
      yKeys.push(makeBezTriple(f, 0))
      zKeys.push(makeBezTriple(f, 0))
    }
    const action = makeCameraAction([
      makeFCurve('location', xKeys, { arrayIndex: 0 }),
      makeFCurve('location', yKeys, { arrayIndex: 1 }),
      makeFCurve('location', zKeys, { arrayIndex: 2 }),
    ], 24)
    const path = fitFCurvesToPath(action, { targetCount: 5, consumeFCurves: false })
    expect(path.points.length).toBe(5)
    // First and last anchors lie at the source frame range endpoints.
    expect(path.points[0].co[0]).toBeCloseTo(0, 4)
    expect(path.points[4].co[0]).toBeCloseTo(99 * 0.1, 4)
  })

  it('useFCurveHandles=true reads h2 directly from each axis bezt', () => {
    // X-axis right handle at (5, 8) on the key at frame 0, gap to next = 10.
    // Slope = (8-0)/(5-0) = 1.6 per frame; expected h2.x = 0 + 1.6*10/3 = 5.333.
    const xKey0 = makeBezTriple(0,  0)
    xKey0.vec[2] = [5, 8]   // override right handle
    const yKey0 = makeBezTriple(0, 0)
    const zKey0 = makeBezTriple(0, 0)
    const action = makeCameraAction([
      makeFCurve('location', [xKey0, makeBezTriple(10, 5)], { arrayIndex: 0 }),
      makeFCurve('location', [yKey0, makeBezTriple(10, 0)], { arrayIndex: 1 }),
      makeFCurve('location', [zKey0, makeBezTriple(10, 0)], { arrayIndex: 2 }),
    ], 24)
    const path = fitFCurvesToPath(action, { consumeFCurves: false })
    expect(path.points[0].h2[0]).toBeCloseTo(8 / 5 * 10 / 3, 4)
    expect(path.points[0].h2[1]).toBeCloseTo(0, 4)
    expect(path.points[0].h2[2]).toBeCloseTo(0, 4)
  })

  it('useFCurveHandles=false falls back to central-difference tangents', () => {
    const xKey0 = makeBezTriple(0,  0)
    xKey0.vec[2] = [5, 8]   // would normally bias h2 strongly
    const yKey0 = makeBezTriple(0, 0)
    const zKey0 = makeBezTriple(0, 0)
    const action = makeCameraAction([
      makeFCurve('location', [xKey0, makeBezTriple(10, 5)], { arrayIndex: 0 }),
      makeFCurve('location', [yKey0, makeBezTriple(10, 0)], { arrayIndex: 1 }),
      makeFCurve('location', [zKey0, makeBezTriple(10, 0)], { arrayIndex: 2 }),
    ], 24)
    const pathLegacy = fitFCurvesToPath(action, { consumeFCurves: false, useFCurveHandles: false })
    const pathHandles = fitFCurvesToPath(action, { consumeFCurves: false, useFCurveHandles: true })
    // The two strategies must produce different h2 for the first anchor.
    expect(pathLegacy.points[0].h2[0]).not.toBeCloseTo(pathHandles.points[0].h2[0], 2)
  })

  it('minFrame/maxFrame clips the fit window', () => {
    const action = makeCameraAction([
      makeFCurve('location', [
        makeBezTriple(0, 0), makeBezTriple(10, 5), makeBezTriple(20, 10), makeBezTriple(30, 15),
      ], { arrayIndex: 0 }),
      makeFCurve('location', [], { arrayIndex: 1 }),
      makeFCurve('location', [], { arrayIndex: 2 }),
    ], 24)
    const path = fitFCurvesToPath(action, { minFrame: 5, maxFrame: 25, consumeFCurves: false })
    // Should keep only frames 10 and 20.
    expect(path.points.length).toBe(2)
    expect(path.points[0].co[0]).toBe(5)
    expect(path.points[1].co[0]).toBe(10)
  })
})
