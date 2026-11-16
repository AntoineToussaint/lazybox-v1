import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '@bufbuild/protobuf';
import { JournalEventSchema } from '@lazybox/protocol';
import { appendTranscript, emptyTranscript } from '../packages/surfaces/src/transcript-model.ts';
test('diagnostic limits never truncate conversation text or prompts', () => {
 let state=emptyTranscript();
 const add=(type:string,text:string,turnId='turn')=>{state=appendTranscript(state,create(JournalEventSchema,{cursor:state.cursor+1n,event:{type,text,turnId}}));};
 add('operation_accepted','prompt');
 for(let i=0;i<2000;i++)add('message_delta','x');
 assert.equal(state.messages[0].text,'prompt');assert.equal(state.messages[1].text.length,2000);assert.equal(state.recent.length,80);
 add('turn_ended','');add('message_delta','next');assert.equal(state.messages.length,3);
 add('message_delta','other turn','second');assert.equal(state.messages.length,4);
 const duplicate=state.recent.at(-1)!;assert.equal(appendTranscript(state,duplicate),state);
});

import {fileReference} from '../packages/surfaces/src/file-reference.ts';
test('file links preserve line anchors and reject executable schemes',()=>{
 assert.deepEqual(fileReference('handbook/concepts/glossary.md:12'),{path:'handbook/concepts/glossary.md',line:12});
 assert.deepEqual(fileReference('README.md#L2'),{path:'README.md',line:2});
 assert.deepEqual(fileReference('/workspace/api/a%20b.ts:5:2'),{path:'/workspace/api/a b.ts',line:5});
 for(const value of ['javascript:alert(1)','https://example.com/a.md','data:text/plain,a','not a file'])assert.equal(fileReference(value),undefined);
});

import {ConversationReader,conversationReader,continueConversation} from '../packages/surfaces/src/transcript-cache.ts';
import type {RunnerClient} from '@lazybox/client-core';
import {conversationDetails,sessionModelLabel,sessionAccountLabel} from '../packages/surfaces/src/conversation-model.ts';
import {SessionSchema,ProfileSchema} from '@lazybox/protocol';
test('reader retains transcript and resumes from its cursor when remounted',async()=>{
 const cursors:bigint[]=[];let event=1;
 const api={async *watchEvents({after}:{after:bigint},{signal}:{signal:AbortSignal}){cursors.push(after);yield create(JournalEventSchema,{cursor:BigInt(event++),event:{type:'message_delta',text:'answer'}});await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}} as unknown as RunnerClient;
 const reader=conversationReader(api,'chat');const unsubscribe=reader.subscribe(()=>{});await new Promise(resolve=>setTimeout(resolve,5));unsubscribe();
 assert.equal(reader.getSnapshot().messages[0].text,'answer');assert.equal(conversationReader(api,'chat'),reader);
 const stop=reader.subscribe(()=>{});await new Promise(resolve=>setTimeout(resolve,5));stop();assert.deepEqual(cursors,[0n,1n]);assert.equal(reader.getSnapshot().messages[0].text,'answeranswer');
});
test('conversation details identify provider, model provenance and subscription',()=>{
 const session=create(SessionSchema,{provider:'codex',profileId:'saved',model:'test-model',modelReported:true});const profile=create(ProfileSchema,{id:'saved',label:'Work account'});
 assert.equal(conversationDetails(session,[profile]),'Codex · test-model · Work account');session.modelReported=false;assert.match(conversationDetails(session,[profile]),/test-model \(requested\)/);session.model='';assert.equal(conversationDetails(session,[]),'Codex · Saved account','an unknown model is left out, never a placeholder');
});

import {compareRepositories,repositoryOrganization} from '../packages/surfaces/src/repository-model.ts';
test('repository grouping sorts organization then repository and puts locals last',()=>{
 const rows=[{identity:'local:z',name:'local'},{identity:'github:zoo/api',name:'zoo/api'},{identity:'github:alpha/web',name:'alpha/web'},{identity:'github:alpha/api',name:'alpha/api'}].sort(compareRepositories);
 assert.deepEqual(rows.map(row=>row.name),['alpha/api','alpha/web','zoo/api','local']);assert.equal(repositoryOrganization(rows[0].identity),'alpha');
});


test('main agent model survives diagnostic eviction and ignores child models',()=>{
 let state=emptyTranscript();
 const add=(type:string,model:string,agentId='root')=>state=appendTranscript(state,create(JournalEventSchema,{cursor:state.cursor+1n,event:{type,agentId,providerDataJson:new TextEncoder().encode(JSON.stringify({model}))}}));
 add('session_ready','actual-main-model');for(let i=0;i<100;i++)add('activity','');
 add('context','child-model','reviewer');assert.equal(state.reportedModel,'actual-main-model');
 add('usage','updated-main-model');assert.equal(state.reportedModel,'updated-main-model');
});


