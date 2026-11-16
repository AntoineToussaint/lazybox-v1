import { follow, runnerLink, type RunnerClient } from '@lazybox/client-core';
import { foldTranscript, emptyTranscript } from './transcript-model';
import type { JournalEvent } from '@lazybox/protocol';
import type { Session } from '@lazybox/protocol';
import { INITIAL_MESSAGES } from './useChatScroll';

/** Milliseconds between published batches while records stream in, and between progress reports of a replay. */
const PUBLISH_INTERVAL=32,PROGRESS_INTERVAL=100;
/** How far a replay of retained history has come, while it is held back. */
export type ReplayProgress = { loaded: number; total: number };
type Snapshot = ReturnType<typeof emptyTranscript> & { status: string; error: string; loading: boolean; replay?: ReplayProgress };
/** Per-client readers survive navigation, without holding provider execution alive. */
export class ConversationReader {
 snapshot: Snapshot = {...emptyTranscript(),status:'Connecting',error:'',loading:true};
 session?: Session;
 view = {scrollTop:0,following:true,visibleMessages:INITIAL_MESSAGES};
 private listeners = new Set<()=>void>();
 private controller?: AbortController;
 identity:string;
 constructor(private api:RunnerClient,private id:string){this.identity=id;}
 getSnapshot = () => this.snapshot;
 private publish(value:Partial<Snapshot>){this.snapshot={...this.snapshot,...value};this.listeners.forEach(listener=>listener());}
 subscribe = (listener:()=>void) => {
  this.listeners.add(listener);this.start();
  return()=>{this.listeners.delete(listener);if(!this.listeners.size){this.controller?.abort();this.controller=undefined;this.flush();}};
 };
 get active(){return this.listeners.size>0;}
 private start(){
  if(this.controller||!this.id||this.snapshot.status==='Complete')return;
  const controller=new AbortController();this.controller=controller;
  void follow((after,signal)=>this.api.watchEvents({sessionId:this.id,after,includePrevious:true},{signal}),controller.signal,
   event=>{if(!controller.signal.aborted)this.receive(event);},
   status=>{if(!controller.signal.aborted)this.status(status);},
   error=>{if(!controller.signal.aborted){this.flush();this.publish({error:error.message,loading:false});}},this.snapshot.cursor);
 }
 // Replaying a saved conversation delivers thousands of records. Publishing
 // each one re-rendered the view per streamed delta and made opening a long
 // conversation take tens of seconds. While the Runner says retained history
 // is still coming, records are held and only progress is reported; the
 // conversation is published once, at its latest message, when the replay
 // catches up. Live records are published in batches, at most every couple
 // of frames.
 private queue:JournalEvent[]=[];
 private timer?:ReturnType<typeof setTimeout>;
 private flushed=0;
 private behind=false;
 private receive(event:JournalEvent){
  this.queue.push(event);
  const behind=event.retained>event.cursor,caughtUp=this.behind&&!behind;this.behind=behind;
  if(caughtUp){clearTimeout(this.timer);this.timer=setTimeout(this.flush,0);}
  else this.timer??=setTimeout(this.tick,behind?PROGRESS_INTERVAL:Math.max(0,this.flushed+PUBLISH_INTERVAL-Date.now()));
 }
 private tick=()=>{
  this.timer=undefined;
  const last=this.queue.at(-1);
  if(this.behind&&last)this.publish({replay:{loaded:Number(last.cursor),total:Number(last.retained)}});
  else this.flush();
 };
 private status(status:string){
  if(status==='Live'&&this.snapshot.status==='Live')return;
  if(status==='Live'&&this.queue.length){this.pendingStatus=status;return;}
  this.flush();this.publish({status,...(status==='Complete'?{loading:false}:{})});
 }
 private pendingStatus?:string;
 /** Fold every queued record now; the cursor is current once this returns. */
 flush=()=>{
  clearTimeout(this.timer);this.timer=undefined;
  const batch=this.queue,status=this.pendingStatus;this.queue=[];this.pendingStatus=undefined;this.flushed=Date.now();
  if(batch.length)this.publish({...foldTranscript(this.snapshot,batch),loading:false,replay:undefined,...(status?{status}:{})});
  else if(this.snapshot.replay)this.publish({replay:undefined});
 };
 retry=()=>{this.controller?.abort();this.controller=undefined;clearTimeout(this.timer);this.timer=undefined;this.queue=[];this.behind=false;this.pendingStatus=undefined;this.publish({...emptyTranscript(),error:'',loading:true,status:'Connecting',replay:undefined});if(this.active)this.start();};
}
// Keyed by the window's Runner link, not one client: a restarted Runner gives
// the window a new client, and its readers continue from their cursors.
const caches=new WeakMap<object,Map<string,ConversationReader>>();
const owner=(api:RunnerClient):object=>runnerLink(api)||api;
export function conversationReader(api:RunnerClient,id:string){
 let cache=caches.get(owner(api));if(!cache){cache=new Map();caches.set(owner(api),cache);}
 let entry=cache.get(id);if(!entry){entry=new ConversationReader(api,id);cache.set(id,entry);}
 // Keep recent inactive readers; never evict a reader mounted in another panel.
 cache.delete(id);cache.set(id,entry);
 for(const [key,value] of cache){if(cache.size<=16)break;if(key!==id&&!value.active)cache.delete(key);}
 return entry;
}

export function forgetConversation(api:RunnerClient,id:string){caches.get(owner(api))?.delete(id);}

/** A successor extends the same contiguous Runner timeline; retain its rendered prefix. */
export function continueConversation(api:RunnerClient,previousId:string,session:Session){
 const next=conversationReader(api,session.id);
 if(session.previousExecutionId!==previousId)return next;
 const previous=conversationReader(api,previousId);
 next.identity=previous.identity;
 if(!next.active&&next.snapshot.cursor<previous.snapshot.cursor){
  next.snapshot={...previous.snapshot,status:'Connecting',error:'',loading:false};
  next.view={...previous.view};
 }
 next.session=session;
 return next;
}
