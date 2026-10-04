"""Enable the pinned bridge only in the project-local Blender profile."""
import addon_utils
import bpy

addon_utils.enable('blender_mcp', default_set=True, persistent=True)
prefs = bpy.context.preferences.addons['blender_mcp'].preferences
prefs.telemetry_consent = False
bpy.ops.wm.save_userpref()
print('PROJECT_BLENDER_MCP_ENABLED telemetry=false')
