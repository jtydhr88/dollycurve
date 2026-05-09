// Canvas-based F-Curve graph editor, modeled on Blender's Graph Editor
// (editors/space_graph/).

import { Easing, HandleType, Interpolation } from '../data/enums'
import { CameraAction, FCurve } from '../data/types'
import { evalBezierSegment } from '../eval/bezier'
import { evaluateFCurve } from '../eval/evaluate'
import { deleteKeyframe } from '../editing/delete'
import { recalcAllHandles } from '../editing/handles'
import { moveKeyframeTimeWithHandles, moveKeyframeValueWithHandles } from '../editing/move'
import { sortFCurve } from '../editing/sort'
import { channelGroup, channelGroupSortKey, channelLabel, formatValue, isAngleRnaPath, rnaPathSortKey } from './labels'
import { showSimpleMenu, type MenuItem } from './menu'
import { niceStep } from './draw-utils'
import {
  THEME, STYLE, STYLE_ID,
  HIT_RADIUS, VERT_SIZE, HANDLE_DOT_SIZE, Y_PAD_FRAC, X_PAD_FRAC,
  colorForFCurve,
} from './graph-theme'

type HitPart = 'anchor' | 'h1' | 'h2'

interface HitResult {
  keyIdx: number
  part: HitPart
  distancePx: number
}

interface DragState {
  kind: 'box' | 'translate' | 'pan'
  startX: number
  startY: number
  initialPositions?: Map<string, [number, number]>  // "keyIdx:part" → [time, value] snapshot
}

/** Shared X view between Timeline and GraphEditor. Either widget mutates
 * it in place and calls `onViewXChanged` so the other re-renders. */
export interface SharedXView {
  xMin: number
  xMax: number
}

export interface GraphEditorOptions {
  container: HTMLElement
  action: CameraAction
  getCurrentFrame: () => number
  setCurrentFrame?: (frame: number) => void
  onChanged?: () => void
  /** Fired once per user-intent COMMAND boundary (drag commit, delete, set
   * ipo / handle / snap). Use this to push undo steps — `onChanged` fires
   * per pointermove during a drag, which is too granular for undo. The
   * `label` is a short human-readable description for history menus. */
  onCommit?: (label: string) => void
  viewX?: SharedXView
  onViewXChanged?: () => void
  getFrameRange?: () => [number, number] | null
}


export class GraphEditor {
  private root: HTMLDivElement
  private channelsEl: HTMLDivElement
  private wrapEl: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private emptyEl: HTMLDivElement

  private action: CameraAction
  private getCurrentFrame: () => number
  private setCurrentFrame: ((f: number) => void) | null
  private onChanged: () => void
  private onCommit: (label: string) => void
  private sharedX: SharedXView | null
  private onViewXChanged: () => void
  private getFrameRange: (() => [number, number] | null) | null

  // X may be backed by sharedX (so Timeline can sync) or fall back here.
  private view = { xMin: 0, xMax: 100, yMin: -1, yMax: 1 }
  private activeFCurveIdx: number = -1
  // Non-active visible channels render at lower opacity, share Y space.
  private visibleSet = new Set<number>()
  // Selection: keys "keyIdx:part" within active fcurve.
  private selected = new Set<string>()
  private activeKey: string | null = null
  private collapsedGroups = new Set<string>()
  // Frames where Shift+K marked a column; visible-channel keys at these
  // frames render with a tinted highlight. Cleared on selection change.
  private columnFrames: number[] = []
  private dragging: DragState | null = null
  private mouseInCanvas = false
  private rafPending = false
  // Re-entry guard: refresh's renderChannelList → auto-pick → frameAll →
  // syncToShared fires onViewXChanged, which hosts typically wire to
  // another graph.refresh(). Without this, the outer append loop runs
  // AFTER the recursive call already populated the list, leaving
  // duplicate rows.
  private inRefresh = false
  private resizeObs: ResizeObserver

  constructor (opts: GraphEditorOptions) {
    this.action = opts.action
    this.getCurrentFrame = opts.getCurrentFrame
    this.setCurrentFrame = opts.setCurrentFrame ?? null
    this.onChanged = opts.onChanged ?? (() => {})
    this.onCommit = opts.onCommit ?? (() => {})
    this.sharedX = opts.viewX ?? null
    this.onViewXChanged = opts.onViewXChanged ?? (() => {})
    this.getFrameRange = opts.getFrameRange ?? null
    if (this.sharedX) {
      this.view.xMin = this.sharedX.xMin
      this.view.xMax = this.sharedX.xMax
    }

    this.injectStyle()
    this.root = document.createElement('div')
    this.root.className = 'ckp-graph'
    this.channelsEl = document.createElement('div')
    this.channelsEl.className = 'ckp-graph-channels'
    this.wrapEl = document.createElement('div')
    this.wrapEl.className = 'ckp-graph-canvas-wrap'
    this.wrapEl.tabIndex = 0  // focusable for keyboard events
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ckp-graph-canvas'
    this.emptyEl = document.createElement('div')
    this.emptyEl.className = 'ckp-graph-empty'
    this.emptyEl.textContent = 'No channels yet — capture some keyframes from the camera'
    this.wrapEl.appendChild(this.canvas)
    this.wrapEl.appendChild(this.emptyEl)
    this.root.appendChild(this.channelsEl)
    this.root.appendChild(this.wrapEl)
    opts.container.appendChild(this.root)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('GraphEditor: 2d context unavailable')
    this.ctx = ctx

    this.attachEvents()

    this.resizeObs = new ResizeObserver(() => this.onResize())
    this.resizeObs.observe(this.wrapEl)

    this.refresh()
  }

  refresh (): void {
    if (this.inRefresh) return
    this.inRefresh = true
    try {
      this.renderChannelList()
      // Container may have been hidden at construction (canvas dims 0,
      // ResizeObserver produced 1×1 backing store). Force-resize before
      // first paint after becoming visible.
      this.onResize()
      this.requestRender()
    } finally {
      this.inRefresh = false
    }
  }

  /** Drop all interactive state. Call when the underlying action is
   * replaced wholesale (e.g. JSON load) — stale indices would otherwise
   * point at keys that no longer exist. */
  reset (): void {
    this.activeFCurveIdx = -1
    this.visibleSet.clear()
    this.selected.clear()
    this.activeKey = null
    this.refresh()
  }

  /** Lightweight re-render — skips channel-list DOM rebuild. Use for
   * playback (refresh would thrash the DOM at 60fps). */
  redraw (): void {
    this.requestRender()
  }

  destroy (): void {
    this.resizeObs.disconnect()
    this.detachEvents()
    this.root.remove()
  }

  private injectStyle (): void {
    if (document.getElementById(STYLE_ID)) return
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.textContent = STYLE
    document.head.appendChild(tag)
  }

