import { describe, it, expect } from 'vitest'
import { evaluateFCurve } from './evaluate'
import { makeBezTriple, makeFCurve } from '../data/factories'
import { Interpolation } from '../data/enums'
import { exportCameraActionToJson, importCameraActionFromJson } from '../io/blender-json'

describe('FCurve.muted', () => {
  it('returns 0 regardless of keyframe content', () => {
    const fcu = makeFCurve('value', [
      makeBezTriple(0,  5, { ipo: Interpolation.LINEAR }),
      makeBezTriple(10, 15, { ipo: Interpolation.LINEAR }),
    ])
    expect(evaluateFCurve(fcu, 5)).toBeCloseTo(10, 6)
    fcu.muted = true
    expect(evaluateFCurve(fcu, 5)).toBe(0)
  })
})

describe('JSON round-trip preserves muted/locked flags', () => {
  it('survives export → import', () => {
    const fcu = makeFCurve('value', [makeBezTriple(0, 5)])
    fcu.muted = true
    fcu.locked = true

    const action = { fcurves: [fcu], fps: 24 }
    const json = exportCameraActionToJson(action)
    const back = importCameraActionFromJson(json)
    expect(back.fcurves[0].muted).toBe(true)
    expect(back.fcurves[0].locked).toBe(true)
  })

  it('absent flags do not appear in JSON output (backward-compat)', () => {
    const fcu = makeFCurve('value', [makeBezTriple(0, 5)])
    const json = exportCameraActionToJson({ fcurves: [fcu], fps: 24 })
    expect(json.fcurves[0].muted).toBeUndefined()
    expect(json.fcurves[0].locked).toBeUndefined()
  })
})
