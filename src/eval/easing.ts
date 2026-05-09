// Port of BLI_easing_* (blender/blenlib/intern/easing.cc).

import { Easing, Interpolation } from '../data/enums'

export function linearEase (time: number, begin: number, change: number, duration: number): number {
  return change * time / duration + begin
}

export function backEaseIn (time: number, begin: number, change: number, duration: number, overshoot: number): number {
  time /= duration
  return change * time * time * ((overshoot + 1) * time - overshoot) + begin
}
export function backEaseOut (time: number, begin: number, change: number, duration: number, overshoot: number): number {
  time = time / duration - 1
  return change * (time * time * ((overshoot + 1) * time + overshoot) + 1) + begin
}
export function backEaseInOut (time: number, begin: number, change: number, duration: number, overshoot: number): number {
  overshoot *= 1.525
  if ((time /= duration / 2) < 1) {
    return change / 2 * (time * time * ((overshoot + 1) * time - overshoot)) + begin
  }
  time -= 2
  return change / 2 * (time * time * ((overshoot + 1) * time + overshoot) + 2) + begin
}

export function bounceEaseOut (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  if (time < (1 / 2.75)) {
    return change * (7.5625 * time * time) + begin
  }
  if (time < (2 / 2.75)) {
    time -= (1.5 / 2.75)
    return change * ((7.5625 * time) * time + 0.75) + begin
  }
  if (time < (2.5 / 2.75)) {
    time -= (2.25 / 2.75)
    return change * ((7.5625 * time) * time + 0.9375) + begin
  }
  time -= (2.625 / 2.75)
  return change * ((7.5625 * time) * time + 0.984375) + begin
}
export function bounceEaseIn (time: number, begin: number, change: number, duration: number): number {
  return change - bounceEaseOut(duration - time, 0, change, duration) + begin
}
export function bounceEaseInOut (time: number, begin: number, change: number, duration: number): number {
  if (time < duration / 2) {
    return bounceEaseIn(time * 2, 0, change, duration) * 0.5 + begin
  }
  return bounceEaseOut(time * 2 - duration, 0, change, duration) * 0.5 + change * 0.5 + begin
}

export function circEaseIn (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  return -change * (Math.sqrt(1 - time * time) - 1) + begin
}
export function circEaseOut (time: number, begin: number, change: number, duration: number): number {
  time = time / duration - 1
  return change * Math.sqrt(1 - time * time) + begin
}
export function circEaseInOut (time: number, begin: number, change: number, duration: number): number {
  if ((time /= duration / 2) < 1) {
    return -change / 2 * (Math.sqrt(1 - time * time) - 1) + begin
  }
  time -= 2
  return change / 2 * (Math.sqrt(1 - time * time) + 1) + begin
}

export function cubicEaseIn (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  return change * time * time * time + begin
}
export function cubicEaseOut (time: number, begin: number, change: number, duration: number): number {
  time = time / duration - 1
  return change * (time * time * time + 1) + begin
}
export function cubicEaseInOut (time: number, begin: number, change: number, duration: number): number {
  if ((time /= duration / 2) < 1) {
    return change / 2 * time * time * time + begin
  }
  time -= 2
  return change / 2 * (time * time * time + 2) + begin
}

// USE_ELASTIC_BLEND from easing.cc:18 — blend to linear when amplitude < |change|.
function elasticBlend (
  time: number, change: number, _duration: number, amplitude: number, s: number, f: number,
): number {
  if (change) {
    const t = Math.abs(s)
    if (amplitude) {
      f *= amplitude / Math.abs(change)
    } else {
      f = 0
    }
    if (Math.abs(time * _duration) < t) {
      const l = Math.abs(time * _duration) / t
      f = (f * l) + (1 - l)
    }
  }
  return f
}

