import { CycleMode } from '../../data/enums'
import { CyclesModifier, FCurve } from '../../data/types'

export interface CyclesStorage {
  cycyofs: number
}

export function makeCyclesStorage (): CyclesStorage {
  return { cycyofs: 0 }
}

// Port of fcm_cycles_time (fmodifier.cc:620). Rewrites evalFrame into the
// canonical [firstKey.x, lastKey.x] window when extrapolating with cycles.
export function applyCyclesTime (
  fcu: FCurve,
  m: CyclesModifier,
  frame: number,
  storage: CyclesStorage,
): number {
  storage.cycyofs = 0
  if (fcu.bezt.length === 0) return frame

  const first = fcu.bezt[0].vec[1]
  const last = fcu.bezt[fcu.bezt.length - 1].vec[1]
  const cycdx = last[0] - first[0]
  const cycdy = last[1] - first[1]
  if (cycdx === 0) return frame

  let side: 0 | -1 | 1 = 0
  let mode: CycleMode = CycleMode.OFF
  let count = 0
  let ofs = 0

  if (frame < first[0] && m.before !== CycleMode.OFF) {
    side = -1
    mode = m.before
    count = m.beforeCount
    ofs = first[0]
  } else if (frame > last[0] && m.after !== CycleMode.OFF) {
    side = 1
    mode = m.after
    count = m.afterCount
    ofs = last[0]
  }

  if (side === 0) return frame

  const cycle = side * (frame - ofs) / cycdx
  const cyct = ((frame - ofs) % cycdx + cycdx) % cycdx
  if (count !== 0 && cycle > count) return frame

  if (mode === CycleMode.REPEAT_OFFSET) {
    const cy = side < 0
      ? Math.floor((frame - ofs) / cycdx)
      : Math.ceil((frame - ofs) / cycdx)
    storage.cycyofs = cy * cycdy
  }

  if (cyct === 0) {
    let evalt = side === 1 ? last[0] : first[0]
    if (mode === CycleMode.REPEAT_MIRROR && (Math.floor(cycle) & 1)) {
      evalt = side === 1 ? first[0] : last[0]
    }
    return evalt
  }

  // Blender uses signed fmod (cyct < 0 for before-side) and writes
  // `first - cyct` for before vs `last - cyct` for after. With our positive
  // fmod, the unified formula `last - cyct` works for both sides:
  // before:  cyct = cycdx - |blender_cyct|  →  last - cyct = first + |blender_cyct| = first - blender_cyct ✓
  // after:   cyct = blender_cyct            →  last - cyct ✓
  if (mode === CycleMode.REPEAT_MIRROR && (Math.floor(cycle + 1) & 1)) {
    return last[0] - cyct
  }

  let evalt = first[0] + cyct
  if (evalt < first[0]) evalt += cycdx
  return evalt
}

export function applyCyclesValue (
  _m: CyclesModifier,
  value: number,
  storage: CyclesStorage,
): number {
  return value + storage.cycyofs
}
