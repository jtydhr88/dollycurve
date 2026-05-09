import { describe, it, expect } from 'vitest'
import { PerspectiveCamera } from 'three'
import {
  makeCameraAction,
  makePathFollowConstraint,
  makeSplinePath,
  makeSplinePoint,
} from '../data/factories'
import { CameraTrackBinding } from '../three/CameraTrackBinding'
import { bakePathToFCurves } from './bake-path'

describe('bakePathToFCurves', () => {
  it('produces 3 location FCurves + 4 rotation_quaternion FCurves by default', () => {
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ]))
    bakePathToFCurves(action, { startFrame: 0, endFrame: 5 })
    const loc = action.fcurves.filter((f) => f.rnaPath === 'location')
    const quat = action.fcurves.filter((f) => f.rnaPath === 'rotation_quaternion')
    expect(loc.length).toBe(3)
    expect(quat.length).toBe(4)
    expect(loc[0].bezt.length).toBe(6)  // frames 0..5
    expect(action.pathFollow).toBeUndefined()  // cleared by default
  })

  it('baked FCurves reproduce the original path positions', () => {
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0]),
      makeSplinePoint([5, 5, 0],  [1, 1, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ]), { arcLengthUniform: true })
    // Sample original at a midpoint frame.
    const camOrig = new PerspectiveCamera()
    new CameraTrackBinding(camOrig, action).evaluate(3 / 24)
    const origX = camOrig.position.x
    const origY = camOrig.position.y

    bakePathToFCurves(action, { startFrame: 0, endFrame: 12 })
    expect(action.pathFollow).toBeUndefined()

    const camBaked = new PerspectiveCamera()
    new CameraTrackBinding(camBaked, action).evaluate(3 / 24)
    expect(camBaked.position.x).toBeCloseTo(origX, 3)
    expect(camBaked.position.y).toBeCloseTo(origY, 3)
  })

  it('Euler mode writes rotation_euler instead of rotation_quaternion', () => {
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ]))
    bakePathToFCurves(action, { startFrame: 0, endFrame: 5, rotationMode: 'XYZ' })
    expect(action.fcurves.filter((f) => f.rnaPath === 'rotation_quaternion').length).toBe(0)
    expect(action.fcurves.filter((f) => f.rnaPath === 'rotation_euler').length).toBe(3)
  })

  it('replace=false appends; default replaces existing same-rnaPath fcurves', () => {
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([10, 0, 0]),
    ]))
    bakePathToFCurves(action, { startFrame: 0, endFrame: 5, clearPathFollow: false })
    const before = action.fcurves.filter((f) => f.rnaPath === 'location').length
    expect(before).toBe(3)

    bakePathToFCurves(action, { startFrame: 0, endFrame: 5 })  // replace=true (default)
    const after = action.fcurves.filter((f) => f.rnaPath === 'location').length
    expect(after).toBe(3)  // not 6
  })

  it('bakeRotation=false skips rotation FCurves', () => {
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([10, 0, 0]),
    ]))
    bakePathToFCurves(action, { startFrame: 0, endFrame: 5, bakeRotation: false })
    expect(action.fcurves.filter((f) => f.rnaPath.startsWith('rotation_')).length).toBe(0)
  })

  it('quaternion hemisphere continuity: no sign flip between adjacent frames', () => {
    // Spline that twists enough to risk a sign flip (helix-like).
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(makeSplinePath([
      makeSplinePoint([5, 0, 0],  [0, 1, 0]),
      makeSplinePoint([0, 5, 1],  [-1, 0, 0]),
      makeSplinePoint([-5, 0, 2], [0, -1, 0]),
      makeSplinePoint([0, -5, 1], [1, 0, 0]),
    ], { closed: true }))
    bakePathToFCurves(action, { startFrame: 0, endFrame: 60 })

    const qw = action.fcurves.find((f) => f.rnaPath === 'rotation_quaternion' && f.arrayIndex === 3)!
    // Successive qw values should not jump by ±2 (a sign flip on a unit quaternion).
    for (let i = 1; i < qw.bezt.length; i++) {
      const dq = Math.abs(qw.bezt[i].vec[1][1] - qw.bezt[i - 1].vec[1][1])
      expect(dq).toBeLessThan(1.0)  // unit-quat components change at most ~1 per frame
    }
  })

  it('throws when action has no pathFollow', () => {
    const action = makeCameraAction([], 24)
    expect(() => bakePathToFCurves(action, { startFrame: 0, endFrame: 5 })).toThrow(/pathFollow/)
  })
})
