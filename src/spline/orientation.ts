// Stable orientation along a spline via parallel transport.
// Pure Frenet frames flip at zero-curvature points (straight stretches,
// inflections); parallel transport instead carries an "up" reference forward
// by the smallest rotation aligning successive tangents, yielding a
// continuous frame across the whole curve.

import { PathFollowConstraint, SplinePath, Vec3 } from '../data/types'
import { pathTangent, segmentCount } from './bezier3d'

export interface OrientationFrame {
  pos: Vec3
  forward: Vec3        // unit tangent
  up: Vec3             // unit up (parallel-transported)
  right: Vec3          // forward × up
}

function cross (a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}
function dot (a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function norm (a: Vec3): number { return Math.hypot(a[0], a[1], a[2]) }
function normalize (a: Vec3): Vec3 {
  const n = norm(a)
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0]
}
function add (a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function scale (a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s] }
function sub (a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }

function seedUp (axis: PathFollowConstraint['upAxis']): Vec3 {
  if (axis === 'X') return [1, 0, 0]
  if (axis === 'Y') return [0, 1, 0]
  if (axis === 'Z') return [0, 0, 1]
  return normalize(axis)
}

// Rotate v by the short-arc rotation taking unit a -> unit b (Rodrigues).
// Handles a == b and a == -b (180° flip) without singularity.
function rotateBetween (v: Vec3, a: Vec3, b: Vec3): Vec3 {
  const c = dot(a, b)
  if (c >= 1 - 1e-9) return v
  if (c <= -1 + 1e-9) {
    const axisCandidate: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const axis = normalize(cross(a, axisCandidate))
    // Rodrigues for 180°: v' = 2*(axis·v)*axis - v
    const k = 2 * dot(axis, v)
    return [axis[0] * k - v[0], axis[1] * k - v[1], axis[2] * k - v[2]]
  }
  const axis = cross(a, b)
  const s = norm(axis)
  if (s === 0) return v
  const unit = scale(axis, 1 / s)
  const cosT = c
  const sinT = s
  const term1 = scale(v, cosT)
  const term2 = scale(cross(unit, v), sinT)
  const term3 = scale(unit, dot(unit, v) * (1 - cosT))
  return add(add(term1, term2), term3)
}

/** Compute parallel-transported orientation frames at uniformly spaced
 * parameter values along the path. Returns N frames where N = numSamples. */
