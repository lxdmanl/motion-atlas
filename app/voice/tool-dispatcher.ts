import { sanitizeMotionSnapshot, validateToolArguments } from '../../server/tools';

export type ExecuteTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type EventRecord = Record<string, any>;
interface ToolCall { call_id: string; name: string; arguments: string; }
interface Batch { calls: Set<string>; pending: number; complete: boolean; continued: boolean; }

/** Only finished tool items may run. Duplicate delivery cannot repeat UI changes. */
export class ToolDispatcher {
  private currentResponses = new Map<string,string>();
  private seen = new Set<string>();
  private batches = new Map<string, Batch>();
  private generation = 0;
  constructor(private provider: 'live' | 'realtime', private execute: ExecuteTool, private send: (event: EventRecord) => void, private active: () => boolean) {}
  reset() { this.generation++; this.seen.clear(); this.batches.clear(); this.currentResponses.clear(); }
  async handle(event: EventRecord, scope = 'primary') {
    if (event.type === 'response.created' && event.response?.id) this.currentResponses.set(scope,event.response.id);
    // Live may keep two delegated responses running while the user interrupts.
    // Output-item events do not necessarily carry response_id; retain the
    // enclosing delegation ID so their tool results continue the correct batch.
    const id = event.response_id ?? event.response?.id ?? this.currentResponses.get(scope) ?? scope;
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') await this.run(event.item, id);
    if (event.type === 'response.completed' || event.type === 'response.done') {
      // Realtime response.done also carries final items. Deduplication handles
      // providers that delivered those items earlier in output_item.done.
      const jobs = (event.response?.output ?? []).filter((item: EventRecord) => item.type === 'function_call').map((item: ToolCall) => this.run(item, id));
      const batch = this.batch(id); batch.complete = true;
      await Promise.all(jobs); this.continueWhenReady(batch);
    }
  }
  private batch(id: string) {
    let batch = this.batches.get(id);
    if (!batch) { batch = { calls:new Set(),pending:0,complete:false,continued:false }; this.batches.set(id,batch); }
    return batch;
  }
  private async run(item: ToolCall, responseId: string) {
    if (!this.active() || typeof item.call_id !== 'string' || this.seen.has(item.call_id)) return;
    this.seen.add(item.call_id);
    const batch = this.batch(responseId); batch.calls.add(item.call_id); batch.pending++;
    const generation = this.generation;
    let output: unknown;
    try {
      if (typeof item.arguments !== 'string' || item.arguments.length > 16000) throw new Error('工具參數過長或格式錯誤');
      const args = validateToolArguments(item.name, item.arguments);
      const result = await this.execute(item.name,args);
      if (item.name === 'get_motion_state') {
        const wrapped = result && typeof result === 'object' && 'snapshot' in result ? (result as {snapshot:unknown}).snapshot : result;
        output = {ok:true,snapshot:sanitizeMotionSnapshot(wrapped)};
      } else if (item.name === 'highlight_structures' || item.name === 'set_anatomy_view') {
        if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) throw new Error('畫面尚未確認更新成功');
        output = result;
      } else output = {ok:true,data:result};
    } catch(error) { output = {ok:false,error:error instanceof Error ? error.message : '工具執行失敗'}; }
    batch.pending--;
    if (!this.active() || generation !== this.generation) return;
    this.send({type:this.provider === 'live' ? 'response.item.create' : 'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}});
    this.continueWhenReady(batch);
  }
  private continueWhenReady(batch: Batch) {
    if (!this.active() || !batch.complete || batch.pending !== 0 || batch.calls.size === 0 || batch.continued) return;
    batch.continued = true; this.send({type:'response.create'});
  }
}
