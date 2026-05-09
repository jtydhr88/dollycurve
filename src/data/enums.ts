export enum Interpolation {
  CONSTANT = 'constant',
  LINEAR = 'linear',
  BEZIER = 'bezier',
  BACK = 'back',
  BOUNCE = 'bounce',
  CIRC = 'circ',
  CUBIC = 'cubic',
  ELASTIC = 'elastic',
  EXPO = 'expo',
  QUAD = 'quad',
  QUART = 'quart',
  QUINT = 'quint',
  SINE = 'sine',
}

export enum Easing {
  AUTO = 'auto',
  IN = 'in',
  OUT = 'out',
  IN_OUT = 'in_out',
}

export enum HandleType {
  FREE = 'free',
  AUTO = 'auto',
  VECTOR = 'vector',
  ALIGN = 'align',
  AUTO_CLAMPED = 'auto_clamped',
}

export enum KeyType {
  KEYFRAME = 'keyframe',
  EXTREME = 'extreme',
  BREAKDOWN = 'breakdown',
  JITTER = 'jitter',
  MOVING_HOLD = 'moving_hold',
  GENERATED = 'generated',
}

// Maps to eFMod_Cycling_Modes (DNA_anim_enums.h:86).
export enum CycleMode {
  OFF = 'off',
  REPEAT = 'repeat',
  REPEAT_OFFSET = 'repeat_offset',
  REPEAT_MIRROR = 'repeat_mirror',
}

export enum Extend {
  CONSTANT = 'constant',
  LINEAR = 'linear',
}

export enum AutoSmoothing {
  NONE = 'none',
  CONTINUOUS_ACCELERATION = 'continuous_acceleration',
}
