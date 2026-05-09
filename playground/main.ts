import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  CameraTrackBinding,
  GraphEditor,
  Interpolation,
  SimplePanel,
  Timeline,
  evaluateFCurve,
  exportCameraActionToJson,
  importCameraActionFromJson,
  insertScalarKey,
  insertVec3Key,
  makeCameraAction,
} from 'dollycurve'
import type { FCurve, SharedXView } from 'dollycurve'

const host = document.getElementById('canvas-host') as HTMLDivElement
const endFrameInput = document.getElementById('end-frame') as HTMLInputElement
const previewToggle = document.getElementById('preview-toggle') as HTMLInputElement
const addBtn = document.getElementById('add-kf') as HTMLButtonElement
const clearBtn = document.getElementById('clear-kf') as HTMLButtonElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const resetBtn = document.getElementById('reset-time') as HTMLButtonElement
const timeReadout = document.getElementById('time-readout') as HTMLSpanElement
const timelineHost = document.getElementById('timeline-host') as HTMLDivElement
const kfList = document.getElementById('keyframes') as HTMLDivElement
const loadJsonBtn = document.getElementById('load-json') as HTMLButtonElement
const saveJsonBtn = document.getElementById('save-json') as HTMLButtonElement
const loadJsonInput = document.getElementById('load-json-input') as HTMLInputElement
const graphHost = document.getElementById('graph-host') as HTMLDivElement
const graphBottom = document.getElementById('graph-bottom') as HTMLDivElement
const toggleGraphBtn = document.getElementById('toggle-graph') as HTMLButtonElement

const FPS = 24
const SENSOR_HEIGHT_MM = 24

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(host.clientWidth, host.clientHeight)
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a1a)
scene.fog = new THREE.Fog(0x1a1a1a, 30, 80)

const editorCam = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 200)
editorCam.position.set(8, 6, 12)
editorCam.lookAt(0, 0, 0)

const previewCam = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 200)
previewCam.position.set(0, 2, 8)

const controls = new OrbitControls(editorCam, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 1, 0)

scene.add(new THREE.AmbientLight(0xffffff, 0.4))
const sun = new THREE.DirectionalLight(0xffffff, 1.0)
sun.position.set(10, 20, 8)
scene.add(sun)
scene.add(new THREE.GridHelper(40, 40, 0x444444, 0x2a2a2a))
scene.add(new THREE.AxesHelper(2))

const refMaterials = [0xff5555, 0x55aaff, 0xffd166, 0x55cc88, 0xc879ff]
const refPositions: [number, number, number][] = [
  [0, 1, 0], [4, 0.5, 2], [-3, 1.5, -1], [2, 2, -4], [-4, 0.5, 3],
]
refPositions.forEach((p, i) => {
  const geom = i % 2 === 0 ? new THREE.BoxGeometry(1.5, p[1] * 2, 1.5) : new THREE.SphereGeometry(0.9, 24, 16)
  const mat = new THREE.MeshStandardMaterial({ color: refMaterials[i % refMaterials.length], roughness: 0.5 })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(p[0], p[1], p[2])
  scene.add(mesh)
})

const action = makeCameraAction([], FPS)
const binding = new CameraTrackBinding(previewCam, action, {
  sensorHeight: SENSOR_HEIGHT_MM,
  eulerOrder: 'XYZ',
})
const editorBinding = new CameraTrackBinding(editorCam, action, {
  sensorHeight: SENSOR_HEIGHT_MM,
  eulerOrder: 'XYZ',
})

// End-frame is the source of truth (Blender convention: scene.frame_end).
// `duration` (in seconds) is derived from it for the playback loop and the
// CameraTrackBinding which evaluates time, not frames.
let endFrame = parseInt(endFrameInput.value, 10)
let duration = endFrame / FPS
let currentTime = 0
let isPlaying = false

const kfHelperGroup = new THREE.Group()
scene.add(kfHelperGroup)
const previewCamHelper = new THREE.CameraHelper(previewCam)
previewCamHelper.visible = false
scene.add(previewCamHelper)

function locXCurve (): FCurve | undefined {
  return action.fcurves.find((f) => f.rnaPath === 'location' && f.arrayIndex === 0)
}

function uniqueKeyframeFrames (): number[] {
  const fcu = locXCurve()
  if (!fcu) return []
  return fcu.bezt.map((b) => b.vec[1][0])
}

