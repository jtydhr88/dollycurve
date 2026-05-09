import { describe, it, expect } from 'vitest'
import { Interpolation } from '../data/enums'
import {
  channelLabel,
  formatValue,
  isAngleRnaPath,
  isEasingInterpolation,
  parseValue,
  rnaPathSortKey,
} from './labels'

describe('channelLabel', () => {
  it('vec3 paths use x/y/z component names', () => {
    expect(channelLabel('location', 0)).toBe('location.x')
    expect(channelLabel('location', 1)).toBe('location.y')
    expect(channelLabel('location', 2)).toBe('location.z')
    expect(channelLabel('rotation_euler', 1)).toBe('rotation.y')
    expect(channelLabel('scale', 2)).toBe('scale.z')
  })

  it('scalar paths get a friendly name', () => {
    expect(channelLabel('lens', 0)).toBe('lens (mm)')
    expect(channelLabel('clip_start', 0)).toBe('clip start')
    expect(channelLabel('dof.focus_distance', 0)).toBe('focus distance')
  })

  it('unknown paths fall back to raw rnaPath + index suffix', () => {
    expect(channelLabel('custom_field', 0)).toBe('custom_field')
    expect(channelLabel('custom_vec', 1)).toBe('custom_vec[1]')
  })
})

describe('isAngleRnaPath', () => {
  it('rotation_euler is an angle path (radians)', () => {
    expect(isAngleRnaPath('rotation_euler')).toBe(true)
  })
  it('rotation_quaternion is NOT an angle path', () => {
    // Quaternion components are dimensionless [-1, 1] — they shouldn't go
    // through the radian↔degree converter.
    expect(isAngleRnaPath('rotation_quaternion')).toBe(false)
  })
  it('non-rotation paths are not angles', () => {
    expect(isAngleRnaPath('location')).toBe(false)
    expect(isAngleRnaPath('lens')).toBe(false)
  })
})

describe('formatValue for rotation_quaternion', () => {
  it('passes through as plain 4-decimal value (no rad→deg)', () => {
    expect(formatValue('rotation_quaternion', 0.7071)).toBe('0.7071')
    expect(formatValue('rotation_quaternion', 1)).toBe('1.0000')
  })
})

describe('formatValue / parseValue round-trip', () => {
  it('rotation_euler converts radians to degrees with 1 decimal', () => {
    expect(formatValue('rotation_euler', Math.PI / 2)).toBe('90.0')
    expect(formatValue('rotation_euler', Math.PI / 4)).toBe('45.0')
  })

  it('parseValue inverts formatValue for rotations', () => {
    const r = Math.PI / 3  // 60°
    const shown = formatValue('rotation_euler', r)
    const back = parseValue('rotation_euler', shown)!
    expect(back).toBeCloseTo(r, 3)
  })

  it('non-rotation paths pass through with appropriate decimal', () => {
    expect(formatValue('lens', 50)).toBe('50.0')
    expect(formatValue('location', 1.234)).toBe('1.23')
    expect(parseValue('lens', '24.5')).toBeCloseTo(24.5, 6)
    expect(parseValue('location', '5.5')).toBeCloseTo(5.5, 6)
  })

  it('parseValue returns null for non-numeric input', () => {
    expect(parseValue('lens', 'abc')).toBeNull()
    expect(parseValue('lens', '')).toBeNull()
  })
})

describe('isEasingInterpolation', () => {
  it('matches Blender bezt->ipo > BEZT_IPO_BEZ — easings only', () => {
    expect(isEasingInterpolation(Interpolation.CONSTANT)).toBe(false)
    expect(isEasingInterpolation(Interpolation.LINEAR)).toBe(false)
    expect(isEasingInterpolation(Interpolation.BEZIER)).toBe(false)
    expect(isEasingInterpolation(Interpolation.BACK)).toBe(true)
    expect(isEasingInterpolation(Interpolation.BOUNCE)).toBe(true)
    expect(isEasingInterpolation(Interpolation.CIRC)).toBe(true)
    expect(isEasingInterpolation(Interpolation.CUBIC)).toBe(true)
    expect(isEasingInterpolation(Interpolation.ELASTIC)).toBe(true)
    expect(isEasingInterpolation(Interpolation.EXPO)).toBe(true)
    expect(isEasingInterpolation(Interpolation.QUAD)).toBe(true)
    expect(isEasingInterpolation(Interpolation.QUART)).toBe(true)
    expect(isEasingInterpolation(Interpolation.QUINT)).toBe(true)
    expect(isEasingInterpolation(Interpolation.SINE)).toBe(true)
  })
})

describe('rnaPathSortKey', () => {
  it('puts location first, then rotation, scale, then scalars', () => {
    expect(rnaPathSortKey('location'))
      .toBeLessThan(rnaPathSortKey('rotation_euler'))
    expect(rnaPathSortKey('rotation_euler'))
      .toBeLessThan(rnaPathSortKey('scale'))
    expect(rnaPathSortKey('scale'))
      .toBeLessThan(rnaPathSortKey('lens'))
    expect(rnaPathSortKey('lens'))
      .toBeLessThan(rnaPathSortKey('dof.focus_distance'))
  })
  it('unknown paths sort to the end', () => {
    expect(rnaPathSortKey('mystery')).toBeGreaterThan(rnaPathSortKey('dof.aperture_fstop'))
  })
})
