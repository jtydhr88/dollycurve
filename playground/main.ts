import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import {
  CameraTrackBinding,
  GraphEditor,
  Interpolation,
  ScenePathEditor,
  SimplePanel,
  Timeline,
  bakePathToFCurves,
  buildArcTable,
  evaluateFCurve,
  exportCameraActionToJson,
  fitFCurvesToPath,
  importCameraActionFromJson,
  UndoStack,
  alignQuaternionHemisphere,
  insertOrReplaceKeyframe,
  insertScalarKey,
  insertVec3Key,
  unwrapEulerInAction,
  makeBezTriple,
  makeCameraAction,
  makeFCurve,
  makePathFollowConstraint,
  makeSplinePath,
  makeSplinePoint,
  recalcHandlesAround,
} from 'dollycurve'
import type { FCurve, SharedXView } from 'dollycurve'

const host = document.getElementById('canvas-host') as HTMLDivElement
const endFrameInput = document.getElementById('end-frame') as HTMLInputElement
const previewToggle = document.getElementById('preview-toggle') as HTMLInputElement
const showHelperToggle = document.getElementById('show-helper') as HTMLInputElement
const addBtn = document.getElementById('add-kf') as HTMLButtonElement
const addLiveBtn = document.getElementById('add-kf-live') as HTMLButtonElement
const clearBtn = document.getElementById('clear-kf') as HTMLButtonElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const resetBtn = document.getElementById('reset-time') as HTMLButtonElement
const timeReadout = document.getElementById('time-readout') as HTMLSpanElement
const timelineHost = document.getElementById('timeline-host') as HTMLDivElement
const kfList = document.getElementById('keyframes') as HTMLDivElement
const loadJsonBtn = document.getElementById('load-json') as HTMLButtonElement
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement
const saveJsonBtn = document.getElementById('save-json') as HTMLButtonElement
const loadJsonInput = document.getElementById('load-json-input') as HTMLInputElement
const graphHost = document.getElementById('graph-host') as HTMLDivElement
const graphBottom = document.getElementById('graph-bottom') as HTMLDivElement
const toggleGraphBtn = document.getElementById('toggle-graph') as HTMLButtonElement
const pathModeToggle = document.getElementById('path-mode') as HTMLInputElement
const pathControls = document.getElementById('path-controls') as HTMLDivElement
const bakePathBtn = document.getElementById('bake-path') as HTMLButtonElement
const fitPathBtn = document.getElementById('fit-path') as HTMLButtonElement
const fitCountInput = document.getElementById('fit-count') as HTMLInputElement
const bakeCountInput = document.getElementById('bake-count') as HTMLInputElement
const gizmoEnableCheckbox = document.getElementById('gizmo-enable') as HTMLInputElement
const gizmoRadiosEl = document.getElementById('gizmo-radios') as HTMLSpanElement
const gizmoTranslateRadio = document.getElementById('gizmo-translate') as HTMLInputElement
const gizmoRotateRadio = document.getElementById('gizmo-rotate') as HTMLInputElement

const FPS = 24
const SENSOR_HEIGHT_MM = 24

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(host.clientWidth, host.clientHeight)
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const BG_COLOR        = 0xeadfc8
const GRID_MAJOR      = 0xb09775
const GRID_MINOR      = 0xcfbb95
const PATH_LINE_COLOR = 0xd23838
const KF_HELPER_COLOR = 0x2563eb
const KF_HELPER_SELECTED_COLOR = 0x16a34a
const LIVE_HELPER_COLOR = 0xff8c00

scene.background = new THREE.Color(BG_COLOR)
scene.fog = new THREE.Fog(BG_COLOR, 30, 80)

const editorCam = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 200)
editorCam.position.set(8, 6, 12)
editorCam.lookAt(0, 0, 0)

const previewCam = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 200)
previewCam.position.set(0, 2, 8)

const controls = new OrbitControls(editorCam, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 1, 0)

// ---- Keyframe-pose gizmo ----
const gizmoProxy = new THREE.Object3D()
scene.add(gizmoProxy)
const gizmo = new TransformControls(editorCam, renderer.domElement)
const gizmoHelper = gizmo.getHelper ? gizmo.getHelper() : (gizmo as unknown as THREE.Object3D)
scene.add(gizmoHelper)
gizmoHelper.visible = false
let selectedKfFrame: number | null = null
let suppressGizmoWriteback = false
let gizmoEnabled = false

gizmo.addEventListener('dragging-changed', (e) => {
  const dragging = (e as { value: boolean }).value
  controls.enabled = !dragging
  if (!dragging && selectedKfFrame !== null && !suppressGizmoWriteback) {
    const mode = (gizmo as unknown as { mode: 'translate' | 'rotate' | 'scale' }).mode
    undoStack.push(mode === 'rotate' ? 'rotate keyframe' : 'translate keyframe')
  }
})
gizmo.addEventListener('objectChange', () => {
  if (suppressGizmoWriteback || selectedKfFrame === null) return
  writeGizmoBackToFCurves(selectedKfFrame)
})

