// Blender-style timeline strip — frame ruler, aggregated keyframe
// diamonds, draggable playhead. Optionally shares X view with a
// GraphEditor.

import { CameraAction, FCurve } from '../data/types'
import { moveKeyframeTimeWithHandles } from '../editing/move'
import { sortFCurve } from '../editing/sort'
import { recalcAllHandles } from '../editing/handles'
import type { SharedXView } from './GraphEditor'

export interface TimelineOptions {
  container: HTMLElement
  action: CameraAction
  getCurrentFrame: () => number
  setCurrentFrame: (frame: number) => void
  onChanged?: () => void
  viewX?: SharedXView
  onViewXChanged?: () => void
  /** Areas outside [start, end] get shaded — mirrors Blender's
   * ANIM_draw_framerange. */
  getFrameRange?: () => [number, number] | null
}

const THEME = {
  bg:         '#1a1a1f',
  rulerBg:    '#26262c',
  gridMajor:  '#3a3a44',
  gridMinor:  '#2a2a32',
  axisLabel:  '#aaa',
  playhead:   '#4a90ff',
  playheadText: '#ffffff',
  keyDiamond: '#dddddd',
  keyDiamondHover: '#ffe060',
  border:     '#333',
  outOfRange: 'rgba(0,0,0,0.45)',
  marker:     '#3dd17e',
  markerSel:  '#7df0a6',
}

const RULER_HEIGHT = 18
const KEY_RADIUS = 4
const KEY_HIT = 7

const STYLE_ID = 'ckp-timeline-style'
const STYLE = `
.ckp-timeline { width: 100%; height: 100%; position: relative; outline: none; user-select: none; }
.ckp-timeline canvas { display: block; width: 100%; height: 100%; cursor: default; }
.ckp-timeline canvas.scrub { cursor: ew-resize; }
.ckp-timeline canvas.pan { cursor: grabbing; }
`

interface DragState {
  kind: 'playhead' | 'pan' | 'keyframe' | 'marker'
  startX: number
  startY: number
  // For 'keyframe': all bezt at the dragged frame across all channels.
  draggedFrame?: number
  affected?: { fcu: FCurve; bezt: FCurve['bezt'][number]; t0: number }[]
  markerIdx?: number
  markerT0?: number
}

export class Timeline {
  private root: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private action: CameraAction
  private getCurrentFrame: () => number
  private setCurrentFrame: (f: number) => void
  private onChanged: () => void
  private sharedX: SharedXView | null
  private onViewXChanged: () => void
  private getFrameRange: (() => [number, number] | null) | null

  private view = { xMin: 0, xMax: 240 }

  private dragging: DragState | null = null
  private hoveredFrame: number | null = null
  private rafPending = false
  private resizeObs: ResizeObserver

  constructor (opts: TimelineOptions) {
    this.action = opts.action
    this.getCurrentFrame = opts.getCurrentFrame
    this.setCurrentFrame = opts.setCurrentFrame
    this.onChanged = opts.onChanged ?? (() => {})
    this.sharedX = opts.viewX ?? null
    this.onViewXChanged = opts.onViewXChanged ?? (() => {})
    this.getFrameRange = opts.getFrameRange ?? null
    if (this.sharedX) {
      this.view.xMin = this.sharedX.xMin
      this.view.xMax = this.sharedX.xMax
    }

    this.injectStyle()
    this.root = document.createElement('div')
    this.root.className = 'ckp-timeline'
    this.root.tabIndex = 0
    this.canvas = document.createElement('canvas')
    this.root.appendChild(this.canvas)
    opts.container.appendChild(this.root)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Timeline: 2d context unavailable')
    this.ctx = ctx

    this.attachEvents()
    this.resizeObs = new ResizeObserver(() => this.onResize())
    this.resizeObs.observe(this.root)
  }

  refresh (): void {
    this.requestRender()
  }