export function buildFrames (
  path: SplinePath,
  upAxis: PathFollowConstraint['upAxis'],
  numSamples: number,
): OrientationFrame[] {
  const segs = segmentCount(path)
  if (segs === 0) {
    return [{ pos: [0, 0, 0], forward: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] }]
  }
  const frames: OrientationFrame[] = []
  let prevTan: Vec3 = pathTangent(path, 0)
  let up: Vec3 = seedUp(upAxis)
  up = normalize(sub(up, scale(prevTan, dot(up, prevTan))))
  if (norm(up) < 1e-6) {
    // seed upAxis was parallel to tangent; pick an arbitrary perpendicular
    up = Math.abs(prevTan[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    up = normalize(sub(up, scale(prevTan, dot(up, prevTan))))
  }

  for (let i = 0; i < numSamples; i++) {
    const u = (i / Math.max(1, numSamples - 1)) * segs
    const tan = pathTangent(path, u)
    if (i > 0) {
      up = rotateBetween(up, prevTan, tan)
      up = normalize(sub(up, scale(tan, dot(up, tan))))  // re-orthogonalize against drift
    }
    const right = normalize(cross(tan, up))
    frames.push({ pos: [0, 0, 0], forward: tan, up, right })
    prevTan = tan
  }

  // Cyclic seam-roll redistribution (curve.cc:2248-2309). On closed paths,
  // non-zero torsion means the transported up at the last sample doesn't
  // match the seed at the first; distribute the residual angle linearly
  // across all samples to avoid a visible jolt at the seam.
  if (path.closed && frames.length >= 3) {
    const last = frames[frames.length - 1]
    const first = frames[0]
    const lastUpInFirstPlane = rotateBetween(last.up, last.forward, first.forward)
    const renorm = normalize(sub(lastUpInFirstPlane, scale(first.forward, dot(lastUpInFirstPlane, first.forward))))
    let cosA = dot(renorm, first.up)
    if (cosA > 1) cosA = 1
    if (cosA < -1) cosA = -1
    let angle = Math.acos(cosA)
    // Sign: if cross(renorm, first.up) aligns with first.forward, residual
    // is "renorm rotated by +angle to reach first.up" — apply -angle*frac
    // walking forward to undo.
    const sgn = dot(cross(renorm, first.up), first.forward)
    if (sgn < 0) angle = -angle
    if (Math.abs(angle) > 1e-6) {
      const N = frames.length
      for (let i = 0; i < N; i++) {
        const fac = (angle * i) / (N - 1)
        if (fac === 0) continue
        const f = frames[i]
        const c = Math.cos(fac), s = Math.sin(fac)
        // Rodrigues rotation of `up` around unit `forward` by `fac`
        const k = dot(f.forward, f.up)
        f.up = [
          f.up[0] * c + (f.forward[1] * f.up[2] - f.forward[2] * f.up[1]) * s + f.forward[0] * k * (1 - c),
          f.up[1] * c + (f.forward[2] * f.up[0] - f.forward[0] * f.up[2]) * s + f.forward[1] * k * (1 - c),
          f.up[2] * c + (f.forward[0] * f.up[1] - f.forward[1] * f.up[0]) * s + f.forward[2] * k * (1 - c),
        ]
        f.up = normalize(f.up)
        f.right = normalize(cross(f.forward, f.up))
      }
    }
  }

  return frames
}

/** Sample a single frame at parameter u. Walks from 0 each call; for
 * many samples cache buildFrames() results instead. */
export function frameAtU (
  path: SplinePath,
  upAxis: PathFollowConstraint['upAxis'],
  u: number,
  numSeedSteps = 16,
): OrientationFrame {
  const segs = segmentCount(path)
  if (segs === 0 || u <= 0) {
    const t = pathTangent(path, 0)
    let up = seedUp(upAxis)
    up = normalize(sub(up, scale(t, dot(up, t))))
    if (norm(up) < 1e-6) up = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    return { pos: [0, 0, 0], forward: t, up, right: normalize(cross(t, up)) }
  }
  let prevTan = pathTangent(path, 0)
  let up = seedUp(upAxis)
  up = normalize(sub(up, scale(prevTan, dot(up, prevTan))))
  if (norm(up) < 1e-6) up = Math.abs(prevTan[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  for (let i = 1; i <= numSeedSteps; i++) {
    const sub_u = (i / numSeedSteps) * u
    const tan = pathTangent(path, sub_u)
    up = rotateBetween(up, prevTan, tan)
    up = normalize(sub(up, scale(tan, dot(up, tan))))
    prevTan = tan
  }
  return {
    pos: [0, 0, 0],
    forward: prevTan,
    up,
    right: normalize(cross(prevTan, up)),
  }
}

/** Convert a frame (forward, up, right) to a quaternion rotating the
 * Three.js camera default basis (forward = -Z, up = +Y) onto the path frame. */
export function frameToQuaternion (frame: OrientationFrame, additionalRoll = 0): [number, number, number, number] {
  // M's columns are the world-space basis of the camera's local frame.
  // Three.js cameras face -Z, so camera-local +Z is opposite the tangent;
  // hence column 2 = -forward.
  const f = frame.forward
  const u = frame.up
  const r = frame.right
  const m00 = r[0], m01 = u[0], m02 = -f[0]
  const m10 = r[1], m11 = u[1], m12 = -f[1]
  const m20 = r[2], m21 = u[2], m22 = -f[2]

  // Matrix → quaternion via Shepperd's method
  const trace = m00 + m11 + m22
  let qx: number, qy: number, qz: number, qw: number
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2
    qw = 0.25 * s
    qx = (m21 - m12) / s
    qy = (m02 - m20) / s
    qz = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2
    qw = (m21 - m12) / s
    qx = 0.25 * s
    qy = (m01 + m10) / s
    qz = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2
    qw = (m02 - m20) / s
    qx = (m01 + m10) / s
    qy = 0.25 * s
    qz = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2
    qw = (m10 - m01) / s
    qx = (m02 + m20) / s
    qy = (m12 + m21) / s
    qz = 0.25 * s
  }

  // Additional roll around the tangent (world-space axis = forward).
  if (additionalRoll !== 0) {
    const half = additionalRoll / 2
    const c = Math.cos(half), s = Math.sin(half)
    const rqx = f[0] * s, rqy = f[1] * s, rqz = f[2] * s, rqw = c
    // q = roll * q
    const x = rqw * qx + rqx * qw + rqy * qz - rqz * qy
    const y = rqw * qy - rqx * qz + rqy * qw + rqz * qx
    const z = rqw * qz + rqx * qy - rqy * qx + rqz * qw
    const w = rqw * qw - rqx * qx - rqy * qy - rqz * qz
    qx = x; qy = y; qz = z; qw = w
  }

  return [qx, qy, qz, qw]
}
