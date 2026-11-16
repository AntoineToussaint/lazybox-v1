import {test} from 'node:test';import assert from 'node:assert/strict';
import {create} from '@bufbuild/protobuf';import {JournalEventSchema} from '@lazybox/protocol';
import {appendTranscript,emptyTranscript} from '../packages/surfaces/src/transcript-model';
import {commandLine,decideSend,emptyCatalog,lazyboxCommands,mergeCatalog,parseSlash,providerCommands,rankChoices,rankCommands,resolveModel,shortTokens,slashMenu,snippetCommands,type SlashContext} from '../packages/surfaces/src/slash-commands';

const ctx=(over:Partial<SlashContext>={}):SlashContext=>({provider:'claude',live:true,busy:false,coding:true,workspace:true,permission:'ask',planWorkflow:false,livePermission:true,model:'claude-opus-5-5',liveModel:true,resumable:true,models:[{value:'claude-opus-5-5',displayName:'Opus 5.5',description:'Most capable'},{value:'claude-sonnet-5',displayName:'Sonnet 5',description:'Fast'}],agentMessage:true,shellBlock:true,compact:true,detail:'smart',subscriptions:1,...over});
const catalog=mergeCatalog(emptyCatalog(),{commands:[{name:'compact',description:'Clear history but keep a summary',argumentHint:'<instructions>',builtin:true},{name:'review-pr',description:'Review a pull request',argumentHint:'<number>'},{name:'/init',description:'Initialize CLAUDE.md',argumentHint:''},{name:'model',description:'native model picker',argumentHint:''},{name:'exit',description:'Exit',argumentHint:''},{name:'bad name',description:'',argumentHint:''}],models:[{value:'opus',displayName:'Opus'}],terminal:['exit']});
const all=(c=ctx())=>{const lazybox=lazyboxCommands(c);return [...lazybox,...providerCommands(catalog,lazybox),...snippetCommands([{key:'review',description:'Review this change',category:'Review',body:'Review the current change carefully.'},{key:'test',description:'Run tests',category:'Testing',body:'Run the relevant tests.'}],['test'])];};

test('parsing: a command at the very start, never a path',()=>{
 assert.deepEqual(parseSlash('/model'),{name:'model',args:'',completed:false});
 assert.deepEqual(parseSlash('/model opus'),{name:'model',args:'opus',completed:true});
 assert.deepEqual(parseSlash('/rename Login flake\nsecond'),{name:'rename',args:'Login flake\nsecond',completed:true});
 assert.deepEqual(parseSlash('/'),{name:'',args:'',completed:false});
 assert.equal(parseSlash('/usr/local/bin is missing'),null,'a path is not a command');
 assert.equal(parseSlash(' /model'),null,'only at the start');
 assert.equal(parseSlash('please /model'),null);});

test('the catalog: names without their slash, bounded, terminal commands kept apart; a partial payload keeps the rest',()=>{
 assert.deepEqual(catalog.commands.map(c=>c.name),['compact','review-pr','init','model','exit']);
 assert.deepEqual(catalog.models,[{value:'opus',displayName:'Opus',description:''}]);
 const changed=mergeCatalog(catalog,{commands:[{name:'deploy',description:'Ship it',argumentHint:'<env>'}]});
 assert.deepEqual(changed.commands.map(c=>c.name),['deploy']);assert.equal(changed.models.length,1,'a commands_changed keeps the models');assert.deepEqual(changed.terminal,['exit']);});

test('provider commands: Lazybox stands in for a name it has; terminal-only ones are left out',()=>{
 const names=providerCommands(catalog,lazyboxCommands(ctx())).map(c=>c.name);
 assert.deepEqual(names,['review-pr','init']);});

