// Port of Blender's CONTINUOUS_ACCELERATION smoothing second pass
// (curve.cc:3380-3945, math_solvers.cc:55-160). Tridiagonal solve so the
// second derivative is continuous at every AUTO/AUTO_ANIM keyframe.
//
// Input contract: first pass (recalcHandle / recalcAllHandles in handles.ts)
// already ran. `lockedFinal[i]===true` (AUTO_CLAMPED clamp fired or edge-ease
// flattened) excludes that point — its handles are taken as fixed.

import { HandleType } from '../data/enums'
import { BezTriple, FCurve } from '../data/types'

const EPS = 1e-12
const HD_AUTO = HandleType.AUTO
const HD_AUTO_ANIM = HandleType.AUTO_CLAMPED
const HD_VECT = HandleType.VECTOR
const HD_ALIGN = HandleType.ALIGN

function isFreeAutoPoint (bezt: BezTriple, locked: boolean): boolean {
  if (locked) return false
  return (bezt.h1 === HD_AUTO || bezt.h1 === HD_AUTO_ANIM) &&
         (bezt.h2 === HD_AUTO || bezt.h2 === HD_AUTO_ANIM)
}

function isAutoOrAnim (h: HandleType): boolean {
  return h === HD_AUTO || h === HD_AUTO_ANIM
}

// Tridiagonal solvers (math_solvers.cc:55-160)

function tridiagonalSolve (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  x: Float64Array, n: number,
): boolean {
  if (n < 1) return false
  const c1 = new Float64Array(n)
  const d1 = new Float64Array(n)
  let cPrev = c[0] / b[0]
  let dPrev = d[0] / b[0]
  c1[0] = cPrev
  d1[0] = dPrev
  for (let i = 1; i < n; i++) {
    const denom = b[i] - a[i] * cPrev
    cPrev = c[i] / denom
    dPrev = (d[i] - a[i] * dPrev) / denom
    c1[i] = cPrev
    d1[i] = dPrev
  }
  let xPrev = dPrev
  x[n - 1] = xPrev
  for (let i = n - 2; i >= 0; i--) {
    xPrev = d1[i] - c1[i] * xPrev
    x[i] = xPrev
  }
  return Number.isFinite(xPrev)
}

function tridiagonalSolveCyclic (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  x: Float64Array, n: number,
): boolean {
  if (n < 1) return false
  if (n === 1) {
    x[0] = d[0] / (a[0] + b[0] + c[0])
    return Number.isFinite(x[0])
  }
  if (n === 2) {
    const a2 = new Float64Array([0, a[1] + c[1]])
    const c2 = new Float64Array([a[0] + c[0], 0])
    return tridiagonalSolve(a2, b, c2, d, x, n)
  }

  const a0 = a[0], cN = c[n - 1]
  if (a0 === 0 && cN === 0) {
    return tridiagonalSolve(a, b, c, d, x, n)
  }

  const b2 = new Float64Array(b)
  b2[0]     -= a0
  b2[n - 1] -= cN
  const tmp = new Float64Array(n)
  tmp[0]     = a0
  tmp[n - 1] = cN

  const okTmp = tridiagonalSolve(a, b2, c, tmp, tmp, n)
  const okX = tridiagonalSolve(a, b2, c, d, x, n)
  if (!okTmp || !okX) return false

  const denom = 1 + tmp[0] + tmp[n - 1]
  const coeff = (x[0] + x[n - 1]) / denom
  for (let i = 0; i < n; i++) x[i] -= coeff * tmp[i]
  return true
}

// Equation builders (curve.cc:3596-3625)

function bezierEqContinuous (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  dy: Float64Array, l: Float64Array, i: number,
): void {
  a[i] = l[i] * l[i]
  b[i] = 2 * (l[i] + 1)
  c[i] = 1 / l[i + 1]
  d[i] = dy[i] * l[i] * l[i] + dy[i + 1]
}

function bezierEqNoAccelRight (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  dy: Float64Array, l: Float64Array, i: number,
): void {
  a[i] = 0
  b[i] = 2
  c[i] = 1 / l[i + 1]
  d[i] = dy[i + 1]
}

function bezierEqNoAccelLeft (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  dy: Float64Array, l: Float64Array, i: number,
): void {
  a[i] = l[i] * l[i]
  b[i] = 2 * l[i]
  c[i] = 0
  d[i] = dy[i] * l[i] * l[i]
}

