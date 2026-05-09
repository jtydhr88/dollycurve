import { Easing, HandleType, Interpolation } from '../data/enums'
import { CameraAction, FCurve } from '../data/types'
import { deleteKeyframe } from '../editing/delete'
import { recalcHandlesAround } from '../editing/handles'
import { insertOrReplaceKeyframe } from '../editing/insert'
import { moveKeyframe } from '../editing/move'
import { evaluateFCurve } from '../eval/evaluate'
import {
  channelLabel,
  formatValue,
  isEasingInterpolation,
  parseValue,
  rnaPathSortKey,
} from './labels'

export interface SimplePanelOptions {
  container: HTMLElement
  action: CameraAction
  /** Current playhead frame, used as insertion point for "+ key". */
  getCurrentFrame: () => number
  /** Called after any panel-driven mutation; host should refresh its viewport. */
  onChanged?: () => void
  /** Fired once per user-intent COMMAND (input change / button click) so
   * callers can push undo steps. Same contract as GraphEditor.onCommit. */
  onCommit?: (label: string) => void
  /** Optional jump-to-frame; enables a "go" button per key. */
  setCurrentFrame?: (frame: number) => void
}

const IPO_OPTIONS: { value: Interpolation; label: string }[] = [
  { value: Interpolation.CONSTANT, label: 'const' },
  { value: Interpolation.LINEAR,   label: 'lin' },
  { value: Interpolation.BEZIER,   label: 'bez' },
  { value: Interpolation.SINE,     label: 'sine' },
  { value: Interpolation.QUAD,     label: 'quad' },
  { value: Interpolation.CUBIC,    label: 'cubic' },
  { value: Interpolation.QUART,    label: 'quart' },
  { value: Interpolation.QUINT,    label: 'quint' },
  { value: Interpolation.EXPO,     label: 'expo' },
  { value: Interpolation.CIRC,     label: 'circ' },
  { value: Interpolation.BACK,     label: 'back' },
  { value: Interpolation.BOUNCE,   label: 'bounce' },
  { value: Interpolation.ELASTIC,  label: 'elastic' },
]

const EASING_OPTIONS: { value: Easing; label: string }[] = [
  { value: Easing.AUTO,   label: 'auto' },
  { value: Easing.IN,     label: 'in' },
  { value: Easing.OUT,    label: 'out' },
  { value: Easing.IN_OUT, label: 'in/out' },
]

const HANDLE_OPTIONS: { value: HandleType; label: string }[] = [
  { value: HandleType.AUTO_CLAMPED, label: 'auto-clamp' },
  { value: HandleType.AUTO,         label: 'auto' },
  { value: HandleType.VECTOR,       label: 'vector' },
  { value: HandleType.ALIGN,        label: 'align' },
  { value: HandleType.FREE,         label: 'free' },
]

const STYLE_ID = 'ckp-simple-panel-style'
const STYLE = `
.ckp-panel { font-size: 12px; color: #ddd; }
.ckp-panel .ckp-empty { color: #666; text-align: center; padding: 16px; }
.ckp-channel { border-top: 1px solid #2a2a2a; padding: 6px 0; }
.ckp-channel-header {
  display: flex; align-items: center; gap: 6px; font-weight: 600;
  font-family: ui-monospace, monospace; color: #6cf; padding: 2px 4px;
}
.ckp-channel-header span.ckp-channel-name { flex: 1; }
.ckp-channel-header button {
  background: #2c2c33; color: #ddd; border: 1px solid #3a3a42; border-radius: 3px;
  padding: 1px 6px; font-size: 11px; cursor: pointer;
}
.ckp-channel-header button:hover { background: #353540; }
.ckp-keys { padding: 2px 4px; }
.ckp-key {
  display: grid; grid-template-columns: 56px 64px 60px 70px 56px auto auto;
  gap: 4px; align-items: center; padding: 2px 0;
  font-family: ui-monospace, monospace; font-size: 11px;
}
.ckp-key .ckp-easing-placeholder { color: #555; text-align: center; }
.ckp-key input {
  background: #1f1f23; color: #ddd; border: 1px solid #333;
  border-radius: 3px; padding: 1px 4px; font: inherit; min-width: 0;
}
.ckp-key input:focus { outline: 1px solid #2563eb; }
.ckp-key select {
  background: #1f1f23; color: #ddd; border: 1px solid #333;
  border-radius: 3px; padding: 1px 4px; font: inherit;
}
.ckp-key button {
  background: transparent; color: #aaa; border: none;
  cursor: pointer; padding: 0 4px;
}
.ckp-key button:hover { color: #fff; }
`