  private renderChannelList (): void {
    this.channelsEl.innerHTML = ''
    const sorted = [...this.action.fcurves]
      .map((f, i) => ({ fcu: f, originalIdx: i }))
      .sort((a, b) => {
        const ga = channelGroupSortKey(channelGroup(a.fcu.rnaPath))
        const gb = channelGroupSortKey(channelGroup(b.fcu.rnaPath))
        if (ga !== gb) return ga - gb
        const ka = rnaPathSortKey(a.fcu.rnaPath)
        const kb = rnaPathSortKey(b.fcu.rnaPath)
        if (ka !== kb) return ka - kb
        if (a.fcu.rnaPath !== b.fcu.rnaPath) return a.fcu.rnaPath.localeCompare(b.fcu.rnaPath)
        return a.fcu.arrayIndex - b.fcu.arrayIndex
      })

    if (sorted.length === 0) {
      this.emptyEl.style.display = ''
      return
    }
    this.emptyEl.style.display = 'none'

    // Auto-select first channel; default-show the active channel's
    // siblings group (e.g. location.x active → show all location.*).
    if (this.activeFCurveIdx < 0 || this.activeFCurveIdx >= this.action.fcurves.length) {
      this.activeFCurveIdx = sorted[0].originalIdx
      this.visibleSet.clear()
      const activeFcu = this.action.fcurves[this.activeFCurveIdx]
      if (activeFcu) {
        for (const { fcu, originalIdx } of sorted) {
          if (fcu.rnaPath === activeFcu.rnaPath) this.visibleSet.add(originalIdx)
        }
      }
      this.frameAll()
    }
    this.visibleSet.add(this.activeFCurveIdx)

    let lastGroup: string | null = null
    for (const { fcu, originalIdx } of sorted) {
      const group = channelGroup(fcu.rnaPath)
      if (group !== lastGroup) {
        const collapsed = this.collapsedGroups.has(group)
        const memberCount = sorted.filter((s) => channelGroup(s.fcu.rnaPath) === group).length
        const header = document.createElement('div')
        header.className = 'ckp-graph-group'
        const arrow = document.createElement('span')
        arrow.className = 'ckp-graph-group-arrow'
        arrow.textContent = collapsed ? '▸' : '▾'
        header.appendChild(arrow)
        const label = document.createElement('span')
        label.textContent = group
        header.appendChild(label)
        const count = document.createElement('span')
        count.className = 'ckp-graph-group-count'
        count.textContent = `(${memberCount})`
        header.appendChild(count)
        header.addEventListener('click', () => {
          if (this.collapsedGroups.has(group)) this.collapsedGroups.delete(group)
          else this.collapsedGroups.add(group)
          this.refresh()
        })
        this.channelsEl.appendChild(header)
        lastGroup = group
      }
      if (this.collapsedGroups.has(group)) continue

      const row = document.createElement('div')
      row.className = 'ckp-graph-channel in-group'
      if (originalIdx === this.activeFCurveIdx) row.classList.add('active')
      if (fcu.muted) row.classList.add('is-muted')
      if (fcu.locked) row.classList.add('is-locked')

      const eye = document.createElement('span')
      const isVisible = this.visibleSet.has(originalIdx) || originalIdx === this.activeFCurveIdx
      eye.className = 'ckp-graph-channel-eye' + (isVisible ? ' visible' : '')
      eye.textContent = isVisible ? '●' : '○'
      eye.title = isVisible ? 'Hide channel' : 'Show channel'
      eye.addEventListener('click', (e) => {
        e.stopPropagation()
        if (originalIdx === this.activeFCurveIdx) return
        if (this.visibleSet.has(originalIdx)) this.visibleSet.delete(originalIdx)
        else this.visibleSet.add(originalIdx)
        this.refresh()
      })
      row.appendChild(eye)

      const mute = document.createElement('span')
      mute.className = 'ckp-graph-channel-mute' + (fcu.muted ? ' muted' : '')
      mute.textContent = fcu.muted ? 'M' : 'm'
      mute.title = fcu.muted ? 'Unmute (curve evaluates again)' : 'Mute (skip evaluation; output 0)'
      mute.addEventListener('click', (e) => {
        e.stopPropagation()
        fcu.muted = !fcu.muted
        this.onChanged()
        this.refresh()
      })
      row.appendChild(mute)

      const lock = document.createElement('span')
      lock.className = 'ckp-graph-channel-lock' + (fcu.locked ? ' locked' : '')
      lock.textContent = fcu.locked ? 'L' : 'l'
      lock.title = fcu.locked ? 'Unlock (allow edits)' : 'Lock (prevent drag/insert/delete)'
      lock.addEventListener('click', (e) => {
        e.stopPropagation()
        fcu.locked = !fcu.locked
        this.onChanged()
        this.refresh()
      })
      row.appendChild(lock)

      const swatch = document.createElement('div')
      swatch.className = 'ckp-graph-channel-swatch'
      swatch.style.background = colorForFCurve(fcu)
      const name = document.createElement('span')
      name.className = 'ckp-graph-channel-name'
      name.textContent = channelLabel(fcu.rnaPath, fcu.arrayIndex)
      const count = document.createElement('span')
      count.className = 'ckp-graph-channel-count'
      count.textContent = String(fcu.bezt.length)
      row.appendChild(swatch)
      row.appendChild(name)
      row.appendChild(count)
      row.addEventListener('click', () => {
        if (this.activeFCurveIdx === originalIdx) return
        this.activeFCurveIdx = originalIdx
        this.visibleSet.add(originalIdx)
        this.selected.clear()
        this.activeKey = null
        this.frameAll()
        this.refresh()
      })
      this.channelsEl.appendChild(row)
    }
  }

  private get cssWidth (): number { return this.canvas.clientWidth }
  private get cssHeight (): number { return this.canvas.clientHeight }

  private xToPx (frame: number): number {
    return (frame - this.view.xMin) / (this.view.xMax - this.view.xMin) * this.cssWidth
  }
  private yToPx (value: number): number {
    return this.cssHeight - (value - this.view.yMin) / (this.view.yMax - this.view.yMin) * this.cssHeight
  }
  private pxToFrame (x: number): number {
    return this.view.xMin + (x / this.cssWidth) * (this.view.xMax - this.view.xMin)
  }
  private pxToValue (y: number): number {
    return this.view.yMin + ((this.cssHeight - y) / this.cssHeight) * (this.view.yMax - this.view.yMin)
  }
  private dxFramesPerPx (): number {
    return (this.view.xMax - this.view.xMin) / this.cssWidth
  }
  private dyValuesPerPx (): number {
    return (this.view.yMax - this.view.yMin) / this.cssHeight
  }

