import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Scene } from 'three'
import { makeSplinePath, makeSplinePoint } from '../data/factories'
import { ScenePathEditor } from './ScenePathEditor'

function makeHostDom (): HTMLElement {
  const dom = document.createElement('div')
  Object.defineProperty(dom, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
  })
  return dom
}

function makePointerEvent (type: string, opts: { button?: number; clientX?: number; clientY?: number; pointerId?: number } = {}): Event {
  // jsdom may lack PointerEvent; synthesize a base Event with the fields we read.
  const evt = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(evt, {
    button: opts.button ?? 0,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    pointerId: opts.pointerId ?? 1,
  })
  return evt
}

describe('ScenePathEditor', () => {
  it('instantiates and adds a Group to the scene', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([5, 0, 0], [1, 0, 0]),
    ])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    const group = scene.children.find((c) => c.name === 'dollycurve:ScenePathEditor')
    expect(group).toBeDefined()
    editor.destroy()
    expect(scene.children.find((c) => c.name === 'dollycurve:ScenePathEditor')).toBeUndefined()
  })

  it('refreshes after path mutation: anchor count tracks point count', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([makeSplinePoint([0, 0, 0]), makeSplinePoint([5, 0, 0])])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })

    // Add a third point and refresh
    path.points.push(makeSplinePoint([5, 5, 0]))
    editor.refresh()

    // Anchor meshes (small spheres) should number N
    const group = scene.children.find((c) => c.name === 'dollycurve:ScenePathEditor')!
    const sphereMeshes = group.children.filter((c) => (c as { userData?: { kind?: string } }).userData?.kind === 'anchor')
    expect(sphereMeshes.length).toBe(3)

    editor.destroy()
  })

  it('pick at corner of viewport (anchor far off ray) returns null', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 1000)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const dom = makeHostDom()
    // anchor at world origin; pick from screen corner — center of NDC won't hit (0.05r at 5 units)
    // unless we pick the center. Pick a corner instead.
    const path = makeSplinePath([makeSplinePoint([0, 0, 0])])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    expect(editor.pick(0, 0)).toBeNull()
    editor.destroy()
  })

  it('pointer drag on anchor moves co + handles together (free constraint)', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([2, 0, 0], [1, 0, 0]),
    ])
    let changes = 0
    const editor = new ScenePathEditor(path, { scene, camera, dom, path, onChanged: () => changes++ })

    // Pointerdown on anchor 0 (screen center for centered camera). NDC (0,0)
    // ray hits the (0,0,0) anchor.
    dom.dispatchEvent(makePointerEvent('pointerdown', { clientX: 400, clientY: 300 }))
    expect(editor.getActive()).toEqual({ kind: 'anchor', pointIdx: 0 })

    // Move pointer to slight offset.
    dom.dispatchEvent(makePointerEvent('pointermove', { clientX: 440, clientY: 300 }))

    // Anchor x should have shifted (no longer 0). h1 and h2 also shifted by the same amount.
    expect(path.points[0].co[0]).not.toBe(0)
    const dx = path.points[0].co[0]
    expect(path.points[0].h1[0]).toBeCloseTo(-1 + dx, 4)  // original h1 = (-1,0,0)
    expect(path.points[0].h2[0]).toBeCloseTo( 1 + dx, 4)

    // Pointerup ends drag and emits onChanged.
    dom.dispatchEvent(makePointerEvent('pointerup', { clientX: 440, clientY: 300 }))
    expect(changes).toBe(1)

    editor.destroy()
  })

  it('axis-lock: pressing X during drag constrains to X axis', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([2, 0, 0], [1, 0, 0]),
    ])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    dom.dispatchEvent(makePointerEvent('pointerdown', { clientX: 400, clientY: 300 }))
    // Press X to lock to X axis.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
    // Move pointer up-and-right diagonally; with X-lock only X should change.
    dom.dispatchEvent(makePointerEvent('pointermove', { clientX: 440, clientY: 250 }))
    expect(path.points[0].co[0]).not.toBe(0)
    expect(path.points[0].co[1]).toBeCloseTo(0, 5)  // Y stays
    expect(path.points[0].co[2]).toBeCloseTo(0, 5)  // Z stays
    dom.dispatchEvent(makePointerEvent('pointerup', { clientX: 440, clientY: 250 }))
    editor.destroy()
  })

  it('insertPoint at t=0.5 splits segment via de Casteljau, preserves shape', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0]),
      makeSplinePoint([10, 0, 0], [1, 0, 0]),
    ])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    const idx = editor.insertPoint(0, 0.5)
    expect(idx).toBe(1)
    expect(path.points.length).toBe(3)
    // For a near-linear segment, the midpoint should land at ~(5, 0, 0).
    expect(path.points[1].co[0]).toBeCloseTo(5, 1)
    expect(path.points[1].co[1]).toBeCloseTo(0, 4)
    // Active should advance to the new point.
    expect(editor.getActive()).toEqual({ kind: 'anchor', pointIdx: 1 })
    editor.destroy()
  })

  it('deletePoint removes the point and adjusts active idx', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0]),
      makeSplinePoint([5, 0, 0]),
      makeSplinePoint([10, 0, 0]),
    ])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    editor.setActive({ kind: 'anchor', pointIdx: 2 })
    expect(editor.deletePoint(0)).toBe(true)
    expect(path.points.length).toBe(2)
    // Active was at 2; deleting earlier index decrements it to 1.
    expect(editor.getActive()).toEqual({ kind: 'anchor', pointIdx: 1 })
    editor.destroy()
  })

  it('deletePoint refuses to remove the last remaining point', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([makeSplinePoint([0, 0, 0])])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    expect(editor.deletePoint(0)).toBe(false)
    expect(path.points.length).toBe(1)
    editor.destroy()
  })

  it('insertPoint interpolates tilt linearly between neighbors', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0],  [1, 0, 0], 1, 0),
      makeSplinePoint([10, 0, 0], [1, 0, 0], 1, Math.PI / 2),
    ])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    editor.insertPoint(0, 0.5)
    expect(path.points[1].tilt).toBeCloseTo(Math.PI / 4, 6)
    editor.destroy()
  })

  it('Escape during drag cancels and restores original position', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const dom = makeHostDom()
    const path = makeSplinePath([
      makeSplinePoint([0, 0, 0], [1, 0, 0]),
      makeSplinePoint([2, 0, 0], [1, 0, 0]),
    ])
    let changes = 0
    const editor = new ScenePathEditor(path, { scene, camera, dom, path, onChanged: () => changes++ })
    dom.dispatchEvent(makePointerEvent('pointerdown', { clientX: 400, clientY: 300 }))
    dom.dispatchEvent(makePointerEvent('pointermove', { clientX: 480, clientY: 300 }))
    expect(path.points[0].co[0]).not.toBeCloseTo(0, 4)  // moved
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(path.points[0].co[0]).toBeCloseTo(0, 6)
    expect(path.points[0].h1[0]).toBeCloseTo(-1, 6)
    expect(path.points[0].h2[0]).toBeCloseTo( 1, 6)
    expect(changes).toBe(0)  // canceled drag emits no onChanged
    editor.destroy()
  })

  it('setPointTilt writes/clears the tilt field', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([makeSplinePoint([0, 0, 0]), makeSplinePoint([5, 0, 0])])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    editor.setPointTilt(0, Math.PI / 4)
    expect(path.points[0].tilt).toBeCloseTo(Math.PI / 4, 6)
    editor.setPointTilt(0, 0)
    expect(path.points[0].tilt).toBeUndefined()  // 0 elides the field
    editor.destroy()
  })

  it('setActive / getActive round-trip', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(45, 800 / 600, 0.1, 100)
    const dom = makeHostDom()
    const path = makeSplinePath([makeSplinePoint([0, 0, 0]), makeSplinePoint([5, 0, 0])])
    const editor = new ScenePathEditor(path, { scene, camera, dom, path })
    editor.setActive({ kind: 'anchor', pointIdx: 1 })
    expect(editor.getActive()).toEqual({ kind: 'anchor', pointIdx: 1 })
    editor.setActive(null)
    expect(editor.getActive()).toBeNull()
    editor.destroy()
  })
})
