"""Read-only end-to-end check of the pinned stdio server and live Blender bridge."""
import asyncio
import json
import os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]

async def main():
    env = dict(os.environ, BLENDER_HOST='localhost', BLENDER_PORT='9876',
               BLENDER_MCP_SAFE_MODE='1', DISABLE_TELEMETRY='true',
               BLENDERMCP_NO_UPDATE_CHECK='1',
               BLENDERMCP_ADDONS_DIR=str(ROOT / '.tools/blender-profile/scripts/addons'),
               XDG_CONFIG_HOME=str(ROOT / '.tools/blender-mcp-profile'))
    params = StdioServerParameters(command=str(ROOT / '.tools/blender-mcp-venv/Scripts/mcp-for-blender.exe'), env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
            names = [tool.name for tool in listed.tools]
            assert 'get_scene_info' in names and 'get_object_info' in names
            scene = await session.call_tool('get_scene_info', {'user_prompt': 'Verify the prepared local right-arm anatomy scene.'})
            rig = await session.call_tool('get_object_info', {'object_name': 'RightArmRig', 'user_prompt': 'Verify the prepared local armature.'})
            assert not scene.isError and not rig.isError
            scene_text = '\n'.join(item.text for item in scene.content if item.type == 'text')
            rig_text = '\n'.join(item.text for item in rig.content if item.type == 'text')
            assert 'RightArmRig' in rig_text and 'ARMATURE' in rig_text, rig_text
            result = {'passed': True, 'package': 'mcp-for-blender==2.1.3', 'toolCount': len(names),
                      'scene': json.loads(scene_text), 'armature': json.loads(rig_text),
                      'telemetryDisabled': True, 'safeMode': True}
            (ROOT / 'assets/qa/mcp-validation.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps({'passed': True, 'toolCount': len(names), 'armature': 'RightArmRig'}))

asyncio.run(main())
