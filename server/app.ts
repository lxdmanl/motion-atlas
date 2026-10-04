import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getAnatomyInfo } from './anatomy';
import { sanitizeMotionSnapshot, validateToolArguments } from './tools';
import { ApiError, createProviderSession, closeProviderSession, explainWithProvider, type ProviderConfig, type ProviderSession, type CloseResult } from './provider';

interface TrackedSession { session: ProviderSession; token: string; createdAt: number; closing?: Promise<CloseResult>; }
interface Services { create: typeof createProviderSession; close: typeof closeProviderSession; explain: typeof explainWithProvider; }
const DEFAULT_SERVICES: Services = { create: createProviderSession, close: closeProviderSession, explain: explainWithProvider };
export function authorizedClose(actual: string, supplied: unknown) {
  if (typeof supplied !== 'string') return false;
  const left = Buffer.from(actual), right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function allowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Local command-line calls have no Origin.
  try { const url = new URL(origin); return url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname); } catch { return false; }
}
export function createApp(config: ProviderConfig, services: Services = DEFAULT_SERVICES) {
  const app = express();
  const sessions = new Map<string,TrackedSession>();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    if (!allowedLocalOrigin(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site') return void response.status(403).json({ error: { code: 'forbidden_origin', message: '只允許本機應用程式呼叫。' } });
    response.setHeader('Cache-Control','no-store'); next();
  });
  app.use(express.json({ limit: '128kb' }));
  const needsKey: express.RequestHandler = (_request,response,next) => {
    if (!config.apiKey) return void response.status(503).json({ error: { code: 'missing_api_key', message: '請在本機 .env.local 設定 OPENAI_API_KEY 並重新啟動伺服器。攝影機與 3D 功能可繼續使用。' } });
    next();
  };
  app.get('/api/health', (_request,response) => response.json({ ok:true, apiKeyConfigured:!!config.apiKey, liveModel:config.liveModel, realtimeModel:config.realtimeModel, textModel:config.textModel }));
  app.post('/api/explain', needsKey, async (request,response,next) => {
    try {
      const { snapshot: raw, question = '請根據目前狀態簡短解釋右肘動作與可能相關的肌肉。', selectedIds = [] } = request.body ?? {};
      if (typeof question !== 'string' || question.length > 2000) throw new ApiError(400,'invalid_question','問題需為 2000 字以內的文字。');
      let args: Record<string,unknown>;
      try { args = validateToolArguments('get_anatomy_info',{ids:selectedIds}); }
      catch { throw new ApiError(400,'unsupported_anatomy_selection','文字助手目前支援右手臂的肌肉、骨骼與肌腱示意，請先選取右手臂構造。'); }
      const snapshot = sanitizeMotionSnapshot(raw);
      const text = await services.explain({ question, snapshot, selectedAnatomy:getAnatomyInfo(args.ids as string[]) },config);
      response.json({ text, model:config.textModel, source:'openai', snapshotSource:snapshot.source });
    } catch(error) { next(error); }
  });
  app.post('/api/voice/session', needsKey, async (request,response,next) => {
    try {
      const sdp = request.body?.sdp;
      if (typeof sdp !== 'string' || sdp.length > 100000 || !sdp.startsWith('v=0')) throw new ApiError(400,'invalid_sdp','缺少有效的 WebRTC 連線資訊。');
      if (sessions.size >= 3) throw new ApiError(409,'session_limit','請先結束現有語音連線，再建立新連線。');
      const session = await services.create(sdp,config);
      const closeToken = randomBytes(24).toString('base64url');
      sessions.set(session.id,{session,token:closeToken,createdAt:Date.now()});
      if (response.destroyed) { await closeTracked(session.id); return; }
      response.json({...session,closeToken});
    } catch(error) { next(error); }
  });
  async function closeTracked(id:string):Promise<CloseResult> {
    const tracked = sessions.get(id);
    if (!tracked) return {confirmed:true,alreadyClosed:true};
    if (tracked.closing) return tracked.closing;
    tracked.closing = services.close(tracked.session,config.apiKey).then(result => {
      if (result.confirmed) sessions.delete(id);
      return result;
    }).finally(() => { tracked.closing = undefined; });
    return tracked.closing;
  }
  app.post('/api/voice/session/:id/close', async (request,response,next) => {
    try {
      const tracked = sessions.get(String(request.params.id));
      if (!tracked) return void response.status(404).json({error:{code:'session_not_found',message:'此本機連線已結束或不存在。'}});
      if (!authorizedClose(tracked.token,request.body?.closeToken)) throw new ApiError(403,'unauthorized_session','無權操作此語音連線。');
      response.json(await closeTracked(tracked.session.id));
    } catch(error) { next(error); }
  });
  const errorHandler:express.ErrorRequestHandler = (error,_request,response,_next) => {
    if (error instanceof ApiError) response.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({error:{code:error.code,message:error.message}});
    else if (error instanceof SyntaxError || error instanceof Error && /工具|參數|解剖|焦點|視角|圖層/.test(error.message)) response.status(400).json({error:{code:'invalid_input',message:'請求資料格式不正確。'}});
    else response.status(502).json({error:{code:'service_unavailable',message:'AI 服務連線失敗；請檢查網路後重試。'}});
  };
  app.use(errorHandler);
  // Sessions abandoned by a closed browser are still explicitly closed upstream.
  const reaper = setInterval(() => { for (const [id,value] of sessions) if (Date.now()-value.createdAt > 20*60_000) void closeTracked(id).catch(() => {}); },60_000);
  reaper.unref();
  return { app, sessions, async shutdown() { clearInterval(reaper); return Promise.allSettled([...sessions.keys()].map(closeTracked)); } };
}