// All keyframe times across all fcurves, deduped + sorted. Used by the
// prev/next-keyframe jump buttons (Blender's SCREEN_OT_keyframe_jump,
// screen_ops.cc:3829 — aggregates a keylist from the editor's data).
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
  return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x6cf }))
}

function rebuildHelpers (): void {
  while (kfHelperGroup.children.length > 0) {
    const c = kfHelperGroup.children.pop()!
    if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry?.dispose?.()
  }

  const frames = uniqueKeyframeFrames()
  for (const frame of frames) {
    // Snapshot pose at this keyframe by evaluating into a throwaway camera.
    const dummy = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1.5)
    const dummyBinding = new CameraTrackBinding(dummy, action, {
      sensorHeight: SENSOR_HEIGHT_MM,
      eulerOrder: 'XYZ',
    })
    dummyBinding.evaluate(frame / FPS)
    dummy.updateMatrixWorld(true)
    const helper = new THREE.CameraHelper(dummy)
    ;(helper.material as THREE.LineBasicMaterial).color.set(0xffd54a)
    kfHelperGroup.add(helper)
  }

  const line = buildPathLine()
  if (line) kfHelperGroup.add(line)
}

// Shared X view between Timeline and GraphEditor — pan/zoom on either side
// stays in lock-step. Initial range covers the configured frame range.
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

function updateTimeReadout (): void {
  const frame = Math.round(currentTime * FPS)
  timeReadout.textContent = `${frame} / ${endFrame}  ·  ${currentTime.toFixed(2)}s`
}

function setEndFrame (frames: number): void {
  endFrame = Math.max(1, Math.round(frames))
  duration = endFrame / FPS
  if (currentTime > duration) currentTime = duration
  // Expand the timeline view to show at least up to the new end frame.
  if (sharedX.xMax < endFrame) {
    sharedX.xMax = endFrame
    onSharedXChanged()
  }
  rebuildHelpers()
  updateTimeReadout()
}

addBtn.addEventListener('click', () => {
  const frame = currentTime * FPS
  const captured = editorBinding.captureFromCamera()
  insertVec3Key(action, 'location', frame, captured.location, { ipo: Interpolation.BEZIER })
  insertVec3Key(action, 'rotation_euler', frame, captured.rotation_euler, { ipo: Interpolation.BEZIER })
  insertScalarKey(action, 'lens', frame, captured.lens, { ipo: Interpolation.BEZIER })
  onKeyframesChanged()
})

clearBtn.addEventListener('click', () => {
  action.fcurves.length = 0
  onKeyframesChanged()
})

endFrameInput.addEventListener('change', () => {
  const v = parseInt(endFrameInput.value, 10)
  if (Number.isFinite(v)) setEndFrame(v)
})

previewToggle.addEventListener('change', () => {
  previewCamHelper.visible = !previewToggle.checked
})

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

// Strict-inequality jump (matches Blender behaviour at screen_ops.cc:3865-3888).
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

// Up / Down arrows: same as Blender's keyframe_jump operator.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'ArrowDown') { jumpToPrevKeyframe(); e.preventDefault() }
  else if (e.key === 'ArrowUp') { jumpToNextKeyframe(); e.preventDefault() }
})

// K = capture keyframe @ current time (Blender shortcut).
window.addEventListener('keydown', (e) => {
  if (e.key === 'k' || e.key === 'K') {
    if (e.target instanceof HTMLInputElement) return  // don't intercept text edits
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
      // Replace metadata wholesale — markers, subjectTarget, constraints
      // belong to the loaded action. Without this, stale markers from
      // a previously-loaded JSON would persist.
      if (imported.metadata) action.metadata = imported.metadata
      else delete action.metadata
      // Drop GraphEditor's per-action interactive state (activeFCurveIdx,
      // selection, activeKey) — those indices refer to the old fcurves.
      graph.reset()
      onKeyframesChanged()
      panel.refresh()
      stopPlayback()
      currentTime = 0
      updateTimeReadout()
      timeline.refresh()
    } catch (e) {
      console.error('[camera-keyframe-poc] Load failed:', e)
      alert('Load failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  reader.readAsText(file)
  loadJsonInput.value = ''  // allow re-loading the same file
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
// Tiled grid layout: when bottom or sidebar panels show/hide/resize, the
// viewport cell changes size without a window-resize event. Watch the
// host element directly so the renderer always matches its container.
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
  const activeCam = previewToggle.checked ? previewCam : editorCam
  renderer.render(scene, activeCam)
  requestAnimationFrame(tick)
}

setEndFrame(endFrame)
tick()
