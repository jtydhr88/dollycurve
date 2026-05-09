import { bezBinarySearch } from '../eval/binarySearch'
import { makeBezTriple, makeFCurve, MakeBezTripleOpts } from '../data/factories'
import { BezTriple, FCurve } from '../data/types'
import { recalcHandlesAround } from './handles'

export interface InsertResult {
  bezt: BezTriple
  index: number
  replaced: boolean
}

/**
 * Port of insert_vert_fcurve (animrig/intern/keyframing.cc).
 * Inserts at `frame` with `value`, or updates an existing key within threshold
 * (keeping ipo/handle settings unless `opts` overrides). Recomputes handles
 * for the new key and its neighbors.
 */
export function insertOrReplaceKeyframe (
  fcu: FCurve,
  frame: number,
  value: number,
  opts: MakeBezTripleOpts = {},
): InsertResult {
  const { idx, exact } = bezBinarySearch(fcu.bezt, frame, 1e-4)

  if (exact) {
    const bz = fcu.bezt[idx]
    bz.vec[1][1] = value
    if (opts.ipo !== undefined) bz.ipo = opts.ipo
    if (opts.easing !== undefined) bz.easing = opts.easing
    if (opts.h1 !== undefined) bz.h1 = opts.h1
    if (opts.h2 !== undefined) bz.h2 = opts.h2
    if (opts.keyframeType !== undefined) bz.keyframeType = opts.keyframeType
    recalcHandlesAround(fcu, idx)
    return { bezt: bz, index: idx, replaced: true }
  }

  // Inherit ipo from prev (or next at idx 0) when caller didn't request one.
  // Port of insert_vert_fcurve (animrig/intern/fcurve.cc:480-486).
  const inheritedOpts = { ...opts }
  if (inheritedOpts.ipo === undefined && fcu.bezt.length > 0) {
    if (idx > 0) inheritedOpts.ipo = fcu.bezt[idx - 1].ipo
    else if (idx < fcu.bezt.length) inheritedOpts.ipo = fcu.bezt[idx].ipo
  }

  const bz = makeBezTriple(frame, value, inheritedOpts)
  fcu.bezt.splice(idx, 0, bz)
  recalcHandlesAround(fcu, idx)
  return { bezt: bz, index: idx, replaced: false }
}

/** Insert keys for a vec3 property across three FCurves, creating them as needed. */
export function insertVec3Key (
  action: { fcurves: FCurve[] },
  rnaPath: string,
  frame: number,
  values: [number, number, number],
  opts: MakeBezTripleOpts = {},
): void {
  for (let i = 0; i < 3; i++) {
    let fcu = action.fcurves.find((f) => f.rnaPath === rnaPath && f.arrayIndex === i)
    if (!fcu) {
      fcu = makeFCurveStub(rnaPath, i)
      action.fcurves.push(fcu)
    }
    insertOrReplaceKeyframe(fcu, frame, values[i], opts)
  }
}

export function insertScalarKey (
  action: { fcurves: FCurve[] },
  rnaPath: string,
  frame: number,
  value: number,
  opts: MakeBezTripleOpts = {},
): void {
  let fcu = action.fcurves.find((f) => f.rnaPath === rnaPath && f.arrayIndex === 0)
  if (!fcu) {
    fcu = makeFCurveStub(rnaPath, 0)
    action.fcurves.push(fcu)
  }
  insertOrReplaceKeyframe(fcu, frame, value, opts)
}

function makeFCurveStub (rnaPath: string, arrayIndex: number): FCurve {
  return makeFCurve(rnaPath, [], { arrayIndex })
}