function bezierLockUnknown (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  i: number, value: number,
): void {
  a[i] = c[i] = 0
  b[i] = 1
  d[i] = value
}

function bezierClamp (
  hmax: Float64Array, hmin: Float64Array, i: number,
  dy: number, noReverse: boolean, noOvershoot: boolean,
): void {
  if (dy > 0) {
    if (noOvershoot) hmax[i] = Math.min(hmax[i], dy)
    if (noReverse)   hmin[i] = 0
  } else if (dy < 0) {
    if (noReverse)   hmax[i] = 0
    if (noOvershoot) hmin[i] = Math.max(hmin[i], dy)
  } else if (noReverse || noOvershoot) {
    hmax[i] = hmin[i] = 0
  }
}

function bezierRelaxDirection (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  h: Float64Array, i: number, n: number,
): number {
  const im1 = (i + n - 1) % n
  const ip1 = (i + 1) % n
  const state = a[i] * h[im1] + b[i] * h[i] + c[i] * h[ip1] - d[i]
  return -state * b[i]
}

function tridiagonalSolveWithLimits (
  a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array,
  h: Float64Array, hmin: Float64Array, hmax: Float64Array, n: number,
): boolean {
  const a0 = new Float64Array(a)
  const b0 = new Float64Array(b)
  const c0 = new Float64Array(c)
  const d0 = new Float64Array(d)
  const isLocked = new Uint8Array(n)
  const numUnlocks = new Uint8Array(n)

  let overshoot: boolean, unlocked: boolean
  do {
    if (!tridiagonalSolveCyclic(a, b, c, d, h, n)) return false

    let all = false, locked = false
    overshoot = false; unlocked = false

    do {
      for (let i = 0; i < n; i++) {
        if (h[i] >= hmin[i] && h[i] <= hmax[i]) continue
        overshoot = true
        const target = h[i] > hmax[i] ? hmax[i] : hmin[i]
        if (target !== 0 || all) {
          isLocked[i] = 1
          bezierLockUnknown(a, b, c, d, i, target)
          locked = true
        }
      }
      all = true
    } while (overshoot && !locked)

    if (!locked) {
      for (let i = 0; i < n; i++) {
        if (!isLocked[i] || numUnlocks[i] >= 2) continue
        const relax = bezierRelaxDirection(a0, b0, c0, d0, h, i, n)
        if ((relax > 0 && h[i] < hmax[i]) || (relax < 0 && h[i] > hmin[i])) {
          a[i] = a0[i]; b[i] = b0[i]; c[i] = c0[i]; d[i] = d0[i]
          isLocked[i] = 0
          numUnlocks[i]++
          unlocked = true
        }
      }
    }
  } while (overshoot || unlocked)

  return true
}

// Mirrors bezier_output_handle_inner (curve.cc:3658-3695). Writes vec[idx]
// (right=true → 2 else 0) and fixes the partner side per its handle type.
// 2D only — fcurves don't use a Z component.
function outputHandleInner (bezt: BezTriple, right: boolean, newY: number, endpoint: boolean): void {
  const idx = right ? 2 : 0
  const partnerIdx = right ? 0 : 2
  const hr = right ? bezt.h2 : bezt.h1
  const hm = right ? bezt.h1 : bezt.h2

  if (hr !== HD_AUTO && hr !== HD_AUTO_ANIM && hr !== HD_VECT) return

  bezt.vec[idx][1] = newY

  if (hm === HD_ALIGN) {
    // ALIGN: keep partner at same magnitude on opposite side of anchor
    const ax = bezt.vec[1][0], ay = bezt.vec[1][1]
    const partnerLen = Math.hypot(bezt.vec[partnerIdx][0] - ax, bezt.vec[partnerIdx][1] - ay)
    const newLen = Math.hypot(bezt.vec[idx][0] - ax, bezt.vec[idx][1] - ay)
    if (newLen > EPS) {
      const f = partnerLen / newLen
      bezt.vec[partnerIdx][0] = ax - f * (bezt.vec[idx][0] - ax)
      bezt.vec[partnerIdx][1] = ay - f * (bezt.vec[idx][1] - ay)
    }
  } else if (endpoint && (hm === HD_AUTO || hm === HD_AUTO_ANIM || hm === HD_VECT)) {
    // endpoint: mirror through anchor
    const ax = bezt.vec[1][0], ay = bezt.vec[1][1]
    bezt.vec[partnerIdx][0] = ax - (bezt.vec[idx][0] - ax)
    bezt.vec[partnerIdx][1] = ay - (bezt.vec[idx][1] - ay)
  }
}