test('filtering and ranking: exact, then prefix, then letters in order; grouped Lazybox · agent · snippets',()=>{
 const {items,best}=rankCommands('',all());
 assert.equal(items[0].command.group,'lazybox');assert.equal(items.at(-1)!.command.group,'snippet');
 assert.equal(items[best].command.name,'model');
 assert.deepEqual(items.filter(i=>i.command.group==='snippet').map(i=>[i.command.name,i.command.badge]),[['test','Next'],['review',undefined]],'the chained snippet comes first');
 const rev=rankCommands('rev',all());
 assert.deepEqual(rev.items.map(i=>i.command.key),['lazybox:review','provider:review-pr','snippet:review']);
 assert.equal(rev.items[rev.best].command.key,'lazybox:review');
 const pr=rankCommands('review-pr',all());assert.equal(pr.items[pr.best].command.key,'provider:review-pr','an exact provider name beats a Lazybox prefix');
 const alias=rankCommands('yolo',all());assert.equal(alias.items[alias.best].command.name,'permissions','an alias finds its command');
 const words=rankCommands('tokens',all());assert.ok(words.items.some(i=>i.command.name==='cost'),'a description word finds /cost');
 assert.equal(rankCommands('xqz',all()).items.length,0);});

test('the menu: names while typing, choices after a space, a hint for free arguments, nothing for paths or other lines',()=>{
 const menu=slashMenu('/mo',all());assert.equal(menu?.kind,'commands');
 const models=slashMenu('/model ',all());assert.equal(models?.kind,'choices');
 assert.deepEqual(models!.kind==='choices'&&models.items.map(c=>[c.label,!!c.current]),[['Opus 5.5',true],['Sonnet 5',false]]);
 assert.equal(models!.kind==='choices'&&models.items[models.best].label,'Sonnet 5','the current model is marked, the other one offered');
 const sonnet=slashMenu('/model son',all());assert.deepEqual(sonnet!.kind==='choices'&&sonnet.items.map(c=>c.value),['claude-sonnet-5']);
 const hint=slashMenu('/rename ',all());assert.equal(hint?.kind,'hint');assert.equal(hint!.kind==='hint'&&hint.command.argumentHint,'<title>');
 const pr=slashMenu('/review-pr 12',all());assert.equal(pr?.kind,'hint');
 assert.equal(slashMenu('/usr/local/bin',all()),null);
 assert.equal(slashMenu('/zzzz',all()),null,'nothing matches: no empty menu in the way');
 assert.equal(slashMenu('/model\nmore',all()),null);
 assert.equal(slashMenu('/mo',all(),true),null,'closed with Esc');
 assert.equal(slashMenu('hello',all()),null);});

test('choices: YOLO is refused in plan mode; detail marks the current one',()=>{
 const perms=lazyboxCommands(ctx({planWorkflow:true})).find(c=>c.name==='permissions')!;
 assert.equal(perms.choices!.find(c=>c.value==='yolo')!.disabled,'YOLO is unavailable in plan mode');
 const {items,best}=rankChoices('',perms.choices!);assert.equal(items[best].value,'read-only','the current one is not the default pick');
 assert.equal(rankChoices('yo',perms.choices!).items[0].value,'yolo');
 assert.equal(rankChoices('bypass',perms.choices!).items[0].value,'yolo','keywords');
 const detail=lazyboxCommands(ctx()).find(c=>c.name==='detail')!;assert.equal(detail.choices!.find(c=>c.current)!.value,'smart');});

test('argument hints, and what cannot run now says why',()=>{
 const byName=Object.fromEntries(lazyboxCommands(ctx({busy:true,shellBlock:false,workspace:false,compact:false,provider:'codex',liveModel:false,models:[]})).map(c=>[c.name,c]));
 assert.equal(byName.model.argumentHint,'<name>');assert.equal(byName.detail.argumentHint,'quiet|smart|verbose');assert.equal(byName.rename.argumentHint,'<title>');
 assert.match(byName.model.description,/restarts the agent/,'a model change that is not live says so');
 assert.deepEqual(byName.model.choices!.map(c=>[c.value,c.current]),[['claude-opus-5-5',true]],'the current model is listed even when the provider lists none');
 assert.equal(byName.compact.disabled,'Wait for the turn to finish');
 assert.equal(byName.run.disabled,'No command block to run yet');
 assert.equal(byName.review.disabled,'Only in a workspace');
 assert.equal(byName.stop.disabled,undefined,'busy: stop is offered');
 assert.equal(lazyboxCommands(ctx()).find(c=>c.name==='stop')!.disabled,'Claude is not working');
 assert.equal(lazyboxCommands(ctx({busy:false,provider:'codex',compact:false})).find(c=>c.name==='compact')!.disabled,'Codex compacts its context on its own');});