scene.add(new THREE.AmbientLight(0xffffff, 0.4))
const sun = new THREE.DirectionalLight(0xffffff, 1.0)
sun.position.set(10, 20, 8)
scene.add(sun)
scene.add(new THREE.GridHelper(40, 40, GRID_MAJOR, GRID_MINOR))
scene.add(new THREE.AxesHelper(2))

// Single reference capsule at the origin — used as a focal subject so the
// camera animation has something to frame.
{
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.8, 1.6, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xff5555, roughness: 0.5 }),
  )
  capsule.position.set(0, 1.6, 0)
  scene.add(capsule)
}

const action = makeCameraAction([], FPS)
const binding = new CameraTrackBinding(previewCam, action, {
  sensorHeight: SENSOR_HEIGHT_MM,
  eulerOrder: 'XYZ',
})
const editorBinding = new CameraTrackBinding(editorCam, action, {
  sensorHeight: SENSOR_HEIGHT_MM,
  eulerOrder: 'XYZ',
})

let endFrame = parseInt(endFrameInput.value, 10)
let duration = endFrame / FPS
let currentTime = 0
let isPlaying = false

const kfHelperGroup = new THREE.Group()
scene.add(kfHelperGroup)
// Stand-in for previewCam with small near/far so the helper renders as a
// compact pose indicator instead of extending to the real cam's far plane.
const previewCamGhost = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1.5)
const previewCamHelper = new THREE.CameraHelper(previewCamGhost)
{
  const m = previewCamHelper.material as THREE.LineBasicMaterial
  m.vertexColors = false
  m.color.set(LIVE_HELPER_COLOR)
  m.needsUpdate = true
}
scene.add(previewCamHelper)

function syncPreviewGhost (): void {
  previewCamGhost.position.copy(previewCam.position)
  previewCamGhost.quaternion.copy(previewCam.quaternion)
  previewCamGhost.updateMatrixWorld(true)
  previewCamHelper.update()
}

function syncCamHelperVisibility (): void {
  // Hide while looking through previewCam — frustum lines obscure the scene from inside.
  previewCamHelper.visible = showHelperToggle.checked && !previewToggle.checked
}
syncCamHelperVisibility()

function locXCurve (): FCurve | undefined {
  return action.fcurves.find((f) => f.rnaPath === 'location' && f.arrayIndex === 0)
}

function uniqueKeyframeFrames (): number[] {
  const fcu = locXCurve()
  if (!fcu) return []
  return fcu.bezt.map((b) => b.vec[1][0])
}

function allKeyframeFrames (): number[] {
  const seen = new Set<number>()
  for (const fcu of action.fcurves) {
    for (const b of fcu.bezt) {
      seen.add(Math.round(b.vec[1][0] * 1000) / 1000)
    }
  }
  return [...seen].sort((a, b) => a - b)
}

function buildPathLine (): THREE.Line | null {
  const fcu = locXCurve()
  if (!fcu || fcu.bezt.length < 2) return null
  const fY = action.fcurves.find((f) => f.rnaPath === 'location' && f.arrayIndex === 1)
  const fZ = action.fcurves.find((f) => f.rnaPath === 'location' && f.arrayIndex === 2)
  if (!fY || !fZ) return null

  const samples = 240
  const totalFrames = duration * FPS
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= samples; i++) {
    const frame = (i / samples) * totalFrames
    pts.push(new THREE.Vector3(
      evaluateFCurve(fcu, frame),
      evaluateFCurve(fY, frame),
      evaluateFCurve(fZ, frame),
    ))
  }
  const geom = new THREE.BufferGeometry().setFromPoints(pts)
  return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: PATH_LINE_COLOR, linewidth: 2 }))
}

function writeAxisAtFrame (fcu: FCurve, frame: number, value: number): void {
  const idx = findKeyAtFrame(fcu, frame)
  if (idx < 0) {
    insertOrReplaceKeyframe(fcu, frame, value)
    return
  }
  const b = fcu.bezt[idx]
  const dy = value - b.vec[1][1]
  b.vec[1][1] = value
  b.vec[0][1] += dy
  b.vec[2][1] += dy
  recalcHandlesAround(fcu, idx)
}

