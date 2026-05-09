"""dollycurve camera animation exporter — Blender 4.x addon.

Drop this file into Blender's add-on directory (Edit > Preferences >
Add-ons > Install from disk), enable "Dollycurve Camera Animation Export",
then with a camera selected: File > Export > Camera Animation (dollycurve JSON).

The output JSON matches the schema consumed by `importCameraActionFromJson`
in the dollycurve TypeScript library. Captures FCurves from BOTH the
camera object's animation_data (transform: location, rotation_euler, scale)
AND the camera datablock's animation_data (lens, sensor_width,
sensor_height, clip_start, clip_end, shift_x, shift_y, dof.focus_distance,
dof.aperture_fstop).

Drivers, NLA strips, modifiers other than Cycles, and the Blender 4.x
slot/layer Action system are NOT exported; the importer expects the legacy
flat fcurves array.
"""

bl_info = {
    "name": "Dollycurve Camera Animation Export",
    "author": "dollycurve",
    "version": (1, 0, 0),
    "blender": (4, 0, 0),
    "location": "File > Export > Camera Animation (dollycurve JSON)",
    "description": "Export active camera's FCurve animation as JSON for the dollycurve keyframe engine",
    "category": "Import-Export",
}

import json
import os

import bpy

# ---- enum maps ------------------------------------------------------------
# Blender's Python API exposes these as upper-case identifier strings; map
# them to the lower-case strings our TS schema uses.

IPO_MAP = {
    'CONSTANT': 'constant',
    'LINEAR': 'linear',
    'BEZIER': 'bezier',
    'BACK': 'back',
    'BOUNCE': 'bounce',
    'CIRC': 'circ',
    'CUBIC': 'cubic',
    'ELASTIC': 'elastic',
    'EXPO': 'expo',
    'QUAD': 'quad',
    'QUART': 'quart',
    'QUINT': 'quint',
    'SINE': 'sine',
}
EASING_MAP = {
    'AUTO': 'auto',
    'EASE_IN': 'in',
    'EASE_OUT': 'out',
    'EASE_IN_OUT': 'in_out',
}
HANDLE_MAP = {
    'FREE': 'free',
    'AUTO': 'auto',
    'VECTOR': 'vector',
    'ALIGNED': 'align',
    'AUTO_CLAMPED': 'auto_clamped',
}
KEY_TYPE_MAP = {
    'KEYFRAME': 'keyframe',
    'EXTREME': 'extreme',
    'BREAKDOWN': 'breakdown',
    'JITTER': 'jitter',
    'MOVING_HOLD': 'moving_hold',
    'GENERATED': 'generated',
}
CYCLE_MODE_MAP = {
    'NONE': 'off',  # FCM_EXTRAPOLATE_NONE
    'REPEAT': 'repeat',
    'REPEAT_OFFSET': 'repeat_offset',
    'REPEAT_MIRROR': 'repeat_mirror',
}
EXTEND_MAP = {
    'CONSTANT': 'constant',
    'LINEAR': 'linear',
}
SMOOTH_MAP = {
    'NONE': 'none',
    'CONT_ACCEL': 'continuous_acceleration',
}


# ---- conversion -----------------------------------------------------------

def remap_array_index(data_path, array_index):
    """Convert Blender's per-FCurve array_index into our schema's order.

    For rotation_quaternion, Blender stores components in (W, X, Y, Z)
    order at indices (0, 1, 2, 3). Our schema and the consumer
    (CameraTrackBinding) follow Three.js convention: (X, Y, Z, W) at
    (0, 1, 2, 3). The cyclic shift `(idx + 3) % 4` maps:
      Blender 0 (W) → 3 (W),  1 (X) → 0,  2 (Y) → 1,  3 (Z) → 2.

    All other RNA paths (location, rotation_euler, scale, etc.) keep
    their indices as-is because Blender and Three already agree on
    those axis orderings.
    """
    if data_path == 'rotation_quaternion':
        return (array_index + 3) % 4
    return array_index


