import { describe, it, expect } from 'vitest'
import { CycleMode, Easing, HandleType, Interpolation } from '../data/enums'
import { makeCameraAction, makeCyclesModifier } from '../data/factories'
import { insertScalarKey, insertVec3Key } from '../editing/insert'
import {
  CameraActionJson,
  exportCameraActionToJson,
  importCameraActionFromJson,
  SCHEMA_VERSION,
} from './blender-json'
import { evaluateFCurve } from '../eval/evaluate'

describe('exportCameraActionToJson', () => {
  it('writes the schema version and fps', () => {
    const action = makeCameraAction([], 30)
    const json = exportCameraActionToJson(action)
    expect(json.version).toBe(SCHEMA_VERSION)
    expect(json.fps).toBe(30)
    expect(json.fcurves).toEqual([])
  })

  it('emits one fcurve entry per FCurve with all fields', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.BEZIER })
    insertScalarKey(action, 'lens', 24, 24, { ipo: Interpolation.BEZIER })
    const json = exportCameraActionToJson(action)
    expect(json.fcurves).toHaveLength(1)
    const fcu = json.fcurves[0]
    expect(fcu.rnaPath).toBe('lens')
    expect(fcu.arrayIndex).toBe(0)
    expect(fcu.keyframes).toHaveLength(2)
    expect(fcu.keyframes[0].vec[1]).toEqual([0, 50])
    expect(fcu.keyframes[0].ipo).toBe('bezier')
  })

  it('serializes Cycles modifier', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50)
    insertScalarKey(action, 'lens', 24, 24)
    action.fcurves[0].modifiers.push(makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_OFFSET, 0, 3))
    const json = exportCameraActionToJson(action)
    expect(json.fcurves[0].modifiers).toEqual([
      { type: 'cycles', before: 'off', after: 'repeat_offset', beforeCount: 0, afterCount: 3 },
    ])
  })
})

describe('importCameraActionFromJson', () => {
  it('parses a minimal valid JSON', () => {
    const json: CameraActionJson = {
      version: 1,
      fps: 24,
      fcurves: [],
    }
    const action = importCameraActionFromJson(json)
    expect(action.fcurves).toEqual([])
    expect(action.fps).toBe(24)
  })

  it('rejects wrong schema version', () => {
    expect(() => importCameraActionFromJson({ version: 2, fps: 24, fcurves: [] }))
      .toThrow(/version/)
  })

  it('rejects unknown ipo enum', () => {
    const json = {
      version: 1, fps: 24,
      fcurves: [{
        rnaPath: 'lens', arrayIndex: 0, extend: 'constant',
        autoSmoothing: 'continuous_acceleration', discrete: false,
        modifiers: [], keyframes: [{
          vec: [[-1, 0], [0, 0], [1, 0]],
          ipo: 'wrongMode', easing: 'auto', h1: 'auto_clamped', h2: 'auto_clamped',
          keyframeType: 'keyframe', back: 1.7, amplitude: 0.8, period: 4.1,
        }],
      }],
    }
    expect(() => importCameraActionFromJson(json)).toThrow(/ipo.*wrongMode/)
  })

  it('rejects malformed root', () => {
    expect(() => importCameraActionFromJson(null)).toThrow()
    expect(() => importCameraActionFromJson('hello')).toThrow()
    expect(() => importCameraActionFromJson([])).toThrow()
  })

  it('rejects non-finite fps', () => {
    expect(() => importCameraActionFromJson({ version: 1, fps: NaN, fcurves: [] }))
      .toThrow(/fps/)
  })
})