  setViewX (xMin: number, xMax: number): void {
    if (this.sharedX) {
      this.sharedX.xMin = xMin
      this.sharedX.xMax = xMax
    }
    this.view.xMin = xMin
    this.view.xMax = xMax
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

  private get cssWidth (): number { return this.canvas.clientWidth }
  private get cssHeight (): number { return this.canvas.clientHeight }
  private xToPx (frame: number): number {
    return (frame - this.view.xMin) / (this.view.xMax - this.view.xMin) * this.cssWidth
  }
  private pxToFrame (x: number): number {
    return this.view.xMin + (x / this.cssWidth) * (this.view.xMax - this.view.xMin)
  }
  private dxFramesPerPx (): number {
    return (this.view.xMax - this.view.xMin) / this.cssWidth
  }

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

  private requestRender (): void {
    if (this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => { this.rafPending = false; this.render() })
  }

  private onResize (): void {
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.floor(this.cssWidth * dpr))
    this.canvas.height = Math.max(1, Math.floor(this.cssHeight * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.requestRender()
  }

  private render (): void {
    if (this.canvas.width === 0) this.onResize()
    this.syncFromShared()
    const ctx = this.ctx
    const w = this.cssWidth
    const h = this.cssHeight

    ctx.fillStyle = THEME.bg
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = THEME.rulerBg
    ctx.fillRect(0, 0, w, RULER_HEIGHT)

    this.drawOutOfRangeShading()
    this.drawRuler()
    this.drawMarkers()
    this.drawKeyframes()
    this.drawPlayhead()

    ctx.strokeStyle = THEME.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, RULER_HEIGHT + 0.5)
    ctx.lineTo(w, RULER_HEIGHT + 0.5)
    ctx.stroke()
  }

  private drawRuler (): void {
    const ctx = this.ctx
    const xRange = this.view.xMax - this.view.xMin
    const targetStepPx = 90
    const xStep = niceStep((xRange * targetStepPx) / Math.max(1, this.cssWidth))

    ctx.font = '10px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = THEME.axisLabel

    // Minor ticks at xStep/5, but only if ≥4px apart (avoid clutter).
    const minorStep = xStep / 5
    const minorPx = (minorStep / xRange) * this.cssWidth
    if (minorPx >= 4) {
      ctx.strokeStyle = THEME.gridMinor
      ctx.lineWidth = 1
      const minStart = Math.ceil(this.view.xMin / minorStep) * minorStep
      ctx.beginPath()
      for (let x = minStart; x <= this.view.xMax; x += minorStep) {
        const px = Math.floor(this.xToPx(x)) + 0.5
        ctx.moveTo(px, RULER_HEIGHT - 4)
        ctx.lineTo(px, RULER_HEIGHT)
      }
      ctx.stroke()
    }

    ctx.strokeStyle = THEME.gridMajor
    ctx.lineWidth = 1
    const start = Math.ceil(this.view.xMin / xStep) * xStep
    ctx.beginPath()
    for (let x = start; x <= this.view.xMax; x += xStep) {
      const px = Math.floor(this.xToPx(x)) + 0.5
      ctx.moveTo(px, 0); ctx.lineTo(px, RULER_HEIGHT)
    }
    ctx.stroke()

    for (let x = start; x <= this.view.xMax; x += xStep) {
      const px = this.xToPx(x)
      const label = xStep >= 1 ? `${Math.round(x)}` : x.toFixed(1)
      ctx.fillText(label, px + 3, RULER_HEIGHT / 2)
    }
  }

  private drawKeyframes (): void {
    const ctx = this.ctx
    const yMid = (RULER_HEIGHT + this.cssHeight) / 2
    const seen = new Set<number>()
    ctx.fillStyle = THEME.keyDiamond
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    for (const fcu of this.action.fcurves) {
      for (const b of fcu.bezt) {
        const f = b.vec[1][0]
        if (f < this.view.xMin || f > this.view.xMax) continue
        // Snap to thousandth-frame to dedupe near-equal floats.
        const k = Math.round(f * 1000) / 1000
        if (seen.has(k)) continue
        seen.add(k)
        const px = this.xToPx(f)
        const isHovered = this.hoveredFrame !== null && Math.abs(f - this.hoveredFrame) < 1e-3
        ctx.fillStyle = isHovered ? THEME.keyDiamondHover : THEME.keyDiamond
        ctx.beginPath()
        ctx.moveTo(px, yMid - KEY_RADIUS)
        ctx.lineTo(px + KEY_RADIUS, yMid)
        ctx.lineTo(px, yMid + KEY_RADIUS)
        ctx.lineTo(px - KEY_RADIUS, yMid)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
  }

  // Mirrors Blender's ANIM_draw_framerange (space_action.cc:254).
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
    ctx.strokeStyle = THEME.playhead
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.3
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
    ctx.globalAlpha = 1
  }

  private drawMarkers (): void {
    const markers = this.action.metadata?.markers
    if (!markers || markers.length === 0) return
    const ctx = this.ctx
    ctx.font = '10px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    for (const m of markers) {
      if (m.frame < this.view.xMin || m.frame > this.view.xMax) continue
      const px = Math.floor(this.xToPx(m.frame)) + 0.5
      const color = m.color ?? THEME.marker
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.4
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, RULER_HEIGHT)
      ctx.lineTo(px, this.cssHeight)
      ctx.stroke()
      ctx.globalAlpha = 1
      const textW = ctx.measureText(m.name).width
      const flagW = textW + 10
      const flagH = 12
      const fy = this.cssHeight - flagH - 1
      ctx.fillStyle = color
      ctx.fillRect(px, fy, flagW, flagH)
      ctx.fillStyle = '#1a1a1f'
      ctx.fillText(m.name, px + 5, fy + flagH / 2)
    }
  }

