import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  Group,
  Line,
  LineBasicMaterial,
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
import { SplinePath, SplinePoint, Vec3 as Vec3Tuple } from '../data/types'
import { pathPos, segmentCount } from '../spline/bezier3d'

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
  /** Samples per segment for the spline polyline. Default 48. */
  resolution?: number
  /** Anchor handle radius in world units. Default 0.05. */
  anchorRadius?: number
}

const COLOR_SPLINE         = new Color('#88ccff')
const COLOR_HANDLE_LINE    = new Color('#666666')
const COLOR_ANCHOR         = new Color('#ffffff')
const COLOR_ANCHOR_HOVER   = new Color('#ffe060')
const COLOR_ANCHOR_ACTIVE  = new Color('#ff7733')
const COLOR_HANDLE_DOT     = new Color('#cccccc')

export class ScenePathEditor {
  private scene: Scene
  private camera: Camera
  private dom: HTMLElement
  private onChanged: () => void
  private resolution: number
  private anchorRadius: number

  private root: Group
  private splineLine: Line
  private anchorMeshes: Mesh[] = []
  private handleLineMeshes: Line[] = []
  private handleDotMeshes: Mesh[] = []

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
  private boundOnKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e)

  constructor (
    public path: SplinePath,
    opts: ScenePathEditorOptions,
  ) {
    this.scene = opts.scene
    this.camera = opts.camera
    this.dom = opts.dom
    this.onChanged = opts.onChanged ?? (() => {})
    this.resolution = opts.resolution ?? 48
    this.anchorRadius = opts.anchorRadius ?? 0.05

    this.root = new Group()
    this.root.name = 'dollycurve:ScenePathEditor'
    this.scene.add(this.root)

    this.splineLine = this.makeSplineLine()
    this.root.add(this.splineLine)

    // Capture phase: run before OrbitControls so a control-point hit can
    // stopPropagation and prevent the camera from also being dragged.
    this.dom.addEventListener('pointermove', this.boundOnPointerMove, true)
    this.dom.addEventListener('pointerdown', this.boundOnPointerDown, true)
    this.dom.addEventListener('pointerup', this.boundOnPointerUp, true)
    this.dom.addEventListener('pointercancel', this.boundOnPointerUp, true)

    this.refresh()
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
    window.removeEventListener('keydown', this.boundOnKeyDown)
    this.scene.remove(this.root)
    this.disposeSubtree(this.root)
  }

  getActive (): PathHit | null { return this.active }
  setActive (hit: PathHit | null): void {
    this.active = hit
    this.updateColors()
  }

  private makeSplineLine (): Line {
    const geo = new BufferGeometry()
    const mat = new LineBasicMaterial({ color: COLOR_SPLINE, depthTest: false, transparent: true, opacity: 0.9 })
    const line = new Line(geo, mat)
    line.renderOrder = 999  // draw on top of typical scene content
    return line
  }

  private updateSplineGeometry (): void {
    const segs = segmentCount(this.path)
    if (segs === 0) {
      this.splineLine.geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3))
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
    const geo = this.splineLine.geometry
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.computeBoundingSphere()
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
    const wantLines = N * 2
    const wantDots = N * 2
    while (this.handleLineMeshes.length < wantLines) {
      const geo = new BufferGeometry()
      const mat = new LineBasicMaterial({ color: COLOR_HANDLE_LINE, depthTest: false, transparent: true, opacity: 0.6 })
      const line = new Line(geo, mat)
      line.renderOrder = 999
      this.root.add(line)
      this.handleLineMeshes.push(line)
    }
    while (this.handleLineMeshes.length > wantLines) {
      const l = this.handleLineMeshes.pop()!
      this.root.remove(l)
      this.disposeSubtree(l)
    }
    while (this.handleDotMeshes.length < wantDots) {
      const geo = new SphereGeometry(this.anchorRadius * 0.6, 8, 6)
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
    for (let i = 0; i < N; i++) {
      const p = this.path.points[i]
      const h1 = this.handleLineMeshes[i * 2]
      const h2 = this.handleLineMeshes[i * 2 + 1]
      const positions1 = new Float32Array([p.co[0], p.co[1], p.co[2], p.h1[0], p.h1[1], p.h1[2]])
      const positions2 = new Float32Array([p.co[0], p.co[1], p.co[2], p.h2[0], p.h2[1], p.h2[2]])
      h1.geometry.setAttribute('position', new BufferAttribute(positions1, 3))
      h2.geometry.setAttribute('position', new BufferAttribute(positions2, 3))
      h1.geometry.computeBoundingSphere()
      h2.geometry.computeBoundingSphere()
      const dot1 = this.handleDotMeshes[i * 2]
      const dot2 = this.handleDotMeshes[i * 2 + 1]
      dot1.position.set(p.h1[0], p.h1[1], p.h1[2])
      dot2.position.set(p.h2[0], p.h2[1], p.h2[2])
      dot1.userData = { kind: 'h1', pointIdx: i }
      dot2.userData = { kind: 'h2', pointIdx: i }
    }
  }

  private updateColors (): void {
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
    }
  }

  /** Pick the nearest anchor/handle under the pointer. Anchors take priority
   * over handles within the ray tolerance. */
  pick (clientX: number, clientY: number): PathHit | null {
    const rect = this.dom.getBoundingClientRect()
    this.ndc.x = ((clientX - rect.left) / rect.width)  * 2 - 1
    this.ndc.y = -((clientY - rect.top)  / rect.height) * 2 + 1
    this.camera.updateMatrixWorld()  // raycaster reads matrixWorldInverse
    this.raycaster.setFromCamera(this.ndc, this.camera)

    const targets: Object3D[] = [...this.anchorMeshes, ...this.handleDotMeshes]
    const hits = this.raycaster.intersectObjects(targets, false)
    if (hits.length === 0) return null
    // Prefer anchors within a small tolerance — they sit slightly behind
    // handles in screen space, otherwise handles always win.
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
      this.applyDrag(e.clientX, e.clientY)
      // Swallow during drag so OrbitControls doesn't also see it.
      e.stopPropagation()
      e.preventDefault()
      return
    }
    const hit = this.pick(e.clientX, e.clientY)
    if (hit?.kind !== this.hovered?.kind || hit?.pointIdx !== this.hovered?.pointIdx) {
      this.hovered = hit
      this.updateColors()
    }
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

    // Ctrl+click inserts a new control point via de Casteljau split.
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
      this.updateColors()
      // Swallow so OrbitControls doesn't also start a camera drag.
      e.stopPropagation()
      e.preventDefault()
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
    // Generous Line threshold scaled to bounding sphere — pixel-perfect aim
    // would be too strict on screens of any size.
    const sphere = this.splineLine.geometry.boundingSphere
    const threshold = sphere ? Math.max(sphere.radius * 0.05, 0.05) : 0.1
    const prev = this.raycaster.params.Line?.threshold
    this.raycaster.params.Line = { ...this.raycaster.params.Line, threshold }
    const hits = this.raycaster.intersectObject(this.splineLine, false)
    if (prev !== undefined) this.raycaster.params.Line!.threshold = prev
    if (hits.length === 0) return null
    const idx = hits[0].index ?? 0
    const total = segs * this.resolution + 1
    const u = (idx / (total - 1)) * segs
    const segIdx = Math.min(segs - 1, Math.floor(u))
    return { segIdx, t: u - segIdx }
  }

  /** de Casteljau split at `t` in segment `segIdx`. Inserts a new control
   * point with handles that preserve curve shape (mirrors
   * BKE_fcurve_bezt_subdivide_handles). */
  insertPoint (segIdx: number, t: number): number {
    const N = this.path.points.length
    if (N < 2) return -1
    const a = this.path.points[segIdx]
    const b = this.path.points[(segIdx + 1) % N]
    const lerp = (p: Vec3Tuple, q: Vec3Tuple): Vec3Tuple =>
      [p[0] * (1 - t) + q[0] * t, p[1] * (1 - t) + q[1] * t, p[2] * (1 - t) + q[2] * t]
    // Control polygon: P0 = a.co, P1 = a.h2, P2 = b.h1, P3 = b.co.
    const p1 = lerp(a.co, a.h2)            // new a.h2
    const p12 = lerp(a.h2, b.h1)
    const p23 = lerp(b.h1, b.co)
    const p2 = lerp(p1, p12)               // mid.h1
    const p3 = lerp(p12, p23)              // mid.h2
    const mid = lerp(p2, p3)               // new anchor
    const newH1ForB = p23                  // new b.h1

    const newPoint: SplinePoint = { co: mid, h1: p2, h2: p3 }
    // Interpolate tilt at split so attributes don't break discontinuously
    // across insert (Blender subdivideNurb editcurve.cc:3587-3589).
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
    return insertAt
  }

  /** Set per-point baseline tilt (banking) in radians. PathFollow's
   * `tiltCurve` adds time-varying roll on top. */
  setPointTilt (idx: number, radians: number): void {
    const p = this.path.points[idx]
    if (!p) return
    if (radians === 0) delete p.tilt
    else p.tilt = radians
    this.onChanged()
  }

  /** Remove a control point — plain splice (Blender CURVE_OT_delete). The
   * curve through the gap snaps to the existing neighbor handles; for shape
   * preservation, a future dissolvePoint will refit a cubic across the gap
   * (CURVE_OT_dissolve_verts, editcurve.cc:6660-6722). */
  deletePoint (idx: number): boolean {
    if (idx < 0 || idx >= this.path.points.length) return false
    if (this.path.points.length <= 1) return false
    this.path.points.splice(idx, 1)
    if (this.active?.pointIdx === idx) this.active = null
    else if (this.active && this.active.pointIdx > idx) this.active = { ...this.active, pointIdx: this.active.pointIdx - 1 }
    this.refresh()
    this.onChanged()
    return true
  }

  private onPointerUp (e: PointerEvent): void {
    if (this.dragState) {
      this.dragState = null
      window.removeEventListener('keydown', this.boundOnKeyDown)
      try { this.dom.releasePointerCapture(e.pointerId) } catch { /* jsdom may not support */ }
      e.stopPropagation()
      this.onChanged()
    }
  }

  // Drag-time keys: X/Y/Z axis-lock, Shift+X/Y/Z plane-lock, Escape cancels.
  // Outside drag, hosts wire their own delete/insert keys — this class
  // doesn't grab global keys, to avoid focus-leak problems.
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

  // Escape / right-click during drag: restore drag-start position. Mirrors
  // Blender's modal-transform cancel. Does NOT call onChanged — path is
  // back where it started.
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
      // Plane through start, normal = camera forward.
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

  private applyDrag (clientX: number, clientY: number): void {
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
    } else {
      p.h2 = [newPos[0], newPos[1], newPos[2]]
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
