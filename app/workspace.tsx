import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowUpRight, AudioLines, Bone, Camera, ChevronRight, CircleHelp, Focus, Layers3, Maximize, Mic, MicOff, Move3d, Pause, Play, RotateCcw, ScanLine, Send, Settings2, Square, VolumeX, X } from 'lucide-react';
import MotionScene, { type SceneStats } from './motion-scene';
import type { Atlas } from './anatomy';
import { INITIAL_MOTION, INITIAL_VIEW, type MotionSnapshot, type RigManifest, type ViewState } from './contracts';
import { PoseTracker, drawPoseOverlay } from './tracking';
import { ANATOMY_GROUPS, ANATOMY_IDS, getAnatomyInfo } from '../server/anatomy';
import { validateToolArguments, sanitizeMotionSnapshot } from '../server/tools';
import { VoiceSession, type VoiceStatus } from './voice/VoiceSession';

const phases = { flexing: '屈肘中', extending: '伸肘中', holding: '維持姿勢', unknown: '等待追蹤' };
type Transcript = { role: 'user' | 'assistant'; text: string; final: boolean };
export default function Workspace() {
  const [assets, setAssets] = useState<{ atlas: Atlas; rig: RigManifest } | null>(null);
  const [attempt, setAttempt] = useState(0), [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [motion, setMotion] = useState<MotionSnapshot>(INITIAL_MOTION), motionRef = useRef(INITIAL_MOTION);
  const [ready, setReady] = useState(false), readyRef = useRef(false);
  const [progress, setProgress] = useState(0), [reset, setReset] = useState(0), [error, setError] = useState('');
  const [stats, setStats] = useState<SceneStats>({ fps: 0, triangles: 0, drawCalls: 0, geometries: 0 });
  const [demo, setDemo] = useState(false), [demoAngle, setDemoAngle] = useState(60), [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null), overlay = useRef<HTMLCanvasElement>(null), tracker = useRef<PoseTracker | null>(null), lastUI = useRef(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle'), [muted, setMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]), voice = useRef<VoiceSession | null>(null);
  const [provider, setProvider] = useState('');
  const receipts = useRef(new Map<ViewState, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>());
  const [health, setHealth] = useState<{ apiKeyConfigured: boolean; ok: boolean } | null>(null);
  const [question, setQuestion] = useState(''), [answer, setAnswer] = useState(''), [asking, setAsking] = useState(false);
  const [dialogKind, setDialogKind] = useState<'help' | 'text'>('help'), dialog = useRef<HTMLDialogElement>(null);
  const group = ANATOMY_GROUPS.find(g => g.ids.some(id => view.selected.includes(id)));
  const part = assets?.atlas.parts.find(p => view.selected.includes(p.id));
  const cameraActive = motion.source === 'camera' && !['idle', 'error'].includes(motion.status);
  const setSnapshot = useCallback((s: MotionSnapshot) => {
    motionRef.current = s;
    if (performance.now() - lastUI.current > 100 || s.status !== 'tracking') { lastUI.current = performance.now(); setMotion(s); }
  }, []);
  const refreshHealth = useCallback(() => { fetch('/api/health').then(r => r.ok ? r.json() : Promise.reject()).then(setHealth).catch(() => setHealth(null)); }, []);
  useEffect(() => { refreshHealth(); const timer = setInterval(refreshHealth, 15000); return () => clearInterval(timer); }, [refreshHealth]);
  useEffect(() => {
    const abort = new AbortController(); setError(''); setReady(false); readyRef.current = false; setAssets(null);
    Promise.all(['/models/atlas.json', '/models/rig.json'].map(async url => {
      const r = await fetch(url, { signal: abort.signal }); if (!r.ok) throw new Error(`無法載入模型資料 (${r.status})`); return r.json();
    })).then(([atlas, rig]) => setAssets({ atlas, rig })).catch(e => { if (!abort.signal.aborted) setError(`解剖資產尚未就緒。${e.message}`); });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    if (!demo) return;
    let frame = 0, previousAngle = demoAngle, previousTime = 0;
    const update = (time: number) => {
      const angle = playing ? 65 + 60 * Math.sin(time / 1600) : demoAngle;
      if (time - previousTime > 50) {
        setSnapshot({ ...INITIAL_MOTION, source: 'demo', status: 'tracking', angleDeg: angle, quality: 1, capturedAt: Date.now(), fps: 20, phase: Math.abs(angle - previousAngle) < .3 ? 'holding' : angle > previousAngle ? 'flexing' : 'extending' });
        previousTime = time; previousAngle = angle;
      }
      frame = requestAnimationFrame(update);
    }; frame = requestAnimationFrame(update); return () => cancelAnimationFrame(frame);
  }, [demo, demoAngle, playing, setSnapshot]);
  useEffect(() => () => { tracker.current?.dispose(); void voice.current?.disconnect(); for (const receipt of receipts.current.values()) { clearTimeout(receipt.timer); receipt.resolve({ ok: false, error: '工作台已關閉' }); } receipts.current.clear(); }, []);
  const select = useCallback((ids: string[]) => {
    const groups = getAnatomyInfo(ids);
    setView(v => ({ ...v, selected: ids, layers: { ...v.layers,
      ...(groups.some(g => g.role === 'bone') ? { skeletal: true } : {}),
      ...(groups.some(g => g.role === 'flexor' || g.role === 'extensor') ? { muscular: true } : {}),
      ...(groups.some(g => g.role === 'tendon') ? { connective: true } : {}),
    } }));
  }, []);
  const executeTool = useCallback(async (name: string, raw: unknown) => {
    const args = validateToolArguments(name, raw);
    if (name === 'get_motion_state') return sanitizeMotionSnapshot(motionRef.current);
    if (name === 'get_anatomy_info') return getAnatomyInfo(args.ids as string[]);
    if (!readyRef.current) return { ok: false, error: '3D 模型尚未載入完成，畫面操作未執行。' };
    if (document.hidden) return { ok: false, error: '頁面位於背景，無法確認畫面操作。' };
    return new Promise(resolve => setView(v => {
      let next: ViewState;
      if (name === 'highlight_structures') {
        const ids = args.ids as string[], groups = getAnatomyInfo(ids);
        next = { ...v, focus: ids.length ? 'arm' : v.focus, selected: ids, layers: { ...v.layers,
          ...(groups.some(g => g.role === 'bone') ? { skeletal: true } : {}),
          ...(groups.some(g => ['flexor','extensor'].includes(g.role)) ? { muscular: true } : {}),
          ...(groups.some(g => g.role === 'tendon') ? { connective: true } : {}),
        } };
      } else next = { ...v,
        ...(args.focus ? { focus: args.focus as ViewState['focus'] } : {}),
        ...(args.view ? { view: args.view as ViewState['view'] } : {}),
        layers: { ...v.layers, ...args.layers as Partial<ViewState['layers']> },
      };
      const timer = setTimeout(() => { receipts.current.delete(next); resolve({ ok: false, error: '畫面尚未確認操作完成，請重試。' }); }, 5000);
      receipts.current.set(next, { resolve, timer });
      return next;
    }));
  }, []);
  const confirmScene = (state: ViewState) => {
    const receipt = receipts.current.get(state); if (!receipt) return;
    clearTimeout(receipt.timer); receipts.current.delete(state);
    receipt.resolve({ ok: true, applied: { focus: state.focus, view: state.view, layers: state.layers, selected: state.selected } });
  };
  const sceneError = (message: string) => { setReady(false); readyRef.current = false; setError(message); };
  const startCamera = async () => {
    setError(''); setPlaying(false); setDemo(false); tracker.current?.dispose(); tracker.current = new PoseTracker();
    try { await tracker.current.start(video.current!, { onSnapshot: setSnapshot, onLandmarks: points => { if (overlay.current) drawPoseOverlay(overlay.current, points); } }); }
    catch (e) { setError(e instanceof Error ? e.message : '相機啟動失敗'); }
  };
  const stopCamera = () => { tracker.current?.stop(); setSnapshot({ ...INITIAL_MOTION }); if (overlay.current) drawPoseOverlay(overlay.current, null); };
  const toggleDemo = () => { stopCamera(); setPlaying(false); setDemo(!demo); };
  const connectVoice = async () => {
    setError(''); refreshHealth();
    if (!voice.current) voice.current = new VoiceSession({ executeTool, onStatus: setVoiceStatus, onProvider: (service, model, fallback) => { setProvider(`${service === 'live' ? 'GPT-Live' : 'Realtime'} · ${model}`); if (fallback) setError(`已切換 Realtime：${fallback}`); }, onTranscript: next => setTranscripts(previous => {
      const items = [...previous], last = items.at(-1); if (last && last.role === next.role && !last.final) items[items.length - 1] = next; else items.push(next); return items.slice(-30);
    }), onError: setError });
    try { setMuted(false); await voice.current.connect(); } catch (e) { setError(e instanceof Error ? e.message : '語音連線失敗'); }
  };
  const openDialog = (kind: 'help' | 'text') => { setDialogKind(kind); dialog.current?.showModal(); };
  const ask = async (event: FormEvent) => {
    event.preventDefault(); if (!question.trim() || asking) return; setAsking(true); setAnswer('');
    if (view.selected.some(id => !ANATOMY_IDS.includes(id))) { setAnswer('目前 AI 解剖解說支援右手臂。請先點選右側清單中的肌肉，或清除全身構造選取後再提問。'); setAsking(false); return; }
    try { const r = await fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, snapshot: motionRef.current, selectedIds: view.selected }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || '無法取得回答'); setAnswer(data.text); }
    catch (e) { setAnswer(e instanceof Error ? e.message : '無法連接服務'); } finally { setAsking(false); }
  };
  const connected = voiceStatus === 'connected', connecting = voiceStatus === 'connecting';
  const disconnecting = voiceStatus === 'disconnecting', pendingClose = voiceStatus === 'error' && !!voice.current?.provider;
  const sourceText = demo ? '示範資料 · 非相機' : motion.status === 'tracking' ? '相機即時追蹤' : cameraActive ? '等待可靠姿態' : '相機未啟動';
  return <div className="workspace">
    <header className="topbar"><a className="brand" href="/" aria-label="Motion Atlas 首頁"><span className="brand-mark"><Activity size={23}/></span><span>Motion<span className="brand-light">Atlas</span><small>動作與解剖工作台</small></span></a><div className="session-label"><span className="subtle-dot"/> LOCAL WORKSPACE <span className="version">01</span></div><div className="header-actions"><button className={demo ? 'button compact active' : 'button compact'} onClick={toggleDemo}><Play size={14}/>展示模式</button><button className="icon-button" onClick={() => openDialog('help')} aria-label="設定與使用說明"><Settings2 size={18}/></button></div></header>
    <main className="workbench">
      <nav className="rail" aria-label="模型工具"><div className="rail-group"><span className="rail-caption">範圍</span><button aria-pressed={view.focus === 'body'} onClick={() => setView(v => ({ ...v, focus: 'body' }))}><Move3d/><span>全身</span></button><button aria-pressed={view.focus === 'arm'} onClick={() => setView(v => ({ ...v, focus: 'arm' }))}><Focus/><span>右手臂</span></button></div><div className="rail-group"><span className="rail-caption">圖層</span>{([['skeletal', '骨骼', Bone], ['muscular', '肌肉', Activity], ['connective', '肌腱示意', Layers3]] as const).map(([key, name, Icon]) => <button key={key} aria-pressed={view.layers[key]} onClick={() => setView(v => ({ ...v, layers: { ...v.layers, [key]: !v.layers[key] } }))}><Icon/><span>{name}</span></button>)}</div><button className="rail-help" onClick={() => openDialog('help')} aria-label="操作指南"><CircleHelp/><span>指南</span></button></nav>
      <section className="stage" aria-label="3D 解剖工作區">
        {assets && <MotionScene atlas={assets.atlas} rig={assets.rig} state={view} motion={motionRef} resetToken={reset} onSelect={id => select([id])} onProgress={setProgress} onReady={() => { setReady(true); readyRef.current = true; }} onError={sceneError} onStats={setStats} onApplied={confirmScene}/>}
        <div className="stage-heading"><div className="eyebrow">EXPLORE YOUR MOVEMENT</div><h1>看見每個動作<span>。</span></h1><p>{view.focus === 'body' ? '全身解剖 · 從結構理解運動' : '右手臂 · 探索肘關節的屈與伸'}</p></div><div className="stage-status"><span className={demo ? 'status-dot amber' : ready ? 'status-dot' : 'status-dot dim'}/>{demo ? '展示模式' : ready ? '3D 已就緒' : '載入解剖模型'}</div>
        {!ready && <div className="loading-card"><ScanLine size={28}/><strong>建立你的解剖視野</strong><span>{error ? '資產載入需要重試' : `載入原始解剖模型 ${Math.round(progress)}%`}</span><progress value={progress} max="100"/>{error && <button className="button" onClick={() => setAttempt(n => n + 1)}>重新載入</button>}</div>}
        <div className="view-switch" aria-label="模型視角">{([['front','正面'],['side','側面'],['back','背面'],['three-quarter','3D']] as const).map(([key,label]) => <button key={key} aria-pressed={view.view === key} onClick={() => setView(v => ({ ...v, view: key }))}>{label}</button>)}<button aria-label="重設視角" onClick={() => { setReset(n => n + 1); setView(INITIAL_VIEW); }}><RotateCcw size={15}/></button></div><div className="stage-axis"><span>Y</span><i/><b>X</b><em>Z</em></div><div className="stage-bottom"><span><Maximize size={13}/>拖曳旋轉 · 滾輪縮放 · 點選構造</span><span className="render-stats">{stats.fps ? `${stats.fps} FPS` : '— FPS'}<span className="subtle-dot"/>WebGL</span></div>
        {demo && <div className="demo-control"><div><span className="demo-tag">示範</span><strong>手動探索屈肘</strong><span>{Math.round(motion.angleDeg ?? demoAngle)}°</span></div><div className="demo-slider"><button className="icon-button" aria-label={playing ? '暫停示範動畫' : '播放示範動畫'} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button><input aria-label="示範屈肘角度" type="range" min="0" max="130" value={playing ? motion.angleDeg ?? 0 : demoAngle} onChange={e => { setPlaying(false); setDemoAngle(Number(e.target.value)); }}/></div><small>解剖形變示意 · 不代表即時人體量測</small></div>}
      </section>
      <aside className="inspector"><div className="panel-title"><div><span className="eyebrow">MOTION CAPTURE</span><h2>動作觀察</h2></div><span className={motion.status === 'tracking' && !demo ? 'live-pill live' : 'live-pill'}>{demo ? 'DEMO' : motion.status === 'tracking' ? 'LIVE' : '待機'}</span></div>
        <div className="camera-frame"><video ref={video} muted playsInline className={cameraActive ? '' : 'camera-hidden'}/><canvas ref={overlay} width="640" height="480"/>{!cameraActive && <div className="camera-placeholder"><div className="scan-corners"><Camera size={28}/></div><strong>{demo ? '正在探索示範動作' : '讓動作進入畫面'}</strong><p>側身面向相機<br/>讓右肩、手肘、手腕完整入鏡</p><button className="button camera-start" onClick={startCamera}><Camera size={14}/>開啟相機</button></div>}<div className="camera-caption"><span>{sourceText}</span>{cameraActive && <button onClick={stopCamera} aria-label="停止相機"><Square size={12}/></button>}</div></div>
        <section className="angle-card"><div className="metric-heading"><span>右肘屈曲角度</span><span className="tiny-badge">右側</span></div><div className="angle-line"><span className="angle-number">{motion.angleDeg === null ? '—' : Math.round(motion.angleDeg)}<small>°</small></span><span className="phase"><Activity size={14}/>{phases[motion.phase]}</span></div><div className="angle-scale"><i style={{ width: `${Math.min(100, (motion.angleDeg ?? 0) / 130 * 100)}%` }}/></div><div className="scale-labels"><span>0° 伸直</span><span>130° 彎曲</span></div><div className="quality-line"><span>追蹤品質</span><span>{demo ? '示範資料' : cameraActive ? `${Math.round(motion.quality * 100)}% · ${motion.fps.toFixed(0)} Hz` : '尚無量測'}</span></div>{motion.message && <p className="tracking-message">{motion.message}</p>}</section>
        <section className="anatomy-panel"><div className="section-line"><h2>相關解剖構造</h2><span>點選探索</span></div><div className="muscle-list">{ANATOMY_GROUPS.slice(0, 4).map(g => <button key={g.key} aria-pressed={group?.key === g.key} onClick={() => { select(g.ids); setView(v => ({ ...v, focus: 'arm' })); }}><span className="muscle-color" style={{ background: g.color }}/><span><strong>{g.nameZh}</strong><small>{g.nameEn}</small></span><span className="role-tag">{g.role === 'extensor' ? '伸肘' : '屈肘'}</span><ChevronRight size={14}/></button>)}</div>{group || part ? <div className="structure-detail"><span className="eyebrow">已選取構造</span><h3>{group?.nameZh || part?.name}</h3><p>{group?.description || '選取的原始解剖結構。模型形變為教學示意。'}</p>{group?.origin && <p>起點：{group.origin}<br/>止點：{group.insertion}</p>}{group && <a href={group.sourceUrl} target="_blank" rel="noreferrer">解剖來源 <ArrowUpRight size={11}/></a>}<button onClick={() => openDialog('text')}>詢問這個構造 <ArrowUpRight size={13}/></button></div> : <p className="anatomy-note">顯示可能相關肌群；姿態無法量測肌肉活化或肌腱張力。</p>}</section>
        <div className="data-credit">BODY PARTS 3D <span>×</span> HUMAN ATLAS <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noreferrer">CC BY 4.0 <ArrowUpRight size={10}/></a></div>
      </aside>
    </main>
    <footer className="voice-dock"><div className={connected ? 'voice-orb connected' : 'voice-orb'}><AudioLines size={24}/></div><div className="voice-copy"><div><strong>解剖語音助手</strong><span className="voice-state">{connected ? provider || '已連線' : connecting ? '連線中…' : disconnecting ? '正在結束…' : pendingClose ? '等待關閉確認' : voiceStatus === 'error' ? '語音離線' : health?.apiKeyConfigured ? '準備開始' : health === null ? 'API 服務未連線' : '等待 API Key'}</span></div><p aria-live="polite">{transcripts.at(-1)?.text || '試著說：「放大我的右手臂，介紹屈肘相關的肌肉。」'}</p></div><div className="voice-actions">{connected ? <><button className="icon-button" aria-label={muted ? '取消靜音' : '麥克風靜音'} aria-pressed={muted} onClick={() => { voice.current?.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff size={18}/> : <Mic size={18}/>}</button><button className="icon-button" aria-label="打斷回答" onClick={() => voice.current?.interrupt()}><VolumeX size={18}/></button><button className="button" onClick={() => void voice.current?.disconnect()}><Square size={13}/>結束語音</button></> : pendingClose ? <button className="button" onClick={() => void voice.current?.disconnect()}><Square size={13}/>重試結束</button> : <button className="button primary" disabled={connecting || disconnecting} onClick={connectVoice}><Mic size={16}/>{connecting ? '建立連線中' : disconnecting ? '正在結束…' : voiceStatus === 'error' ? '重新連線' : '開始語音'}</button>}{connecting && <button className="text-button" onClick={() => void voice.current?.disconnect()}>取消連線</button>}<button className="text-button" onClick={() => openDialog('text')}>文字提問 <ChevronRight size={14}/></button></div></footer>
    {error && <div className="error-toast" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="關閉提示"><X size={16}/></button></div>}
    <dialog ref={dialog} className="info-dialog"><div className="dialog-heading"><h2>{dialogKind === 'help' ? '開始探索 Motion Atlas' : '與解剖助手對話'}</h2><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="關閉對話框"><X size={20}/></button></div>{dialogKind === 'help' ? <div className="guide"><p>旋轉全身模型，點選肌肉，或切換「右手臂」細看肘關節。</p><ol><li><strong>先試展示模式</strong><p>使用滑桿探索屈肘，或播放循環動畫。畫面會標示為示範資料。</p></li><li><strong>開啟相機</strong><p>站在光線充足的位置，讓右肩、手肘、手腕完整入鏡。建議側身緩慢彎伸右肘。</p></li><li><strong>連接中文語音</strong><p>在本機 <code>.env.local</code> 設定 <code>OPENAI_API_KEY</code>，重新啟動 API 後按「開始語音」。金鑰只保留於後端。</p></li></ol><p className="anatomy-note">這是解剖教學工作台。第一版只驅動右手肘；肌腱為連接示意，模型形變不是生物力學模擬。</p><button className="button" onClick={refreshHealth}>重新檢查 API 設定</button></div> : <div className="text-chat"><p className="anatomy-note">使用最新動作摘要與所選構造回答。需要本機 OpenAI API Key。</p><form onSubmit={ask}><label htmlFor="question">你的問題</label><div><input id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="目前屈肘可能用到哪些肌肉？" maxLength={2000}/><button className="button primary" disabled={asking || !question.trim()} aria-label="送出問題"><Send size={17}/></button></div></form><div className="text-answer" aria-live="polite">{asking ? '正在整理動作與解剖資料…' : answer || '回答會顯示在這裡。'}</div></div>}</dialog>
  </div>;
}