function writeGizmoBackToFCurves (frame: number): void {
  // Translate writes only the grabbed axis subset of `location`; rotate writes
  // all rotation channels (axis-coupled in both quat and Euler).
  const mode = (gizmo as unknown as { mode: 'translate' | 'rotate' | 'scale' }).mode
  const axis = (gizmo as unknown as { axis: string | null }).axis ?? 'XYZ'
  const wantX = axis.includes('X')
  const wantY = axis.includes('Y')
  const wantZ = axis.includes('Z')
  const want = [wantX, wantY, wantZ]

  if (mode === 'translate') {
    for (const fcu of action.fcurves) {
      if (fcu.rnaPath !== 'location' || fcu.arrayIndex < 0 || fcu.arrayIndex > 2) continue
      if (!want[fcu.arrayIndex]) continue
      const v = [gizmoProxy.position.x, gizmoProxy.position.y, gizmoProxy.position.z][fcu.arrayIndex]
      writeAxisAtFrame(fcu, frame, v)
    }
  } else if (mode === 'rotate') {
    const hasQuat = action.fcurves.some((f) => f.rnaPath === 'rotation_quaternion')
    if (hasQuat) {
      const q = gizmoProxy.quaternion
      let qx = q.x, qy = q.y, qz = q.z, qw = q.w
      // Hemisphere continuity vs. the previous frame's sample.
      const sample = sampleQuatAtFrame(frame - 1)
      if (sample) {
        const d = sample[0] * qx + sample[1] * qy + sample[2] * qz + sample[3] * qw
        if (d < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw }
      }
      for (const fcu of action.fcurves) {
        if (fcu.rnaPath !== 'rotation_quaternion') continue
        const v = [qx, qy, qz, qw][fcu.arrayIndex] ?? 0
        writeAxisAtFrame(fcu, frame, v)
      }
    } else {
      for (const fcu of action.fcurves) {
        if (fcu.rnaPath !== 'rotation_euler' || fcu.arrayIndex < 0 || fcu.arrayIndex > 2) continue
        const v = [gizmoProxy.rotation.x, gizmoProxy.rotation.y, gizmoProxy.rotation.z][fcu.arrayIndex]
        writeAxisAtFrame(fcu, frame, v)
      }
    }
  }

  // Continuity post-pass: prevent 360° spins between visually-identical keys.
  unwrapEulerInAction(action)
  alignQuaternionHemisphere(action)

  binding.evaluate(currentTime)
  rebuildHelpers()
  panel.refresh()
  graph.redraw()
}

function findKeyAtFrame (fcu: FCurve, frame: number): number {
  for (let i = 0; i < fcu.bezt.length; i++) {
    if (Math.abs(fcu.bezt[i].vec[1][0] - frame) < 1e-3) return i
  }
  return -1
}

function sampleQuatAtFrame (frame: number): [number, number, number, number] | null {
  const fxs: (FCurve | undefined)[] = [undefined, undefined, undefined, undefined]
  for (const fcu of action.fcurves) {
    if (fcu.rnaPath === 'rotation_quaternion' && fcu.arrayIndex >= 0 && fcu.arrayIndex <= 3) {
      fxs[fcu.arrayIndex] = fcu
    }
  }
  if (!fxs[0] || !fxs[1] || !fxs[2] || !fxs[3]) return null
  return [
    evaluateFCurve(fxs[0], frame),
    evaluateFCurve(fxs[1], frame),
    evaluateFCurve(fxs[2], frame),
    evaluateFCurve(fxs[3], frame),
  ]
}

function syncGizmoToSelection (): void {
  if (selectedKfFrame === null) return
  for (const c of kfHelperGroup.children) {
    if (c.userData?.frame === selectedKfFrame) {
      const pose = c.userData.dummyPose as { pos: number[]; euler: number[] }
      suppressGizmoWriteback = true
      gizmoProxy.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
      gizmoProxy.rotation.set(pose.euler[0], pose.euler[1], pose.euler[2])
      gizmoProxy.updateMatrixWorld()
      suppressGizmoWriteback = false
      gizmoHelper.visible = true
      if (!(gizmo as unknown as { object?: THREE.Object3D }).object) {
        gizmo.attach(gizmoProxy)
      }
      return
    }
  }
  // Helper for this frame is gone (key deleted) — clear selection.
  selectedKfFrame = null
  gizmo.detach()
  gizmoHelper.visible = false
}

function selectKeyframeHelper (frame: number | null): void {
  selectedKfFrame = frame
  if (frame === null) {
    gizmo.detach()
    gizmoHelper.visible = false
    applyHelperSelectionTint()
    return
  }
  syncGizmoToSelection()
  applyHelperSelectionTint()
}

function applyHelperSelectionTint (): void {
  for (const c of kfHelperGroup.children) {
    if (!(c instanceof THREE.CameraHelper)) continue
    const m = c.material as THREE.LineBasicMaterial
    const f = c.userData.frame as number | undefined
    const selected = selectedKfFrame !== null && f !== undefined && Math.abs(f - selectedKfFrame) < 1e-3
    m.color.set(selected ? KF_HELPER_SELECTED_COLOR : KF_HELPER_COLOR)
  }
}