function outputHandle (bezt: BezTriple, right: boolean, dy: number, endpoint: boolean): void {
  const newY = bezt.vec[1][1] + dy
  outputHandleInner(bezt, right, newY, endpoint)
}

// End-handle adjustment (curve.cc:3704-3712). `hsize` is the (vec1-hand)
// delta. May mutate `hsize` in place when handles overlap in X.
function bezierCalcHandleAdj (hsize: [number, number], dx: number): number {
  const fac = dx / (hsize[0] + dx / 3)
  if (fac < 1) {
    hsize[0] *= fac
    hsize[1] *= fac
  }
  return 1 - 3 * hsize[0] / dx
}

function bezierCheckSolveEndHandle (locked: boolean, htype: HandleType, end: boolean): boolean {
  if (htype === HD_VECT) return true
  return end && isAutoOrAnim(htype) && !locked
}

// Main per-segment solver (curve.cc:3711-3895)

function bezierHandleCalcSmoothFCurve (
  bezts: BezTriple[],
  total: number,
  start: number,
  count: number,
  cycle: boolean,
  locked: boolean[],
): void {
  if (count < 2) return

  const fullCycle = (start === 0 && count === total && cycle)
  const beztFirst = bezts[start]
  const lastIdx = (start + count > total) ? start + count - total : start + count - 1
  const beztLast = bezts[lastIdx]

  const lockedFirst = locked[start]
  const lockedLast = locked[lastIdx]

  const solveFirst = bezierCheckSolveEndHandle(lockedFirst, beztFirst.h2, start === 0)
  const solveLast  = bezierCheckSolveEndHandle(lockedLast, beztLast.h1,  start + count === total)

  if (count === 2 && !fullCycle && solveFirst === solveLast) return

  let solveCount = count
  const dx = new Float64Array(count)
  const dy = new Float64Array(count)
  const l  = new Float64Array(count)
  const a  = new Float64Array(count)
  const b  = new Float64Array(count)
  const c  = new Float64Array(count)
  const d  = new Float64Array(count)
  const h  = new Float64Array(count)
  const hmax = new Float64Array(count)
  const hmin = new Float64Array(count)

  // dx/dy[1..count-1] from anchor deltas, wrapping in cyclic mode.
  for (let i = 1, j = start + 1; i < count; i++, j++) {
    if (cycle && j === total - 1) {
      dx[i] = bezts[total - 1].vec[1][0] - bezts[total - 2].vec[1][0]
      dy[i] = bezts[total - 1].vec[1][1] - bezts[total - 2].vec[1][1]
      j = 0
      continue
    }
    if (j > total - 1) j = j - total
    const cur = bezts[j]
    const prv = bezts[j - 1 < 0 ? total - 1 : j - 1]
    dx[i] = cur.vec[1][0] - prv.vec[1][0]
    dy[i] = cur.vec[1][1] - prv.vec[1][1]
  }

  if (fullCycle) {
    dx[0] = dx[count - 1]
    dy[0] = dy[count - 1]
    l[0] = l[count - 1] = dx[1] / dx[0]
  } else {
    l[0] = l[count - 1] = 1
  }
  for (let i = 1; i < count - 1; i++) l[i] = dx[i + 1] / dx[i]

  for (let i = 0; i < count; i++) {
    hmax[i] = Number.MAX_VALUE
    hmin[i] = -Number.MAX_VALUE
  }
  let clampedPrev = false
  let clampedCur = beztFirst.h1 === HD_AUTO_ANIM || beztFirst.h2 === HD_AUTO_ANIM
  for (let i = 1, j = start + 1; i < count; i++, j++) {
    clampedPrev = clampedCur
    if (j >= total) j -= total
    let bz = bezts[j]
    clampedCur = bz.h1 === HD_AUTO_ANIM || bz.h2 === HD_AUTO_ANIM
    if (cycle && j === total - 1) {
      j = 0
      bz = bezts[j]
      clampedCur = clampedCur || bz.h1 === HD_AUTO_ANIM || bz.h2 === HD_AUTO_ANIM
    }
    bezierClamp(hmax, hmin, i - 1, dy[i],        clampedPrev, clampedPrev)
    bezierClamp(hmax, hmin, i,     dy[i] * l[i], clampedCur,  clampedCur)
  }

  let firstHandleAdj = 0, lastHandleAdj = 0

  if (fullCycle) {
    solveCount = count - 1
    hmin[0] = Math.max(hmin[0], hmin[count - 1])
    hmax[0] = Math.min(hmax[0], hmax[count - 1])
    bezierEqContinuous(a, b, c, d, dy, l, 0)
  } else {
    if (!solveFirst) {
      const hsize: [number, number] = [
        beztFirst.vec[2][0] - beztFirst.vec[1][0],
        beztFirst.vec[2][1] - beztFirst.vec[1][1],
      ]
      firstHandleAdj = bezierCalcHandleAdj(hsize, dx[1])
      bezierLockUnknown(a, b, c, d, 0, hsize[1])
    } else {
      bezierEqNoAccelRight(a, b, c, d, dy, l, 0)
    }
    if (!solveLast) {
      const hsize: [number, number] = [
        beztLast.vec[1][0] - beztLast.vec[0][0],
        beztLast.vec[1][1] - beztLast.vec[0][1],
      ]
      lastHandleAdj = bezierCalcHandleAdj(hsize, dx[count - 1])
      bezierLockUnknown(a, b, c, d, count - 1, hsize[1])
    } else {
      bezierEqNoAccelLeft(a, b, c, d, dy, l, count - 1)
    }
  }

  for (let i = 1; i < count - 1; i++) bezierEqContinuous(a, b, c, d, dy, l, i)

  if (!fullCycle) {
    if (count > 2 || solveLast)  b[1]         += l[1] * firstHandleAdj
    if (count > 2 || solveFirst) b[count - 2] += lastHandleAdj
  }

  if (!tridiagonalSolveWithLimits(a, b, c, d, h, hmin, hmax, solveCount)) return

  if (fullCycle) h[count - 1] = h[0]

  for (let i = 1, j = start + 1; i < count - 1; i++, j++) {
    if (j >= total) j -= total
    const end = (j === total - 1)
    outputHandle(bezts[j], false, -h[i] / l[i], end)
    if (end) j = 0
    outputHandle(bezts[j], true, h[i], end)
  }
  if (solveFirst) outputHandle(beztFirst, true, h[0], start === 0)
  if (solveLast)  outputHandle(beztLast, false, -h[count - 1] / l[count - 1], start + count === total)
}

