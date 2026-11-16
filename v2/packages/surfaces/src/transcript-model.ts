import type { JournalEvent } from '@lazybox/protocol';
import { providerData } from '@lazybox/client-core';

export type TranscriptMessage = { id: string; type: string; text: string; turnId: string; files?: { name: string; size: number }[]; count?: number };
export type Transcript = { messages: TranscriptMessage[]; recent: JournalEvent[]; activity: JournalEvent[]; activityTruncated: boolean; cursor: bigint; appendToLast: boolean; reportedModel:string };
export const emptyTranscript = (): Transcript => ({ messages: [], recent: [], activity: [], activityTruncated: false, cursor: 0n, appendToLast: false, reportedModel:'' });

/** Fold one record into durable message-shaped state; diagnostic events are bounded separately. */
export function appendTranscript(state: Transcript, record: JournalEvent): Transcript {
  return foldTranscript(state, [record]);
}

const RECENT = 80, ACTIVITY = 1024;
/**
 * Fold a batch of records with one copy of each array, not one per record.
 * Replaying a long conversation is tens of thousands of streamed deltas; a
 * per-record copy of the message list made opening one quadratic. The input
 * state is never mutated: objects created in this batch are the only ones
 * extended in place.
 */
export function foldTranscript(state: Transcript, records: readonly JournalEvent[]): Transcript {
  const fresh: JournalEvent[] = [];
  let cursor = state.cursor;
  for (const record of records) if (record.cursor > cursor) { fresh.push(record); cursor = record.cursor; }
  if (!fresh.length) return state;
  const next: Transcript = { ...state, messages: state.messages, recent: state.recent, activity: state.activity };
  let messages: TranscriptMessage[] | undefined;
  const activity: JournalEvent[] = [];
  const owned = new Set<TranscriptMessage>();
  const list = () => messages ??= [...state.messages];
  const replaceLast = (message: TranscriptMessage) => { const m = list(); m[m.length - 1] = message; owned.add(message); };
  const add = (message: TranscriptMessage) => { list().push(message); owned.add(message); };
  for (const record of fresh) {
    next.cursor = record.cursor;
    const event = record.event;
    if (event && ACTIVITY_TYPES.has(event.type)) activity.push(record);
    if (!event || (event.agentId && event.agentId !== 'root')) continue;
    if (event.type === 'session_ready' || event.type === 'context' || event.type === 'usage') {
      const model = providerData(event.providerDataJson).model;
      if (typeof model === 'string' && model.trim()) next.reportedModel = model;
    }
    const last = (messages ?? state.messages).at(-1);
    // A restart that interrupted nothing is not worth a card: consecutive ones
    // collapse into one quiet line, so hot reloads do not flood the conversation.
    if (event.type === 'runner_reattached' && !record.receipt) {
      if (last?.type === 'reattached') replaceLast({ ...last, count: (last.count || 1) + 1 });
      else add({ id: record.cursor.toString(), type: 'reattached', text: '', turnId: event.turnId, count: 1 });
      continue;
    }
    const notice = runnerNotice(record);
    if (notice) {
      add({ id: record.cursor.toString(), type: 'notice', text: notice, turnId: event.turnId });
      next.appendToLast = false;
      continue;
    }
    const files = event.type === 'operation_accepted' ? providerData(event.providerDataJson).files as TranscriptMessage['files'] : undefined;
    if (event.type === 'message_delta' && event.text) {
      if (next.appendToLast && last?.type === 'message_delta' && last.turnId === event.turnId) {
        if (owned.has(last)) last.text += event.text;
        else replaceLast({ ...last, text: last.text + event.text });
      } else add({ id: record.cursor.toString(), type: event.type, text: event.text, turnId: event.turnId });
      next.appendToLast = true;
    } else if ((event.type === 'operation_accepted' || event.type === 'failure') && (event.text || files?.length)) {
      add({ id: record.cursor.toString(), type: event.type, text: event.text, turnId: event.turnId, files });
      next.appendToLast = false;
    } else if (BOUNDARY_TYPES.has(event.type) || (event.type === 'activity' && event.status === 'tool')) {
      next.appendToLast = false;
    }
  }
  if (messages) next.messages = messages;
  if (activity.length) {
    // Bound only what is retained: a long replay drops most activity anyway.
    const room = ACTIVITY - activity.length;
    const kept = [...(room > 0 ? state.activity.slice(-room) : []), ...activity.slice(-ACTIVITY).map(boundedActivity)];
    if (state.activity.length + activity.length > ACTIVITY) next.activityTruncated = true;
    next.activity = kept;
  }
  next.recent = fresh.length >= RECENT ? fresh.slice(-RECENT) : [...state.recent, ...fresh].slice(-RECENT);
  return next;
}
const ACTIVITY_TYPES = new Set(['tool_catalog', 'tool_activity', 'turn_ended', 'failure', 'session_closed']);
const BOUNDARY_TYPES = new Set(['turn_started', 'turn_ended', 'session_closed', 'approval', 'question', 'request_resolved']);

/**
 * Runner restarts are not interruptions: agents and commands keep running and
 * the next Runner re-attaches. What a restart can leave uncertain is said
 * plainly, in the conversation, where the user will look for it.
 */
export function runnerNotice(record: JournalEvent): string {
  const event = record.event;
  if (record.receipt?.delivery === 'unknown_after_runner_restart')
    return 'The Runner restarted before it could confirm this message reached the agent. It was not sent again; resend it if it is still needed.';
  if (event?.type === 'runner_reattached')
    return 'The Runner restarted and re-attached to this agent. Nothing was interrupted.';
  if (event?.type === 'request_resolved' && event.status === 'outcome_unknown_after_restart')
    return 'The Runner restarted while a command the agent started was in flight. Its outcome is unknown, so it was not run again; the agent was told to check before retrying.';
  return '';
}

// Tool results can contain images or megabytes of logs. Keep a bounded display
// projection while the Runner journal owns the original evidence.
function boundedActivity(record:JournalEvent):JournalEvent {
 const event=record.event;if(!event||event.providerDataJson.length<=32768)return record;
 let raw:any;try{raw=JSON.parse(new TextDecoder().decode(event.providerDataJson));}catch{return {...record,event:{...event,providerDataJson:new Uint8Array()}};}
 const limit=(v:any,depth=0):any=>typeof v==='string'?v.length>4096?v.slice(0,4096)+'\n[Preview truncated]':v:depth>5?'[Nested content omitted]':Array.isArray(v)?v.slice(0,20).map(x=>limit(x,depth+1)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).slice(0,30).map(([k,x])=>[k,limit(x,depth+1)])):v;
 let data=new TextEncoder().encode(JSON.stringify(limit(raw)));
 if(data.length>32768){const item=raw.item;raw=item?{item:{id:item.id,type:item.type,tool:item.tool,status:item.status,exitCode:item.exitCode,result:'[Large payload omitted]'}}:{type:raw.type,id:raw.id,tool_use_id:raw.tool_use_id,name:raw.name,status:raw.status,is_error:raw.is_error,output:raw.output===undefined?undefined:'[Large payload omitted]',input:'[Large payload omitted]',content:'[Large payload omitted]'};data=new TextEncoder().encode(JSON.stringify(raw));}
 return {...record,event:{...event,providerDataJson:data}};
}
