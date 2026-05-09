import { describe, it, expect, beforeEach } from 'vitest'
import { Easing, HandleType, Interpolation } from '../data/enums'
import { makeCameraAction } from '../data/factories'
import { insertScalarKey, insertVec3Key } from '../editing/insert'
import { SimplePanel } from './SimplePanel'

function buildAction () {
  const action = makeCameraAction([], 24)
  insertVec3Key(action, 'location', 0, [0, 0, 0], { ipo: Interpolation.BEZIER })
  insertVec3Key(action, 'location', 24, [5, 1.5, 8], { ipo: Interpolation.BEZIER })
  insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.BEZIER })
  insertScalarKey(action, 'lens', 24, 24, { ipo: Interpolation.BEZIER })
  return action
}

describe('SimplePanel', () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('renders one row per FCurve, with two key rows each', () => {
    const action = buildAction()
    new SimplePanel({
      container,
      action,
      getCurrentFrame: () => 0,
    })
    const channels = container.querySelectorAll('.ckp-channel')
    expect(channels.length).toBe(4)  // location.x/y/z + lens
    const allKeys = container.querySelectorAll('.ckp-key')
    expect(allKeys.length).toBe(8)  // 4 channels × 2 keys
  })

  it('renders empty-state when action has no fcurves', () => {
    const action = makeCameraAction([], 24)
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    expect(container.querySelector('.ckp-empty')).not.toBeNull()
    expect(container.querySelectorAll('.ckp-channel').length).toBe(0)
  })

  it('orders channels by rnaPath then arrayIndex', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50)
    insertVec3Key(action, 'location', 0, [0, 0, 0])
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    const labels = Array.from(container.querySelectorAll('.ckp-channel-name'))
      .map((n) => n.textContent)
    expect(labels).toEqual(['location.x', 'location.y', 'location.z', 'lens (mm)'])
  })

  it('changing the value input via "change" event updates the bezt', () => {
    const action = buildAction()
    const panel = new SimplePanel({
      container,
      action,
      getCurrentFrame: () => 0,
    })
    const lensFcu = action.fcurves.find((f) => f.rnaPath === 'lens')!
    const lensChannel = Array.from(container.querySelectorAll('.ckp-channel'))
      .find((c) => c.querySelector('.ckp-channel-name')?.textContent === 'lens (mm)')!
    const valueInput = lensChannel.querySelectorAll('.ckp-key input[type="number"]')[1] as HTMLInputElement
    valueInput.value = '85'
    valueInput.dispatchEvent(new Event('change'))
    expect(lensFcu.bezt[0].vec[1][1]).toBeCloseTo(85, 6)
    void panel
  })

  it('rotation_euler value field round-trips degrees to radians', () => {
    const action = makeCameraAction([], 24)
    insertVec3Key(action, 'rotation_euler', 0, [0, 0, 0])
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    const rotXChannel = Array.from(container.querySelectorAll('.ckp-channel'))
      .find((c) => c.querySelector('.ckp-channel-name')?.textContent === 'rotation.x')!
    const valueInput = rotXChannel.querySelectorAll('.ckp-key input[type="number"]')[1] as HTMLInputElement
    valueInput.value = '90'
    valueInput.dispatchEvent(new Event('change'))
    const rotXFcu = action.fcurves.find((f) => f.rnaPath === 'rotation_euler' && f.arrayIndex === 0)!
    expect(rotXFcu.bezt[0].vec[1][1]).toBeCloseTo(Math.PI / 2, 5)
  })

  it('clicking "+ key" inserts a key at the current playhead', () => {
    const action = buildAction()
    const lensFcu = action.fcurves.find((f) => f.rnaPath === 'lens')!
    new SimplePanel({
      container,
      action,
      getCurrentFrame: () => 12,  // halfway between 0 and 24
    })
    const before = lensFcu.bezt.length
    const lensChannel = Array.from(container.querySelectorAll('.ckp-channel'))
      .find((c) => c.querySelector('.ckp-channel-name')?.textContent === 'lens (mm)')!
    const addBtn = lensChannel.querySelector('button')! as HTMLButtonElement
    addBtn.click()
    expect(lensFcu.bezt.length).toBe(before + 1)
    const middleKey = lensFcu.bezt.find((b) => Math.abs(b.vec[1][0] - 12) < 0.01)
    expect(middleKey).toBeDefined()
  })

  it('clicking "×" deletes the key', () => {
    const action = buildAction()
    const lensFcu = action.fcurves.find((f) => f.rnaPath === 'lens')!
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    const lensChannel = Array.from(container.querySelectorAll('.ckp-channel'))
      .find((c) => c.querySelector('.ckp-channel-name')?.textContent === 'lens (mm)')!
    const delBtn = lensChannel.querySelectorAll('.ckp-key button')[1] as HTMLButtonElement
    // delBtn at idx 1 = "×" of the first key (idx 0 was "go" if setCurrentFrame absent we have a placeholder span)
    // Re-grab to skip the placeholder span: there's only 1 button per row when setCurrentFrame is undefined.
    // Let me select the actual delete button by text content:
    const deleteBtn = Array.from(lensChannel.querySelectorAll('.ckp-key button'))
      .find((b) => b.textContent === '×') as HTMLButtonElement
    const before = lensFcu.bezt.length
    deleteBtn.click()
    expect(lensFcu.bezt.length).toBe(before - 1)
    void delBtn  // silence unused
  })

  it('changing ipo dropdown updates the bezt', () => {
    const action = buildAction()
    const lensFcu = action.fcurves.find((f) => f.rnaPath === 'lens')!
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    const lensChannel = Array.from(container.querySelectorAll('.ckp-channel'))
      .find((c) => c.querySelector('.ckp-channel-name')?.textContent === 'lens (mm)')!
    const select = lensChannel.querySelector('select') as HTMLSelectElement
    select.value = Interpolation.LINEAR
    select.dispatchEvent(new Event('change'))
    expect(lensFcu.bezt[0].ipo).toBe(Interpolation.LINEAR)
  })

  it('easing dropdown shown only when ipo is an easing mode', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.BEZIER })
    insertScalarKey(action, 'lens', 24, 24, { ipo: Interpolation.BEZIER })
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    // BEZIER ipo → easing slot is a placeholder span (text "—"), not a select.
    let easingSelects = container.querySelectorAll('.ckp-key select.ck-easing-stub-not-rendered')
    expect(easingSelects.length).toBe(0)
    expect(container.querySelectorAll('.ckp-easing-placeholder').length).toBe(2)

    // Switch ipo to BACK → easing dropdown should appear after refresh.
    const ipoSelect = container.querySelector('.ckp-channel select') as HTMLSelectElement
    ipoSelect.value = Interpolation.BACK
    ipoSelect.dispatchEvent(new Event('change'))
    // After refresh, the row should have an easing select instead of placeholder.
    const placeholderAfter = container.querySelectorAll('.ckp-easing-placeholder').length
    expect(placeholderAfter).toBe(1)  // first key now has 4 selects, second still BEZIER
  })

  it('changing easing dropdown updates bezt.easing', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.BACK, easing: Easing.AUTO })
    insertScalarKey(action, 'lens', 24, 24, { ipo: Interpolation.BACK })
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    const lensFcu = action.fcurves[0]
    // Selects: ipo, easing, handle. Easing is the 2nd one.
    const selects = container.querySelectorAll('.ckp-key select')
    const easingSelect = selects[1] as HTMLSelectElement
    easingSelect.value = Easing.IN_OUT
    easingSelect.dispatchEvent(new Event('change'))
    expect(lensFcu.bezt[0].easing).toBe(Easing.IN_OUT)
  })

  it('handle dropdown changes both h1 and h2 together', () => {
    const action = makeCameraAction([], 24)
    insertScalarKey(action, 'lens', 0, 50, { ipo: Interpolation.BEZIER })
    insertScalarKey(action, 'lens', 24, 24, { ipo: Interpolation.BEZIER })
    new SimplePanel({ container, action, getCurrentFrame: () => 0 })
    const lensFcu = action.fcurves[0]
    // BEZIER ipo → no easing dropdown, so per-row selects are: ipo, handle.
    const selects = container.querySelectorAll('.ckp-key select')
    const handleSelect = selects[1] as HTMLSelectElement
    handleSelect.value = HandleType.VECTOR
    handleSelect.dispatchEvent(new Event('change'))
    expect(lensFcu.bezt[0].h1).toBe(HandleType.VECTOR)
    expect(lensFcu.bezt[0].h2).toBe(HandleType.VECTOR)
  })

  it('onChanged is called after a mutation', () => {
    const action = buildAction()
    let count = 0
    new SimplePanel({
      container,
      action,
      getCurrentFrame: () => 0,
      onChanged: () => { count++ },
    })
    const select = container.querySelector('.ckp-channel select') as HTMLSelectElement
    select.value = Interpolation.LINEAR
    select.dispatchEvent(new Event('change'))
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
