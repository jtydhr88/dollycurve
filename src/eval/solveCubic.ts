// Direct port of solve_cubic in blender/blenkernel/intern/fcurve.cc:1423.
// Cardano formula. Returns roots in [SMALL, ROOT_HI]; up to 3.

const SMALL = -1e-10
const ROOT_HI = 1.000001

function accept (v: number): boolean {
  return v >= SMALL && v <= ROOT_HI
}

export function solveCubic (c0: number, c1: number, c2: number, c3: number): number[] {
  const out: number[] = []

  if (c3 !== 0) {
    let a = c2 / c3
    const b = c1 / c3
    const c = c0 / c3
    a = a / 3
    const p = b / 3 - a * a
    const q = (2 * a * a * a - a * b + c) / 2
    const d = q * q + p * p * p

    if (d > 0) {
      const t = Math.sqrt(d)
      const r = Math.cbrt(-q + t) + Math.cbrt(-q - t) - a
      if (accept(r)) out.push(r)
      return out
    }
    if (d === 0) {
      const t = Math.cbrt(-q)
      const r1 = 2 * t - a
      const r2 = -t - a
      if (accept(r1)) out.push(r1)
      if (accept(r2)) out.push(r2)
      return out
    }
    // d < 0 → three real roots, trigonometric form.
    const phi = Math.acos(-q / Math.sqrt(-(p * p * p)))
    const t = Math.sqrt(-p)
    const cp = Math.cos(phi / 3)
    const sq = Math.sqrt(3 - 3 * cp * cp)
    const r1 = 2 * t * cp - a
    const r2 = -t * (cp + sq) - a
    const r3 = -t * (cp - sq) - a
    if (accept(r1)) out.push(r1)
    if (accept(r2)) out.push(r2)
    if (accept(r3)) out.push(r3)
    return out
  }

  if (c2 !== 0) {
    const disc = c1 * c1 - 4 * c2 * c0
    if (disc > 0) {
      const s = Math.sqrt(disc)
      const r1 = (-c1 - s) / (2 * c2)
      const r2 = (-c1 + s) / (2 * c2)
      if (accept(r1)) out.push(r1)
      if (accept(r2)) out.push(r2)
      return out
    }
    if (disc === 0) {
      const r = -c1 / (2 * c2)
      if (accept(r)) out.push(r)
    }
    return out
  }

  if (c1 !== 0) {
    const r = -c0 / c1
    if (accept(r)) out.push(r)
    return out
  }

  // Constant: convention from Blender — any t is a root if c0==0.
  if (c0 === 0) out.push(0)
  return out
}