const _kfRaycaster = new THREE.Raycaster()
_kfRaycaster.params.Line = { threshold: 0.05 }
const _kfNDC = new THREE.Vector2()
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!gizmoEnabled) return
  if (e.button !== 0) return
  if ((gizmo as unknown as { dragging?: boolean }).dragging) return
  const rect = renderer.domElement.getBoundingClientRect()
  _kfNDC.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
  _kfNDC.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
  editorCam.updateMatrixWorld()
  _kfRaycaster.setFromCamera(_kfNDC, editorCam)
  // Pick by closest helper anchor in screen space — line raycast misses tiny frusta.
  const helpers = kfHelperGroup.children.filter((c): c is THREE.CameraHelper =>
    c instanceof THREE.CameraHelper)
  let closest: { helper: THREE.CameraHelper; screenDist: number } | null = null
  const projected = new THREE.Vector3()
  for (const h of helpers) {
    h.getWorldPosition(projected)
    projected.project(editorCam)
    if (projected.z < -1 || projected.z > 1) continue
    const dx = projected.x - _kfNDC.x
    const dy = projected.y - _kfNDC.y
    const sd = Math.hypot(dx, dy)
    if (sd < 0.05 && (!closest || sd < closest.screenDist)) {
      closest = { helper: h, screenDist: sd }
    }
  }
  if (closest && closest.helper.userData.frame !== undefined) {
    selectKeyframeHelper(closest.helper.userData.frame as number)
  }
})

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.key === 'Escape' && selectedKfFrame !== null) {
    selectKeyframeHelper(null)
    e.preventDefault()
  } else if ((e.key === 'g' || e.key === 'G') && selectedKfFrame !== null) {
    gizmo.setMode('translate')
    e.preventDefault()
  } else if ((e.key === 'r' || e.key === 'R') && selectedKfFrame !== null) {
    gizmo.setMode('rotate')
    e.preventDefault()
  }
})

function rebuildHelpers (): void {
  while (kfHelperGroup.children.length > 0) {
    const c = kfHelperGroup.children.pop()!
    if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry?.dispose?.()
  }

  const frames = uniqueKeyframeFrames()
  for (const frame of frames) {
    const dummy = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1.5)
    const dummyBinding = new CameraTrackBinding(dummy, action, {
      sensorHeight: SENSOR_HEIGHT_MM,
      eulerOrder: 'XYZ',
    })
    dummyBinding.evaluate(frame / FPS)
    dummy.updateMatrixWorld(true)
    const helper = new THREE.CameraHelper(dummy)
    // Disable per-vertex colors so material.color tints the whole frustum.
    const m = helper.material as THREE.LineBasicMaterial
    m.vertexColors = false
    m.color.set(KF_HELPER_COLOR)
    m.needsUpdate = true
    helper.userData.frame = frame
    helper.userData.dummyPose = {
      pos: [dummy.position.x, dummy.position.y, dummy.position.z],
      euler: [dummy.rotation.x, dummy.rotation.y, dummy.rotation.z],
    }
    kfHelperGroup.add(helper)
  }
  syncGizmoToSelection()
  applyHelperSelectionTint()

  const line = buildPathLine()
  if (line) kfHelperGroup.add(line)
}

// Shared X view: pan/zoom on Timeline and GraphEditor stay in lock-step.
const sharedX: SharedXView = { xMin: 0, xMax: endFrame }

const seekToFrame = (frame: number) => {
  currentTime = frame / FPS
  binding.evaluate(currentTime)
  updateTimeReadout()
  timeline.refresh()
  if (!graphBottom.classList.contains('hidden')) graph.refresh()
}
const handleEdited = () => {
  rebuildHelpers()
  binding.evaluate(currentTime)
}

const onSharedXChanged = () => {
  timeline.refresh()
  graph.refresh()
}

const panel = new SimplePanel({
  container: kfList,
  action,
  getCurrentFrame: () => currentTime * FPS,
  setCurrentFrame: seekToFrame,
  onChanged: handleEdited,
  onCommit: (label) => undoStack.push(label),
})

const graph = new GraphEditor({
  container: graphHost,
  action,
  getCurrentFrame: () => currentTime * FPS,
  setCurrentFrame: seekToFrame,
  onChanged: () => {
    handleEdited()
    panel.refresh()
    timeline.refresh()
  },
  onCommit: (label) => {
    // Late-binds `undoStack` (declared below); user commits can't fire pre-init.
    undoStack.push(`graph: ${label}`)
  },
  viewX: sharedX,
  onViewXChanged: onSharedXChanged,
  getFrameRange: () => [0, endFrame],
})

