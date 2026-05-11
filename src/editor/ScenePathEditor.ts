import {
  Camera,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { HandleType } from '../data/enums'
import { SplinePath, SplinePoint, Vec3 as Vec3Tuple } from '../data/types'
import { pathPos, segmentCount } from '../spline/bezier3d'
import { applyAlignAfterDrag, h1Type, nextHandleType, recalcAllSplineHandles, recalcSplineHandle } from '../spline/handles'

export type HitKind = 'anchor' | 'h1' | 'h2'
export interface PathHit {
  kind: HitKind
  pointIdx: number
}

export interface ScenePathEditorOptions {
  scene: Scene
  camera: Camera
  dom: HTMLElement
  path: SplinePath
  onChanged?: () => void
  /** Called once per user-intent boundary (drag release, click insert,
   * V-cycle, dissolve, etc.) so the host can push an undo step. Receives
   * a short human-readable label. Not called for selection-only changes
   * (click empty deselect) or zero-movement drags. */
  onCommit?: (label: string) => void
  /** Samples per segment for the spline polyline. Default 48. */
  resolution?: number
  /** Anchor handle radius in world units. Default 0.08. */
  anchorRadius?: number
  /** Spline curve line width in CSS pixels (Line2). Default 3. */
  splineLineWidth?: number
  /** Handle bar line width in CSS pixels (LineSegments2). Default 2. */
  handleLineWidth?: number
}

const COLOR_SPLINE         = new Color('#0066ff')
const COLOR_HANDLE_LINE    = new Color('#3a3a3a')
const COLOR_ANCHOR         = new Color('#ffffff')
const COLOR_ANCHOR_HOVER   = new Color('#ffe060')
const COLOR_ANCHOR_ACTIVE  = new Color('#ff7733')
const COLOR_HANDLE_DOT     = new Color('#aaaaaa')
const COLOR_GHOST_INSERT   = new Color('#22c55e')  // semi-transparent "add" affordance

export class ScenePathEditor {
  private scene: Scene
  private camera: Camera
  private dom: HTMLElement
  private onChanged: () => void
  private onCommit: (label: string) => void
  private resolution: number
  private anchorRadius: number

  private root: Group
  private splineLine: Line2
  private splineMaterial: LineMaterial
  private handleSegments: LineSegments2
  private handleSegmentsMaterial: LineMaterial
  private activeHandleSegments: LineSegments2
  private activeHandleSegmentsMaterial: LineMaterial
  private anchorMeshes: Mesh[] = []
  private handleDotMeshes: Mesh[] = []
  private ghostMesh: Mesh
  private ghostInsert: { segIdx: number; t: number } | null = null
  private resizeObserver: ResizeObserver | null = null

  private hovered: PathHit | null = null
  private active: PathHit | null = null
  private dragState: {
    startCo: [number, number, number]
    startH1: [number, number, number]
    startH2: [number, number, number]
    constraint: { kind: 'free' } | { kind: 'axis' | 'plane'; axis: 0 | 1 | 2 }
  } | null = null

  private raycaster = new Raycaster()
  private ndc = new Vector2()
  private tmpV1 = new Vector3()
  private tmpV2 = new Vector3()
  private tmpPlane = new Plane()

  private boundOnPointerMove = (e: PointerEvent): void => this.onPointerMove(e)
  private boundOnPointerDown = (e: PointerEvent): void => this.onPointerDown(e)
  private boundOnPointerUp = (e: PointerEvent): void => this.onPointerUp(e)
  private boundOnPointerLeave = (): void => this.setGhost(null)
  private boundOnKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e)

  constructor (
    public path: SplinePath,
    opts: ScenePathEditorOptions,
  ) {
    this.scene = opts.scene
    this.camera = opts.camera
    this.dom = opts.dom
    this.onChanged = opts.onChanged ?? (() => {})
    this.onCommit = opts.onCommit ?? (() => {})
    this.resolution = opts.resolution ?? 48
    this.anchorRadius = opts.anchorRadius ?? 0.08

    this.root = new Group()
    this.root.name = 'dollycurve:ScenePathEditor'
    this.scene.add(this.root)

    this.splineMaterial = new LineMaterial({
      color: COLOR_SPLINE,
      linewidth: opts.splineLineWidth ?? 3,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    })
    this.splineLine = new Line2(new LineGeometry(), this.splineMaterial)
    this.splineLine.renderOrder = 999
    this.splineLine.frustumCulled = false
    this.root.add(this.splineLine)

    this.handleSegmentsMaterial = new LineMaterial({
      color: COLOR_HANDLE_LINE,
      linewidth: opts.handleLineWidth ?? 2,
      depthTest: false,
      transparent: true,
      opacity: 0.25,
    })
    this.handleSegments = new LineSegments2(new LineSegmentsGeometry(), this.handleSegmentsMaterial)
    this.handleSegments.renderOrder = 999
    this.handleSegments.frustumCulled = false
    this.root.add(this.handleSegments)

    this.activeHandleSegmentsMaterial = new LineMaterial({
      color: COLOR_HANDLE_LINE,
      linewidth: opts.handleLineWidth ?? 2,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    })
    this.activeHandleSegments = new LineSegments2(new LineSegmentsGeometry(), this.activeHandleSegmentsMaterial)
    // renderOrder 999.5 sits between the faded bars (999) and the dots (1000).
    this.activeHandleSegments.renderOrder = 999.5
    this.activeHandleSegments.frustumCulled = false
    this.activeHandleSegments.visible = false
    this.root.add(this.activeHandleSegments)

    this.ghostMesh = new Mesh(
      new SphereGeometry(this.anchorRadius, 12, 8),
      new MeshBasicMaterial({ color: COLOR_GHOST_INSERT, depthTest: false, transparent: true, opacity: 0.45 }),
    )
    this.ghostMesh.renderOrder = 1000
    this.ghostMesh.visible = false
    this.root.add(this.ghostMesh)

    this.updateLineResolution()
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.updateLineResolution())
      this.resizeObserver.observe(this.dom)
    }

    // Capture phase: run before OrbitControls so a hit can stopPropagation.
    this.dom.addEventListener('pointermove', this.boundOnPointerMove, true)
    this.dom.addEventListener('pointerdown', this.boundOnPointerDown, true)
    this.dom.addEventListener('pointerup', this.boundOnPointerUp, true)
    this.dom.addEventListener('pointercancel', this.boundOnPointerUp, true)
    this.dom.addEventListener('pointerleave', this.boundOnPointerLeave)

    this.refresh()
  }

  private updateLineResolution (): void {
    const w = this.dom.clientWidth || window.innerWidth
    const h = this.dom.clientHeight || window.innerHeight
    this.splineMaterial.resolution.set(w, h)
    this.handleSegmentsMaterial.resolution.set(w, h)
    this.activeHandleSegmentsMaterial.resolution.set(w, h)
  }

  /** Rebuild all visuals. Call after mutating `path` directly. */
  refresh (): void {
    this.updateSplineGeometry()
    this.updateAnchorMeshes()
    this.updateHandleMeshes()
    this.updateColors()
  }

  destroy (): void {
    this.dom.removeEventListener('pointermove', this.boundOnPointerMove, true)
    this.dom.removeEventListener('pointerdown', this.boundOnPointerDown, true)
    this.dom.removeEventListener('pointerup', this.boundOnPointerUp, true)
    this.dom.removeEventListener('pointercancel', this.boundOnPointerUp, true)
    this.dom.removeEventListener('pointerleave', this.boundOnPointerLeave)
    window.removeEventListener('keydown', this.boundOnKeyDown)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.scene.remove(this.root)
    this.disposeSubtree(this.root)
  }

  getActive (): PathHit | null { return this.active }
  setActive (hit: PathHit | null): void {
    this.active = hit
    this.updateColors()
  }

  private updateSplineGeometry (): void {
    const segs = segmentCount(this.path)
    // Replace the geometry on every refresh — reusing one across setPositions
    // calls drops the tail segment after insertPoint (stale instanceStart).
    this.splineLine.geometry.dispose()
    const geo = new LineGeometry()
    if (segs === 0) {
      geo.setPositions([0, 0, 0, 0, 0, 0])
      this.splineLine.geometry = geo
      return
    }
    const total = segs * this.resolution + 1
    const positions = new Float32Array(total * 3)
    for (let i = 0; i < total; i++) {
      const u = (i / (total - 1)) * segs
      const p = pathPos(this.path, u)
      positions[i * 3]     = p[0]
      positions[i * 3 + 1] = p[1]
      positions[i * 3 + 2] = p[2]
    }
    geo.setPositions(positions as unknown as number[])
    this.splineLine.geometry = geo
  }

  private updateAnchorMeshes (): void {
    const N = this.path.points.length
    while (this.anchorMeshes.length < N) {
      const geo = new SphereGeometry(this.anchorRadius, 12, 8)
      const mat = new MeshBasicMaterial({ color: COLOR_ANCHOR, depthTest: false, transparent: true })
      const mesh = new Mesh(geo, mat)
      mesh.renderOrder = 1000
      mesh.userData = { kind: 'anchor', pointIdx: this.anchorMeshes.length }
      this.root.add(mesh)
      this.anchorMeshes.push(mesh)
    }
    while (this.anchorMeshes.length > N) {
      const m = this.anchorMeshes.pop()!
      this.root.remove(m)
      this.disposeSubtree(m)
    }
    for (let i = 0; i < N; i++) {
      const p = this.path.points[i]
      this.anchorMeshes[i].position.set(p.co[0], p.co[1], p.co[2])
      this.anchorMeshes[i].userData.pointIdx = i
    }
  }

  private updateHandleMeshes (): void {
    const N = this.path.points.length
    const wantDots = N * 2
    while (this.handleDotMeshes.length < wantDots) {
      const geo = new SphereGeometry(this.anchorRadius, 12, 8)
      const mat = new MeshBasicMaterial({ color: COLOR_HANDLE_DOT, depthTest: false, transparent: true })
      const mesh = new Mesh(geo, mat)
      mesh.renderOrder = 1000
      const idx = this.handleDotMeshes.length
      mesh.userData = { kind: idx % 2 === 0 ? 'h1' : 'h2', pointIdx: idx >> 1 }
      this.root.add(mesh)
      this.handleDotMeshes.push(mesh)
    }
    while (this.handleDotMeshes.length > wantDots) {
      const m = this.handleDotMeshes.pop()!
      this.root.remove(m)
      this.disposeSubtree(m)
    }
    const segPositions = new Float32Array(N * 2 * 6)
    for (let i = 0; i < N; i++) {
      const p = this.path.points[i]
      const base = i * 12
      segPositions[base]     = p.co[0]
      segPositions[base + 1] = p.co[1]
      segPositions[base + 2] = p.co[2]
      segPositions[base + 3] = p.h1[0]
      segPositions[base + 4] = p.h1[1]
      segPositions[base + 5] = p.h1[2]
      segPositions[base + 6] = p.co[0]
      segPositions[base + 7] = p.co[1]
      segPositions[base + 8] = p.co[2]
      segPositions[base + 9]  = p.h2[0]
      segPositions[base + 10] = p.h2[1]
      segPositions[base + 11] = p.h2[2]
      // Sync the dot meshes too.
      const dot1 = this.handleDotMeshes[i * 2]
      const dot2 = this.handleDotMeshes[i * 2 + 1]
      dot1.position.set(p.h1[0], p.h1[1], p.h1[2])
      dot2.position.set(p.h2[0], p.h2[1], p.h2[2])
      dot1.userData = { kind: 'h1', pointIdx: i }
      dot2.userData = { kind: 'h2', pointIdx: i }
    }
    // Same pattern as updateSplineGeometry: replace rather than reuse.
    this.handleSegments.geometry.dispose()
    const geo = new LineSegmentsGeometry()
    geo.setPositions(segPositions as unknown as number[])
    this.handleSegments.geometry = geo
  }

  private updateColors (): void {
    const activeIdx = this.active?.pointIdx
    for (let i = 0; i < this.anchorMeshes.length; i++) {
      const mat = this.anchorMeshes[i].material as MeshBasicMaterial
      const isActive = this.active?.kind === 'anchor' && this.active.pointIdx === i
      const isHover = this.hovered?.kind === 'anchor' && this.hovered.pointIdx === i
      mat.color.copy(isActive ? COLOR_ANCHOR_ACTIVE : isHover ? COLOR_ANCHOR_HOVER : COLOR_ANCHOR)
    }
    for (let i = 0; i < this.handleDotMeshes.length; i++) {
      const mat = this.handleDotMeshes[i].material as MeshBasicMaterial
      const kind = i % 2 === 0 ? 'h1' : 'h2'
      const idx = i >> 1
      const isActive = this.active?.kind === kind && this.active.pointIdx === idx
      const isHover = this.hovered?.kind === kind && this.hovered.pointIdx === idx
      mat.color.copy(isActive ? COLOR_ANCHOR_ACTIVE : isHover ? COLOR_ANCHOR_HOVER : COLOR_HANDLE_DOT)
      mat.opacity = activeIdx === idx ? 1.0 : 0.35
    }
    this.updateActiveHandleOverlay(activeIdx)
  }

  private updateActiveHandleOverlay (activeIdx: number | undefined): void {
    if (activeIdx === undefined || activeIdx < 0 || activeIdx >= this.path.points.length) {
      this.activeHandleSegments.visible = false
      return
    }
    const p = this.path.points[activeIdx]
    const bars = new Float32Array([
      p.co[0], p.co[1], p.co[2], p.h1[0], p.h1[1], p.h1[2],
      p.co[0], p.co[1], p.co[2], p.h2[0], p.h2[1], p.h2[2],
    ])
    this.activeHandleSegments.geometry.dispose()
    const geo = new LineSegmentsGeometry()
    geo.setPositions(bars as unknown as number[])
    this.activeHandleSegments.geometry = geo
    this.activeHandleSegments.visible = true
  }

  /** Pick the nearest anchor/handle under the pointer. */
  pick (clientX: number, clientY: number): PathHit | null {
    const rect = this.dom.getBoundingClientRect()
    this.ndc.x = ((clientX - rect.left) / rect.width)  * 2 - 1
    this.ndc.y = -((clientY - rect.top)  / rect.height) * 2 + 1
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc, this.camera)

    const targets: Object3D[] = [...this.anchorMeshes, ...this.handleDotMeshes]
    const hits = this.raycaster.intersectObjects(targets, false)
    if (hits.length === 0) return null
    // Prefer anchors when in range — handles otherwise pre-empt them since
    // they sit slightly in front in screen space.
    const anchorHit = hits.find((h) => (h.object.userData?.kind as HitKind) === 'anchor')
    const first = hits[0]
    const chosen = anchorHit && (anchorHit.distance - first.distance) < this.anchorRadius
      ? anchorHit
      : first
    const ud = chosen.object.userData as { kind?: HitKind; pointIdx?: number } | undefined
    if (!ud || ud.kind === undefined || ud.pointIdx === undefined) return null
    return { kind: ud.kind, pointIdx: ud.pointIdx }
  }

  private onPointerMove (e: PointerEvent): void {
    if (this.dragState && this.active) {
      this.applyDrag(e.clientX, e.clientY, e.shiftKey)
      e.stopPropagation()
      e.preventDefault()
      return
    }
    const hit = this.pick(e.clientX, e.clientY)
    if (hit?.kind !== this.hovered?.kind || hit?.pointIdx !== this.hovered?.pointIdx) {
      this.hovered = hit
      this.updateColors()
    }
    if (hit) {
      this.setGhost(null)
    } else {
      this.setGhost(this.pickSpline(e.clientX, e.clientY))
    }
  }

  private setGhost (g: { segIdx: number; t: number } | null): void {
    this.ghostInsert = g
    if (!g) {
      this.ghostMesh.visible = false
      return
    }
    const u = g.segIdx + g.t
    const p = pathPos(this.path, u)
    this.ghostMesh.position.set(p[0], p[1], p[2])
    this.ghostMesh.visible = true
  }

  private onPointerDown (e: PointerEvent): void {
    // Right-click during drag cancels (Blender modal-transform behavior).
    if (e.button === 2 && this.dragState) {
      this.cancelDrag()
      e.stopPropagation()
      e.preventDefault()
      return
    }
    if (e.button !== 0) return

    if (e.ctrlKey || e.metaKey) {
      const ins = this.pickSpline(e.clientX, e.clientY)
      if (ins !== null) {
        this.insertPoint(ins.segIdx, ins.t)
        e.stopPropagation()
        e.preventDefault()
        return
      }
    }

    const hit = this.pick(e.clientX, e.clientY)
    if (hit) {
      this.active = hit
      const p = this.path.points[hit.pointIdx]
      this.dragState = {
        startCo: [p.co[0], p.co[1], p.co[2]],
        startH1: [p.h1[0], p.h1[1], p.h1[2]],
        startH2: [p.h2[0], p.h2[1], p.h2[2]],
        constraint: { kind: 'free' },
      }
      window.addEventListener('keydown', this.boundOnKeyDown)
      try { this.dom.setPointerCapture(e.pointerId) } catch { /* jsdom may not support */ }
      this.setGhost(null)
      this.updateColors()
      e.stopPropagation()
      e.preventDefault()
    } else if (this.ghostInsert) {
      const g = this.ghostInsert
      this.insertPoint(g.segIdx, g.t)
      this.setGhost(null)
      e.stopPropagation()
      e.preventDefault()
    } else if (this.active) {
      // Don't stopPropagation — let OrbitControls orbit/pan on empty click.
      this.active = null
      this.updateColors()
    }
  }

  /** Pick the nearest segment+t on the spline polyline to the click ray. */
  pickSpline (clientX: number, clientY: number): { segIdx: number; t: number } | null {
    const segs = segmentCount(this.path)
    if (segs === 0) return null
    const rect = this.dom.getBoundingClientRect()
    this.ndc.x = ((clientX - rect.left) / rect.width)  * 2 - 1
    this.ndc.y = -((clientY - rect.top)  / rect.height) * 2 + 1
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc, this.camera)
    // Line2 threshold is in screen pixels (added to half the line width).
    const params = this.raycaster.params as { Line2?: { threshold: number } }
    const prev = params.Line2?.threshold
    params.Line2 = { ...(params.Line2 ?? {}), threshold: 8 }
    const hits = this.raycaster.intersectObject(this.splineLine, false)
    if (prev !== undefined) params.Line2!.threshold = prev
    if (hits.length === 0) return null
    const hit = hits[0] as { faceIndex?: number; pointOnLine?: Vector3 }
    const faceIdx = hit.faceIndex ?? 0

    // Continuous sub-edge param so (segIdx, t) doesn't snap to the polyline
    // grid — mirrors Blender's get_updated_data_for_edge (editcurve_pen.cc:710).
    let s = 0
    const start = this.splineLine.geometry.attributes.instanceStart
    const end = this.splineLine.geometry.attributes.instanceEnd
    if (hit.pointOnLine && start && end && faceIdx < start.count) {
      const ax = start.getX(faceIdx), ay = start.getY(faceIdx), az = start.getZ(faceIdx)
      const bx = end.getX(faceIdx),   by = end.getY(faceIdx),   bz = end.getZ(faceIdx)
      const dx = bx - ax, dy = by - ay, dz = bz - az
      const lenSq = dx * dx + dy * dy + dz * dz
      if (lenSq > 1e-12) {
        const px = hit.pointOnLine.x - ax
        const py = hit.pointOnLine.y - ay
        const pz = hit.pointOnLine.z - az
        s = (px * dx + py * dy + pz * dz) / lenSq
        if (s < 0) s = 0
        else if (s > 1) s = 1
      }
    }

    const u = (faceIdx + s) / this.resolution
    const segIdx = Math.min(segs - 1, Math.floor(u))
    return { segIdx, t: u - segIdx }
  }

  /** de Casteljau split at `t` in segment `segIdx`. Shape-preserving. */
  insertPoint (segIdx: number, t: number): number {
    const N = this.path.points.length
    if (N < 2) return -1
    const a = this.path.points[segIdx]
    const b = this.path.points[(segIdx + 1) % N]
    const lerp = (p: Vec3Tuple, q: Vec3Tuple): Vec3Tuple =>
      [p[0] * (1 - t) + q[0] * t, p[1] * (1 - t) + q[1] * t, p[2] * (1 - t) + q[2] * t]
    const p1 = lerp(a.co, a.h2)
    const p12 = lerp(a.h2, b.h1)
    const p23 = lerp(b.h1, b.co)
    const p2 = lerp(p1, p12)
    const p3 = lerp(p12, p23)
    const mid = lerp(p2, p3)
    const newH1ForB = p23

    const newPoint: SplinePoint = { co: mid, h1: p2, h2: p3 }
    const aTilt = a.tilt ?? 0
    const bTilt = b.tilt ?? 0
    const midTilt = aTilt * (1 - t) + bTilt * t
    if (midTilt !== 0) newPoint.tilt = midTilt
    a.h2 = p1
    b.h1 = newH1ForB
    const insertAt = segIdx + 1
    if (insertAt >= this.path.points.length) {
      this.path.points.push(newPoint)
    } else {
      this.path.points.splice(insertAt, 0, newPoint)
    }
    this.active = { kind: 'anchor', pointIdx: insertAt }
    this.refresh()
    this.onChanged()
    this.onCommit('insert spline point')
    return insertAt
  }

  /** Cycle the active anchor's handle types together (h1 + h2 in lockstep)
   * through AUTO → VECTOR → ALIGN → FREE. AUTO and VECTOR also re-snap
   * the handle positions so the new constraint takes effect immediately;
   * ALIGN and FREE keep current positions. No-op when nothing is active.
   * Returns the type just applied, or `null` if nothing changed. */
  cycleActiveHandleType (): HandleType | null {
    if (!this.active) return null
    const idx = this.active.pointIdx
    const p = this.path.points[idx]
    if (!p) return null
    const next = nextHandleType(h1Type(p))
    p.h1Type = next
    p.h2Type = next
    recalcSplineHandle(this.path, idx)
    this.refresh()
    this.onChanged()
    this.onCommit(`handle type → ${next}`)
    return next
  }

  /** Extrude a new anchor from the active endpoint along the current
   * tangent. Mirrors Blender's curve.extrude_move (E key). */
  extrudeFromActiveEndpoint (): number {
    if (!this.active || this.active.kind !== 'anchor') return -1
    if (this.path.closed) return -1
    const idx = this.active.pointIdx
    const N = this.path.points.length
    const isFirst = idx === 0
    const isLast = idx === N - 1
    if (!isFirst && !isLast) return -1

    const p = this.path.points[idx]
    const ax = isLast ? p.co[0] - p.h1[0] : p.co[0] - p.h2[0]
    const ay = isLast ? p.co[1] - p.h1[1] : p.co[1] - p.h2[1]
    const az = isLast ? p.co[2] - p.h1[2] : p.co[2] - p.h2[2]
    let tlen = Math.hypot(ax, ay, az)
    let tx = 1, ty = 0, tz = 0
    if (tlen > 1e-6) { tx = ax / tlen; ty = ay / tlen; tz = az / tlen }
    const step = Math.max(tlen * 3, 0.5)
    const newCo: Vec3Tuple = [p.co[0] + tx * step, p.co[1] + ty * step, p.co[2] + tz * step]
    const newPoint: SplinePoint = {
      co: newCo,
      h1: [newCo[0] - tx * step / 3, newCo[1] - ty * step / 3, newCo[2] - tz * step / 3],
      h2: [newCo[0] + tx * step / 3, newCo[1] + ty * step / 3, newCo[2] + tz * step / 3],
      h1Type: HandleType.AUTO,
      h2Type: HandleType.AUTO,
    }
    if (isLast) {
      this.path.points.push(newPoint)
      this.active = { kind: 'anchor', pointIdx: this.path.points.length - 1 }
    } else {
      this.path.points.unshift(newPoint)
      this.active = { kind: 'anchor', pointIdx: 0 }
    }
    // The old endpoint just gained an interior neighbor — resnap AUTO handles.
    recalcAllSplineHandles(this.path)
    this.refresh()
    this.onChanged()
    this.onCommit('extrude spline endpoint')
    return this.active.pointIdx
  }

  /** Reverse point order; mirrors BKE_nurb_direction_switch. */
  switchDirection (): void {
    const N = this.path.points.length
    if (N < 2) return
    this.path.points.reverse()
    for (const p of this.path.points) {
      const tmpH = p.h1; p.h1 = p.h2; p.h2 = tmpH
      const tmpT = p.h1Type; p.h1Type = p.h2Type; p.h2Type = tmpT
      if (p.tilt !== undefined && p.tilt !== 0) p.tilt = -p.tilt
    }
    if (this.active) {
      this.active = { ...this.active, pointIdx: N - 1 - this.active.pointIdx }
    }
    this.refresh()
    this.onChanged()
    this.onCommit('switch spline direction')
  }

  /** Remove a point but refit the neighbor handles to keep curve shape.
   * Approximation of Blender's CURVE_OT_dissolve_verts (no Schneider fit). */
  dissolvePoint (idx: number): boolean {
    const N = this.path.points.length
    if (N <= 2) return false
    const prevIdx = idx > 0 ? idx - 1 : (this.path.closed ? N - 1 : -1)
    const nextIdx = idx < N - 1 ? idx + 1 : (this.path.closed ? 0 : -1)
    if (prevIdx < 0 || nextIdx < 0) return false

    const prev = this.path.points[prevIdx]
    const next = this.path.points[nextIdx]
    const chord = Math.hypot(next.co[0] - prev.co[0], next.co[1] - prev.co[1], next.co[2] - prev.co[2])
    const targetLen = chord / 3

    const reproject = (anchor: Vec3Tuple, handle: Vec3Tuple): Vec3Tuple => {
      const dx = handle[0] - anchor[0], dy = handle[1] - anchor[1], dz = handle[2] - anchor[2]
      const l = Math.hypot(dx, dy, dz)
      if (l < 1e-9) {
        const cx = next.co[0] - prev.co[0], cy = next.co[1] - prev.co[1], cz = next.co[2] - prev.co[2]
        const cl = Math.hypot(cx, cy, cz) || 1
        const sign = anchor === prev.co ? 1 : -1
        return [anchor[0] + sign * cx / cl * targetLen, anchor[1] + sign * cy / cl * targetLen, anchor[2] + sign * cz / cl * targetLen]
      }
      return [anchor[0] + dx / l * targetLen, anchor[1] + dy / l * targetLen, anchor[2] + dz / l * targetLen]
    }
    prev.h2 = reproject(prev.co, prev.h2)
    next.h1 = reproject(next.co, next.h1)

    // AUTO → ALIGN / VECTOR → FREE so a future recalc doesn't undo the fit.
    const promote = (t: HandleType | undefined): HandleType => {
      const cur = t ?? HandleType.AUTO
      if (cur === HandleType.FREE || cur === HandleType.ALIGN) return cur
      return cur === HandleType.VECTOR ? HandleType.FREE : HandleType.ALIGN
    }
    prev.h2Type = promote(prev.h2Type)
    next.h1Type = promote(next.h1Type)

    this.path.points.splice(idx, 1)
    if (this.active?.pointIdx === idx) this.active = null
    else if (this.active && this.active.pointIdx > idx) {
      this.active = { ...this.active, pointIdx: this.active.pointIdx - 1 }
    }
    this.refresh()
    this.onChanged()
    this.onCommit('dissolve spline point')
    return true
  }

  /** Flip the spline between open and closed (cyclic). Resnaps every
   * AUTO/VECTOR handle since the neighbor topology at the seam changed
   * (open endpoints have only one neighbor; closed wrap around). */
  toggleClosed (): boolean {
    this.path.closed = !this.path.closed
    recalcAllSplineHandles(this.path)
    this.refresh()
    this.onChanged()
    this.onCommit(this.path.closed ? 'close spline' : 'open spline')
    return this.path.closed
  }

  /** Set per-point baseline tilt (banking) in radians. */
  setPointTilt (idx: number, radians: number): void {
    const p = this.path.points[idx]
    if (!p) return
    const prev = p.tilt ?? 0
    if (radians === 0) delete p.tilt
    else p.tilt = radians
    this.onChanged()
    if (Math.abs(prev - radians) > 1e-9) this.onCommit('set anchor tilt')
  }

  /** Remove a control point. For shape-preserving removal use dissolvePoint. */
  deletePoint (idx: number): boolean {
    if (idx < 0 || idx >= this.path.points.length) return false
    if (this.path.points.length <= 1) return false
    this.path.points.splice(idx, 1)
    if (this.active?.pointIdx === idx) this.active = null
    else if (this.active && this.active.pointIdx > idx) this.active = { ...this.active, pointIdx: this.active.pointIdx - 1 }
    this.refresh()
    this.onChanged()
    this.onCommit('delete spline point')
    return true
  }

  private onPointerUp (e: PointerEvent): void {
    if (!this.dragState || !this.active) return
    // Plain click (no movement) shouldn't push an undo step.
    const ds = this.dragState
    const p = this.path.points[this.active.pointIdx]
    let moved = false
    if (p) {
      const cur = this.active.kind === 'anchor' ? p.co
                : this.active.kind === 'h1'     ? p.h1
                                                : p.h2
      const start = this.active.kind === 'anchor' ? ds.startCo
                  : this.active.kind === 'h1'     ? ds.startH1
                                                  : ds.startH2
      moved = Math.abs(cur[0] - start[0]) > 1e-9
           || Math.abs(cur[1] - start[1]) > 1e-9
           || Math.abs(cur[2] - start[2]) > 1e-9
    }
    const kind = this.active.kind
    this.dragState = null
    window.removeEventListener('keydown', this.boundOnKeyDown)
    try { this.dom.releasePointerCapture(e.pointerId) } catch { /* jsdom may not support */ }
    e.stopPropagation()
    this.onChanged()
    if (moved) {
      this.onCommit(kind === 'anchor' ? 'move spline anchor' : 'move spline handle')
    }
  }

  // Drag-time keys: X/Y/Z axis-lock, Shift+X/Y/Z plane-lock, Esc cancels.
  // Outside drag, hosts wire their own delete/insert keys.
  private onKeyDown (e: KeyboardEvent): void {
    if (!this.dragState) return
    if (e.key === 'Escape' || e.key === 'Esc') {
      this.cancelDrag()
      e.preventDefault()
      return
    }
    let axis: 0 | 1 | 2 | null = null
    if (e.key === 'x' || e.key === 'X') axis = 0
    else if (e.key === 'y' || e.key === 'Y') axis = 1
    else if (e.key === 'z' || e.key === 'Z') axis = 2
    else return
    const wantPlane = e.shiftKey
    const cur = this.dragState.constraint
    const sameAxis = cur.kind !== 'free' && cur.axis === axis
    const sameMode = cur.kind === 'free' ? false : (cur.kind === 'plane') === wantPlane
    if (sameAxis && sameMode) {
      this.dragState.constraint = { kind: 'free' }
    } else {
      this.dragState.constraint = { kind: wantPlane ? 'plane' : 'axis', axis }
    }
    e.preventDefault()
  }

  // Esc / right-click during drag → restore drag-start position. Doesn't
  // emit onChanged since the path is back where it was.
  private cancelDrag (): void {
    if (!this.dragState || !this.active) return
    const p = this.path.points[this.active.pointIdx]
    if (p) {
      p.co = [...this.dragState.startCo]
      p.h1 = [...this.dragState.startH1]
      p.h2 = [...this.dragState.startH2]
    }
    this.dragState = null
    window.removeEventListener('keydown', this.boundOnKeyDown)
    this.refresh()
  }

  private projectPointer (clientX: number, clientY: number): Vec3Tuple | null {
    if (!this.dragState) return null
    const rect = this.dom.getBoundingClientRect()
    this.ndc.x = ((clientX - rect.left) / rect.width)  * 2 - 1
    this.ndc.y = -((clientY - rect.top)  / rect.height) * 2 + 1
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const ray = this.raycaster.ray
    const start = this.dragState.startCo
    const startV = this.tmpV1.set(start[0], start[1], start[2])
    const cn = this.dragState.constraint

    if (cn.kind === 'free') {
      const camFwd = this.tmpV2
      this.camera.getWorldDirection(camFwd)
      this.tmpPlane.setFromNormalAndCoplanarPoint(camFwd, startV)
      const out = new Vector3()
      if (!ray.intersectPlane(this.tmpPlane, out)) return null
      return [out.x, out.y, out.z]
    }
    if (cn.kind === 'plane') {
      const normal = this.tmpV2.set(cn.axis === 0 ? 1 : 0, cn.axis === 1 ? 1 : 0, cn.axis === 2 ? 1 : 0)
      this.tmpPlane.setFromNormalAndCoplanarPoint(normal, startV)
      const out = new Vector3()
      if (!ray.intersectPlane(this.tmpPlane, out)) return null
      return [out.x, out.y, out.z]
    }
    // axis-locked: closest point on (start + s*axis) to the ray.
    const axisVec = this.tmpV2.set(cn.axis === 0 ? 1 : 0, cn.axis === 1 ? 1 : 0, cn.axis === 2 ? 1 : 0)
    const o = ray.origin
    const d = ray.direction
    const A = axisVec.dot(d)
    const det = 1 - A * A
    if (Math.abs(det) < 1e-6) return [start[0], start[1], start[2]]  // ray parallel to axis
    const dx = startV.x - o.x, dy = startV.y - o.y, dz = startV.z - o.z
    const B = dx * d.x + dy * d.y + dz * d.z
    const C = dx * axisVec.x + dy * axisVec.y + dz * axisVec.z
    const s = (B * A - C) / det
    return [
      startV.x + axisVec.x * s,
      startV.y + axisVec.y * s,
      startV.z + axisVec.z * s,
    ]
  }

  private applyDrag (clientX: number, clientY: number, shiftKey = false): void {
    if (!this.dragState || !this.active) return
    const newPos = this.projectPointer(clientX, clientY)
    if (!newPos) return
    const p = this.path.points[this.active.pointIdx]
    if (!p) return
    if (this.active.kind === 'anchor') {
      const dx = newPos[0] - this.dragState.startCo[0]
      const dy = newPos[1] - this.dragState.startCo[1]
      const dz = newPos[2] - this.dragState.startCo[2]
      p.co = [newPos[0], newPos[1], newPos[2]]
      p.h1 = [this.dragState.startH1[0] + dx, this.dragState.startH1[1] + dy, this.dragState.startH1[2] + dz]
      p.h2 = [this.dragState.startH2[0] + dx, this.dragState.startH2[1] + dy, this.dragState.startH2[2] + dz]
    } else if (this.active.kind === 'h1') {
      p.h1 = [newPos[0], newPos[1], newPos[2]]
      applyAlignAfterDrag(p, 'h1', shiftKey)
    } else {
      p.h2 = [newPos[0], newPos[1], newPos[2]]
      applyAlignAfterDrag(p, 'h2', shiftKey)
    }
    this.refresh()
  }

  private disposeSubtree (root: Object3D): void {
    root.traverse((node) => {
      const mesh = node as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } | { dispose?: () => void }[] }
      if (mesh.geometry?.dispose) mesh.geometry.dispose()
      const m = mesh.material
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.())
      else m?.dispose?.()
    })
  }

  /** Notify owners of mutation. Call after directly editing point data. */
  protected emitChanged (): void {

    this.refresh()
    this.onChanged()
  }
}
