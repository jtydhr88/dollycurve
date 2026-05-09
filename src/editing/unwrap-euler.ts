import { CameraAction, FCurve } from '../data/types'

/**
 * "Unwrap" an Euler-rotation FCurve so adjacent keys never differ by more
 * than π. A fresh quaternion→Euler decompose can flip sign across ±180°
 * (e.g. 179° → -179°), causing linear interpolation to take the long way
 * around. We walk keys in time order and shift by ±2π whenever |delta| > π.
 * Idempotent: re-running on unwrapped data is a no-op.
 */
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
    if (fcu.rnaPath !== 'rotation_euler' && fcu.rnaPath !== 'rotation_quaternion') continue
    if (fcu.rnaPath === 'rotation_quaternion') continue  // quaternions don't wrap the same way
    total += unwrapEulerFCurve(fcu)
  }
  return total
}