const timeline = new Timeline({
  container: timelineHost,
  action,
  getCurrentFrame: () => currentTime * FPS,
  setCurrentFrame: seekToFrame,
  onChanged: () => {
    handleEdited()
    panel.refresh()
    graph.refresh()
  },
  viewX: sharedX,
  onViewXChanged: onSharedXChanged,
  getFrameRange: () => [0, endFrame],
})

const bottomEl = document.getElementById('bottom') as HTMLDivElement
toggleGraphBtn.addEventListener('click', () => {
  const wasHidden = graphBottom.classList.contains('hidden')
  graphBottom.classList.toggle('hidden')
  toggleGraphBtn.classList.toggle('active', wasHidden)
  bottomEl.classList.toggle('with-graph', wasHidden)
  if (wasHidden) graph.refresh()
})

function onKeyframesChanged (): void {
  rebuildHelpers()
  panel.refresh()
  graph.refresh()
  timeline.refresh()
  binding.evaluate(currentTime)
}

// ---- Undo / redo ----
interface ActionSnapshot {
  fcurves: typeof action.fcurves
  metadata?: typeof action.metadata
  pathFollow?: typeof action.pathFollow
  fps: number
}
const undoStack = new UndoStack<ActionSnapshot>({
  getSnapshot: () => structuredClone({
    fcurves: action.fcurves,
    metadata: action.metadata,
    pathFollow: action.pathFollow,
    fps: action.fps,
  }),
  applySnapshot: (s) => {
    // Mutate `action` in place — bindings/panels/graph hold references to it.
    action.fcurves.length = 0
    for (const f of s.fcurves) action.fcurves.push(f)
    action.fps = s.fps
    if (s.metadata) action.metadata = s.metadata
    else delete action.metadata
    if (s.pathFollow) action.pathFollow = s.pathFollow
    else delete action.pathFollow
    onKeyframesChanged()
    graph.reset()
  },
  maxSteps: 100,
  onChange: () => {
    if (undoBtn) undoBtn.disabled = !undoStack.canUndo()
    if (redoBtn) redoBtn.disabled = !undoStack.canRedo()
    persistWorkspace()
  },
})

// ---- localStorage workspace persistence ----
const STORAGE_KEY = 'dollycurve.playground.v1'

function persistWorkspace (): void {
  try {
    const json = exportCameraActionToJson(action)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(json))
  } catch { /* private mode / quota */ }
}

function restoreWorkspace (): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const imported = importCameraActionFromJson(JSON.parse(raw))
    action.fcurves.length = 0
    for (const f of imported.fcurves) action.fcurves.push(f)
    action.fps = imported.fps
    if (imported.metadata) action.metadata = imported.metadata
    else delete action.metadata
    if (imported.pathFollow) action.pathFollow = imported.pathFollow
    else delete action.pathFollow
    return true
  } catch (e) {
    console.warn('[dollycurve] restore failed; clearing storage:', e)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    return false
  }
}

if (restoreWorkspace()) {
  // Refresh UI before setBaseline so baseline reflects the restored state.
  onKeyframesChanged()
  panel.refresh()
}
undoStack.setBaseline()

// ---- UI state persistence ----

interface UIState {
  graphOpen: boolean
  endFrame: number
  currentTime: number
  showCamHelper: boolean
  graphActiveIdx: number
  graphView: { xMin: number; xMax: number; yMin: number; yMax: number }
  collapsedGroups: string[]
  editorCamPos: [number, number, number]
  editorCamTarget: [number, number, number]
  helpOpen: boolean
  panelOpen: boolean
}

const UI_STORAGE_KEY = 'dollycurve.playground.ui.v1'

function captureUIState (): UIState {
  return {
    graphOpen: !graphBottom.classList.contains('hidden'),
    endFrame,
    currentTime,
    showCamHelper: showHelperToggle.checked,
    graphActiveIdx: graph.getActiveFCurveIdx(),
    graphView: graph.getView(),
    collapsedGroups: graph.getCollapsedGroups(),
    editorCamPos: [editorCam.position.x, editorCam.position.y, editorCam.position.z],
    editorCamTarget: [controls.target.x, controls.target.y, controls.target.z],
    helpOpen: (document.getElementById('help') as HTMLDetailsElement | null)?.open ?? true,
    panelOpen: (document.getElementById('panel') as HTMLDetailsElement | null)?.open ?? true,
  }
}

let uiPersistTimer: number | null = null
let lastUIHash = ''
function persistUIState (): void {
  if (uiPersistTimer !== null) clearTimeout(uiPersistTimer)
  uiPersistTimer = window.setTimeout(() => {
    uiPersistTimer = null
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(captureUIState()))
    } catch { /* private mode / quota */ }
  }, 400)
}

// Picks up zoom/pan/active-channel/collapse changes that GraphEditor doesn't
// surface as callbacks. Idle ticks short-circuit on the hash compare.
function maybePersistUIStateOnTick (): void {
  const hash = JSON.stringify(captureUIState())
  if (hash === lastUIHash) return
  lastUIHash = hash
  persistUIState()
}

