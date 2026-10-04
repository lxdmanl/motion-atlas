import { ToolDispatcher, type ExecuteTool } from './tool-dispatcher';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';
export interface VoiceTranscript { role: 'user' | 'assistant'; text: string; final: boolean; }
export interface VoiceSessionOptions {
  executeTool: ExecuteTool;
  onStatus: (status: VoiceStatus) => void;
  onTranscript: (entry: VoiceTranscript) => void;
  onError: (message: string) => void;
  onProvider?: (provider: 'live'|'realtime', model: string, fallbackReason?: string) => void;
}
interface SessionResponse { id:string; closeToken:string; provider:'live'|'realtime'; sdp:string; model:string; fallbackReason?:string; }
type EventRecord = Record<string, any>;
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '語音連線失敗，請重試。'; }
async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `請求失敗（${response.status}）`);
  return body;
}

/** Browser-only transport. API credentials never enter this class. */
export class VoiceSession {
  private state: VoiceStatus = 'idle';
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private microphone?: MediaStream;
  private audio?: HTMLAudioElement;
  private session?: SessionResponse;
  private dispatcher?: ToolDispatcher;
  private requestAbort?: AbortController;
  private epoch = 0;
  private isMuted = false;
  private closing?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error:Error) => void;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private captions = {user:'',assistant:''};
  private outputInterrupted = false;
  private nextUserSpeech = false;
  private closeOnPageHide = () => {
    const session = this.session;
    if (session) {
      const body = new Blob([JSON.stringify({closeToken:session.closeToken})],{type:'application/json'});
      navigator.sendBeacon(`/api/voice/session/${encodeURIComponent(session.id)}/close`,body);
    }
    this.releaseDevices();
  };
  constructor(private options: VoiceSessionOptions) {}
  get status() {return this.state;}
  get provider() {return this.session?.provider;}
  get muted() {return this.isMuted;}
  private setStatus(status:VoiceStatus) {this.state=status;this.options.onStatus(status);}

  async connect():Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') return;
    if (this.closing) await this.closing;
    if (this.session) await this.disconnect();
    if (this.session) {this.options.onError('前一個語音連線尚未確認結束，請再按一次結束後重試。');return;}
    const epoch = ++this.epoch;
    this.setStatus('connecting'); this.captions={user:'',assistant:''}; this.isMuted=false;
    this.requestAbort = new AbortController();
    try {
      // Check configuration before requesting a microphone that cannot be used.
      const health = await readJson(await fetch('/api/health',{signal:AbortSignal.any([this.requestAbort.signal,AbortSignal.timeout(10000)])}));
      if (!health.apiKeyConfigured) throw new Error('請先在本機 .env.local 設定 OPENAI_API_KEY，再重新啟動伺服器。');
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('此瀏覽器不支援語音；請使用 localhost 的 Chrome 或 Edge。');
      const stream = await this.requestMicrophone(epoch);
      if(epoch !== this.epoch) {stream.getTracks().forEach(track=>track.stop());return;}
      this.microphone=stream;
      const peer = new RTCPeerConnection(); this.peer=peer;
      const audio = new Audio(); audio.autoplay=true; this.audio=audio;
      peer.ontrack = event => {
        if(epoch !== this.epoch) return;
        audio.srcObject=event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(()=>this.options.onError('瀏覽器阻擋聲音播放，請再次點擊語音連線。'));
      };
      stream.getTracks().forEach(track=>peer.addTrack(track,stream));
      const channel = peer.createDataChannel('oai-events'); this.channel=channel;
      channel.onmessage = event => {if(epoch === this.epoch) {try {this.handleEvent(JSON.parse(event.data));} catch {this.options.onError('收到無法解析的語音事件。');}}};
      channel.onerror=()=>this.failConnection('語音事件通道中斷，請重新連線。',epoch);
      peer.onconnectionstatechange=()=>{if(peer.connectionState === 'failed' || peer.connectionState === 'disconnected') this.failConnection('語音網路連線中斷，請重新連線。',epoch);};
      const offer=await peer.createOffer(); await peer.setLocalDescription(offer);
      await this.waitForIce(peer);
      if(epoch !== this.epoch) return;
      const session:SessionResponse=await readJson(await fetch('/api/voice/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:peer.localDescription?.sdp}),signal:AbortSignal.any([this.requestAbort.signal,AbortSignal.timeout(60000)])}));
      this.session=session;
      if(epoch !== this.epoch) {await this.closeServerSession();return;}
      this.options.onProvider?.(session.provider,session.model,session.fallbackReason);
      this.dispatcher=new ToolDispatcher(session.provider,this.options.executeTool,event=>this.send(event),()=>epoch===this.epoch&&this.state==='connected');
      const ready = new Promise<void>((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;this.readyTimer=setTimeout(()=>reject(new Error('語音服務啟動逾時，請重試。')),25000);});
      await peer.setRemoteDescription({type:'answer',sdp:session.sdp});
      window.addEventListener('pagehide',this.closeOnPageHide);
      await ready;
    } catch(error) {
      if(epoch!==this.epoch) return;
      this.clearReady();this.releaseDevices();
      try {await this.closeServerSession();} catch(closeError) {this.options.onError(errorMessage(closeError));}
      this.setStatus('error');this.options.onError(errorMessage(error));
    }
  }
  private async requestMicrophone(epoch:number):Promise<MediaStream> {
    let timedOut=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const request=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    // Permission can arrive after cancellation or timeout. Such a stream must
    // immediately stop rather than leave an invisible live microphone behind.
    request.then(stream=>{if(timedOut||epoch!==this.epoch)stream.getTracks().forEach(track=>track.stop());},()=>{});
    try {
      return await Promise.race([request,new Promise<never>((_resolve,reject)=>{
        timer=setTimeout(()=>{timedOut=true;reject(new Error('麥克風授權等待逾時，請允許此網站使用麥克風後重試。'));},20000);
      })]);
    } catch(error) {
      if(error instanceof DOMException) {
        if(error.name==='NotAllowedError')throw new Error('尚未取得麥克風權限，請允許此網站使用麥克風後重試。');
        if(error.name==='NotFoundError')throw new Error('找不到麥克風，請確認裝置已連接。');
        if(error.name==='NotReadableError')throw new Error('麥克風目前無法使用，請檢查其他應用程式或裝置設定。');
      }
      throw error;
    } finally {clearTimeout(timer);}
  }
  private async waitForIce(peer:RTCPeerConnection) {
    if(peer.iceGatheringState==='complete') return;
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>{cleanup();reject(new Error('WebRTC 連線資訊準備逾時。'));},6000);
      const listener=()=>{if(peer.iceGatheringState==='complete'){cleanup();resolve();}};
      const cleanup=()=>{clearTimeout(timeout);peer.removeEventListener('icegatheringstatechange',listener);};
      peer.addEventListener('icegatheringstatechange',listener);listener();
    });
  }
  private handleEvent(event:EventRecord) {
    if(event.type==='session.started'||this.session?.provider==='realtime'&&event.type==='session.created') {
      this.setStatus('connected');this.readyResolve?.();this.clearReady();return;
    }
    if(event.type==='error') {this.options.onError(event.error?.message??'語音服務回報錯誤。');return;}
    if(event.type==='session.closed') {
      if(this.state!=='disconnecting') {this.options.onError('語音服務已結束連線。');void this.disconnect();}
      return;
    }
    if(event.type==='session.input_transcript.delta') {this.nextUserSpeech=true;this.caption('user',event.delta,false);}
    if(event.type==='session.output_transcript.delta') {
      if(this.outputInterrupted && this.nextUserSpeech) {if(this.audio)this.audio.muted=false;this.outputInterrupted=false;}
      this.caption('assistant',event.delta,false);
    }
    if(event.type==='conversation.item.input_audio_transcription.completed') this.caption('user',event.transcript,true,true);
    if(event.type==='response.output_audio_transcript.delta'||event.type==='response.audio_transcript.delta') this.caption('assistant',event.delta,false);
    if(event.type==='response.output_audio_transcript.done'||event.type==='response.audio_transcript.done') this.caption('assistant',event.transcript,true,true);
    const nested=event.type==='response.event'?event.event:event;
    if(nested&&this.dispatcher) void this.dispatcher.handle(nested,event.type==='response.event'?event.delegation_id??'primary':'primary').catch(()=>this.options.onError('語音工具處理失敗。'));
  }
  private caption(role:'user'|'assistant',text:unknown,final:boolean,replace=false) {
    if(typeof text!=='string')return;
    // Live does not provide turn-completion events: display independent running
    // captions; never infer final speech from packet timing.
    this.captions[role]=(replace?text:this.captions[role]+text).slice(-1800);
    this.options.onTranscript({role,text:this.captions[role],final});
    if(final)this.captions[role]='';
  }
  private send(event:EventRecord) {if(this.channel?.readyState==='open')this.channel.send(JSON.stringify(event));}
  mute(muted:boolean) {
    this.isMuted=muted;this.microphone?.getAudioTracks().forEach(track=>{track.enabled=!muted;});
    if(this.session?.provider==='live'&&this.state==='connected') this.send({type:muted?'session.input_audio.mute':'session.input_audio.unmute',event_id:crypto.randomUUID()});
  }
  interrupt() {
    if(this.state!=='connected')return;
    if(this.session?.provider==='realtime') {this.send({type:'response.cancel'});this.send({type:'output_audio_buffer.clear'});}
    else {
      // Instructions alone cannot retract buffered WebRTC audio, so suppress
      // playback immediately, then allow a fresh reply after the interruption.
      if(this.audio)this.audio.muted=true;
      this.outputInterrupted=true;this.nextUserSpeech=false;
      this.send({type:'session.instructions.append',event_id:crypto.randomUUID(),delegation_id:null,content:'Stop speaking immediately. The user pressed interrupt. Wait silently for the next user question.'});
    }
  }
  async reconnect() {await this.disconnect();await this.connect();}
  async disconnect():Promise<void> {
    if(this.closing)return this.closing;
    ++this.epoch;this.setStatus('disconnecting');this.requestAbort?.abort();
    this.readyReject?.(new Error('語音連線已取消'));this.clearReady();this.dispatcher?.reset();
    // Keep transport open until the server's upstream close handshake completes.
    // Audio devices stop capturing immediately while control events can drain.
    this.microphone?.getTracks().forEach(track=>track.stop());
    this.closing=(async()=>{
      try {await this.closeServerSession();this.setStatus('idle');}
      catch(error){this.setStatus('error');this.options.onError(errorMessage(error));}
      finally {this.releaseDevices();this.closing=undefined;}
    })();
    return this.closing;
  }
  private async closeServerSession() {
    const session=this.session;if(!session)return;
    const response=await fetch(`/api/voice/session/${encodeURIComponent(session.id)}/close`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({closeToken:session.closeToken}),keepalive:true,signal:AbortSignal.timeout(12000)});
    if(response.status!==404) {const result=await readJson(response);if(!result.confirmed)throw new Error('服務端尚未確認語音已結束。');}
    if(this.session===session)this.session=undefined;
  }
  private failConnection(message:string,epoch:number) {
    if(epoch!==this.epoch||this.state==='disconnecting'||this.state==='idle')return;
    this.readyReject?.(new Error(message));
    if(this.state==='connected'){this.options.onError(message);void this.disconnect();}
  }
  private clearReady(){clearTimeout(this.readyTimer);this.readyResolve=undefined;this.readyReject=undefined;}
  private releaseDevices() {
    this.outputInterrupted=false;this.nextUserSpeech=false;
    this.microphone?.getTracks().forEach(track=>track.stop());this.microphone=undefined;
    if(this.channel){this.channel.onmessage=null;this.channel.onerror=null;this.channel.close();this.channel=undefined;}
    if(this.peer){this.peer.ontrack=null;this.peer.onconnectionstatechange=null;this.peer.close();this.peer=undefined;}
    if(this.audio){this.audio.pause();this.audio.srcObject=null;this.audio=undefined;}
    window.removeEventListener('pagehide',this.closeOnPageHide);
  }
}