test('model and account labels distinguish reported models from internal defaults',()=>{
 const session=create(SessionSchema,{profileId:'claude-default',model:'alias'});
 assert.equal(sessionModelLabel(session),'alias (requested)');
 assert.equal(sessionModelLabel(session,'provider-exact-model'),'provider-exact-model');
 assert.equal(sessionModelLabel(), '', 'an unknown model is left out, never a placeholder');
 assert.equal(sessionAccountLabel(session),'Account not reported');
});

test('successor keeps transcript identity and cursor, unrelated executions remain separate',async()=>{
 const calls:{id:string;after:bigint}[]=[];
 const api={async *watchEvents({sessionId,after}:{sessionId:string;after:bigint}){calls.push({id:sessionId,after});if(!after)yield create(JournalEventSchema,{cursor:1n,event:{type:'message_delta',text:'retained'}});}} as unknown as RunnerClient;
 const old=conversationReader(api,'old');const stop=old.subscribe(()=>{});await new Promise(resolve=>setTimeout(resolve,5));stop();old.view.scrollTop=120;
 const next=continueConversation(api,'old',create(SessionSchema,{id:'next',previousExecutionId:'old'}));assert.equal(next.identity,old.identity);assert.equal(next.snapshot.messages,old.snapshot.messages);assert.equal(next.view.scrollTop,120);const end=next.subscribe(()=>{});await new Promise(resolve=>setTimeout(resolve,5));end();assert.deepEqual(calls,[{id:'old',after:0n},{id:'next',after:1n}]);
 const unrelated=continueConversation(api,'old',create(SessionSchema,{id:'unrelated'}));assert.equal(unrelated.snapshot.cursor,0n);assert.equal(unrelated.identity,'unrelated');
});

test('runner restarts surface what they leave uncertain, and only that',()=>{
 let state=emptyTranscript();
 const add=(fields:Record<string,unknown>)=>{state=appendTranscript(state,create(JournalEventSchema,{cursor:state.cursor+1n,...fields}));};
 add({event:{type:'operation_accepted',text:'deploy it'}});
 add({event:{type:'message_delta',text:'Deploying',turnId:'t'}});
 add({event:{type:'runner_reattached',status:'native_process_adopted'}});
 add({event:{type:'message_delta',text:' now',turnId:'t'}});
 add({event:{type:'request_resolved',status:'outcome_unknown_after_restart',requestId:'n:41'}});
 add({event:{type:'request_resolved',status:'response_written',requestId:'n:42'}});
 add({event:{type:'receipt'},receipt:{operationId:'second',delivery:'unknown_after_runner_restart'}});
 add({event:{type:'receipt'},receipt:{operationId:'third',delivery:'accepted'}});
 assert.deepEqual(state.messages.map(m=>m.type),['operation_accepted','message_delta','reattached','message_delta','notice','notice']);
 assert.equal(state.messages[2].count,1,'a restart that interrupted nothing is a quiet line, not a card');
 assert.match(state.messages[4].text,/outcome is unknown/);
 assert.match(state.messages[5].text,/not sent again/);
 assert.equal(state.messages[1].text,'Deploying','a restart notice must not merge into the reply around it');
});

test('consecutive harmless restarts collapse into one line',()=>{
 let state=emptyTranscript();
 const add=(fields:Record<string,unknown>)=>{state=appendTranscript(state,create(JournalEventSchema,{cursor:state.cursor+1n,...fields}));};
 add({event:{type:'message_delta',text:'Done',turnId:'t'}});
 for(let i=0;i<5;i++)add({event:{type:'runner_reattached',status:'native_process_adopted'}});
 assert.deepEqual(state.messages.map(m=>[m.type,m.count]),[['message_delta',undefined],['reattached',5]]);
 add({event:{type:'operation_accepted',text:'next'}});
 add({event:{type:'runner_reattached',status:'native_process_adopted'}});
 assert.deepEqual(state.messages.map(m=>m.type),['message_delta','reattached','operation_accepted','reattached'],'restarts separated by other messages stay separate');
});

