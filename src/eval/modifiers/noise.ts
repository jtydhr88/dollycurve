import { NoiseModifier } from '../../data/types'

// Ken Perlin's reference permutation. Blender's noise uses BLI's hash-based
// grid; this 256-entry permutation is the standard alternative and produces
// visually equivalent fbm for camera-anim purposes.
const PERM_BASE: ReadonlyArray<number> = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69,
  142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
  203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230,
  220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76,
  132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173,
  186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206,
  59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163,
  70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232,
  178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162,
  241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204,
  176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141,
  128, 195, 78, 66, 215, 61, 156, 180,
]
const PERM = new Uint8Array(512)
for (let i = 0; i < 512; i++) PERM[i] = PERM_BASE[i & 255]

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
const grad = (h: number, x: number, y: number): number => {
  const u = (h & 1) === 0 ? x : -x
  const v = (h & 2) === 0 ? y : -y
  return u + v
}

function perlin2 (x: number, y: number): number {
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const u = fade(xf), v = fade(yf)
  const aa = PERM[PERM[xi] + yi]
  const ab = PERM[PERM[xi] + yi + 1]
  const ba = PERM[PERM[xi + 1] + yi]
  const bb = PERM[PERM[xi + 1] + yi + 1]
  const lerp = (a: number, b: number, t: number) => a + t * (b - a)
  const x1 = lerp(grad(aa, xf, yf),     grad(ba, xf - 1, yf),     u)
  const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
  return lerp(x1, x2, v)  // approx [-1, 1]
}

function fbm (x: number, y: number, octaves: number, roughness: number, lacunarity: number): number {
  const oct = Math.max(1, octaves | 0)
  let value = 0, amp = 1, freq = 1, totalAmp = 0
  for (let i = 0; i < oct; i++) {
    value += amp * perlin2(x * freq, y * freq)
    totalAmp += amp
    freq *= lacunarity
    amp *= roughness
  }
  return totalAmp > 0 ? value / totalAmp : 0  // approx [-1, 1]
}

const PHASE_OFFSET = 0.61803398874  // golden ratio shift to avoid integer-frame zero-crossings

/** Apply a Noise modifier to `value`. Mirrors fcm_noise_evaluate
 * (fmodifier.cc:814-867). Returns the new value. */
export function applyNoiseValue (m: NoiseModifier, value: number, evalFrame: number): number {
  if (m.size === 0 || m.strength === 0) return value
  const scale = 1 / m.size
  const noise = fbm(
    (evalFrame - m.offset) * scale + PHASE_OFFSET,
    m.phase,
    m.depth + 1,  // Blender depth=0 means 1 octave
    m.roughness ?? 0.5,
    m.lacunarity ?? 2,
  )
  switch (m.modification) {
    case 'add': return value + noise * m.strength
    case 'sub': return value - noise * m.strength
    case 'mul': return value * noise * m.strength
    case 'replace':
    default:    return value + (noise - 0.5) * m.strength
  }
}