function restoreUIState (): void {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as Partial<UIState>
    if (typeof s.endFrame === 'number') {
      endFrameInput.value = String(s.endFrame)
      setEndFrame(s.endFrame)
    }
    if (typeof s.currentTime === 'number' && Number.isFinite(s.currentTime)) {
      seekToFrame(s.currentTime * FPS)
    }
    if (typeof s.showCamHelper === 'boolean') {
      showHelperToggle.checked = s.showCamHelper
      syncCamHelperVisibility()
    }
    if (typeof s.graphOpen === 'boolean') {
      graphBottom.classList.toggle('hidden', !s.graphOpen)
      document.getElementById('bottom')?.classList.toggle('with-graph', s.graphOpen)
    }
    if (Array.isArray(s.collapsedGroups)) graph.setCollapsedGroups(s.collapsedGroups)
    if (typeof s.graphActiveIdx === 'number' && s.graphActiveIdx >= 0 &&
        s.graphActiveIdx < action.fcurves.length) {
      graph.setActiveFCurveIdx(s.graphActiveIdx)
    }
    if (s.graphView) graph.setView(s.graphView)
    if (Array.isArray(s.editorCamPos) && s.editorCamPos.length === 3) {
      editorCam.position.set(s.editorCamPos[0], s.editorCamPos[1], s.editorCamPos[2])
    }
    if (Array.isArray(s.editorCamTarget) && s.editorCamTarget.length === 3) {
      controls.target.set(s.editorCamTarget[0], s.editorCamTarget[1], s.editorCamTarget[2])
    }
    controls.update()
    if (typeof s.helpOpen === 'boolean') {
      const help = document.getElementById('help') as HTMLDetailsElement | null
      if (help) help.open = s.helpOpen
    }
    if (typeof s.panelOpen === 'boolean') {
      const panel = document.getElementById('panel') as HTMLDetailsElement | null
      if (panel) {
        panel.open = s.panelOpen
        document.getElementById('layout')?.classList.toggle('panel-collapsed', !s.panelOpen)
      }
    }
  } catch (e) {
    console.warn('[dollycurve] UI restore failed:', e)
    try { localStorage.removeItem(UI_STORAGE_KEY) } catch { /* ignore */ }
  }
}

restoreUIState()
showHelperToggle.addEventListener('change', persistUIState)
endFrameInput.addEventListener('change', persistUIState)
toggleGraphBtn.addEventListener('click', persistUIState)

const panelDetails = document.getElementById('panel') as HTMLDetailsElement
panelDetails.addEventListener('toggle', () => {
  document.getElementById('layout')!.classList.toggle('panel-collapsed', !panelDetails.open)
  onResize()
  persistUIState()
})

function updateTimeReadout (): void {
  const frame = Math.round(currentTime * FPS)
  timeReadout.textContent = `${frame} / ${endFrame}  ·  ${currentTime.toFixed(2)}s`
}

function setEndFrame (frames: number): void {
  endFrame = Math.max(1, Math.round(frames))
  duration = endFrame / FPS
  if (currentTime > duration) currentTime = duration
  if (sharedX.xMax < endFrame) {
    sharedX.xMax = endFrame
    onSharedXChanged()
  }
  if (action.pathFollow) {
    const a = buildArcTable(action.pathFollow.splinePath)
    action.pathFollow.speedCurve = makeLinearSpeedCurve(a.totalLen, endFrame)
  }
  rebuildHelpers()
  updateTimeReadout()
}

function captureToKeyframe (
  source: typeof binding | typeof editorBinding,
): void {
  const frame = currentTime * FPS
  const captured = source.captureFromCamera()
  insertVec3Key(action, 'location', frame, captured.location, { ipo: Interpolation.BEZIER })
  insertVec3Key(action, 'rotation_euler', frame, captured.rotation_euler, { ipo: Interpolation.BEZIER })
  insertScalarKey(action, 'lens', frame, captured.lens, { ipo: Interpolation.BEZIER })
  unwrapEulerInAction(action)
  alignQuaternionHemisphere(action)
  onKeyframesChanged()
}

addBtn.addEventListener('click', () => {
  captureToKeyframe(editorBinding)
  undoStack.push('+ Keyframe')
})
addLiveBtn.addEventListener('click', () => {
  binding.evaluate(currentTime)
  captureToKeyframe(binding)
  undoStack.push('+ KF (live)')
})

function updateAddLiveBtnState (): void {
  // Only enabled strictly between first and last keys (not on one). Outside
  // that range we'd just duplicate an endpoint; on a key, replace is ambiguous.
  const frame = currentTime * FPS
  const all = allKeyframeFrames()
  if (all.length < 2) { addLiveBtn.disabled = true; return }
  const first = all[0]
  const last = all[all.length - 1]
  const onExisting = all.some((f) => Math.abs(f - frame) < 1e-3)
  addLiveBtn.disabled = onExisting || frame <= first + 1e-3 || frame >= last - 1e-3
}

