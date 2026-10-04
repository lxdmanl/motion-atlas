import { ANATOMY_IDS } from './anatomy';
import type { MotionSnapshot } from '../app/contracts';

const idsSchema = { type: 'object', properties: { ids: { type: 'array', items: { type: 'string', enum: ANATOMY_IDS }, maxItems: 12 } }, required: ['ids'], additionalProperties: false };
export const TOOL_DEFINITIONS = [
  { type: 'function', name: 'get_motion_state', description: 'Read current local right-elbow estimate. Always call before discussing current movement. Demo is not the camera; invalid or stale readings are unavailable.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'get_anatomy_info', description: 'Read verified educational descriptions for allowed right-arm structure IDs.', parameters: idsSchema },
  { type: 'function', name: 'highlight_structures', description: 'Highlight only these right-arm structures in the viewer. A highlight is an educational selection, never a measured muscle activation.', parameters: idsSchema },
  { type: 'function', name: 'set_anatomy_view', description: 'Change the local anatomy viewer focus, viewpoint, or visible layers.', parameters: { type: 'object', properties: { focus: { type: 'string', enum: ['body','arm'] }, view: { type: 'string', enum: ['front','side','back','three-quarter'] }, layers: { type: 'object', properties: { skeletal: { type: 'boolean' }, muscular: { type: 'boolean' }, connective: { type: 'boolean' } }, additionalProperties: false } }, additionalProperties: false } },
] as const;

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('工具含有不支援的參數'); }
export function validateToolArguments(name: string, raw: unknown): Record<string, unknown> {
  const args: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!record(args)) throw new Error('工具參數必須為物件');
  if (name === 'get_motion_state') { onlyKeys(args, []); return {}; }
  if (name === 'get_anatomy_info' || name === 'highlight_structures') {
    onlyKeys(args, ['ids']);
    if (!Array.isArray(args.ids) || args.ids.length > 12 || args.ids.some(id => typeof id !== 'string' || !ANATOMY_IDS.includes(id))) throw new Error('未知的解剖構造 ID');
    return { ids: [...new Set(args.ids)] };
  }
  if (name === 'set_anatomy_view') {
    onlyKeys(args, ['focus','view','layers']);
    if (args.focus !== undefined && !['body','arm'].includes(String(args.focus))) throw new Error('未知的焦點');
    if (args.view !== undefined && !['front','side','back','three-quarter'].includes(String(args.view))) throw new Error('未知的視角');
    if (args.layers !== undefined) {
      if (!record(args.layers)) throw new Error('無效的圖層');
      onlyKeys(args.layers, ['skeletal','muscular','connective']);
      if (Object.values(args.layers).some(value => typeof value !== 'boolean')) throw new Error('圖層值必須為布林值');
    }
    return args;
  }
  throw new Error('未授權的工具');
}

export function sanitizeMotionSnapshot(raw: unknown, now = Date.now()): MotionSnapshot {
  const value = record(raw) ? raw : {};
  const source = value.source === 'camera' || value.source === 'demo' ? value.source : 'none';
  const age = typeof value.capturedAt === 'number' ? now - value.capturedAt : Infinity;
  const quality = typeof value.quality === 'number' && Number.isFinite(value.quality) ? Math.max(0, Math.min(1, value.quality)) : 0;
  const valid = source !== 'none' && value.side === 'right' && value.joint === 'elbow' && value.status === 'tracking' && age >= -1000 && age <= 1500 && quality >= .65 && typeof value.angleDeg === 'number' && Number.isFinite(value.angleDeg) && value.angleDeg >= 0 && value.angleDeg <= 180;
  return { source, side: 'right', joint: 'elbow', angleDeg: valid ? value.angleDeg as number : null,
    phase: valid && ['flexing','extending','holding'].includes(String(value.phase)) ? value.phase as MotionSnapshot['phase'] : 'unknown',
    quality, capturedAt: typeof value.capturedAt === 'number' ? value.capturedAt : 0,
    status: valid ? 'tracking' : source === 'none' ? 'idle' : 'lost',
    fps: typeof value.fps === 'number' && Number.isFinite(value.fps) ? Math.max(0, value.fps) : 0,
    ...(!valid ? { message: '目前沒有新鮮、可靠的右肘姿態；不可推測即時角度或動作。' } : source === 'demo' ? { message: '這是示範資料，不是目前攝影機量測。' } : {}),
  };
}
