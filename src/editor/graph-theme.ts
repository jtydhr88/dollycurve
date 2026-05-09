import { HandleType } from '../data/enums'
import { FCurve } from '../data/types'

/** GraphEditor color palette + injected stylesheet. Kept separate so the
 * editor class file focuses on logic. */
export const THEME = {
  bg:         '#1f1f23',
  gridMajor:  '#3a3a44',
  gridMinor:  '#2a2a32',
  axisLabel:  '#888',
  playhead:   '#4a90ff',
  selBox:     'rgba(74,144,255,0.18)',
  selBoxLine: '#4a90ff',
  vertFill:   '#dddddd',
  vertSel:    '#ffe060',
  vertActive: '#ffffff',
  handleLine: 'rgba(255,255,255,0.35)',
  outOfRange: 'rgba(0,0,0,0.35)',
  rangeBound: 'rgba(74,144,255,0.30)',
  handleColors: {
    [HandleType.FREE]:         '#e25555',
    [HandleType.AUTO]:         '#e0c040',
    [HandleType.VECTOR]:       '#5da3e2',
    [HandleType.ALIGN]:        '#c879ff',
    [HandleType.AUTO_CLAMPED]: '#e08040',
  } as Record<HandleType, string>,
}

export const HIT_RADIUS = 10              // px hit threshold (Blender: GVERTSEL_TOL)
export const VERT_SIZE = 5                // half-side of keyframe square
export const HANDLE_DOT_SIZE = 3.5
export const Y_PAD_FRAC = 0.15            // 15% Y padding on frame-all
export const X_PAD_FRAC = 0.05

/** Mirrors Blender's FCURVE_COLOR_AUTO_RGB / YRGB rule:
 * vec3 axis 0/1/2 → R/G/B; quaternion 1/2/3 → R/G/B and 0 (W) → grey. */
export function colorForFCurve (fcu: FCurve): string {
  const i = fcu.arrayIndex
  if (fcu.rnaPath === 'rotation_quaternion') {
    if (i === 0) return '#cccccc'
    return ['#e25555', '#5dd35a', '#5da3e2'][i - 1] ?? '#bbbbbb'
  }
  if (fcu.rnaPath === 'location' || fcu.rnaPath === 'rotation_euler' || fcu.rnaPath === 'scale') {
    return ['#e25555', '#5dd35a', '#5da3e2'][i] ?? '#bbbbbb'
  }
  switch (fcu.rnaPath) {
    case 'lens':          return '#f0c040'
    case 'sensor_height': return '#a080ff'
    case 'clip_start':    return '#80c0ff'
    case 'clip_end':      return '#80c0ff'
    default:              return '#cccccc'
  }
}

export const STYLE_ID = 'ckp-graph-editor-style'
export const STYLE = `
.ckp-graph { display: flex; height: 100%; width: 100%; font-size: 12px; color: #ddd; user-select: none; }
.ckp-graph-channels {
  width: 180px; min-width: 120px; max-width: 240px;
  border-right: 1px solid #333; overflow-y: auto;
  background: rgba(28,28,32,0.6);
}
.ckp-graph-channel {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 4px 4px 6px; cursor: pointer;
  border-bottom: 1px solid #2a2a2a;
}
.ckp-graph-channel:hover { background: #292930; }
.ckp-graph-channel.active { background: #2a3845; }
.ckp-graph-channel-eye, .ckp-graph-channel-mute, .ckp-graph-channel-lock {
  width: 16px; text-align: center; color: #555; flex-shrink: 0;
  font-size: 11px; cursor: pointer; user-select: none;
  font-family: ui-monospace, monospace;
}
.ckp-graph-channel-eye.visible { color: #ddd; }
.ckp-graph-channel-mute.muted { color: #ff7070; }
.ckp-graph-channel-lock.locked { color: #c879ff; }
.ckp-graph-channel-eye:hover, .ckp-graph-channel-mute:hover, .ckp-graph-channel-lock:hover {
  color: #fff;
}
.ckp-graph-channel.is-muted .ckp-graph-channel-name { opacity: 0.5; }
.ckp-graph-channel.is-locked { background: rgba(200,121,255,0.04); }
.ckp-graph-channel.in-group { padding-left: 18px; }

.ckp-graph-group {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 6px; cursor: pointer; user-select: none;
  background: #1c1c20; color: #aaa;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid #2a2a2a;
}
.ckp-graph-group:hover { background: #22222a; color: #ddd; }
.ckp-graph-group-arrow { width: 10px; flex-shrink: 0; }
.ckp-graph-group-count { color: #666; }
.ckp-graph-channel-swatch {
  width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
}
.ckp-graph-channel-name { flex: 1; font-family: ui-monospace, monospace; font-size: 11px; }
.ckp-graph-channel-count { color: #777; font-size: 10px; }
.ckp-graph-canvas-wrap {
  flex: 1; position: relative; background: ${THEME.bg};
  outline: none;
}
.ckp-graph-canvas { display: block; width: 100%; height: 100%; cursor: default; }
.ckp-graph-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #666; pointer-events: none; font-size: 13px;
}
`