import {foldTranscript} from '../packages/surfaces/src/transcript-model.ts';
import {longConversation} from './fixtures/long-conversation.mjs';
const wireRecords=(events:any[],from=1)=>events.map((e,i)=>create(JournalEventSchema,{cursor:BigInt(from+i),capturedAt:'2026-11-16T10:00:00Z',event:{...e,providerDataJson:e.providerDataJson?Buffer.from(e.providerDataJson,'base64'):new Uint8Array()}}));
test('folding a batch equals folding its records one by one',()=>{
 const records=wireRecords(longConversation({turns:30}));
 let one=emptyTranscript();for(const record of records)one=appendTranscript(one,record);
 // Any split into batches, including one record and the whole replay, lands on the same state.
 for(const size of [1,7,500,records.length]){
  let batched=emptyTranscript();for(let i=0;i<records.length;i+=size)batched=foldTranscript(batched,records.slice(i,i+size));
  assert.deepEqual(batched.messages,one.messages,`batches of ${size}`);
  assert.deepEqual(batched.recent.map(r=>r.cursor),one.recent.map(r=>r.cursor));
  assert.deepEqual(batched.activity.map(r=>r.cursor),one.activity.map(r=>r.cursor));
  assert.equal(batched.activityTruncated,one.activityTruncated);assert.equal(batched.cursor,one.cursor);assert.equal(batched.reportedModel,one.reportedModel);assert.equal(batched.appendToLast,one.appendToLast);
 }
 // Each turn: the prompt, its tool calls as one run of lines, the answer.
 assert.equal(one.messages.length,90);assert.equal(one.messages.filter(m=>m.type==='tools').length,30);assert.match(one.messages.at(-1)!.text,/ANSWER_END_29$/);assert.equal(one.reportedModel,'claude-fixture-model');
});
test('a fold never changes the state it extends, and skips records it already has',()=>{
 const records=wireRecords([{type:'operation_accepted',text:'q'},{type:'message_delta',text:'a',turnId:'t'},{type:'message_delta',text:'b',turnId:'t'}]);
 const first=foldTranscript(emptyTranscript(),records.slice(0,2));const snapshot=structuredClone(first.messages);
 const second=foldTranscript(first,records.slice(1));
 assert.deepEqual(first.messages,snapshot,'the earlier snapshot a view rendered is unchanged');
 assert.notEqual(second.messages.at(-1),first.messages.at(-1));assert.equal(second.messages.at(-1)!.text,'ab');
 assert.equal(foldTranscript(second,records),second,'a replayed batch is a no-op');
 assert.equal(foldTranscript(second,[]),second);
});
test('activity keeps the latest 1,024 events and says it dropped the rest',()=>{
 const records=wireRecords(Array.from({length:1500},(_,i)=>({type:'tool_activity',providerDataJson:Buffer.from(JSON.stringify({type:'tool_call',id:`t${i}`,name:'Bash',status:'completed'})).toString('base64')})));
 const batched=foldTranscript(emptyTranscript(),records);
 assert.equal(batched.activity.length,1024);assert.equal(batched.activity[0].cursor,477n);assert.equal(batched.activityTruncated,true);
 const small=foldTranscript(foldTranscript(emptyTranscript(),records.slice(0,1000)),records.slice(1000,1010));
 assert.equal(small.activity.length,1010);assert.equal(small.activityTruncated,false);
});
test('a reader publishes a replay burst once, not once per record',async()=>{
 const records=wireRecords(longConversation({turns:20,toolOutputBytes:200}));
 const api={async *watchEvents(){yield* records;}} as unknown as RunnerClient;
 const reader=new ConversationReader(api,'burst');let published=0;
 const stop=reader.subscribe(()=>{published++;});
 await new Promise(resolve=>setTimeout(resolve,100));stop();
 const state=reader.getSnapshot();
 assert.equal(state.cursor,BigInt(records.length));assert.equal(state.messages.length,60);assert.equal(state.status,'Complete');assert.equal(state.loading,false);
 assert.ok(published<=4,`${records.length} records published ${published} times`);
});
test('a replay is held until it reaches the retained history, reporting progress meanwhile',async()=>{
 const records=wireRecords(longConversation({turns:6,toolOutputBytes:200}));const total=BigInt(records.length);
 for(const record of records)record.retained=total;
 const live=create(JournalEventSchema,{cursor:total+1n,retained:total+1n,event:{type:'operation_accepted',text:'LIVE'}});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const api={async *watchEvents(){for(const [i,record] of records.slice(0,-1).entries()){yield record;if(i%50===0)await new Promise(resolve=>setTimeout(resolve,20));}await gate;yield records.at(-1)!;yield live;await new Promise(()=>{});}} as unknown as RunnerClient;
 const reader=new ConversationReader(api,'held');const seen:{messages:number;replay?:{loaded:number;total:number}}[]=[];
 const stop=reader.subscribe(()=>{const s=reader.getSnapshot();seen.push({messages:s.messages.length,replay:s.replay});});
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(reader.getSnapshot().messages.length,0,'nothing from the middle of the history is shown');
 assert.ok(reader.getSnapshot().loading);const progress=reader.getSnapshot().replay!;assert.equal(progress.total,records.length);assert.ok(progress.loaded>0&&progress.loaded<records.length);
 release();await new Promise(resolve=>setTimeout(resolve,100));
 const state=reader.getSnapshot();stop();
 assert.equal(state.replay,undefined);assert.equal(state.loading,false);assert.equal(state.messages.at(-1)!.text,'LIVE');
 assert.equal(seen.filter(s=>s.messages>0)[0].messages,19,'the first published conversation is the whole history');
});