describe('round-trip exportToJson → importFromJson', () => {
  it('preserves a multi-channel action with handles', () => {
    const action = makeCameraAction([], 24)
    insertVec3Key(action, 'location', 0, [0, 0, 0], { ipo: Interpolation.BEZIER })
    insertVec3Key(action, 'location', 24, [5, 1.5, 8], { ipo: Interpolation.BEZIER })
    insertVec3Key(action, 'location', 48, [10, 0, 0], { ipo: Interpolation.LINEAR })
    insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.BACK, easing: Easing.OUT })
    insertScalarKey(action, 'lens', 48, 24, { ipo: Interpolation.BACK })

    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)

    expect(back.fps).toBe(action.fps)
    expect(back.fcurves).toHaveLength(action.fcurves.length)
    for (let i = 0; i < action.fcurves.length; i++) {
      const a = action.fcurves[i]
      const b = back.fcurves[i]
      expect(b.rnaPath).toBe(a.rnaPath)
      expect(b.arrayIndex).toBe(a.arrayIndex)
      expect(b.bezt).toHaveLength(a.bezt.length)
      for (let k = 0; k < a.bezt.length; k++) {
        const ab = a.bezt[k]
        const bb = b.bezt[k]
        expect(bb.vec).toEqual(ab.vec)
        expect(bb.ipo).toBe(ab.ipo)
        expect(bb.easing).toBe(ab.easing)
        expect(bb.h1).toBe(ab.h1)
        expect(bb.h2).toBe(ab.h2)
      }
    }
  })

  it('round-trip preserves evaluation results to 1e-9', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50)
    insertScalarKey(action, 'lens', 24, 24)
    insertScalarKey(action, 'lens', 48, 85)
    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)
    const orig = action.fcurves[0]
    const restored = back.fcurves[0]
    for (let f = 0; f <= 48; f += 1) {
      expect(evaluateFCurve(restored, f)).toBeCloseTo(evaluateFCurve(orig, f), 9)
    }
  })

  it('round-trip preserves Cycles modifier', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'rotation_euler', 0, 0)
    insertScalarKey(action, 'rotation_euler', 24, Math.PI)
    action.fcurves[0].modifiers.push(makeCyclesModifier(CycleMode.OFF, CycleMode.REPEAT_OFFSET))

    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)
    expect(back.fcurves[0].modifiers).toHaveLength(1)
    expect(back.fcurves[0].modifiers[0].type).toBe('cycles')
    if (back.fcurves[0].modifiers[0].type === 'cycles') {
      expect(back.fcurves[0].modifiers[0].after).toBe(CycleMode.REPEAT_OFFSET)
    }
  })
})

describe('Blender-style fixture parsing', () => {
  // What the Python addon would emit for a 2-key lens animation.
  const fixture: unknown = {
    version: 1,
    fps: 24,
    fcurves: [
      {
        rnaPath: 'lens',
        arrayIndex: 0,
        extend: 'constant',
        autoSmoothing: 'continuous_acceleration',
        discrete: false,
        modifiers: [],
        keyframes: [
          {
            vec: [[-1, 50], [0, 50], [1, 50]],
            ipo: 'bezier',
            easing: 'auto',
            h1: 'auto_clamped',
            h2: 'auto_clamped',
            keyframeType: 'keyframe',
            back: 1.70158,
            amplitude: 0.8,
            period: 4.1,
          },
          {
            vec: [[23, 24], [24, 24], [25, 24]],
            ipo: 'bezier',
            easing: 'auto',
            h1: 'auto_clamped',
            h2: 'auto_clamped',
            keyframeType: 'keyframe',
            back: 1.70158,
            amplitude: 0.8,
            period: 4.1,
          },
        ],
      },
    ],
  }

  it('parses without throwing', () => {
    const action = importCameraActionFromJson(fixture)
    expect(action.fcurves).toHaveLength(1)
    expect(action.fcurves[0].bezt[0].vec[1]).toEqual([0, 50])
    expect(action.fcurves[0].bezt[1].vec[1]).toEqual([24, 24])
    expect(action.fcurves[0].bezt[0].h1).toBe(HandleType.AUTO_CLAMPED)
    expect(action.fcurves[0].bezt[0].ipo).toBe(Interpolation.BEZIER)
  })

  it('evaluation of imported action matches Blender semantics', () => {
    const action = importCameraActionFromJson(fixture)
    const fcu = action.fcurves[0]
    expect(evaluateFCurve(fcu, 0)).toBeCloseTo(50, 6)
    expect(evaluateFCurve(fcu, 24)).toBeCloseTo(24, 6)
    // Mid-point: bezier with auto-clamped handles between 50 and 24.
    expect(evaluateFCurve(fcu, 12)).toBeGreaterThan(24)
    expect(evaluateFCurve(fcu, 12)).toBeLessThan(50)
  })
})