clearBtn.addEventListener('click', () => {
  action.fcurves.length = 0
  delete action.metadata
  delete action.pathFollow
  onKeyframesChanged()
  undoStack.push('clear all')
})

endFrameInput.addEventListener('change', () => {
  const v = parseInt(endFrameInput.value, 10)
  if (Number.isFinite(v)) setEndFrame(v)
})

previewToggle.addEventListener('change', syncCamHelperVisibility)
showHelperToggle.addEventListener('change', syncCamHelperVisibility)

playBtn.addEventListener('click', () => {
  if (isPlaying) {
    stopPlayback()
    return
  }
  if (uniqueKeyframeFrames().length < 2) return
  isPlaying = true
  if (currentTime >= duration - 1e-3) currentTime = 0
  playBtn.textContent = '⏸'
  playBtn.title = 'Pause'
})
const prevKeyBtn = document.getElementById('prev-key') as HTMLButtonElement
const nextKeyBtn = document.getElementById('next-key') as HTMLButtonElement

function jumpToPrevKeyframe (): void {
  const frames = allKeyframeFrames()
  const cur = currentTime * FPS
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i] < cur - 1e-3) { seekToFrame(frames[i]); return }
  }
}
function jumpToNextKeyframe (): void {
  const frames = allKeyframeFrames()
  const cur = currentTime * FPS
  for (const f of frames) {
    if (f > cur + 1e-3) { seekToFrame(f); return }
  }
}
prevKeyBtn.addEventListener('click', jumpToPrevKeyframe)
nextKeyBtn.addEventListener('click', jumpToNextKeyframe)

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'ArrowDown') { jumpToPrevKeyframe(); e.preventDefault() }
  else if (e.key === 'ArrowUp') { jumpToNextKeyframe(); e.preventDefault() }
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'k' || e.key === 'K') {
    if (e.target instanceof HTMLInputElement) return
    addBtn.click()
    e.preventDefault()
  }
})
resetBtn.addEventListener('click', () => {
  currentTime = 0
  binding.evaluate(0)
  updateTimeReadout()
  timeline.refresh()
  stopPlayback()
})

loadJsonBtn.addEventListener('click', () => loadJsonInput.click())