def fcurve_to_json(fcu):
    keyframes = []
    for bz in fcu.keyframe_points:
        keyframes.append({
            'vec': [
                [bz.handle_left[0], bz.handle_left[1]],
                [bz.co[0], bz.co[1]],
                [bz.handle_right[0], bz.handle_right[1]],
            ],
            'ipo': IPO_MAP.get(bz.interpolation, 'bezier'),
            'easing': EASING_MAP.get(bz.easing, 'auto'),
            'h1': HANDLE_MAP.get(bz.handle_left_type, 'auto_clamped'),
            'h2': HANDLE_MAP.get(bz.handle_right_type, 'auto_clamped'),
            'keyframeType': KEY_TYPE_MAP.get(bz.type, 'keyframe'),
            'back': bz.back,
            'amplitude': bz.amplitude,
            'period': bz.period,
        })

    modifiers = []
    for mod in fcu.modifiers:
        if mod.type == 'CYCLES':
            modifiers.append({
                'type': 'cycles',
                'before': CYCLE_MODE_MAP.get(mod.mode_before, 'off'),
                'after': CYCLE_MODE_MAP.get(mod.mode_after, 'off'),
                'beforeCount': mod.cycles_before,
                'afterCount': mod.cycles_after,
            })
        # Other modifier types intentionally skipped for v1.

    return {
        'rnaPath': fcu.data_path,
        'arrayIndex': remap_array_index(fcu.data_path, fcu.array_index),
        'extend': EXTEND_MAP.get(fcu.extrapolation, 'constant'),
        'autoSmoothing': SMOOTH_MAP.get(fcu.auto_smoothing, 'continuous_acceleration'),
        'discrete': False,
        'modifiers': modifiers,
        'keyframes': keyframes,
    }


def collect_camera_fcurves(camera_obj):
    """Pull FCurves from both the object's action and the camera datablock's action."""
    fcurves = []
    if camera_obj.animation_data and camera_obj.animation_data.action:
        for fcu in camera_obj.animation_data.action.fcurves:
            fcurves.append(fcu)
    cam_data = camera_obj.data
    if cam_data.animation_data and cam_data.animation_data.action:
        for fcu in cam_data.animation_data.action.fcurves:
            fcurves.append(fcu)
    return fcurves


# ---- operator -------------------------------------------------------------

class ExportDollycurveCameraAnimation(bpy.types.Operator):
    """Export the active camera's animation as dollycurve JSON"""
    bl_idname = "export.dollycurve_camera_animation"
    bl_label = "Camera Animation (dollycurve JSON)"

    filepath: bpy.props.StringProperty(subtype='FILE_PATH')
    filename_ext = ".json"
    filter_glob: bpy.props.StringProperty(default="*.json", options={'HIDDEN'})

    def execute(self, context):
        obj = context.active_object
        if obj is None or obj.type != 'CAMERA':
            self.report({'ERROR'}, "Active object must be a Camera")
            return {'CANCELLED'}

        fcurves = collect_camera_fcurves(obj)
        scene = context.scene
        fps = scene.render.fps / scene.render.fps_base

        data = {
            'version': 1,
            'fps': fps,
            'fcurves': [fcurve_to_json(fcu) for fcu in fcurves],
        }

        with open(self.filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)

        self.report({'INFO'}, f"Exported {len(fcurves)} fcurves to {self.filepath}")
        return {'FINISHED'}

    def invoke(self, context, event):
        if not self.filepath:
            blend_filepath = bpy.data.filepath
            if blend_filepath:
                self.filepath = os.path.splitext(blend_filepath)[0] + ".camera.json"
            else:
                self.filepath = "camera_animation.json"
        context.window_manager.fileselect_add(self)
        return {'RUNNING_MODAL'}


def menu_func_export(self, context):
    self.layout.operator(
        ExportDollycurveCameraAnimation.bl_idname,
        text="Camera Animation (dollycurve JSON)",
    )


def register():
    bpy.utils.register_class(ExportDollycurveCameraAnimation)
    bpy.types.TOPBAR_MT_file_export.append(menu_func_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu_func_export)
    bpy.utils.unregister_class(ExportDollycurveCameraAnimation)


if __name__ == "__main__":
    register()