  private requestRender (): void {
    if (this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      this.render()
    })
  }

  private onResize (): void {
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.floor(this.cssWidth * dpr))
    this.canvas.height = Math.max(1, Math.floor(this.cssHeight * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.requestRender()
  }

  // Pull external X view into local before every render so external
  // setters can mutate sharedX without calling our setViewX().
  private syncFromShared (): void {
    if (!this.sharedX) return
    this.view.xMin = this.sharedX.xMin
    this.view.xMax = this.sharedX.xMax
  }
  private syncToShared (): void {
    if (!this.sharedX) return
    this.sharedX.xMin = this.view.xMin
    this.sharedX.xMax = this.view.xMax
    this.onViewXChanged()
  }

  /** Called from outside (e.g. Timeline) to set the shared X view and redraw. */
  setViewX (xMin: number, xMax: number): void {
    if (this.sharedX) {
      this.sharedX.xMin = xMin
      this.sharedX.xMax = xMax
    }
    this.view.xMin = xMin
    this.view.xMax = xMax
    this.requestRender()
  }

  /** Full view rectangle (frame, value). Useful for persistence. */
  getView (): { xMin: number; xMax: number; yMin: number; yMax: number } {
    return { ...this.view }
  }

  /** Apply a previously-captured view. Skips fields not provided. */
  setView (v: Partial<{ xMin: number; xMax: number; yMin: number; yMax: number }>): void {
    if (v.xMin !== undefined) this.view.xMin = v.xMin
    if (v.xMax !== undefined) this.view.xMax = v.xMax
    if (v.yMin !== undefined) this.view.yMin = v.yMin
    if (v.yMax !== undefined) this.view.yMax = v.yMax
    if (this.sharedX) {
      this.sharedX.xMin = this.view.xMin
      this.sharedX.xMax = this.view.xMax
    }
    this.requestRender()
  }

  getActiveFCurveIdx (): number { return this.activeFCurveIdx }
  setActiveFCurveIdx (idx: number): void {
    if (idx === this.activeFCurveIdx) return
    this.activeFCurveIdx = idx
    this.refresh()
  }

  getCollapsedGroups (): string[] { return [...this.collapsedGroups] }
  setCollapsedGroups (groups: readonly string[]): void {
    this.collapsedGroups = new Set(groups)
    this.refresh()
  }

  private render (): void {
    if (this.canvas.width === 0) this.onResize()
    this.syncFromShared()
    const ctx = this.ctx
    ctx.fillStyle = THEME.bg
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight)

    this.drawGrid()
    this.drawOutOfRangeShading()
    this.drawColumnHighlight()

    // Non-active visible channels first, low opacity, behind active.
    // Drawn in the SAME Y space as the active channel so zoom scales
    // them uniformly (matches Blender's default non-normalize mode).
    for (const idx of this.visibleSet) {
      if (idx === this.activeFCurveIdx) continue
      const fcu = this.action.fcurves[idx]
      if (!fcu) continue
      this.drawCurve(fcu, 0.35)
    }

    const fcu = this.activeFCurve()
    if (fcu) {
      this.drawCurve(fcu, 1)
      this.drawExtrapolationGuides(fcu)
      this.drawHandles(fcu)
      this.drawKeyframes(fcu)
    }
    this.drawPlayhead()
    this.drawSelectionBox()
    if (this.mouseInCanvas && !this.dragging) this.drawHoverReadout()
  }

  private activeFCurve (): FCurve | null {
    return this.action.fcurves[this.activeFCurveIdx] ?? null
  }

  private drawGrid (): void {
    const ctx = this.ctx
    const fcu = this.activeFCurve()

    const targetStepPx = 90
    const xRange = this.view.xMax - this.view.xMin
    const xStep = niceStep((xRange * targetStepPx) / this.cssWidth)
    ctx.strokeStyle = THEME.gridMajor
    ctx.lineWidth = 1
    ctx.fillStyle = THEME.axisLabel
    ctx.font = '11px ui-monospace, monospace'
    ctx.textBaseline = 'top'
    const xStart = Math.ceil(this.view.xMin / xStep) * xStep
    for (let x = xStart; x <= this.view.xMax; x += xStep) {
      const px = Math.floor(this.xToPx(x)) + 0.5
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.cssHeight); ctx.stroke()
      const label = xStep >= 1 ? `${Math.round(x)}` : x.toFixed(1)
      ctx.fillText(label, px + 3, 2)
    }

    const yRange = this.view.yMax - this.view.yMin
    const yStep = niceStep((yRange * targetStepPx) / this.cssHeight)
    const yStart = Math.ceil(this.view.yMin / yStep) * yStep
    ctx.textBaseline = 'middle'
    for (let y = yStart; y <= this.view.yMax; y += yStep) {
      const py = Math.floor(this.yToPx(y)) + 0.5
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(this.cssWidth, py); ctx.stroke()
      const label = fcu ? formatValue(fcu.rnaPath, isAngleRnaPath(fcu.rnaPath) ? y : y) : y.toFixed(2)
      ctx.fillText(label, 4, py - 1)
    }
  }

  private drawOutOfRangeShading (): void {
    if (!this.getFrameRange) return
    const range = this.getFrameRange()
    if (!range) return
    const [start, end] = range
    const ctx = this.ctx
    ctx.fillStyle = THEME.outOfRange
    if (start > this.view.xMin) {
      const xL = 0
      const xR = Math.min(this.cssWidth, this.xToPx(start))
      if (xR > xL) ctx.fillRect(xL, 0, xR - xL, this.cssHeight)
    }
    if (end < this.view.xMax) {
      const xL = Math.max(0, this.xToPx(end))
      const xR = this.cssWidth
      if (xR > xL) ctx.fillRect(xL, 0, xR - xL, this.cssHeight)
    }
    ctx.strokeStyle = THEME.rangeBound
    ctx.lineWidth = 1
    ctx.beginPath()
    if (start >= this.view.xMin && start <= this.view.xMax) {
      const px = Math.floor(this.xToPx(start)) + 0.5
      ctx.moveTo(px, 0); ctx.lineTo(px, this.cssHeight)
    }
    if (end >= this.view.xMin && end <= this.view.xMax) {
      const px = Math.floor(this.xToPx(end)) + 0.5
      ctx.moveTo(px, 0); ctx.lineTo(px, this.cssHeight)
    }
    ctx.stroke()
  }

  private drawPlayhead (): void {
    const frame = this.getCurrentFrame()
    if (frame < this.view.xMin || frame > this.view.xMax) return
    const ctx = this.ctx
    const px = Math.floor(this.xToPx(frame)) + 0.5
    ctx.strokeStyle = THEME.playhead
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, this.cssHeight); ctx.stroke()
  }

  // Per-segment dispatch, mirroring Blender's draw_fcurve_curve_keys
  // (graph_draw.cc:1008): each segment uses the representation
  // appropriate to its ipo. Single ctx.stroke() at the end.
  private drawCurve (fcu: FCurve, alpha: number = 1): void {
    if (fcu.bezt.length === 0) return
    const ctx = this.ctx
    ctx.strokeStyle = colorForFCurve(fcu)
    ctx.lineWidth = alpha < 1 ? 1.5 : 2
    ctx.globalAlpha = alpha

    ctx.beginPath()
    let pen = false
    const moveOrLine = (x: number, y: number) => {
      if (!pen) { ctx.moveTo(x, y); pen = true }
      else { ctx.lineTo(x, y) }
    }

    let firstIdx = 0
    let lastIdx = fcu.bezt.length - 1
    for (let i = 0; i < fcu.bezt.length; i++) {
      if (fcu.bezt[i].vec[1][0] >= this.view.xMin) {
        firstIdx = Math.max(0, i - 1)
        break
      }
    }
    for (let i = fcu.bezt.length - 1; i >= 0; i--) {
      if (fcu.bezt[i].vec[1][0] <= this.view.xMax) {
        lastIdx = Math.min(fcu.bezt.length - 1, i + 1)
        break
      }
    }

    if (this.view.xMin < fcu.bezt[firstIdx].vec[1][0]) {
      moveOrLine(this.xToPx(this.view.xMin), this.yToPx(evaluateFCurve(fcu, this.view.xMin)))
    }

    const start = fcu.bezt[firstIdx]
    moveOrLine(this.xToPx(start.vec[1][0]), this.yToPx(start.vec[1][1]))

    for (let i = firstIdx; i < lastIdx; i++) {
      const prev = fcu.bezt[i]
      const next = fcu.bezt[i + 1]

      switch (prev.ipo) {
        case Interpolation.CONSTANT: {
          moveOrLine(this.xToPx(next.vec[1][0]), this.yToPx(prev.vec[1][1]))
          moveOrLine(this.xToPx(next.vec[1][0]), this.yToPx(next.vec[1][1]))
          break
        }
        case Interpolation.LINEAR: {
          moveOrLine(this.xToPx(next.vec[1][0]), this.yToPx(next.vec[1][1]))
          break
        }
        case Interpolation.BEZIER: {
          const ax = this.xToPx(prev.vec[1][0])
          const bx = this.xToPx(next.vec[1][0])
          const segPx = Math.max(2, Math.min(64, Math.ceil(bx - ax)))
          const x0 = prev.vec[1][0]
          const dx = next.vec[1][0] - x0
          for (let j = 1; j <= segPx; j++) {
            const t = j / segPx
            const frame = x0 + dx * t
            const value = evalBezierSegment(prev, next, frame)
            moveOrLine(this.xToPx(frame), this.yToPx(value))
          }
          break
        }
        default: {
          // Easings (BACK / BOUNCE / CUBIC / etc.) — sample via evaluateFCurve.
          const ax = this.xToPx(prev.vec[1][0])
          const bx = this.xToPx(next.vec[1][0])
          const segPx = Math.max(2, Math.min(120, Math.ceil(bx - ax)))
          const x0 = prev.vec[1][0]
          const dx = next.vec[1][0] - x0
          for (let j = 1; j <= segPx; j++) {
            const t = j / segPx
            const frame = x0 + dx * t
            moveOrLine(this.xToPx(frame), this.yToPx(evaluateFCurve(fcu, frame)))
          }
          break
        }
      }
    }

    const last = fcu.bezt[fcu.bezt.length - 1]
    if (this.view.xMax > last.vec[1][0]) {
      moveOrLine(this.xToPx(this.view.xMax), this.yToPx(evaluateFCurve(fcu, this.view.xMax)))
    }

    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private drawHoverReadout (): void {
    const [mx, my] = this.lastMouse
    if (mx < 0 || mx > this.cssWidth || my < 0 || my > this.cssHeight) return
    const ctx = this.ctx

    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(mx + 0.5, 0); ctx.lineTo(mx + 0.5, this.cssHeight)
    ctx.moveTo(0, my + 0.5); ctx.lineTo(this.cssWidth, my + 0.5)
    ctx.stroke()
    ctx.setLineDash([])

    const frame = this.pxToFrame(mx)
    const fcu = this.activeFCurve()
    const seconds = (frame / this.action.fps).toFixed(2)
    let text: string
    if (fcu) {
      const curveValue = evaluateFCurve(fcu, frame)
      text = `f ${frame.toFixed(1)}  t ${seconds}s  ${channelLabel(fcu.rnaPath, fcu.arrayIndex)}: ${formatValue(fcu.rnaPath, curveValue)}`
    } else {
      text = `f ${frame.toFixed(1)}  t ${seconds}s`
    }
    ctx.font = '11px ui-monospace, monospace'
    const textW = ctx.measureText(text).width
    const padX = 8, h = 18
    const boxX = this.cssWidth - textW - padX * 2 - 6
    const boxY = 6
    ctx.fillStyle = 'rgba(20,20,24,0.85)'
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(boxX, boxY, textW + padX * 2, h)
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, textW + padX * 2, h)
    ctx.fillStyle = '#ddd'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, boxX + padX, boxY + h / 2)
  }

  private drawExtrapolationGuides (fcu: FCurve): void {
    if (fcu.bezt.length === 0) return
    const ctx = this.ctx
    const color = colorForFCurve(fcu)
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    const first = fcu.bezt[0]
    const last = fcu.bezt[fcu.bezt.length - 1]
    if (this.view.xMin < first.vec[1][0]) {
      ctx.moveTo(this.xToPx(this.view.xMin), this.yToPx(evaluateFCurve(fcu, this.view.xMin)))
      ctx.lineTo(this.xToPx(first.vec[1][0]), this.yToPx(first.vec[1][1]))
    }
    if (this.view.xMax > last.vec[1][0]) {
      ctx.moveTo(this.xToPx(last.vec[1][0]), this.yToPx(last.vec[1][1]))
      ctx.lineTo(this.xToPx(this.view.xMax), this.yToPx(evaluateFCurve(fcu, this.view.xMax)))
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  private drawHandles (fcu: FCurve): void {
    if (fcu.bezt.length === 0) return
    const ctx = this.ctx
    ctx.lineWidth = 1
    ctx.strokeStyle = THEME.handleLine
    for (let i = 0; i < fcu.bezt.length; i++) {
      const b = fcu.bezt[i]
      if (b.vec[2][0] < this.view.xMin) continue
      if (b.vec[0][0] > this.view.xMax) break
      // h1 belongs to the segment ENDING here (uses prev's ipo); h2 to
      // the segment starting here.
      const showH1 = (i > 0 && fcu.bezt[i - 1].ipo === Interpolation.BEZIER)
      const showH2 = b.ipo === Interpolation.BEZIER

      const ax = this.xToPx(b.vec[1][0])
      const ay = this.yToPx(b.vec[1][1])
      ctx.beginPath()
      if (showH1) {
        const x = this.xToPx(b.vec[0][0]); const y = this.yToPx(b.vec[0][1])
        ctx.moveTo(ax, ay); ctx.lineTo(x, y)
      }
      if (showH2) {
        const x = this.xToPx(b.vec[2][0]); const y = this.yToPx(b.vec[2][1])
        ctx.moveTo(ax, ay); ctx.lineTo(x, y)
      }
      ctx.stroke()

      if (showH1) {
        const x = this.xToPx(b.vec[0][0]); const y = this.yToPx(b.vec[0][1])
        ctx.fillStyle = this.selected.has(`${i}:h1`) ? THEME.vertSel : THEME.handleColors[b.h1]
        ctx.beginPath(); ctx.arc(x, y, HANDLE_DOT_SIZE, 0, Math.PI * 2); ctx.fill()
      }
      if (showH2) {
        const x = this.xToPx(b.vec[2][0]); const y = this.yToPx(b.vec[2][1])
        ctx.fillStyle = this.selected.has(`${i}:h2`) ? THEME.vertSel : THEME.handleColors[b.h2]
        ctx.beginPath(); ctx.arc(x, y, HANDLE_DOT_SIZE, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  private drawKeyframes (fcu: FCurve): void {
    const ctx = this.ctx
    for (let i = 0; i < fcu.bezt.length; i++) {
      const b = fcu.bezt[i]
      if (b.vec[1][0] < this.view.xMin || b.vec[1][0] > this.view.xMax) continue
      const px = this.xToPx(b.vec[1][0])
      const py = this.yToPx(b.vec[1][1])
      const key = `${i}:anchor`
      const sel = this.selected.has(key)
      const active = this.activeKey === key
      const size = active ? VERT_SIZE + 2 : VERT_SIZE
      ctx.fillStyle = active ? THEME.vertActive : (sel ? THEME.vertSel : THEME.vertFill)
      ctx.strokeStyle = '#000'
      ctx.lineWidth = active ? 1.5 : 1
      ctx.beginPath()
      ctx.moveTo(px, py - size)
      ctx.lineTo(px + size, py)
      ctx.lineTo(px, py + size)
      ctx.lineTo(px - size, py)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  private drawSelectionBox (): void {
    if (!this.dragging || this.dragging.kind !== 'box') return
    const ctx = this.ctx
    const x0 = this.dragging.startX
    const y0 = this.dragging.startY
    const [x1, y1] = this.lastMouse
    const x = Math.min(x0, x1)
    const y = Math.min(y0, y1)
    const w = Math.abs(x1 - x0)
    const h = Math.abs(y1 - y0)
    ctx.fillStyle = THEME.selBox
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = THEME.selBoxLine
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w, h)
  }

  private lastMouse: [number, number] = [0, 0]

  private hitTest (mx: number, my: number): HitResult | null {
    const fcu = this.activeFCurve()
    if (!fcu) return null
    let best: HitResult | null = null
    for (let i = 0; i < fcu.bezt.length; i++) {
      const b = fcu.bezt[i]
      const ax = this.xToPx(b.vec[1][0])
      const ay = this.yToPx(b.vec[1][1])
      const da = Math.hypot(mx - ax, my - ay)
      if (da <= HIT_RADIUS && (!best || da < best.distancePx)) {
        best = { keyIdx: i, part: 'anchor', distancePx: da }
      }
      const showH1 = (i > 0 && fcu.bezt[i - 1].ipo === Interpolation.BEZIER)
      if (showH1) {
        const hx = this.xToPx(b.vec[0][0])
        const hy = this.yToPx(b.vec[0][1])
        const d = Math.hypot(mx - hx, my - hy)
        if (d <= HIT_RADIUS && (!best || d < best.distancePx)) {
          best = { keyIdx: i, part: 'h1', distancePx: d }
        }
      }
      if (b.ipo === Interpolation.BEZIER) {
        const hx = this.xToPx(b.vec[2][0])
        const hy = this.yToPx(b.vec[2][1])
        const d = Math.hypot(mx - hx, my - hy)
        if (d <= HIT_RADIUS && (!best || d < best.distancePx)) {
          best = { keyIdx: i, part: 'h2', distancePx: d }
        }
      }
    }
    return best
  }

  private boundOnMouseDown = (e: MouseEvent) => this.onMouseDown(e)
  private boundOnMouseMove = (e: MouseEvent) => this.onMouseMove(e)
  private boundOnMouseUp = (e: MouseEvent) => this.onMouseUp(e)
  private boundOnWheel = (e: WheelEvent) => this.onWheel(e)
  private boundOnKeyDown = (e: KeyboardEvent) => this.onKeyDown(e)
  private boundOnDblClick = (e: MouseEvent) => this.onDblClick(e)
  private boundOnContextMenu = (e: MouseEvent) => this.onContextMenu(e)
  private boundOnMouseEnter = () => { this.mouseInCanvas = true; this.requestRender() }
  private boundOnMouseLeave = () => { this.mouseInCanvas = false; this.requestRender() }

  private attachEvents (): void {
    this.canvas.addEventListener('mousedown', this.boundOnMouseDown)
    window.addEventListener('mousemove', this.boundOnMouseMove)
    window.addEventListener('mouseup', this.boundOnMouseUp)
    this.canvas.addEventListener('wheel', this.boundOnWheel, { passive: false })
    this.wrapEl.addEventListener('keydown', this.boundOnKeyDown)
    this.canvas.addEventListener('dblclick', this.boundOnDblClick)
    this.canvas.addEventListener('contextmenu', this.boundOnContextMenu)
    this.canvas.addEventListener('mouseenter', this.boundOnMouseEnter)
    this.canvas.addEventListener('mouseleave', this.boundOnMouseLeave)
  }

  private detachEvents (): void {
    this.canvas.removeEventListener('mousedown', this.boundOnMouseDown)
    window.removeEventListener('mousemove', this.boundOnMouseMove)
    window.removeEventListener('mouseup', this.boundOnMouseUp)
    this.canvas.removeEventListener('wheel', this.boundOnWheel)
    this.wrapEl.removeEventListener('keydown', this.boundOnKeyDown)
    this.canvas.removeEventListener('dblclick', this.boundOnDblClick)
    this.canvas.removeEventListener('contextmenu', this.boundOnContextMenu)
    this.canvas.removeEventListener('mouseenter', this.boundOnMouseEnter)
    this.canvas.removeEventListener('mouseleave', this.boundOnMouseLeave)
  }

  private localCoord (e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  private onMouseDown (e: MouseEvent): void {
    this.wrapEl.focus()
    const [mx, my] = this.localCoord(e)
    this.lastMouse = [mx, my]
    this.columnFrames = []

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.dragging = { kind: 'pan', startX: mx, startY: my }
      e.preventDefault()
      return
    }

    if (e.button !== 0) return

    const hit = this.hitTest(mx, my)
    if (hit) {
      const key = `${hit.keyIdx}:${hit.part}`
      if (e.shiftKey) {
        if (this.selected.has(key)) {
          this.selected.delete(key)
          if (this.activeKey === key) this.activeKey = null
        } else {
          this.selected.add(key)
          this.activeKey = key
        }
      } else {
        if (!this.selected.has(key)) {
          this.selected.clear()
          this.selected.add(key)
        }
        this.activeKey = key
      }
      this.beginTranslate(mx, my)
      this.requestRender()
    } else {
      if (!e.shiftKey) {
        this.selected.clear()
        this.activeKey = null
      }
      this.dragging = { kind: 'box', startX: mx, startY: my }
      this.requestRender()
    }
  }

  private beginTranslate (mx: number, my: number): void {
    const fcu = this.activeFCurve()
    if (!fcu) return
    if (fcu.locked) return  // FCURVE_PROTECTED — refuse drag

    // Promote AUTO/AUTO_CLAMPED handles to ALIGN at drag-start so user-
    // set positions survive the next handle recalc. Mirrors Blender's
    // graphedit_activekey_handles_cb (graph_buttons.cc:286). h1/h2 are
    // promoted together (coupled pair under auto modes).
    const isAuto = (h: HandleType) => h === HandleType.AUTO || h === HandleType.AUTO_CLAMPED
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':') as [string, HitPart]
      if (part === 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      if (isAuto(b.h1) || isAuto(b.h2)) {
        b.h1 = HandleType.ALIGN
        b.h2 = HandleType.ALIGN
      }
    }

    const snapshot = new Map<string, [number, number]>()
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':') as [string, HitPart]
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      const slot = part === 'anchor' ? 1 : (part === 'h1' ? 0 : 2)
      snapshot.set(key, [b.vec[slot][0], b.vec[slot][1]])
    }
    this.dragging = { kind: 'translate', startX: mx, startY: my, initialPositions: snapshot }
  }

  private onMouseMove (e: MouseEvent): void {
    const [mx, my] = this.localCoord(e)
    const prev = this.lastMouse
    this.lastMouse = [mx, my]
    if (!this.dragging) {
      // requestRender uses rAF batching → caps at 60fps regardless of
      // mouse-move event rate.
      if (this.mouseInCanvas) this.requestRender()
      return
    }

    if (this.dragging.kind === 'pan') {
      const dx = (mx - prev[0]) * this.dxFramesPerPx()
      const dy = (my - prev[1]) * this.dyValuesPerPx()
      this.view.xMin -= dx
      this.view.xMax -= dx
      this.view.yMin += dy
      this.view.yMax += dy
      this.syncToShared()
      this.requestRender()
      return
    }

    if (this.dragging.kind === 'translate') {
      const fcu = this.activeFCurve()
      if (!fcu || !this.dragging.initialPositions) return
      const dxFrames = (mx - this.dragging.startX) * this.dxFramesPerPx()
      const dyValues = -(my - this.dragging.startY) * this.dyValuesPerPx()
      const dxApplied = e.ctrlKey ? Math.round(dxFrames) : dxFrames
      this.applyTranslateDelta(fcu, dxApplied, dyValues)
      this.requestRender()
    } else if (this.dragging.kind === 'box') {
      this.requestRender()
    }
  }

  private applyTranslateDelta (fcu: FCurve, dxFrames: number, dyValues: number): void {
    if (!this.dragging || this.dragging.kind !== 'translate' || !this.dragging.initialPositions) return
    let movedAnchor = false
    for (const [key, [t0, v0]] of this.dragging.initialPositions) {
      const [idxStr, part] = key.split(':') as [string, HitPart]
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      const newT = t0 + dxFrames
      const newV = v0 + dyValues
      if (part === 'anchor') {
        const dt = newT - b.vec[1][0]
        const dv = newV - b.vec[1][1]
        if (dt !== 0) moveKeyframeTimeWithHandles(b, b.vec[1][0] + dt)
        if (dv !== 0) moveKeyframeValueWithHandles(b, b.vec[1][1] + dv)
        movedAnchor = true
      } else {
        const slot = part === 'h1' ? 0 : 2
        b.vec[slot][0] = newT
        b.vec[slot][1] = newV
      }
    }

    // If any anchor crossed its neighbor, sort + recalc. Selection and
    // initialPositions are index-keyed → remap via BezTriple references
    // so drag continues seamlessly instead of dropping out.
    if (movedAnchor) {
      let needsSort = false
      for (let i = 1; i < fcu.bezt.length; i++) {
        if (fcu.bezt[i - 1].vec[1][0] > fcu.bezt[i].vec[1][0]) { needsSort = true; break }
      }
      if (needsSort) this.remapAfterSort(fcu)
    }
    this.onChanged()
  }

  // Sort fcurve back into time order and translate drag/selection state
  // from the old index space to the new one via BezTriple identity
  // (preserved across the sort).
  private remapAfterSort (fcu: FCurve): void {
    const oldRefs = new Map<string, { bezt: typeof fcu.bezt[number]; part: HitPart; t0?: number; v0?: number }>()
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':') as [string, HitPart]
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (b) oldRefs.set(key, { bezt: b, part })
    }
    if (this.dragging?.kind === 'translate' && this.dragging.initialPositions) {
      for (const [key, [t0, v0]] of this.dragging.initialPositions) {
        const [idxStr, part] = key.split(':') as [string, HitPart]
        const i = parseInt(idxStr)
        const b = fcu.bezt[i]
        if (b) oldRefs.set(key, { bezt: b, part, t0, v0 })
      }
    }

    sortFCurve(fcu)
    recalcAllHandles(fcu)

    const beztToNewIdx = new Map<typeof fcu.bezt[number], number>()
    for (let i = 0; i < fcu.bezt.length; i++) beztToNewIdx.set(fcu.bezt[i], i)

    this.selected.clear()
    for (const { bezt, part } of oldRefs.values()) {
      const newIdx = beztToNewIdx.get(bezt)
      if (newIdx !== undefined) this.selected.add(`${newIdx}:${part}`)
    }
    // Reuse the SAME snapshot t0/v0 — drag delta is relative to
    // drag-start, not current.
    if (this.dragging?.kind === 'translate' && this.dragging.initialPositions) {
      const fresh = new Map<string, [number, number]>()
      for (const { bezt, part, t0, v0 } of oldRefs.values()) {
        if (t0 === undefined || v0 === undefined) continue
        const newIdx = beztToNewIdx.get(bezt)
        if (newIdx !== undefined) fresh.set(`${newIdx}:${part}`, [t0, v0])
      }
      this.dragging.initialPositions = fresh
    }
  }

  private onMouseUp (e: MouseEvent): void {
    if (!this.dragging) return
    if (this.dragging.kind === 'pan') {
      this.dragging = null
      return
    }
    const wasTranslate = this.dragging.kind === 'translate'
    if (this.dragging.kind === 'box') {
      this.commitBoxSelection(e.shiftKey)
    }
    this.dragging = null
    this.requestRender()
    // One undo step per drag commit, not per pointermove. Box-select doesn't
    // mutate data and isn't part of undo (Blender's choice; we agree).
    if (wasTranslate) this.onCommit('move keyframe')
  }

  private commitBoxSelection (additive: boolean): void {
    if (!this.dragging || this.dragging.kind !== 'box') return
    const fcu = this.activeFCurve()
    if (!fcu) return
    const x0 = Math.min(this.dragging.startX, this.lastMouse[0])
    const y0 = Math.min(this.dragging.startY, this.lastMouse[1])
    const x1 = Math.max(this.dragging.startX, this.lastMouse[0])
    const y1 = Math.max(this.dragging.startY, this.lastMouse[1])
    if (Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3) return
    if (!additive) this.selected.clear()
    for (let i = 0; i < fcu.bezt.length; i++) {
      const b = fcu.bezt[i]
      const px = this.xToPx(b.vec[1][0])
      const py = this.yToPx(b.vec[1][1])
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
        this.selected.add(`${i}:anchor`)
      }
    }
  }

  private onWheel (e: WheelEvent): void {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1
    const [mx, my] = this.localCoord(e)
    const cx = this.pxToFrame(mx)
    const cy = this.pxToValue(my)
    if (!e.shiftKey) {
      this.view.xMin = cx - (cx - this.view.xMin) * factor
      this.view.xMax = cx + (this.view.xMax - cx) * factor
      this.syncToShared()
    }
    if (!e.ctrlKey) {
      this.view.yMin = cy - (cy - this.view.yMin) * factor
      this.view.yMax = cy + (this.view.yMax - cy) * factor
    }
    this.requestRender()
  }

  private onKeyDown (e: KeyboardEvent): void {
    if (e.key === 'a' || e.key === 'A') {
      const fcu = this.activeFCurve()
      if (!fcu) return
      if (this.selected.size > 0) {
        this.selected.clear()
        this.activeKey = null
      } else {
        for (let i = 0; i < fcu.bezt.length; i++) this.selected.add(`${i}:anchor`)
      }
      this.requestRender()
      e.preventDefault()
    } else if (e.key === 'f' || e.key === 'F') {
      if (e.shiftKey) this.frameSelected()
      else this.frameAll()
      this.requestRender()
      e.preventDefault()
    } else if (e.key === 'Delete' || e.key === 'x' || e.key === 'X') {
      this.deleteSelectedAnchors()
      e.preventDefault()
    } else if (e.key === 'v' || e.key === 'V') {
      this.cycleHandleType()
      e.preventDefault()
    } else if (e.key === 't' || e.key === 'T') {
      this.cycleInterpolation()
      e.preventDefault()
    } else if ((e.key === 'k' || e.key === 'K') && e.shiftKey) {
      this.markColumn()
      e.preventDefault()
    }
  }

  private drawColumnHighlight (): void {
    if (this.columnFrames.length === 0) return
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(255, 224, 96, 0.10)'  // gold tint
    for (const f of this.columnFrames) {
      const x = this.xToPx(f)
      ctx.fillRect(x - 1.5, 0, 3, this.cssHeight)
    }
  }

  /** Shift+K: collect frames of currently-selected anchors and render keys
   * at those frames in OTHER visible channels with a column highlight.
   * (graph.select_column in Blender — we draw the tint but don't yet support
   * multi-fcurve drag, so the highlight is informational, not a selection.) */
  private markColumn (): void {
    const fcu = this.activeFCurve()
    if (!fcu) return
    const frames = new Set<number>()
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (b) frames.add(b.vec[1][0])
    }
    this.columnFrames = [...frames]
    this.requestRender()
  }

  private onContextMenu (e: MouseEvent): void {
    e.preventDefault()
    const [mx, my] = this.localCoord(e)
    const hit = this.hitTest(mx, my)
    if (hit) {
      const k = `${hit.keyIdx}:${hit.part}`
      if (!this.selected.has(k)) {
        this.selected.clear()
        this.selected.add(k)
        this.activeKey = k
        this.requestRender()
      }
    }
    if (this.selected.size === 0) {
      showSimpleMenu(e.clientX, e.clientY, [
        { label: 'Frame all (F)', action: () => { this.frameAll(); this.requestRender() } },
        { label: 'Select all (A)', action: () => {
          const fcu = this.activeFCurve()
          if (!fcu) return
          for (let i = 0; i < fcu.bezt.length; i++) this.selected.add(`${i}:anchor`)
          this.requestRender()
        }},
      ])
      return
    }

    // Common ipo / handle across the selection — used to mark the active
    // option in submenus. Returns null on a mixed selection so no item is
    // checked (matches Blender's "—" indicator on mixed properties).
    const commonIpo = this.commonIpoOfSelection()
    const commonHandle = this.commonHandleOfSelection()
    const ipoItem = (label: string, ipo: Interpolation): MenuItem => ({
      label, checked: commonIpo === ipo, action: () => this.setSelectedIpo(ipo),
    })
    const handleItem = (label: string, h: HandleType): MenuItem => ({
      label, checked: commonHandle === h, action: () => this.setSelectedHandle(h),
    })

    const items: MenuItem[] = [
      { label: 'Interpolation' },
      ipoItem('Constant',  Interpolation.CONSTANT),
      ipoItem('Linear',    Interpolation.LINEAR),
      ipoItem('Bezier',    Interpolation.BEZIER),
      ipoItem('Sine',      Interpolation.SINE),
      ipoItem('Cubic',     Interpolation.CUBIC),
      ipoItem('Back',      Interpolation.BACK),
      ipoItem('Bounce',    Interpolation.BOUNCE),
      ipoItem('Elastic',   Interpolation.ELASTIC),
      { separator: true },
      { label: 'Handle Type' },
      handleItem('Auto Clamped', HandleType.AUTO_CLAMPED),
      handleItem('Auto',         HandleType.AUTO),
      handleItem('Vector',       HandleType.VECTOR),
      handleItem('Align',        HandleType.ALIGN),
      handleItem('Free',         HandleType.FREE),
      { separator: true },
      { label: 'Snap selection to current frame', action: () => this.snapSelectedToCurrentFrame() },
      { label: 'Frame selected (Shift+F)', action: () => { this.frameSelected(); this.requestRender() } },
      { separator: true },
      { label: 'Delete (X)', action: () => this.deleteSelectedAnchors() },
    ]
    showSimpleMenu(e.clientX, e.clientY, items)
  }

  private commonIpoOfSelection (): Interpolation | null {
    const fcu = this.activeFCurve()
    if (!fcu) return null
    let common: Interpolation | null = null
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const b = fcu.bezt[parseInt(idxStr)]
      if (!b) continue
      if (common === null) common = b.ipo
      else if (common !== b.ipo) return null  // mixed
    }
    return common
  }

  private commonHandleOfSelection (): HandleType | null {
    const fcu = this.activeFCurve()
    if (!fcu) return null
    let common: HandleType | null = null
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const b = fcu.bezt[parseInt(idxStr)]
      if (!b) continue
      if (b.h1 !== b.h2) return null  // asymmetric
      if (common === null) common = b.h1
      else if (common !== b.h1) return null  // mixed
    }
    return common
  }

  private setSelectedIpo (ipo: Interpolation): void {
    const fcu = this.activeFCurve()
    if (!fcu) return
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (b) b.ipo = ipo
    }
    this.onChanged()
    this.requestRender()
    this.onCommit('set interpolation')
  }

  private setSelectedHandle (h: HandleType): void {
    const fcu = this.activeFCurve()
    if (!fcu) return
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (b) { b.h1 = h; b.h2 = h }
    }
    recalcAllHandles(fcu)
    this.onChanged()
    this.requestRender()
    this.onCommit('set handle type')
  }

  private snapSelectedToCurrentFrame (): void {
    const fcu = this.activeFCurve()
    if (!fcu) return
    const target = Math.round(this.getCurrentFrame())
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      const dt = target - b.vec[1][0]
      b.vec[0][0] += dt
      b.vec[1][0] = target
      b.vec[2][0] += dt
    }
    if (this.selected.size > 0) {
      const refs = new Set<typeof fcu.bezt[number]>()
      for (const key of this.selected) {
        const [idxStr] = key.split(':')
        const b = fcu.bezt[parseInt(idxStr)]
        if (b) refs.add(b)
      }
      this.selected.clear()
      this.activeKey = null
      fcu.bezt.sort((a, b) => a.vec[1][0] - b.vec[1][0])
      recalcAllHandles(fcu)
      for (let i = 0; i < fcu.bezt.length; i++) {
        if (refs.has(fcu.bezt[i])) this.selected.add(`${i}:anchor`)
      }
    }
    this.onChanged()
    this.requestRender()
    this.onCommit('snap to frame')
  }

  private onDblClick (e: MouseEvent): void {
    if (!this.setCurrentFrame) return
    const [mx] = this.localCoord(e)
    const frame = this.pxToFrame(mx)
    this.setCurrentFrame(Math.round(frame))
    this.requestRender()
  }

  private deleteSelectedAnchors (): void {
    const fcu = this.activeFCurve()
    if (!fcu || fcu.locked) return
    const idxs: number[] = []
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      idxs.push(parseInt(idxStr))
    }
    idxs.sort((a, b) => b - a)  // desc, so splices don't reindex
    for (const i of idxs) deleteKeyframe(fcu, i)
    this.selected.clear()
    this.activeKey = null
    this.onChanged()
    this.requestRender()
    if (idxs.length > 0) this.onCommit('delete keys')
  }

  private cycleHandleType (): void {
    const fcu = this.activeFCurve()
    if (!fcu || fcu.locked) return
    const order = [HandleType.AUTO_CLAMPED, HandleType.AUTO, HandleType.VECTOR, HandleType.ALIGN, HandleType.FREE]
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      const ci = order.indexOf(b.h1)
      const next = order[(ci + 1) % order.length]
      b.h1 = next
      b.h2 = next
    }
    recalcAllHandles(fcu)
    this.onChanged()
    this.requestRender()
    this.onCommit('cycle handle type')
  }

  private cycleInterpolation (): void {
    const fcu = this.activeFCurve()
    if (!fcu || fcu.locked) return
    const order: Interpolation[] = [
      Interpolation.BEZIER, Interpolation.LINEAR, Interpolation.CONSTANT,
      Interpolation.SINE, Interpolation.QUAD, Interpolation.CUBIC, Interpolation.BACK, Interpolation.BOUNCE, Interpolation.ELASTIC,
    ]
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':')
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      const ci = order.indexOf(b.ipo)
      b.ipo = order[(ci + 1) % order.length]
      if (b.easing === undefined) b.easing = Easing.AUTO
    }
    this.onChanged()
    this.requestRender()
    this.onCommit('cycle interpolation')
  }

  private frameSelected (): void {
    const fcu = this.activeFCurve()
    if (!fcu || this.selected.size === 0) { this.frameAll(); return }
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const key of this.selected) {
      const [idxStr, part] = key.split(':') as [string, HitPart]
      if (part !== 'anchor') continue
      const i = parseInt(idxStr)
      const b = fcu.bezt[i]
      if (!b) continue
      xMin = Math.min(xMin, b.vec[1][0])
      xMax = Math.max(xMax, b.vec[1][0])
      yMin = Math.min(yMin, b.vec[1][1])
      yMax = Math.max(yMax, b.vec[1][1])
    }
    if (!Number.isFinite(xMin)) { this.frameAll(); return }
    this.applyFitBounds(xMin, xMax, yMin, yMax)
  }

  private frameAll (): void {
    const fcu = this.activeFCurve()
    if (!fcu || fcu.bezt.length === 0) {
      // Don't override X (likely already initialized to action's working
      // range via sharedX); just reset Y to a neutral [-1, 1] strip.
      this.view.yMin = -1
      this.view.yMax = 1
      this.requestRender()
      return
    }
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const b of fcu.bezt) {
      xMin = Math.min(xMin, b.vec[1][0])
      xMax = Math.max(xMax, b.vec[1][0])
      yMin = Math.min(yMin, b.vec[1][1])
      yMax = Math.max(yMax, b.vec[1][1])
    }
    this.applyFitBounds(xMin, xMax, yMin, yMax)
  }

  // Guard against degenerate X range (single keyframe → would crush X
  // view to ±1px). Keep existing X, only fit Y in that case — otherwise
  // capturing the first keyframe zoom-bombs the timeline to 0.1-frame
  // ticks that can't be dragged usefully.
  private applyFitBounds (xMin: number, xMax: number, yMin: number, yMax: number): void {
    const xRange = xMax - xMin
    const yRange = (yMax - yMin) || 1
    const yPad = yRange * Y_PAD_FRAC
    this.view.yMin = yMin - yPad
    this.view.yMax = yMax + yPad
    if (xRange >= 1) {
      const xPad = xRange * X_PAD_FRAC
      this.view.xMin = xMin - xPad
      this.view.xMax = xMax + xPad
    }
    this.syncToShared()
  }
}