export class SimplePanel {
  private container: HTMLElement
  private action: CameraAction
  private getCurrentFrame: () => number
  private setCurrentFrame: ((f: number) => void) | undefined
  private onChanged: () => void
  private onCommit: (label: string) => void

  constructor (opts: SimplePanelOptions) {
    this.container = opts.container
    this.action = opts.action
    this.getCurrentFrame = opts.getCurrentFrame
    this.setCurrentFrame = opts.setCurrentFrame
    this.onChanged = opts.onChanged ?? (() => {})
    this.onCommit = opts.onCommit ?? (() => {})

    this.injectStyle()
    this.container.classList.add('ckp-panel')
    this.refresh()
  }

  refresh (): void {
    this.container.innerHTML = ''

    const sortedFcurves = [...this.action.fcurves].sort((a, b) => {
      const ka = rnaPathSortKey(a.rnaPath)
      const kb = rnaPathSortKey(b.rnaPath)
      if (ka !== kb) return ka - kb
      if (a.rnaPath !== b.rnaPath) return a.rnaPath.localeCompare(b.rnaPath)
      return a.arrayIndex - b.arrayIndex
    })

    if (sortedFcurves.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'ckp-empty'
      empty.textContent = 'No keyframes yet — orbit and click + Capture all'
      this.container.appendChild(empty)
      return
    }

    for (const fcu of sortedFcurves) {
      this.container.appendChild(this.renderChannel(fcu))
    }
  }

  destroy (): void {
    this.container.innerHTML = ''
    this.container.classList.remove('ckp-panel')
  }

  private renderChannel (fcu: FCurve): HTMLDivElement {
    const channel = document.createElement('div')
    channel.className = 'ckp-channel'

    const header = document.createElement('div')
    header.className = 'ckp-channel-header'

    const name = document.createElement('span')
    name.className = 'ckp-channel-name'
    name.textContent = channelLabel(fcu.rnaPath, fcu.arrayIndex)
    header.appendChild(name)

    const addBtn = document.createElement('button')
    addBtn.textContent = '+ key'
    addBtn.title = 'Insert key at current playhead with the curve\'s current value'
    addBtn.addEventListener('click', () => {
      const frame = this.getCurrentFrame()
      const value = evaluateFCurve(fcu, frame)
      insertOrReplaceKeyframe(fcu, frame, value)
      this.fireChanged('panel: + key')
    })
    header.appendChild(addBtn)

    const removeBtn = document.createElement('button')
    removeBtn.textContent = '×'
    removeBtn.title = 'Remove this entire channel'
    removeBtn.addEventListener('click', () => {
      const i = this.action.fcurves.indexOf(fcu)
      if (i >= 0) this.action.fcurves.splice(i, 1)
      this.fireChanged('panel: remove channel')
    })
    header.appendChild(removeBtn)
    channel.appendChild(header)

    const keys = document.createElement('div')
    keys.className = 'ckp-keys'
    fcu.bezt.forEach((_, i) => keys.appendChild(this.renderKey(fcu, i)))
    channel.appendChild(keys)

    return channel
  }

