import { CameraAction, FCurve } from '../data/types'

/**
 * Unwrap an Euler FCurve so adjacent keys never differ by more than π.
 * Without this, a quat→Euler decompose can flip sign across ±180° (e.g.
 * 179° → -179°) and linear interp takes the long way around. Idempotent. */
export function unwrapEulerFCurve (fcu: FCurve): number {
  if (fcu.bezt.length < 2) return 0
  let adjustments = 0
  for (let i = 1; i < fcu.bezt.length; i++) {
    const prev = fcu.bezt[i - 1].vec[1][1]
    let curr = fcu.bezt[i].vec[1][1]
    while (curr - prev > Math.PI) {
      shiftKey(fcu.bezt[i], -2 * Math.PI)
      curr -= 2 * Math.PI
      adjustments++
    }
    while (curr - prev < -Math.PI) {
      shiftKey(fcu.bezt[i], 2 * Math.PI)
      curr += 2 * Math.PI
      adjustments++
    }
  }
  return adjustments
}

function shiftKey (bezt: { vec: [[number, number], [number, number], [number, number]] }, dy: number): void {
  bezt.vec[0][1] += dy
  bezt.vec[1][1] += dy
  bezt.vec[2][1] += dy
}

/** Apply unwrap to all rotation_euler channels in an action. */
export function unwrapEulerInAction (action: CameraAction): number {
  let total = 0
  for (const fcu of action.fcurves) {
    if (fcu.rnaPath !== 'rotation_euler') continue
    total += unwrapEulerFCurve(fcu)
  }
  return total
}

/**
 * Re-align rotation_quaternion FCurves so neighbors stay on the same
 * hemisphere. q and -q are the same orientation, but a sign flip between
 * keys makes component-wise interpolation take the long way (360° spin).
 * Idempotent. */
export function alignQuaternionHemisphere (action: CameraAction): number {
  const q: (FCurve | null)[] = [null, null, null, null]
  for (const fcu of action.fcurves) {
    if (fcu.rnaPath === 'rotation_quaternion' && fcu.arrayIndex >= 0 && fcu.arrayIndex <= 3) {
      q[fcu.arrayIndex] = fcu
    }
  }
  if (!q[0] || !q[1] || !q[2] || !q[3]) return 0
  // Skip if the four FCurves don't share a key schedule — bake-path produces
  // aligned shapes, but a manual edit could break it; better to skip than corrupt.
  const N = q[0].bezt.length
  if (q[1].bezt.length !== N || q[2].bezt.length !== N || q[3].bezt.length !== N) return 0
  let flips = 0
  for (let i = 1; i < N; i++) {
    const dot = q[0].bezt[i - 1].vec[1][1] * q[0].bezt[i].vec[1][1]
              + q[1].bezt[i - 1].vec[1][1] * q[1].bezt[i].vec[1][1]
              + q[2].bezt[i - 1].vec[1][1] * q[2].bezt[i].vec[1][1]
              + q[3].bezt[i - 1].vec[1][1] * q[3].bezt[i].vec[1][1]
    if (dot < 0) {
      for (const fcu of q) {
        if (!fcu) continue
        const b = fcu.bezt[i]
        b.vec[0][1] = -b.vec[0][1]
        b.vec[1][1] = -b.vec[1][1]
        b.vec[2][1] = -b.vec[2][1]
      }
      flips++
    }
  }
  return flips
}