// Top-level entry (curve.cc:3897-3945)

export function smoothFCurve (fcu: FCurve, lockedFinal: boolean[], cyclic: boolean): void {
  const bezts = fcu.bezt
  const total = bezts.length
  if (total < 2) return

  // Only honor cycle if both endpoints are free auto.
  cyclic = cyclic && isFreeAutoPoint(bezts[0], lockedFinal[0]) &&
                     isFreeAutoPoint(bezts[total - 1], lockedFinal[total - 1])

  // In cyclic mode, find the first non-free-auto point (sequence break).
  let searchBase = 0
  if (cyclic) {
    let foundBreak = false
    for (let i = 1; i < total - 1; i++) {
      if (!isFreeAutoPoint(bezts[i], lockedFinal[i])) {
        searchBase = i
        foundBreak = true
        break
      }
    }
    if (!foundBreak) {
      bezierHandleCalcSmoothFCurve(bezts, total, 0, total, true, lockedFinal)
      return
    }
  }

  let start = searchBase
  let count = 1
  for (let i = 1, j = start + 1; i < total; i++, j++) {
    if (j === total - 1 && cyclic) j = 0
    if (j >= total) j -= total
    if (!isFreeAutoPoint(bezts[j], lockedFinal[j])) {
      bezierHandleCalcSmoothFCurve(bezts, total, start, count + 1, cyclic, lockedFinal)
      start = j
      count = 1
    } else {
      count++
    }
  }
  if (count > 1) bezierHandleCalcSmoothFCurve(bezts, total, start, count, cyclic, lockedFinal)
}
