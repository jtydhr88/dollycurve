/** Round `raw` to a "nice" tick step for axis labels: 1, 2, or 5 × 10^n.
 * Used by both Timeline and GraphEditor for ruler / grid spacing. */
export function niceStep (raw: number): number {
  if (raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const f = raw / Math.pow(10, exp)
  let nice: number
  if (f < 1.5) nice = 1
  else if (f < 3) nice = 2
  else if (f < 7) nice = 5
  else nice = 10
  return nice * Math.pow(10, exp)
}

/** Trace a rounded rectangle path. Caller invokes ctx.fill() / .stroke(). */
export function roundRect (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}