export function elasticEaseIn (
  time: number, begin: number, change: number, duration: number, amplitude: number, period: number,
): number {
  let s = 0
  let f = 1
  if (time === 0) return begin
  if ((time /= duration) === 1) return begin + change
  time -= 1
  if (!period) period = duration * 0.3
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4
    f = elasticBlend(time, change, duration, amplitude, s, f)
    amplitude = change
  } else {
    s = period / (2 * Math.PI) * Math.asin(change / amplitude)
  }
  return -f * (amplitude * Math.pow(2, 10 * time) *
    Math.sin((time * duration - s) * (2 * Math.PI) / period)) + begin
}

export function elasticEaseOut (
  time: number, begin: number, change: number, duration: number, amplitude: number, period: number,
): number {
  let s = 0
  let f = 1
  if (time === 0) return begin
  if ((time /= duration) === 1) return begin + change
  time = -time
  if (!period) period = duration * 0.3
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4
    f = elasticBlend(time, change, duration, amplitude, s, f)
    amplitude = change
  } else {
    s = period / (2 * Math.PI) * Math.asin(change / amplitude)
  }
  return f * (amplitude * Math.pow(2, 10 * time) *
    Math.sin((time * duration - s) * (2 * Math.PI) / period)) + change + begin
}

export function elasticEaseInOut (
  time: number, begin: number, change: number, duration: number, amplitude: number, period: number,
): number {
  let s = 0
  let f = 1
  if (time === 0) return begin
  if ((time /= duration / 2) === 2) return begin + change
  time -= 1
  if (!period) period = duration * (0.3 * 1.5)
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4
    f = elasticBlend(time, change, duration, amplitude, s, f)
    amplitude = change
  } else {
    s = period / (2 * Math.PI) * Math.asin(change / amplitude)
  }
  if (time < 0) {
    f *= -0.5
    return f * (amplitude * Math.pow(2, 10 * time) *
      Math.sin((time * duration - s) * (2 * Math.PI) / period)) + begin
  }
  time = -time
  f *= 0.5
  return f * (amplitude * Math.pow(2, 10 * time) *
    Math.sin((time * duration - s) * (2 * Math.PI) / period)) + change + begin
}

// Constants from easing.cc:254 — clamp range so curve passes through (0,0) and (1,1).
const POW_MIN = 0.0009765625 // = 2^-10
const POW_SCALE = 1 / (1 - POW_MIN)

export function expoEaseIn (time: number, begin: number, change: number, duration: number): number {
  if (time === 0) return begin
  return change * (Math.pow(2, 10 * (time / duration - 1)) - POW_MIN) * POW_SCALE + begin
}
export function expoEaseOut (time: number, begin: number, change: number, duration: number): number {
  if (time === 0) return begin
  return change * (1 - (Math.pow(2, -10 * time / duration) - POW_MIN) * POW_SCALE) + begin
}
export function expoEaseInOut (time: number, begin: number, change: number, duration: number): number {
  const halfDur = duration / 2
  const halfChange = change / 2
  if (time <= halfDur) return expoEaseIn(time, begin, halfChange, halfDur)
  return expoEaseOut(time - halfDur, begin + halfChange, halfChange, halfDur)
}

export function quadEaseIn (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  return change * time * time + begin
}
export function quadEaseOut (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  return -change * time * (time - 2) + begin
}
export function quadEaseInOut (time: number, begin: number, change: number, duration: number): number {
  if ((time /= duration / 2) < 1) return change / 2 * time * time + begin
  time -= 1
  return -change / 2 * (time * (time - 2) - 1) + begin
}

export function quartEaseIn (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  return change * time * time * time * time + begin
}
export function quartEaseOut (time: number, begin: number, change: number, duration: number): number {
  time = time / duration - 1
  return -change * (time * time * time * time - 1) + begin
}
export function quartEaseInOut (time: number, begin: number, change: number, duration: number): number {
  if ((time /= duration / 2) < 1) return change / 2 * time * time * time * time + begin
  time -= 2
  return -change / 2 * (time * time * time * time - 2) + begin
}

