import WebSocket from 'ws';
import { TOOL_DEFINITIONS } from './tools';
import { ANATOMY_GROUPS } from './anatomy';

export type VoiceProvider = 'live' | 'realtime';
export interface ProviderConfig { apiKey: string; liveModel: string; realtimeModel: string; textModel: string; }
export interface ProviderSession { id: string; provider: VoiceProvider; sdp: string; model: string; fallbackReason?: string; }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const BACKEND_INSTRUCTIONS = `你是繁體中文的右肘動作解剖教育助理，每次回答一至三個短句。攝影機由本機姿態模型估測，你不能直接看到影像。談到「現在」必須先呼叫 get_motion_state。source=demo 必須說明是示範，source=none 或 angleDeg=null 或 status 不為 tracking 時不得猜测目前姿勢。角度只是單眼估計，不能宣稱精準3D量測。沒有外力、負重或肌電，不得把屈伸方向等同肌肉活化，不可提供活化百分比、肌腱力、診斷或治療指示。根據工具提供的解剖資料教育性解說，原始肌肉網格與合成肌腱示意要明確區分。操作畫面只可透過允許工具。只有工具回傳 ok=true 才能說畫面已改好；錯誤要如實說明。結構 ID 必須來自下列清單：\n${JSON.stringify(ANATOMY_GROUPS)}`;
const LIVE_INSTRUCTIONS = '你是繁體中文的動作解剖語音助理。簡短、自然，等使用者說話。所有目前動作、解剖或畫面控制問題都交給 backend；不要自行猜測影像、肌肉活化或肌腱受力。backend 回傳失敗時不要聲稱操作成功。使用者可以隨時打斷。';

async function providerError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; type?: string; message?: string } };
  const code = body.error?.code ?? body.error?.type ?? 'provider_error';
  const messages: Record<string, string> = { invalid_api_key: 'OpenAI API key 無效，請在伺服器重新設定。', insufficient_quota: 'API 額度不足，請檢查專案計費。', rate_limit_exceeded: 'API 暫時達到速率限制，請稍後再試。' };
  return new ApiError(response.status, code, messages[code] ?? `OpenAI 請求失敗（${response.status} / ${code}）。`);
}
export function mayFallbackToRealtime(error: unknown): boolean {
  return error instanceof ApiError && [400,403,404].includes(error.status) && ['model_not_found','model_access_denied','unsupported_model','model_not_available','access_denied','permission_denied'].includes(error.code);
}
export async function createProviderSession(sdp: string, config: ProviderConfig, fetcher: typeof fetch = fetch): Promise<ProviderSession> {
  const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };
  try {
    const response = await fetcher('https://api.openai.com/v1/live/sessions', {
      method: 'POST', headers, signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ session: { model: config.liveModel, instructions: LIVE_INSTRUCTIONS, store: false,
        delegation: { type: 'responses', responses: { model: config.textModel, instructions: BACKEND_INSTRUCTIONS, tools: TOOL_DEFINITIONS, parallel_tool_calls: false, max_output_tokens: 800 } } }, transport: { type: 'webrtc', sdp } }),
    });
    if (!response.ok) throw await providerError(response);
    const data = await response.json() as { session?: { id?: string }; transport?: { sdp?: string } };
    if (!data.session?.id || !data.transport?.sdp) throw new ApiError(502, 'invalid_provider_response', '語音服務回傳格式不完整。');
    return { id: data.session.id, sdp: data.transport.sdp, provider: 'live', model: config.liveModel };
  } catch (error) {
    if (!mayFallbackToRealtime(error)) throw error;
  }
  // Fallback is limited to explicit model/access rejection; never hide auth, quota,
  // malformed request, network or server failures by creating another billable call.
  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify({ type: 'realtime', model: config.realtimeModel, instructions: BACKEND_INSTRUCTIONS,
    tools: TOOL_DEFINITIONS, tool_choice: 'auto', audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } }, output: { voice: 'marin' } } }));
  const response = await fetcher('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: headers.Authorization }, body: form, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw await providerError(response);
  const location = response.headers.get('location');
  const id = location?.split('/').filter(Boolean).at(-1);
  if (!id || !/^[-a-zA-Z0-9_]+$/.test(id)) throw new ApiError(502, 'missing_call_id', 'Realtime 沒有回傳可追蹤的通話 ID。');
  return { id, sdp: await response.text(), provider: 'realtime', model: config.realtimeModel, fallbackReason: 'GPT-Live 模型或存取權不可用，已切換至 Realtime。' };
}

export interface CloseResult { confirmed: boolean; usageSeconds?: number; alreadyClosed?: boolean; }
export type SocketFactory = (url: string, key: string) => WebSocket;
const socketFactory: SocketFactory = (url, key) => new WebSocket(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 7000 });
export async function closeProviderSession(session: Pick<ProviderSession,'id'|'provider'>, apiKey: string, fetcher: typeof fetch = fetch, connect: SocketFactory = socketFactory): Promise<CloseResult> {
  if (session.provider === 'realtime') {
    const response = await fetcher(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(session.id)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw await providerError(response);
    return { confirmed: true, alreadyClosed: response.status === 404 || response.status === 410 };
  }
  // Live REST hangup is documented for SIP. Attach a sideband to close a WebRTC
  // session with the documented session.close / session.closed handshake instead.
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connect(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(session.id)}/attach`, apiKey);
    const timer = setTimeout(() => finish(new ApiError(504, 'close_unconfirmed', '語音連線已停止，但服務端關閉尚未確認；可重試結束。')), 10_000);
    function finish(error?: Error, result?: CloseResult) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.removeAllListeners();
      // ws can emit an error asynchronously while terminating a connecting socket.
      socket.on('error', () => {}); socket.terminate();
      if (error) reject(error); else resolve(result ?? { confirmed: true });
    }
    socket.on('open', () => socket.send(JSON.stringify({ type: 'session.close' })));
    socket.on('message', data => {
      try {
        const event = JSON.parse(data.toString());
        if (event.type === 'session.closed') finish(undefined, { confirmed: true, usageSeconds: event.usage?.seconds });
        else if (event.type === 'error') finish(new ApiError(502, 'close_unconfirmed', '服務端尚未確認語音已結束。'));
      } catch { /* Non-JSON/unrelated events cannot confirm closure. */ }
    });
    socket.on('unexpected-response', (_request, response) => {
      if (response.statusCode === 404 || response.statusCode === 410) finish(undefined, { confirmed: true, alreadyClosed: true });
      else finish(new ApiError(502, 'close_unconfirmed', '無法建立語音結束控制連線。'));
    });
    socket.on('error', () => finish(new ApiError(502, 'close_unconfirmed', '無法確認服務端語音已結束。')));
    socket.on('close', () => finish(new ApiError(502, 'close_unconfirmed', '結束確認前連線中斷。')));
  });
}

export async function explainWithProvider(context: unknown, config: ProviderConfig, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ model: config.textModel, store: false, instructions: BACKEND_INSTRUCTIONS + '\n本次為文字模式，已驗證的最新資料在輸入中。不要說自己執行了工具或改動畫面。', input: JSON.stringify(context), max_output_tokens: 700 }) });
  if (!response.ok) throw await providerError(response);
  const data = await response.json() as { output?: { content?: { type: string; text?: string }[] }[] };
  const text = (data.output ?? []).flatMap(item => item.content ?? []).filter(content => content.type === 'output_text').map(content => content.text ?? '').join('').trim();
  if (!text) throw new ApiError(502, 'empty_response', 'AI 這次未產生文字，請重試。');
  return text;
}