loadJsonInput.addEventListener('change', () => {
  const file = loadJsonInput.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      const imported = importCameraActionFromJson(parsed)
      action.fcurves.length = 0
      for (const fcu of imported.fcurves) action.fcurves.push(fcu)
      action.fps = imported.fps
      // Replace metadata wholesale so stale markers/constraints don't persist.
      if (imported.metadata) action.metadata = imported.metadata
      else delete action.metadata
      graph.reset()
      onKeyframesChanged()
      panel.refresh()
      stopPlayback()
      currentTime = 0
      updateTimeReadout()
      timeline.refresh()
      undoStack.push('load JSON')
    } catch (e) {
      console.error('[dollycurve] Load failed:', e)
      alert('Load failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  reader.readAsText(file)
  loadJsonInput.value = ''
})

saveJsonBtn.addEventListener('click', () => {
  const json = exportCameraActionToJson(action)
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'camera_animation.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
})

function stopPlayback (): void {
  isPlaying = false
  playBtn.textContent = '▶'
  playBtn.title = 'Play'
}

function onResize (): void {
  const w = host.clientWidth
  const h = host.clientHeight
  if (w === 0 || h === 0) return
  renderer.setSize(w, h)
  editorCam.aspect = w / h
  editorCam.updateProjectionMatrix()
  previewCam.aspect = w / h
  previewCam.updateProjectionMatrix()
}
window.addEventListener('resize', onResize)
// Panel show/hide changes viewport size without firing window resize.
new ResizeObserver(onResize).observe(host)

const clock = new THREE.Clock()
function tick (): void {
  const dt = clock.getDelta()
  if (isPlaying && uniqueKeyframeFrames().length >= 2) {
    currentTime += dt
    if (currentTime >= duration) {
      currentTime = duration
      stopPlayback()
    }
    binding.evaluate(currentTime)
    updateTimeReadout()
    timeline.refresh()
    graph.redraw()
  }
  controls.update()
  // previewCam isn't in scene.children, so renderer.render() doesn't
  // auto-recompute its matrixWorld. Sync explicitly each frame so the
  // ghost helper (parented to a smaller stand-in camera) follows the
  // real cam's pose without inheriting its far-plane line lengths.
  previewCam.updateMatrixWorld(true)
  syncPreviewGhost()
  updateAddLiveBtnState()
  maybePersistUIStateOnTick()
  const activeCam = previewToggle.checked ? previewCam : editorCam
  renderer.render(scene, activeCam)
  requestAnimationFrame(tick)
}

// ---- Path mode ----

let pathEditor: ScenePathEditor | null = null

function defaultSpline () {
  return makeSplinePath([
    makeSplinePoint([-3,  1.5,  3], [1, 0, 0]),
    makeSplinePoint([ 0,  2.5,  0], [1, 0, -1]),
    makeSplinePoint([ 3,  1.5, -3], [1, 0, -1]),
  ])
}

// Without this, the default s=frame fallback traverses the full path in ~10 frames.
function makeLinearSpeedCurve (totalLen: number, endFrame: number): ReturnType<typeof makeFCurve> {
  return makeFCurve('__path_speed', [
    makeBezTriple(0,        0,        { ipo: Interpolation.LINEAR }),
    makeBezTriple(endFrame, totalLen, { ipo: Interpolation.LINEAR }),
  ])
}

function enterPathMode (): void {
  if (pathEditor) return
  if (!action.pathFollow) {
    action.pathFollow = makePathFollowConstraint(defaultSpline(), {
      orientation: 'tangent',
      upAxis: 'Y',
      arcLengthUniform: true,
    })
  }
  const arc = buildArcTable(action.pathFollow.splinePath)
  action.pathFollow.speedCurve = makeLinearSpeedCurve(arc.totalLen, endFrame)

  pathEditor = new ScenePathEditor(action.pathFollow.splinePath, {
    scene,
    camera: editorCam,
    dom: renderer.domElement,
    path: action.pathFollow.splinePath,
    onChanged: () => {
      if (action.pathFollow) {
        const a = buildArcTable(action.pathFollow.splinePath)
        action.pathFollow.speedCurve = makeLinearSpeedCurve(a.totalLen, endFrame)
      }
      onKeyframesChanged()
    },
  })
  pathControls.style.display = ''
}

function exitPathMode (): void {
  if (pathEditor) {
    pathEditor.destroy()
    pathEditor = null
  }
  pathControls.style.display = 'none'
}

pathModeToggle.addEventListener('change', () => {
  if (pathModeToggle.checked) enterPathMode()
  else exitPathMode()
})

bakePathBtn.addEventListener('click', () => {
  if (!action.pathFollow) return
  const targetCount = Math.max(2, parseInt(bakeCountInput.value, 10) || 20)
  bakePathToFCurves(action, { startFrame: 0, endFrame: endFrame, targetCount })
  exitPathMode()
  pathModeToggle.checked = false
  onKeyframesChanged()
  panel.refresh()
  undoStack.push('bake path → fcurves')
})

fitPathBtn.addEventListener('click', () => {
  try {
    const targetCount = Math.max(2, parseInt(fitCountInput.value, 10) || 5)
    const path = fitFCurvesToPath(action, { consumeFCurves: true, targetCount })
    action.pathFollow = makePathFollowConstraint(path, {
      orientation: 'tangent', upAxis: 'Y', arcLengthUniform: true,
    })
    onKeyframesChanged()
    panel.refresh()
    if (!pathEditor) {
      pathModeToggle.checked = true
      enterPathMode()
    } else {
      exitPathMode()
      pathModeToggle.checked = true
      enterPathMode()
    }
    undoStack.push('fit fcurves → path')
  } catch (e) {
    alert('Fit failed: ' + (e instanceof Error ? e.message : String(e)))
  }
})

// ---- Gizmo toolbar wiring ----------------------------------------------

function setGizmoMode (mode: 'translate' | 'rotate'): void {
  gizmo.setMode(mode)
  gizmoTranslateRadio.checked = mode === 'translate'
  gizmoRotateRadio.checked = mode === 'rotate'
}

function setGizmoEnabled (on: boolean): void {
  gizmoEnabled = on
  gizmoEnableCheckbox.checked = on
  gizmoRadiosEl.classList.toggle('disabled', !on)
  if (!on) selectKeyframeHelper(null)
}

gizmoEnableCheckbox.addEventListener('change', () => setGizmoEnabled(gizmoEnableCheckbox.checked))
gizmoTranslateRadio.addEventListener('change', () => { if (gizmoTranslateRadio.checked) setGizmoMode('translate') })
gizmoRotateRadio.addEventListener('change', () => { if (gizmoRotateRadio.checked) setGizmoMode('rotate') })

// ---- Undo / redo buttons + shortcuts ----
undoBtn.addEventListener('click', () => undoStack.undo())
redoBtn.addEventListener('click', () => undoStack.redo())
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    if (e.shiftKey) undoStack.redo()
    else undoStack.undo()
    e.preventDefault()
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
    undoStack.redo()
    e.preventDefault()
  }
})

setEndFrame(endFrame)
tick()