  private hitTestMarker (mx: number, my: number): number | null {
    const markers = this.action.metadata?.markers
    if (!markers) return null
    // Only the bottom strip — diamond row and ruler keep their semantics.
    if (my < this.cssHeight - 16) return null
    let best: { i: number; dpx: number } | null = null
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i]
      if (m.frame < this.view.xMin || m.frame > this.view.xMax) continue
      const dpx = Math.abs(this.xToPx(m.frame) - mx)
      if (dpx <= 14 && (!best || dpx < best.dpx)) best = { i, dpx }
    }
    return best ? best.i : null
  }

  /** Add a marker at the given frame. Prompts for name if not given. */
  addMarker (frame: number, name?: string): void {
    if (!this.action.metadata) this.action.metadata = {}
    if (!this.action.metadata.markers) this.action.metadata.markers = []
    const finalName = name ?? window.prompt('Marker name', `M${this.action.metadata.markers.length + 1}`) ?? ''
    if (!finalName) return
    this.action.metadata.markers.push({ frame, name: finalName })
    this.action.metadata.markers.sort((a, b) => a.frame - b.frame)
    this.onChanged()
    this.requestRender()
  }

  removeMarker (idx: number): void {
    const markers = this.action.metadata?.markers
    if (!markers) return
    markers.splice(idx, 1)
    this.onChanged()
    this.requestRender()
  }

  // Port of draw_current_frame (time_scrub_ui.cc:87).
  private drawPlayhead (): void {
    const frame = this.getCurrentFrame()
    if (frame < this.view.xMin || frame > this.view.xMax) return
    const ctx = this.ctx
    const px = Math.floor(this.xToPx(frame)) + 0.5

    const label = `${Math.round(frame)}`
    ctx.font = 'bold 11px ui-monospace, monospace'
    const textW = ctx.measureText(label).width
    const padX = 6
    const boxW = Math.max(24, textW + padX * 2)
    const boxH = RULER_HEIGHT - 4
    const boxX = px - boxW / 2
    const boxY = 2

    // Line first so the label box sits on top.
    ctx.strokeStyle = THEME.playhead
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(px, RULER_HEIGHT)
    ctx.lineTo(px, this.cssHeight)
    ctx.stroke()

    ctx.fillStyle = THEME.playhead
    roundRect(ctx, boxX, boxY, boxW, boxH, 3)
    ctx.fill()

    ctx.fillStyle = THEME.playheadText
    ctx.textBaseline = 'middle'
    ctx.fillText(label, px - textW / 2, boxY + boxH / 2)
    ctx.font = '10px ui-monospace, monospace'
  }

  private hitTestKeyframe (mx: number): number | null {
    let best: { frame: number; dpx: number } | null = null
    const seen = new Set<number>()
    for (const fcu of this.action.fcurves) {
      for (const b of fcu.bezt) {
        const f = b.vec[1][0]
        if (f < this.view.xMin || f > this.view.xMax) continue
        const k = Math.round(f * 1000) / 1000
        if (seen.has(k)) continue
        seen.add(k)
        const dpx = Math.abs(this.xToPx(f) - mx)
        if (dpx <= KEY_HIT && (!best || dpx < best.dpx)) {
          best = { frame: f, dpx }
        }
      }
    }
    return best ? best.frame : null
  }

  private boundOnMouseDown = (e: MouseEvent) => this.onMouseDown(e)
  private boundOnMouseMove = (e: MouseEvent) => this.onMouseMove(e)
  private boundOnMouseUp = (e: MouseEvent) => this.onMouseUp(e)
  private boundOnWheel = (e: WheelEvent) => this.onWheel(e)
  private boundOnContextMenu = (e: MouseEvent) => this.onContextMenu(e)
  private boundOnLeave = () => { this.hoveredFrame = null; this.requestRender() }

  private attachEvents (): void {
    this.canvas.addEventListener('mousedown', this.boundOnMouseDown)
    window.addEventListener('mousemove', this.boundOnMouseMove)
    window.addEventListener('mouseup', this.boundOnMouseUp)
    this.canvas.addEventListener('wheel', this.boundOnWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.boundOnContextMenu)
    this.canvas.addEventListener('mouseleave', this.boundOnLeave)
  }
  private detachEvents (): void {
    this.canvas.removeEventListener('mousedown', this.boundOnMouseDown)
    window.removeEventListener('mousemove', this.boundOnMouseMove)
    window.removeEventListener('mouseup', this.boundOnMouseUp)
    this.canvas.removeEventListener('wheel', this.boundOnWheel)
    this.canvas.removeEventListener('contextmenu', this.boundOnContextMenu)
    this.canvas.removeEventListener('mouseleave', this.boundOnLeave)
  }

  private localCoord (e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  private onMouseDown (e: MouseEvent): void {
    this.root.focus()
    const [mx, my] = this.localCoord(e)

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.dragging = { kind: 'pan', startX: mx, startY: my }
      this.canvas.classList.add('pan')
      e.preventDefault()
      return
    }

    if (e.button !== 0) return

    if (my > RULER_HEIGHT) {
      const mIdx = this.hitTestMarker(mx, my)
      if (mIdx !== null) {
        const m = this.action.metadata!.markers![mIdx]
        this.dragging = {
          kind: 'marker', startX: mx, startY: my,
          markerIdx: mIdx, markerT0: m.frame,
        }
        this.canvas.classList.add('scrub')
        return
      }
    }

    if (my > RULER_HEIGHT) {
      const hit = this.hitTestKeyframe(mx)
      if (hit !== null) {
        this.beginKeyframeDrag(mx, my, hit)
        return
      }
    }

    // Click to seek; subsequent mousemove keeps scrubbing.
    const frame = Math.round(this.pxToFrame(mx))
    this.setCurrentFrame(frame)
    this.dragging = { kind: 'playhead', startX: mx, startY: my }
    this.canvas.classList.add('scrub')
    this.requestRender()
  }

  private beginKeyframeDrag (mx: number, my: number, frame: number): void {
    const affected: { fcu: FCurve; bezt: FCurve['bezt'][number]; t0: number }[] = []
    for (const fcu of this.action.fcurves) {
      for (const b of fcu.bezt) {
        if (Math.abs(b.vec[1][0] - frame) < 1e-3) {
          affected.push({ fcu, bezt: b, t0: b.vec[1][0] })
        }
      }
    }
    this.dragging = {
      kind: 'keyframe', startX: mx, startY: my,
      draggedFrame: frame, affected,
    }
    this.canvas.classList.add('scrub')
  }

  private onMouseMove (e: MouseEvent): void {
    const [mx] = this.localCoord(e)
    if (!this.dragging) {
      this.hoveredFrame = this.hitTestKeyframe(mx)
      this.requestRender()
      return
    }

    if (this.dragging.kind === 'pan') {
      const prev = this.dragging.startX
      const dx = (mx - prev) * this.dxFramesPerPx()
      this.view.xMin -= dx
      this.view.xMax -= dx
      this.dragging.startX = mx
      this.syncToShared()
      this.requestRender()
      return
    }

    if (this.dragging.kind === 'playhead') {
      const frame = Math.round(this.pxToFrame(mx))
      this.setCurrentFrame(frame)
      this.requestRender()
      return
    }

    if (this.dragging.kind === 'marker' && this.dragging.markerIdx !== undefined && this.dragging.markerT0 !== undefined) {
      const dxFrames = (mx - this.dragging.startX) * this.dxFramesPerPx()
      const dxApplied = e.ctrlKey ? Math.round(dxFrames) : dxFrames
      const m = this.action.metadata!.markers![this.dragging.markerIdx]
      m.frame = this.dragging.markerT0 + dxApplied
      this.onChanged()
      this.requestRender()
      return
    }

    if (this.dragging.kind === 'keyframe' && this.dragging.affected) {
      const dxFrames = (mx - this.dragging.startX) * this.dxFramesPerPx()
      const dxApplied = e.ctrlKey ? Math.round(dxFrames) : dxFrames
      let needsSort = false
      for (const a of this.dragging.affected) {
        const newT = a.t0 + dxApplied
        moveKeyframeTimeWithHandles(a.bezt, newT)
        const idx = a.fcu.bezt.indexOf(a.bezt)
        if (idx > 0 && a.fcu.bezt[idx - 1].vec[1][0] > newT) needsSort = true
        if (idx < a.fcu.bezt.length - 1 && a.fcu.bezt[idx + 1].vec[1][0] < newT) needsSort = true
      }
      if (needsSort) {
        const seen = new Set<FCurve>()
        for (const a of this.dragging.affected) {
          if (!seen.has(a.fcu)) { sortFCurve(a.fcu); recalcAllHandles(a.fcu); seen.add(a.fcu) }
        }
      }
      this.onChanged()
      this.requestRender()
    }
  }

  private onMouseUp (_e: MouseEvent): void {
    if (!this.dragging) return
    this.dragging = null
    this.canvas.classList.remove('scrub')
    this.canvas.classList.remove('pan')
    this.requestRender()
  }

  private onContextMenu (e: MouseEvent): void {
    e.preventDefault()
    const [mx, my] = this.localCoord(e)
    const frame = Math.round(this.pxToFrame(mx))
    const mIdx = this.hitTestMarker(mx, my)
    showSimpleMenu(e.clientX, e.clientY, mIdx !== null ? [
      { label: `Rename marker`, action: () => {
        const cur = this.action.metadata!.markers![mIdx!]
        const next = window.prompt('Marker name', cur.name)
        if (next !== null && next !== '') { cur.name = next; this.onChanged(); this.requestRender() }
      }},
      { label: `Delete marker`, action: () => this.removeMarker(mIdx!) },
    ] : [
      { label: `Add marker @ frame ${frame}`, action: () => this.addMarker(frame) },
    ])
  }

  private onWheel (e: WheelEvent): void {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1
    const [mx] = this.localCoord(e)
    const cx = this.pxToFrame(mx)
    this.view.xMin = cx - (cx - this.view.xMin) * factor
    this.view.xMax = cx + (this.view.xMax - cx) * factor
    this.syncToShared()
    this.requestRender()
  }
}