export function quintEaseIn (time: number, begin: number, change: number, duration: number): number {
  time /= duration
  return change * time * time * time * time * time + begin
}
export function quintEaseOut (time: number, begin: number, change: number, duration: number): number {
  time = time / duration - 1
  return change * (time * time * time * time * time + 1) + begin
}
export function quintEaseInOut (time: number, begin: number, change: number, duration: number): number {
  if ((time /= duration / 2) < 1) return change / 2 * time * time * time * time * time + begin
  time -= 2
  return change / 2 * (time * time * time * time * time + 2) + begin
}

export function sineEaseIn (time: number, begin: number, change: number, duration: number): number {
  return -change * Math.cos(time / duration * (Math.PI / 2)) + change + begin
}
export function sineEaseOut (time: number, begin: number, change: number, duration: number): number {
  return change * Math.sin(time / duration * (Math.PI / 2)) + begin
}
export function sineEaseInOut (time: number, begin: number, change: number, duration: number): number {
  return -change / 2 * (Math.cos(Math.PI * time / duration) - 1) + begin
}

// AUTO routing per fcurve.cc:2151+ : BACK→OUT, BOUNCE→OUT, CIRC→IN, CUBIC→IN,
// ELASTIC→OUT, EXPO→IN, QUAD→IN, QUART→IN, QUINT→IN, SINE→IN.
export interface EaseParams {
  time: number
  begin: number
  change: number
  duration: number
  back: number
  amplitude: number
  period: number
}

export function dispatchEase (
  ipo: Interpolation,
  easing: Easing,
  p: EaseParams,
): number {
  const { time, begin, change, duration, back, amplitude, period } = p
  switch (ipo) {
    case Interpolation.BACK:
      switch (easing) {
        case Easing.IN:     return backEaseIn(time, begin, change, duration, back)
        case Easing.IN_OUT: return backEaseInOut(time, begin, change, duration, back)
        case Easing.OUT:
        case Easing.AUTO:
        default:            return backEaseOut(time, begin, change, duration, back)
      }
    case Interpolation.BOUNCE:
      switch (easing) {
        case Easing.IN:     return bounceEaseIn(time, begin, change, duration)
        case Easing.IN_OUT: return bounceEaseInOut(time, begin, change, duration)
        case Easing.OUT:
        case Easing.AUTO:
        default:            return bounceEaseOut(time, begin, change, duration)
      }
    case Interpolation.CIRC:
      switch (easing) {
        case Easing.OUT:    return circEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return circEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return circEaseIn(time, begin, change, duration)
      }
    case Interpolation.CUBIC:
      switch (easing) {
        case Easing.OUT:    return cubicEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return cubicEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return cubicEaseIn(time, begin, change, duration)
      }
    case Interpolation.ELASTIC:
      switch (easing) {
        case Easing.IN:     return elasticEaseIn(time, begin, change, duration, amplitude, period)
        case Easing.IN_OUT: return elasticEaseInOut(time, begin, change, duration, amplitude, period)
        case Easing.OUT:
        case Easing.AUTO:
        default:            return elasticEaseOut(time, begin, change, duration, amplitude, period)
      }
    case Interpolation.EXPO:
      switch (easing) {
        case Easing.OUT:    return expoEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return expoEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return expoEaseIn(time, begin, change, duration)
      }
    case Interpolation.QUAD:
      switch (easing) {
        case Easing.OUT:    return quadEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return quadEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return quadEaseIn(time, begin, change, duration)
      }
    case Interpolation.QUART:
      switch (easing) {
        case Easing.OUT:    return quartEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return quartEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return quartEaseIn(time, begin, change, duration)
      }
    case Interpolation.QUINT:
      switch (easing) {
        case Easing.OUT:    return quintEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return quintEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return quintEaseIn(time, begin, change, duration)
      }
    case Interpolation.SINE:
      switch (easing) {
        case Easing.OUT:    return sineEaseOut(time, begin, change, duration)
        case Easing.IN_OUT: return sineEaseInOut(time, begin, change, duration)
        case Easing.IN:
        case Easing.AUTO:
        default:            return sineEaseIn(time, begin, change, duration)
      }
    default:
      return begin
  }
}
