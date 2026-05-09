import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  makeCameraAction,
  makeFCurve,
  makeBezTriple,
  makePathFollowConstraint,
  makeSplinePath,
  makeSplinePoint,
} from '../data/factories'
import { CameraTrackBinding } from './CameraTrackBinding'
import { Interpolation } from '../data/enums'

describe('CameraTrackBinding with PathFollow', () => {
  const linearPath = () => makeSplinePath([
    makeSplinePoint([0, 0, 0],  [1, 0, 0]),
    makeSplinePoint([10, 0, 0], [1, 0, 0]),
  ])

  it('default speedCurve traversal: position interpolates along path with frame', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(linearPath(), {
      arcLengthUniform: true,
    })
    const binding = new CameraTrackBinding(cam, action)

    binding.evaluate(0)
    expect(cam.position.x).toBeCloseTo(0, 5)

    // Frame 5 with no speedCurve uses frame-as-s. totalLen=10, so frame 5 → s=5 → x=5.
    binding.evaluate(5 / 24)
    expect(cam.position.x).toBeCloseTo(5, 4)

    binding.evaluate(10 / 24)
    expect(cam.position.x).toBeCloseTo(10, 4)
  })

  it('speedCurve drives position', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    // Speed curve: at frame 0 → s=0, at frame 24 → s=10 (full length).
    const speed = makeFCurve('__speed', [
      makeBezTriple(0,  0,  { ipo: Interpolation.LINEAR }),
      makeBezTriple(24, 10, { ipo: Interpolation.LINEAR }),
    ])
    action.pathFollow = makePathFollowConstraint(linearPath(), {
      speedCurve: speed, arcLengthUniform: true,
    })
    const binding = new CameraTrackBinding(cam, action)

    binding.evaluate(12 / 24)  // frame 12 → s=5 → x=5
    expect(cam.position.x).toBeCloseTo(5, 3)
  })

  it('orientation=tangent: camera looks down the path', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(linearPath(), {
      orientation: 'tangent', upAxis: 'Y', arcLengthUniform: true,
    })
    const binding = new CameraTrackBinding(cam, action)
    binding.evaluate(2 / 24)  // somewhere in the middle

    // Camera default forward is -Z; after rotation, world-space forward
    // should align with path tangent (+X for the linear path).
    const worldForward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    expect(worldForward.x).toBeCloseTo(1, 3)
    expect(Math.abs(worldForward.y)).toBeLessThan(0.01)
    expect(Math.abs(worldForward.z)).toBeLessThan(0.01)
  })

  it('orientation=lookAt: camera aims at target regardless of tangent', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    action.pathFollow = makePathFollowConstraint(linearPath(), {
      orientation: 'lookAt',
      lookAtTarget: [5, 10, 0],
    })
    const binding = new CameraTrackBinding(cam, action)
    binding.evaluate(0)  // camera at (0, 0, 0)

    const worldForward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    // Should point from (0,0,0) toward (5,10,0) → unit vector ≈ (0.447, 0.894, 0).
    expect(worldForward.x).toBeCloseTo(0.447, 2)
    expect(worldForward.y).toBeCloseTo(0.894, 2)
  })

  it('FCurve-based location is overridden when pathFollow is present', () => {
    const cam = new PerspectiveCamera()
    const fakeLoc = makeFCurve('location', [makeBezTriple(0, 999)], { arrayIndex: 0 })
    const action = makeCameraAction([fakeLoc], 24)
    action.pathFollow = makePathFollowConstraint(linearPath(), {
      arcLengthUniform: true,
    })
    const binding = new CameraTrackBinding(cam, action)
    binding.evaluate(0)
    // Path drives position to (0,0,0), not the FCurve's 999.
    expect(cam.position.x).toBeCloseTo(0, 4)
  })

  it('orientation=free: rotation FCurves still apply', () => {
    const cam = new PerspectiveCamera()
    const rotZ = makeFCurve('rotation_euler', [
      makeBezTriple(0, Math.PI / 2),
    ], { arrayIndex: 2 })
    const action = makeCameraAction([rotZ], 24)
    action.pathFollow = makePathFollowConstraint(linearPath(), {
      orientation: 'free',
    })
    const binding = new CameraTrackBinding(cam, action)
    binding.evaluate(0)
    // Rotation FCurve should have set Z to π/2.
    expect(cam.rotation.z).toBeCloseTo(Math.PI / 2, 4)
  })

  it('lens/clip FCurves still drive even with pathFollow', () => {
    const cam = new PerspectiveCamera()
    const lens = makeFCurve('lens', [makeBezTriple(0, 35)])
    const action = makeCameraAction([lens], 24)
    action.pathFollow = makePathFollowConstraint(linearPath())
    const binding = new CameraTrackBinding(cam, action)
    binding.evaluate(0)
    // 35mm lens with default 24mm sensor: fov = 2*atan(12/35) ≈ 37.85°
    expect(cam.fov).toBeCloseTo(37.85, 1)
  })
})