function niceStep (raw: number): number {
  if (raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const f = raw / Math.pow(10, exp)
  let nice: number
  if (f < 1.5) nice = 1
  else if (f < 3) nice = 2
  else if (f < 7) nice = 5
  else nice = 10
  return nice * Math.pow(10, exp)
}

/** Lightweight DOM context menu. One-level only — use
 * `separator: true` to draw a divider; an entry with no `action` renders
 * as a section label. */
export interface MenuItem {
  label?: string
  action?: () => void
  separator?: boolean
  disabled?: boolean
}

const MENU_STYLE_ID = 'ckp-menu-style'
const MENU_STYLE = `
.ckp-menu {
  position: fixed; z-index: 9999;
  background: #2a2a30; border: 1px solid #444; border-radius: 4px;
  padding: 4px 0; min-width: 180px;
  font: 12px system-ui, sans-serif; color: #ddd;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  user-select: none;
}
.ckp-menu-item { padding: 4px 14px; cursor: pointer; }
.ckp-menu-item:hover { background: #3a3a44; color: #fff; }
.ckp-menu-item.disabled { color: #666; cursor: default; }
.ckp-menu-item.disabled:hover { background: transparent; color: #666; }
.ckp-menu-section { padding: 4px 14px 2px; color: #777; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; cursor: default; }
.ckp-menu-sep { height: 1px; background: #3a3a44; margin: 4px 0; }
`

export function showSimpleMenu (clientX: number, clientY: number, items: MenuItem[]): void {
  if (!document.getElementById(MENU_STYLE_ID)) {
    const tag = document.createElement('style')
    tag.id = MENU_STYLE_ID
    tag.textContent = MENU_STYLE
    document.head.appendChild(tag)
  }
  document.querySelectorAll('.ckp-menu').forEach((m) => m.remove())

  const menu = document.createElement('div')
  menu.className = 'ckp-menu'
  for (const it of items) {
    if (it.separator) {
      const s = document.createElement('div')
      s.className = 'ckp-menu-sep'
      menu.appendChild(s)
      continue
    }
    if (!it.action) {
      const s = document.createElement('div')
      s.className = 'ckp-menu-section'
      s.textContent = it.label ?? ''
      menu.appendChild(s)
      continue
    }
    const div = document.createElement('div')
    div.className = 'ckp-menu-item' + (it.disabled ? ' disabled' : '')
    div.textContent = it.label ?? ''
    if (!it.disabled) {
      div.addEventListener('click', () => {
        it.action!()
        menu.remove()
      })
    }
    menu.appendChild(div)
  }
  document.body.appendChild(menu)

  const rect = menu.getBoundingClientRect()
  const px = Math.min(clientX, window.innerWidth - rect.width - 8)
  const py = Math.min(clientY, window.innerHeight - rect.height - 8)
  menu.style.left = px + 'px'
  menu.style.top = py + 'px'

  const close = (e: MouseEvent | KeyboardEvent) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return
    if (e instanceof MouseEvent && menu.contains(e.target as Node)) return
    menu.remove()
    window.removeEventListener('mousedown', close as EventListener)
    window.removeEventListener('keydown', close as EventListener)
  }
  // Defer attach so the originating event doesn't immediately close.
  setTimeout(() => {
    window.addEventListener('mousedown', close as EventListener)
    window.addEventListener('keydown', close as EventListener)
  }, 0)
}

function roundRect (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}
