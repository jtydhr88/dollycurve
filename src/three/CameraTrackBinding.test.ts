import { describe, it, expect } from 'vitest'
import { PerspectiveCamera } from 'three'
import { CameraTrackBinding } from './CameraTrackBinding'
import { makeCameraAction } from '../data/factories'
import { insertScalarKey, insertVec3Key } from '../editing/insert'
import { Interpolation } from '../data/enums'

describe('CameraTrackBinding.evaluate', () => {
  it('writes location FCurves into camera.position', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    insertVec3Key(action, 'location', 0, [0, 0, 0], { ipo: Interpolation.LINEAR })
    insertVec3Key(action, 'location', 24, [10, 20, 30], { ipo: Interpolation.LINEAR })
    const binding = new CameraTrackBinding(cam, action)

    binding.evaluate(0)
    expect(cam.position.x).toBeCloseTo(0, 6)

    binding.evaluate(0.5)  // = frame 12, halfway
    expect(cam.position.x).toBeCloseTo(5, 4)
    expect(cam.position.y).toBeCloseTo(10, 4)
    expect(cam.position.z).toBeCloseTo(15, 4)

    binding.evaluate(1)
    expect(cam.position.x).toBeCloseTo(10, 4)
    expect(cam.position.y).toBeCloseTo(20, 4)
    expect(cam.position.z).toBeCloseTo(30, 4)
  })

  it('writes rotation_euler FCurves into camera.rotation', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    insertVec3Key(action, 'rotation_euler', 0, [0, 0, 0], { ipo: Interpolation.LINEAR })
    insertVec3Key(action, 'rotation_euler', 24, [Math.PI / 2, 0, 0], { ipo: Interpolation.LINEAR })
    const binding = new CameraTrackBinding(cam, action)

    binding.evaluate(0.5)
    expect(cam.rotation.x).toBeCloseTo(Math.PI / 4, 4)
  })

  it('lens FCurve drives camera.fov via Blender vertical-sensor formula', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 100)
    const action = makeCameraAction([], 24)
    // 50mm with 24mm sensor → fov_v = 2*atan(12/50) = 0.4516 rad ≈ 25.87°
    insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.LINEAR })
    insertScalarKey(action, 'lens', 24, 24, { ipo: Interpolation.LINEAR })
    const binding = new CameraTrackBinding(cam, action)

    binding.evaluate(0)
    const expected50 = (2 * Math.atan(24 / 2 / 50)) * 180 / Math.PI
    expect(cam.fov).toBeCloseTo(expected50, 3)

    binding.evaluate(1)
    const expected24 = (2 * Math.atan(24 / 2 / 24)) * 180 / Math.PI
    expect(cam.fov).toBeCloseTo(expected24, 3)
  })

  it('captureFromCamera round-trips through evaluate', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100)
    cam.position.set(1, 2, 3)
    cam.rotation.set(0.1, 0.2, 0.3, 'XYZ')
    cam.updateMatrixWorld()

    const action = makeCameraAction([], 24)
    const binding = new CameraTrackBinding(cam, action)
    const captured = binding.captureFromCamera()

    expect(captured.location).toEqual([1, 2, 3])
    expect(captured.rotation_euler[0]).toBeCloseTo(0.1, 5)
    // Lens computed from fov=60, sensor=24: lens = 12 / tan(30°) ≈ 20.785
    expect(captured.lens).toBeCloseTo(12 / Math.tan(30 * Math.PI / 180), 4)
  })

  it('clip_start / clip_end FCurves drive camera.near / camera.far', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'clip_start', 0, 0.5)
    insertScalarKey(action, 'clip_end', 0, 200)
    const binding = new CameraTrackBinding(cam, action)
    binding.evaluate(0)
    expect(cam.near).toBeCloseTo(0.5, 6)
    expect(cam.far).toBeCloseTo(200, 4)
  })

  it('ignores unknown rnaPaths silently', () => {
    const cam = new PerspectiveCamera()
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'this_property_does_not_exist', 0, 42)
    const binding = new CameraTrackBinding(cam, action)
    expect(() => binding.evaluate(0)).not.toThrow()
  })
})
