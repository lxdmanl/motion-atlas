import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSession } from './VoiceSession';

afterEach(()=>vi.unstubAllGlobals());
function harness(configured=true) {
  const track={enabled:true,stop:vi.fn()};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const channel={readyState:'open',onmessage:undefined as ((event:{data:string})=>void)|undefined,onerror:null,send:vi.fn(),close:vi.fn()};
  const peer={iceGatheringState:'complete',connectionState:'new',localDescription:{sdp:'v=0'},ontrack:null,onconnectionstatechange:null,addTrack:vi.fn(),createDataChannel:()=>channel,createOffer:async()=>({type:'offer',sdp:'v=0'}),setLocalDescription:async()=>{},setRemoteDescription:async()=>{queueMicrotask(()=>channel.onmessage?.({data:JSON.stringify({type:'session.started'})}));},close:vi.fn()};
  const audio={autoplay:false,muted:false,srcObject:null,pause:vi.fn(),play:vi.fn(async()=>{})};
  const getUserMedia=vi.fn(async()=>stream);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia},sendBeacon:vi.fn()});
  vi.stubGlobal('RTCPeerConnection',class {constructor(){return peer;}});
  vi.stubGlobal('window',{RTCPeerConnection:class{},addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal('Audio',class {constructor(){return audio;}});
  const fetcher=vi.fn(async(url:string)=>{
    if(url==='/api/health')return new Response(JSON.stringify({apiKeyConfigured:configured}));
    if(url==='/api/voice/session')return new Response(JSON.stringify({id:'live_test',closeToken:'close-capability',provider:'live',sdp:'answer',model:'gpt-live-1'}));
    return new Response(JSON.stringify({confirmed:true}));
  });
  vi.stubGlobal('fetch',fetcher);
  const options={executeTool:vi.fn(async()=>({ok:true})),onStatus:vi.fn(),onTranscript:vi.fn(),onError:vi.fn()};
  return {voice:new VoiceSession(options),options,track,channel,peer,audio,fetcher,getUserMedia};
}
describe('browser voice lifecycle',()=>{
  it('does not request microphone or claim connection without a key',async()=>{
    const h=harness(false);await h.voice.connect();
    expect(h.voice.status).toBe('error');expect(h.getUserMedia).not.toHaveBeenCalled();expect(h.options.onStatus).not.toHaveBeenCalledWith('connected');
  });
  it('connects only after provider ready, mutes, closes upstream and releases all resources',async()=>{
    const h=harness();await h.voice.connect();expect(h.voice.status).toBe('connected');
    h.voice.mute(true);expect(h.track.enabled).toBe(false);expect(h.voice.muted).toBe(true);
    h.channel.onmessage?.({data:JSON.stringify({type:'session.output_transcript.delta',delta:'你好'})});
    expect(h.options.onTranscript).toHaveBeenCalledWith({role:'assistant',text:'你好',final:false});
    await h.voice.disconnect();expect(h.voice.status).toBe('idle');
    expect(h.fetcher.mock.calls.some(([url])=>url==='/api/voice/session/live_test/close')).toBe(true);
    expect(h.track.stop).toHaveBeenCalled();expect(h.peer.close).toHaveBeenCalled();expect(h.channel.close).toHaveBeenCalled();expect(h.audio.pause).toHaveBeenCalled();
  });
  it('does not release the close capability when upstream closure fails',async()=>{
    const h=harness();await h.voice.connect();
    h.fetcher.mockImplementation(async(url:string)=>url.endsWith('/close')?new Response(JSON.stringify({error:{message:'關閉未確認'}}),{status:502}):new Response('{}'));
    await h.voice.disconnect();expect(h.voice.status).toBe('error');expect(h.voice.provider).toBe('live');
    expect(h.track.stop).toHaveBeenCalled();expect(h.options.onError).toHaveBeenCalledWith('關閉未確認');
  });
  it('stops microphone access granted after the user cancelled connection',async()=>{
    const h=harness();let grant!:(stream:any)=>void;
    h.getUserMedia.mockImplementation(()=>new Promise(resolve=>{grant=resolve;}));
    const connecting=h.voice.connect();await vi.waitFor(()=>expect(h.getUserMedia).toHaveBeenCalled());
    await h.voice.disconnect();grant({getTracks:()=>[h.track],getAudioTracks:()=>[h.track]});await connecting;
    expect(h.track.stop).toHaveBeenCalled();expect(h.voice.status).toBe('idle');
    expect(h.fetcher.mock.calls.some(([url])=>url==='/api/voice/session')).toBe(false);
  });
});
