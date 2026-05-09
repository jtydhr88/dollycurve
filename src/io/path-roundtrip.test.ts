import { describe, it, expect } from 'vitest'
import {
  makeBezTriple,
  makeCameraAction,
  makeFCurve,
  makePathFollowConstraint,
  makeSplinePath,
  makeSplinePoint,
} from '../data/factories'
import { exportCameraActionToJson, importCameraActionFromJson } from './blender-json'

describe('PathFollow JSON round-trip', () => {
  it('plain spline path', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0]),
      makeSplinePoint([5, 0, 5],  [1, 0, 1]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ], { closed: false, resolution: 48 })
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(path, {
      orientation: 'tangent',
      upAxis: 'Y',
      arcLengthUniform: true,
    })

    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)

    expect(back.pathFollow).toBeDefined()
    expect(back.pathFollow!.splinePath.points.length).toBe(3)
    expect(back.pathFollow!.splinePath.points[1].co).toEqual([5, 0, 5])
    expect(back.pathFollow!.splinePath.resolution).toBe(48)
    expect(back.pathFollow!.orientation).toBe('tangent')
    expect(back.pathFollow!.upAxis).toBe('Y')
    expect(back.pathFollow!.arcLengthUniform).toBe(true)
  })

  it('lookAt with explicit target', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([10, 0, 0]),
    ])
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(path, {
      orientation: 'lookAt',
      lookAtTarget: [5, 5, 0],
      upAxis: [0.7, 0.7, 0],
    })

    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)

    expect(back.pathFollow!.orientation).toBe('lookAt')
    expect(back.pathFollow!.lookAtTarget).toEqual([5, 5, 0])
    expect(back.pathFollow!.upAxis).toEqual([0.7, 0.7, 0])
  })

  it('embedded speedCurve and tiltCurve survive', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([10, 0, 0]),
    ])
    const speed = makeFCurve('__speed', [makeBezTriple(0, 0), makeBezTriple(48, 10)])
    const tilt = makeFCurve('__tilt', [makeBezTriple(0, 0), makeBezTriple(48, Math.PI / 4)])
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(path, {
      speedCurve: speed,
      tiltCurve: tilt,
    })

    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)

    expect(back.pathFollow!.speedCurve).toBeDefined()
    expect(back.pathFollow!.speedCurve!.bezt.length).toBe(2)
    expect(back.pathFollow!.speedCurve!.bezt[1].vec[1][1]).toBe(10)

    expect(back.pathFollow!.tiltCurve).toBeDefined()
    expect(back.pathFollow!.tiltCurve!.bezt[1].vec[1][1]).toBeCloseTo(Math.PI / 4, 6)
  })

  it('point tilt is preserved', () => {
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0], 1, Math.PI / 6),
      makeSplinePoint([10, 0, 0]),
    ])
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(path)

    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)

    expect(back.pathFollow!.splinePath.points[0].tilt).toBeCloseTo(Math.PI / 6, 6)
  })

  it('action without pathFollow leaves pathFollow undefined after round-trip', () => {
    const action = makeCameraAction([], 24)
    const json = exportCameraActionToJson(action)
    expect(json.pathFollow).toBeUndefined()
    const back = importCameraActionFromJson(json)
    expect(back.pathFollow).toBeUndefined()
  })
})