test('send as text: commands run, the agent\'s go through, an unknown /word asks first, anything else is a message',()=>{
 assert.deepEqual(decideSend('hello',all()),{kind:'text'});
 assert.deepEqual(decideSend('/usr/local/bin is missing',all()),{kind:'text'},'a path is a message');
 assert.deepEqual(decideSend('/ 2',all()),{kind:'text'});
 const model=decideSend('/model sonnet',all());assert.equal(model.kind,'lazybox');assert.equal(model.kind==='lazybox'&&model.args,'sonnet');
 const pr=decideSend('/review-pr 12',all());assert.equal(pr.kind,'provider');assert.equal(pr.kind==='provider'&&pr.args,'12');
 assert.equal(decideSend('/INIT',all()).kind,'provider','names are case-insensitive');
 assert.equal(decideSend('/test',all()).kind,'snippet');
 assert.deepEqual(decideSend('/deploy now',all()),{kind:'unknown',name:'deploy'});
 assert.equal(decideSend('/compact  ',all()).kind,'lazybox','Lazybox\'s /compact stands in for the agent\'s');});

test('models resolve by id, name or prefix; an id the list lacks is kept as typed',()=>{
 const models=ctx().models;
 assert.equal(resolveModel('sonnet 5',models),'claude-sonnet-5');assert.equal(resolveModel('Opus',models),'claude-opus-5-5');
 assert.equal(resolveModel('claude-haiku-5',models),'claude-haiku-5');assert.equal(resolveModel('  ',models),'');});

test('the line a command leaves in the conversation',()=>{
 assert.equal(shortTokens(156000),'156k');assert.equal(shortTokens(61_400),'61k');assert.equal(shortTokens(1_200_000),'1.2M');assert.equal(shortTokens(800),'800');
 assert.equal(commandLine('model_changed','claude-opus-5-5','live',{}),'Switched model to claude-opus-5-5');
 assert.equal(commandLine('model_changed','claude-opus-5-5','restart',{}),'Switched model to claude-opus-5-5 · the agent restarted');
 assert.equal(commandLine('permission_changed','yolo','live',{}),'Permissions: YOLO');
 assert.equal(commandLine('compacted','','',{trigger:'manual',preTokens:156000,postTokens:61000}),'Compacted context: 156k → 61k tokens');
 assert.equal(commandLine('compacted','','',{trigger:'auto',preTokens:180000}),'Context compacted automatically from 180k tokens');
 assert.equal(commandLine('message_delta','hi','',{}),'');});

test('the conversation: the agent\'s catalog is kept, commands run are one line, a model switch is the model shown',()=>{
 let state=emptyTranscript();
 const add=(type:string,text='',data?:unknown,status='')=>{state=appendTranscript(state,create(JournalEventSchema,{cursor:state.cursor+1n,event:{type,text,status,turnId:'t',providerDataJson:data?new TextEncoder().encode(JSON.stringify(data)):new Uint8Array()}}));};
 add('command_catalog','',{commands:[{name:'review-pr',description:'Review',argumentHint:'<n>'}],models:[{value:'opus',displayName:'Opus'}]});
 add('command_catalog','',{commands:[{name:'review-pr',description:'Review',argumentHint:'<n>'},{name:'deploy',description:'Ship',argumentHint:''}]});
 assert.deepEqual(state.catalog.commands.map(c=>c.name),['review-pr','deploy']);assert.equal(state.catalog.models[0].value,'opus','a later commands list keeps the models');
 assert.equal(state.messages.length,0,'the catalog is not a message');
 add('operation_accepted','/review-pr 12');add('operation_accepted','/usr/bin is gone');add('operation_accepted','/compact');
 assert.deepEqual(state.messages.map(m=>[m.text,!!m.command]),[['/review-pr 12',true],['/usr/bin is gone',false],['/compact',true]]);
 add('compacted','',{trigger:'manual',preTokens:156000,postTokens:61000});
 add('model_changed','claude-sonnet-5',undefined,'live');add('permission_changed','yolo',undefined,'live');
 assert.deepEqual(state.messages.slice(3).map(m=>[m.type,m.text]),[['command','Compacted context: 156k → 61k tokens'],['command','Switched model to claude-sonnet-5'],['command','Permissions: YOLO']]);
 assert.equal(state.reportedModel,'claude-sonnet-5');});