  private renderKey (fcu: FCurve, idx: number): HTMLDivElement {
    const bezt = fcu.bezt[idx]
    const row = document.createElement('div')
    row.className = 'ckp-key'

    const fps = this.action.fps

    const timeInput = document.createElement('input')
    timeInput.type = 'number'
    timeInput.step = '0.01'
    timeInput.value = (bezt.vec[1][0] / fps).toFixed(2)
    timeInput.addEventListener('change', () => {
      const seconds = parseFloat(timeInput.value)
      if (!Number.isFinite(seconds)) return this.refresh()
      moveKeyframe(fcu, idx, seconds * fps)
      this.fireChanged('panel: edit time')
    })
    row.appendChild(timeInput)

    const valueInput = document.createElement('input')
    valueInput.type = 'number'
    valueInput.step = '0.01'
    valueInput.value = formatValue(fcu.rnaPath, bezt.vec[1][1])
    valueInput.addEventListener('change', () => {
      const v = parseValue(fcu.rnaPath, valueInput.value)
      if (v === null) return this.refresh()
      moveKeyframe(fcu, idx, bezt.vec[1][0], v)
      this.fireChanged('panel: edit value')
    })
    row.appendChild(valueInput)

    const ipoSelect = document.createElement('select')
    for (const opt of IPO_OPTIONS) {
      const o = document.createElement('option')
      o.value = opt.value
      o.textContent = opt.label
      if (bezt.ipo === opt.value) o.selected = true
      ipoSelect.appendChild(o)
    }
    ipoSelect.addEventListener('change', () => {
      bezt.ipo = ipoSelect.value as Interpolation
      this.fireChanged('panel: set ipo')
    })
    row.appendChild(ipoSelect)

    // Easing only meaningful for BACK..SINE IPOs. Mirrors graph_buttons.cc:413.
    if (isEasingInterpolation(bezt.ipo)) {
      const easingSelect = document.createElement('select')
      for (const opt of EASING_OPTIONS) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = opt.label
        if (bezt.easing === opt.value) o.selected = true
        easingSelect.appendChild(o)
      }
      easingSelect.addEventListener('change', () => {
        bezt.easing = easingSelect.value as Easing
        this.fireChanged('panel: set easing')
      })
      row.appendChild(easingSelect)
    } else {
      const placeholder = document.createElement('span')
      placeholder.className = 'ckp-easing-placeholder'
      placeholder.textContent = '—'
      placeholder.title = 'Easing only applies to BACK/BOUNCE/CIRC/CUBIC/ELASTIC/EXPO/QUAD/QUART/QUINT/SINE'
      row.appendChild(placeholder)
    }

    // Handle dropdown drives h1 and h2 together; if they disagree, leave
    // unselected so the user sees the asymmetry.
    const handleSelect = document.createElement('select')
    for (const opt of HANDLE_OPTIONS) {
      const o = document.createElement('option')
      o.value = opt.value
      o.textContent = opt.label
      if (bezt.h1 === opt.value && bezt.h2 === opt.value) o.selected = true
      handleSelect.appendChild(o)
    }
    handleSelect.addEventListener('change', () => {
      const h = handleSelect.value as HandleType
      bezt.h1 = h
      bezt.h2 = h
      recalcHandlesAround(fcu, idx)
      this.fireChanged('panel: set handle')
    })
    row.appendChild(handleSelect)

    if (this.setCurrentFrame) {
      const goBtn = document.createElement('button')
      goBtn.textContent = 'go'
      goBtn.title = 'Jump playhead to this key'
      goBtn.addEventListener('click', () => {
        this.setCurrentFrame!(bezt.vec[1][0])
      })
      row.appendChild(goBtn)
    } else {
      row.appendChild(document.createElement('span'))
    }

    const delBtn = document.createElement('button')
    delBtn.textContent = '×'
    delBtn.title = 'Delete this key'
    delBtn.addEventListener('click', () => {
      deleteKeyframe(fcu, idx)
      this.fireChanged('panel: delete key')
    })
    row.appendChild(delBtn)

    return row
  }

  private fireChanged (label?: string): void {
    this.onChanged()
    if (label) this.onCommit(label)
    this.refresh()
  }

  private injectStyle (): void {
    if (document.getElementById(STYLE_ID)) return
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.textContent = STYLE
    document.head.appendChild(tag)
  }
}
