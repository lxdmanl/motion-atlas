import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeMotionSnapshot, validateToolArguments } from './tools';
import { ApiError, createProviderSession, closeProviderSession, mayFallbackToRealtime, type SocketFactory } from './provider';
import { authorizedClose, allowedLocalOrigin, createApp } from './app';
import { ToolDispatcher } from '../app/voice/tool-dispatcher';
import { mountFrontend } from './frontend';

const config = {apiKey:'not-a-real-key',liveModel:'gpt-live-1',realtimeModel:'gpt-realtime',textModel:'test-model'};
const snapshot = {source:'camera',side:'right',joint:'elbow',angleDeg:91,phase:'flexing',quality:.92,capturedAt:10000,status:'tracking',fps:30};
describe('tool boundary',()=>{
  it('removes stale, low-confidence, nonfinite and invalid geometry',()=>{
    expect(sanitizeMotionSnapshot(snapshot,11000).angleDeg).toBe(91);
    for(const change of [{capturedAt:1000},{quality:.2},{angleDeg:NaN},{angleDeg:181},{side:'left'},{status:'lost'}]) expect(sanitizeMotionSnapshot({...snapshot,...change},11000).angleDeg).toBeNull();
    expect(sanitizeMotionSnapshot({...snapshot,source:'demo'},11000).source).toBe('demo');
    expect(sanitizeMotionSnapshot({...snapshot,source:'demo'},12000).angleDeg).toBeNull();
    expect(sanitizeMotionSnapshot(undefined,11000).status).toBe('idle');
  });
  it('rejects arbitrary tools, IDs and argument fields',()=>{
    expect(()=>validateToolArguments('run_shell',{})).toThrow();
    expect(()=>validateToolArguments('highlight_structures',{ids:['not-real']})).toThrow();
    expect(()=>validateToolArguments('get_motion_state',{url:'https://invalid.example'})).toThrow();
    expect(()=>validateToolArguments('set_anatomy_view',{layers:{muscular:'yes'}})).toThrow();
    expect(validateToolArguments('highlight_structures',{ids:['FJ1478','FJ1478']})).toEqual({ids:['FJ1478']});
  });
  it('does not confirm failed UI tools, deduplicates calls, and continues only after completion',async()=>{
    const send=vi.fn(), execute=vi.fn(async()=>({ok:false}));
    const dispatch=new ToolDispatcher('live',execute,send,()=>true);
    const item={type:'function_call',call_id:'c1',name:'highlight_structures',arguments:'{"ids":["FJ1478"]}'};
    await dispatch.handle({type:'response.created',response:{id:'r1'}});
    await dispatch.handle({type:'response.function_call_arguments.done',call_id:'c1',arguments:item.arguments});
    expect(execute).not.toHaveBeenCalled();
    await dispatch.handle({type:'response.output_item.done',item});
    await dispatch.handle({type:'response.output_item.done',item});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0].item.output).ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    await dispatch.handle({type:'response.completed',response:{id:'r1',output:[]}});
    expect(send.mock.calls[1][0]).toEqual({type:'response.create'});
  });
  it('discards async tool results after disconnect',async()=>{
    let resolve!:(value:unknown)=>void;
    const send=vi.fn(); const dispatch=new ToolDispatcher('realtime',()=>new Promise(r=>{resolve=r;}),send,()=>true);
    const task=dispatch.handle({type:'response.output_item.done',item:{type:'function_call',call_id:'c2',name:'get_motion_state',arguments:'{}'}});
    dispatch.reset();resolve(snapshot);await task;expect(send).not.toHaveBeenCalled();
  });
  it('keeps overlapping Live delegation batches separate',async()=>{
    const send=vi.fn();const dispatch=new ToolDispatcher('live',async()=>({ok:true}),send,()=>true);
    await dispatch.handle({type:'response.created',response:{id:'r1'}},'delegation-1');
    await dispatch.handle({type:'response.created',response:{id:'r2'}},'delegation-2');
    await dispatch.handle({type:'response.output_item.done',item:{type:'function_call',call_id:'c1',name:'highlight_structures',arguments:'{"ids":["FJ1478"]}'}},'delegation-1');
    await dispatch.handle({type:'response.completed',response:{id:'r2',output:[]}},'delegation-2');
    expect(send.mock.calls.filter(([event])=>event.type==='response.create')).toHaveLength(0);
    await dispatch.handle({type:'response.completed',response:{id:'r1',output:[]}},'delegation-1');
    expect(send.mock.calls.filter(([event])=>event.type==='response.create')).toHaveLength(1);
  });
});
describe('production frontend',()=>{
  it('serves built assets and SPA routes, with a clear missing-build message',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'motion-atlas-voice-test-'));
    const instance=createApp({...config,apiKey:''});mountFrontend(instance.app,directory);
    const server=instance.app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error('No local port');
    const base=`http://127.0.0.1:${address.port}`;
    try {
      const missing=await fetch(base+'/');expect(missing.status).toBe(503);expect(await missing.text()).toContain('npm run build');
      await writeFile(join(directory,'index.html'),'<h1>Test production frontend</h1>');
      await writeFile(join(directory,'.env.local'),'DO_NOT_SERVE_THIS');
      expect(await (await fetch(base+'/')).text()).toContain('Test production frontend');
      expect(await (await fetch(base+'/nested/route')).text()).toContain('Test production frontend');
      expect(await (await fetch(base+'/.env.local')).text()).not.toContain('DO_NOT_SERVE_THIS');
      expect((await fetch(base+'/api/does-not-exist')).status).toBe(404);
      expect((await fetch(base+'/api/health')).status).toBe(200);
    } finally {
      server.close();await instance.shutdown();
      await rm(join(directory,'index.html'),{force:true});
      await rm(join(directory,'.env.local'),{force:true});
      await rmdir(directory);
    }
  });
});
describe('provider fallback and closure',()=>{
  it('falls back for explicit model access only',()=>{
    expect(mayFallbackToRealtime(new ApiError(404,'model_not_found',''))).toBe(true);
    for(const [status,code] of [[401,'invalid_api_key'],[429,'insufficient_quota'],[503,'server_error'],[400,'invalid_request_error']] as const) expect(mayFallbackToRealtime(new ApiError(status,code,''))).toBe(false);
  });
  it('uses Live first; explicit unavailable model falls back to Realtime',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'model_not_found'}}),{status:404})).mockResolvedValueOnce(new Response('answer-sdp',{status:201,headers:{location:'/v1/realtime/calls/rtc_123'}}));
    const session=await createProviderSession('v=0',config,fetcher as typeof fetch);
    expect(session.provider).toBe('realtime');expect(session.id).toBe('rtc_123');expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry/fallback on authentication error',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'invalid_api_key'}}),{status:401}));
    await expect(createProviderSession('v=0',config,fetcher as typeof fetch)).rejects.toMatchObject({status:401});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('terminates Realtime upstream and propagates failure',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:200}));
    await expect(closeProviderSession({provider:'realtime',id:'rtc_1'},'fake',fetcher as typeof fetch)).resolves.toMatchObject({confirmed:true});
    expect(fetcher.mock.calls[0][0]).toContain('/realtime/calls/rtc_1/hangup');
  });
  it('Live sends session.close and requires final session.closed',async()=>{
    class FakeSocket extends EventEmitter {send=vi.fn();terminate=vi.fn();}
    const socket=new FakeSocket();
    const result=closeProviderSession({provider:'live',id:'live_1'},'fake',fetch,(()=>socket) as unknown as SocketFactory);
    socket.emit('open');expect(JSON.parse(socket.send.mock.calls[0][0]).type).toBe('session.close');
    socket.emit('message',Buffer.from(JSON.stringify({type:'session.closed',usage:{seconds:12}})));
    await expect(result).resolves.toEqual({confirmed:true,usageSeconds:12});expect(socket.terminate).toHaveBeenCalledOnce();
  });
});
describe('local API authorization',()=>{
  it('checks origin and per-session capability token',()=>{
    expect(allowedLocalOrigin('https://malicious.example')).toBe(false);
    expect(allowedLocalOrigin('http://localhost:3016')).toBe(true);
    expect(authorizedClose('secret','wrong')).toBe(false);
    expect(authorizedClose('secret','secret')).toBe(true);
  });
  it('missing API key reports unavailable without a provider call',async()=>{
    const services={create:vi.fn(),close:vi.fn(),explain:vi.fn()};
    const instance=createApp({...config,apiKey:''},services);
    const server=instance.app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error('No local port');
    try {
      const response=await fetch(`http://127.0.0.1:${address.port}/api/voice/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"sdp":"v=0"}'});
      expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('missing_api_key');expect(services.create).not.toHaveBeenCalled();
    } finally {server.close();await instance.shutdown();}
  });
  it('retains failed closure for retry and rejects a different session token',async()=>{
    const close=vi.fn().mockRejectedValueOnce(new Error('temporary network failure')).mockResolvedValue({confirmed:true});
    const services={create:vi.fn(async()=>({id:'live_test',provider:'live' as const,sdp:'answer',model:'gpt-live-1'})),close,explain:vi.fn()};
    const instance=createApp(config,services);const server=instance.app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error('No local port');
    const base=`http://127.0.0.1:${address.port}`;
    const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    try {
      const created=await (await post('/api/voice/session',{sdp:'v=0'})).json();
      expect(created.id).toBe('live_test');
      expect((await post('/api/voice/session/live_test/close',{closeToken:'wrong'})).status).toBe(403);expect(close).not.toHaveBeenCalled();
      expect((await post('/api/voice/session/live_test/close',{closeToken:created.closeToken})).status).toBe(502);expect(instance.sessions.size).toBe(1);
      expect((await post('/api/voice/session/live_test/close',{closeToken:created.closeToken})).status).toBe(200);expect(instance.sessions.size).toBe(0);
    } finally {server.close();await instance.shutdown();}
  });
});
