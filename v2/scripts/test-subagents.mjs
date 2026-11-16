// Fixture only: sub-agents in a conversation. Realistic Claude worker journals
// (two parallel sub-agents, one nested, one failed, one long finished run):
// inline cards with live current action, their own timelines, the tray beside
// the composer, the tree, the panel (docked, floating, phone sheet), stopping
// one, and the failed one in the parent's status line.
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {webkit,expect} from '@playwright/test';import {fileURLToPath} from 'node:url';import {mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';import {startRunnerFixture} from './fixtures/runner-ui.mjs';

const f=await startRunnerFixture();
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const now=Date.now(),at=offset=>new Date(now+offset).toISOString();
const A='claude-tool:toolu_explore',B='claude-tool:toolu_audit',C='claude-tool:toolu_logs',D='claude-tool:toolu_flaky',E='claude-tool:toolu_long';
Object.assign(f.sessions[0],{title:'Make sub-agents visible',provider:'claude',model:'claude-fable-5-1',modelReported:true,busy:true,status:'running',
 capabilities:{...f.sessions[0].capabilities,stopAgent:true},
 agents:[{id:'root',status:'running',phase:'thinking',phaseSinceUnixMillis:String(now-4000),turnStartedAtUnixMillis:String(now-300000)},
  ...[[A,'running'],[B,'running'],[C,'running'],[D,'failed'],[E,'done']].map(([id,status])=>({id,parentId:id===C?B:'root',status,name:'Sub-agent',kind:'local_agent'})),{id:'claude-tool:toolu_bg',parentId:'root',status:'running',name:'cd /work/api && source .venv/bin/activate',kind:'local_bash'}]});
const ch=f.openEvents('alpha-session');
const push=(offset,event)=>ch.push(event.data===undefined?event:{...Object.fromEntries(Object.entries(event).filter(([k])=>k!=='data')),providerDataJson:b64(event.data)},at(offset));
const call=(id,name,status,extra={})=>({type:'tool_call',id,name,status,...extra});
const spawn=(offset,id,toolUse,description,type,prompt,parent='root',extra={})=>{
 push(offset,{type:'tool_activity',...(parent==='root'?{}:{agentId:parent}),data:call(toolUse,'Task','running',{input:{description,prompt,subagent_type:type,...extra}})});
 push(offset+200,{type:'agent_status',agentId:id,parentAgentId:parent,nativeId:'task-'+toolUse,status:'running',name:description,agentKind:'local_agent',data:{toolUseId:toolUse,subagentType:type,prompt}});
};
push(-300000,{type:'operation_accepted',text:'Why are sub-agents invisible in the chat? Investigate end to end.'});
push(-299000,{type:'turn_started'});
push(-298000,{type:'message_delta',text:'I will split this: one agent maps the transcript, one audits the worker, and I will rerun the flaky test.'});
// A long run that already finished, with hundreds of steps and a result.
spawn(-290000,E,'toolu_long','Survey every adapter','general-purpose','Read every adapter under internal/runner/adapters and list what each forwards.');
for(let i=0;i<160;i++){push(-289000+i*500,{type:'tool_activity',agentId:E,data:call('e'+i,i%3?'Read':'Grep','running',{input:i%3?{file_path:`services/runner/code/internal/runner/adapters/file${i}.go`}:{pattern:'parent_tool_use_id'}})});push(-288800+i*500,{type:'tool_activity',agentId:E,data:call('e'+i,undefined,'completed',{output:`line ${i}\n`.repeat(40)})});if(i%20===0)push(-288700+i*500,{type:'message_delta',agentId:E,text:`Step ${i}: the adapter forwards tool calls but drops sub-agent prose.`});}
push(-200000,{type:'tool_activity',data:{type:'tool_call',id:'toolu_long',status:'completed',output:[{type:'text',text:'## Findings\n\n- **Claude**: sub-agent prose is dropped unless `forwardSubagentText` is on.\n- **Codex**: sub-threads are attributed by thread id.\n\nLONG_RESULT_END'},{type:'text',text:'agentId: a1b2 (use to resume)'}]}});
push(-199990,{type:'agent_status',agentId:E,status:'done',data:{toolUseId:'toolu_long',summary:'Surveyed 4 adapters',usage:{totalTokens:182000,toolUses:160,durationMs:90000}}});
// Two in parallel, now.
spawn(-95000,A,'toolu_explore','Map the transcript pipeline','Explore','Trace how journal events become transcript messages.\nReport where sub-agent events are dropped.');
spawn(-60000,B,'toolu_audit','Audit worker events','general-purpose','Audit the Claude worker for dropped sub-agent events.');
push(-90000,{type:'tool_activity',agentId:A,data:call('a1','Grep','running',{input:{pattern:'agentId',path:'packages/surfaces/src'}})});
push(-89000,{type:'tool_activity',agentId:A,data:call('a1',undefined,'completed',{output:'transcript-model.ts:52: if (!event || (event.agentId && event.agentId !== \'root\')) continue;'})});
push(-88000,{type:'message_delta',agentId:A,parentAgentId:'root',text:'The transcript fold skips every event whose agentId is not root.'});
push(-8000,{type:'tool_activity',agentId:A,data:call('a2','Read','running',{input:{file_path:'packages/surfaces/src/transcript-model.ts'}})});
push(-5000,{type:'agent_status',agentId:A,status:'running',data:{toolUseId:'toolu_explore',usage:{totalTokens:48200,toolUses:14,durationMs:90000},summary:'Reading the transcript fold'}});
push(-50000,{type:'tool_activity',agentId:B,data:call('b1','Bash','running',{input:{command:'rg -n parent_tool_use_id workers/claude-sdk/src',description:'Find attribution'}})});
// B spawned a nested sub-agent that is still reading CI logs.
spawn(-40000,C,'toolu_logs','Read the CI logs','general-purpose','Read the last CI run logs for sub-agent errors.',B);
push(-30000,{type:'tool_activity',agentId:C,data:call('c1','WebFetch','running',{input:{url:'https://ci.example.com/runs/4242/logs'}})});
// One failed.
spawn(-120000,D,'toolu_flaky','Rerun the flaky test 50 times','general-purpose','Run go test -run TestLogin -count 50 and report failures.');
push(-110000,{type:'tool_activity',agentId:D,data:call('d1','Bash','running',{input:{command:'go test ./... -run TestLogin -count 50'}})});
push(-100000,{type:'agent_status',agentId:D,status:'failed',data:{toolUseId:'toolu_flaky',error:'The test binary timed out after 10m.'}});
push(-4000,{type:'activity',status:'thinking'});
// A background command whose name is a whole script, as Claude reports it.
const SCRIPT='cd /work/api && source .venv/bin/activate\n# the MCP suite is slow\nPYTHONPATH=src uv run pytest tests/test_mcp.py -x -q 2>&1 | tail -80';
const BG='claude-tool:toolu_bg';
push(-45000,{type:'tool_activity',data:call('toolu_bg','Bash','running',{input:{command:SCRIPT,run_in_background:true}})});
push(-44900,{type:'agent_status',agentId:BG,parentAgentId:'root',nativeId:'bash_3',status:'running',name:SCRIPT,agentKind:'local_bash',data:{toolUseId:'toolu_bg',taskType:'local_bash'}});
push(-20000,{type:'tool_activity',data:call('toolu_read','BashOutput','running',{input:{bash_id:'bash_3'}})});
push(-19900,{type:'tool_activity',data:{type:'tool_call',id:'toolu_read',status:'completed',output:'tests/test_mcp.py::test_tools PASSED\nBG_OUTPUT_SEEN'}});
// Many sub-agents in a long saved conversation: it must open as fast as any other.
Object.assign(f.sessions[1],{title:'Fan-out',provider:'claude',status:'stopped',closed:true,busy:false,agents:[{id:'root',status:'done'}]});
const many=f.openEvents('beta-session');many.pace=50;many.paceMs=1;
const pushMany=event=>many.push(event.data===undefined?event:{...Object.fromEntries(Object.entries(event).filter(([k])=>k!=='data')),providerDataJson:b64(event.data)},at(-100000));
for(let n=0;n<80;n++){const id='claude-tool:fan'+n;pushMany({type:'operation_accepted',text:`Fan out batch ${n}`});
 pushMany({type:'tool_activity',data:call('fan'+n,'Task','running',{input:{description:`Batch ${n}`,prompt:'Check one package.',subagent_type:'Explore'}})});
 for(let i=0;i<60;i++){pushMany({type:'tool_activity',agentId:id,data:call(`f${n}-${i}`,'Read','running',{input:{file_path:`pkg/${n}/file${i}.go`}})});pushMany({type:'tool_activity',agentId:id,data:call(`f${n}-${i}`,undefined,'completed',{output:'x'.repeat(2000)})});}
 for(const chunk of `Batch ${n} is clean.`.match(/.{1,4}/g))pushMany({type:'message_delta',agentId:id,text:chunk});
 pushMany({type:'tool_activity',data:{type:'tool_call',id:'fan'+n,status:'completed',output:`Batch ${n}: no problems. FAN_END_${n}`}});
 pushMany({type:'message_delta',text:`Batch ${n} reviewed.`});}
many.complete();

const server=await createServer({configFile:false,logLevel:'error',root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:f.url}}}});let browser;
try{
 await server.listen();await mkdir('.cache',{recursive:true});browser=await webkit.launch();const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 await page.goto(`${base}/?view=workspace&collection=alpha&session=alpha-session#token=${f.token}`);
 const chat=page.locator('.embedded-chat').first(),messages=chat.locator('.messages');
 const card=id=>messages.locator(`.subagent-card[data-agent-id="${id}"]`);

 // Cards sit where they started, in order, with their type, task and state.
 await expect(messages.locator('.subagent-anchor > .subagent-card')).toHaveCount(4);
 assert.deepEqual(await messages.locator('.subagent-anchor > .subagent-card').evaluateAll(n=>n.map(e=>e.dataset.agentId)),[E,A,B,D],"cards follow the journal");
 await expect(card(A).locator('.subagent-type')).toHaveText('Explore');
 await expect(card(A).locator('.subagent-name')).toHaveText('Map the transcript pipeline');
 await expect(card(A)).toHaveAttribute('data-status','running');
 await expect(card(A).locator('.subagent-now-text')).toHaveText('Reading packages/surfaces/src/transcript-model.ts');
 await expect(card(A).locator('.subagent-stats')).toContainText(/1m 3\d+s · 14 tools · 48k tokens/);
 await expect(card(A).locator('.subagent-progress')).toHaveText('Reading the transcript fold');
 {const first=await card(A).locator('.subagent-stats time').textContent();await expect.poll(()=>card(A).locator('.subagent-stats time').textContent(),{timeout:4000}).not.toBe(first);}
 await expect(messages.locator('.message').filter({hasText:'skips every event'}),'a sub-agent\'s prose is not a main message').toHaveCount(0);
 // Finished ones: outcome and result.
 await expect(card(E)).toHaveAttribute('data-status','done');
 await expect(card(E).locator('.subagent-outcome')).toContainText('Done');
 await expect(card(E).locator('.subagent-outcome')).toContainText('Findings · Claude: sub-agent prose is dropped');
 await expect(card(E).locator('.subagent-stats')).toContainText('1m 30s · 160 tools · 182k tokens');
 await card(E).getByRole('button',{name:'Show full result'}).click();
 await expect(card(E).locator('.subagent-result')).toContainText('LONG_RESULT_END');
 await expect(card(E).locator('.subagent-result')).not.toContainText('agentId: a1b2');
 await expect(card(D)).toHaveAttribute('data-status','failed');
 await expect(card(D).locator('.subagent-outcome')).toContainText('The test binary timed out after 10m.');
 await page.screenshot({path:'.cache/subagents-cards.png'});

 // Live: the current action moves with the sub-agent.
 push(0,{type:'tool_activity',agentId:A,data:call('a2',undefined,'completed',{output:'export function foldTranscript…'})});
 push(10,{type:'tool_activity',agentId:A,data:call('a3','Bash','running',{input:{command:'go test ./internal/runner/... -run Subagent'}})});
 await expect(card(A).locator('.subagent-now-text')).toHaveText('Running go test ./internal/runner/... -run Subagent');

 // Expand: its own timeline, tool output collapsed until asked for.
 await card(A).locator(':scope > .subagent-head > .subagent-toggle').click();
 const body=card(A).locator('.subagent-body');
 await expect(body.locator('.subagent-prompt summary')).toContainText('Trace how journal events become transcript messages.');
 await expect(body.locator('.subagent-message')).toContainText('skips every event whose agentId is not root');
 await expect(body.locator('.tool-call')).toHaveCount(3);
 await expect(body.locator('.tool-call-details')).toHaveCount(0);
 await body.locator('.tool-call summary').first().click();
 await expect(body.locator('.tool-call-details').first()).toContainText('transcript-model.ts:52');
 await page.keyboard.press('Escape');
 await expect(card(A).locator('.subagent-body')).toHaveCount(0);
 await expect(card(A).locator(':scope > .subagent-head > .subagent-toggle')).toHaveAttribute('aria-expanded','false');

 // A long run mounts only its latest steps.
 await card(E).locator(':scope > .subagent-head > .subagent-toggle').click();
 await expect(card(E).locator('.subagent-step')).toHaveCount(40);
 await expect(card(E).getByRole('button',{name:/Show earlier steps/})).toBeVisible();
 await card(E).locator(':scope > .subagent-head > .subagent-toggle').click();

 // The tray: parallel sub-agents side by side, the nested one on its parent's chip.
 const tray=chat.locator('.subagent-tray');
 await expect(tray.locator('.subagent-tray-count')).toHaveText('3 sub-agents · 1 command running');
 await expect(tray.locator('.subagent-chip:not(.command)')).toHaveCount(2);
 // A background command is a chip of its own, named by what runs, never by its script; it has no card.
 const bgChip=tray.locator('.subagent-chip.command');
 await expect(bgChip).toHaveText(/^pytest tests\/test_mcp\.py\d/);
 await expect(tray).not.toContainText('source .venv');
 await expect(messages.locator('.subagent-card[data-agent-id="claude-tool:toolu_bg"]')).toHaveCount(0);
 await expect(tray.locator('.subagent-chip').nth(1)).toContainText('Audit worker events');
 await expect(tray.locator('.subagent-chip').nth(1).locator('.subagent-chip-nested')).toHaveText('+1');
 // One live bar: the main agent's step, and the background work in it.
 await expect(chat.locator('.live-bar')).toHaveCount(1);
 await expect(chat.locator('.live-bar .live-activity')).toContainText('Thinking');
 await expect(chat.locator('.live-bar .subagent-tray')).toHaveCount(1);
 const chips=await tray.locator('.subagent-chip').evaluateAll(n=>n.map(e=>e.getBoundingClientRect()));
 assert.ok(Math.abs(chips[0].top-chips[1].top)<1&&chips[1].left>chips[0].right,'parallel chips sit side by side');
 await page.screenshot({path:'.cache/subagents-tray.png'});
 // A chip takes you to its card and opens it.
 await messages.evaluate(n=>{n.scrollTop=0;});
 await tray.locator('.subagent-chip').nth(1).click();
 await expect(card(B).locator(':scope > .subagent-head > .subagent-toggle')).toHaveAttribute('aria-expanded','true');
 await expect(card(B)).toBeInViewport();
 await expect(card(B).locator('.subagent-body .subagent-card[data-agent-id="'+C+'"]'),'the nested sub-agent shows in its parent\'s timeline').toBeVisible();
 await expect(card(B).locator(`.subagent-card[data-agent-id="${C}"] .subagent-now-text`)).toHaveText('Fetching ci.example.com/runs/4242/logs');
 // Chips move with the arrow keys.
 await tray.locator('.subagent-chip').first().focus();await page.keyboard.press('ArrowRight');
 await expect(tray.locator('.subagent-chip').nth(1)).toBeFocused();
 // The tree: every sub-agent, nested under who started it.
 await tray.getByRole('button',{name:'All 6'}).click();
 const tree=page.getByRole('dialog',{name:'Background work',exact:true});
 await expect(tree.getByRole('region',{name:'Sub-agents'}).locator('li')).toHaveCount(5);
 await expect(tree.getByRole('region',{name:'Background commands'}).locator('li')).toHaveText(/pytest tests\/test_mcp\.py/);
 await expect(tree.locator(`li[data-depth="1"]`)).toContainText('Read the CI logs');
 await expect(tree.locator('.subagent-tree-row').first()).toBeFocused();
 await page.screenshot({path:'.cache/subagents-tree.png'});
 await page.keyboard.press('Escape');await expect(tree).toHaveCount(0);
 await expect(tray.getByRole('button',{name:'All 6'})).toBeFocused();
 // A command's chip opens its script and the output the agent read.
 await bgChip.click();
 const bgPanel=chat.getByRole('complementary',{name:'Background command: pytest tests/test_mcp.py'});
 await expect(bgPanel.locator('.background-command')).toContainText('source .venv/bin/activate');
 await expect(bgPanel.locator('.background-command')).toContainText('BG_OUTPUT_SEEN');
 await page.screenshot({path:'.cache/subagents-background-command.png'});
 await bgPanel.getByRole('button',{name:'Close background command panel'}).click();
 // The header keeps the way to all background work.
 await expect(chat.locator('.chat-heading').getByRole('button',{name:/^Background work: 6 in all, 4 running, 1 failed$/})).toBeVisible();

 // A panel of its own, docked, following live.
 await card(A).getByRole('button',{name:'Open Map the transcript pipeline in a panel'}).click();
 const panel=chat.getByRole('complementary',{name:'Sub-agent: Map the transcript pipeline'});
 await expect(panel).toHaveAttribute('data-mode','dock');
 await expect(panel.locator('.subagent-panel-head')).toBeFocused();
 await expect(panel.locator('.subagent-now-text')).toHaveText('Running go test ./internal/runner/... -run Subagent');
 {const box=await panel.boundingBox(),composer=await chat.locator('.composer').boundingBox();assert.ok(composer.x+composer.width<=box.x+1,'the docked panel sits beside the conversation');}
 push(20,{type:'message_delta',agentId:A,parentAgentId:'root',text:'PANEL_FOLLOWS_LIVE'});
 await expect(panel.locator('.subagent-panel-body')).toContainText('PANEL_FOLLOWS_LIVE');
 assert.ok(await panel.locator('.subagent-panel-body').evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<40),'the panel follows the latest step');
 await page.screenshot({path:'.cache/subagents-panel-docked.png'});
 // Resize from its edge with the keyboard.
 {const handle=panel.getByRole('separator',{name:'Resize sub-agent panel'});const before=Number(await handle.getAttribute('aria-valuenow'));await handle.focus();await page.keyboard.press('ArrowLeft');await expect(handle).toHaveAttribute('aria-valuenow',String(before+24));}
 // Float it and move it by its header.
 await panel.getByRole('button',{name:'Float the panel'}).click();
 await expect(panel).toHaveAttribute('data-mode','float');
 {const head=panel.locator('.subagent-panel-head'),start=await panel.boundingBox();await head.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowDown');const moved=await panel.boundingBox();assert.ok(moved.x<start.x&&moved.y>start.y,'arrow keys move a floating panel');}
 await page.screenshot({path:'.cache/subagents-panel-float.png'});
 await page.keyboard.press('Escape');
 await expect(panel).toHaveCount(0);

 // Stop one sub-agent: asked once more, then sent to the Runner.
 const stop=card(A).getByRole('button',{name:'Stop sub-agent Map the transcript pipeline'});
 await stop.click();
 await card(A).getByRole('button',{name:/Confirm: stop/}).click();
 await expect.poll(()=>f.mutations.findLast(m=>m.method==='Apply'&&m.body.stopAgent)?.body.stopAgent.agentId).toBe(A);
 push(30,{type:'agent_status',agentId:A,status:'stopped',data:{toolUseId:'toolu_explore'}});
 await expect(card(A)).toHaveAttribute('data-status','stopped');
 await expect(card(A).locator('.subagent-outcome')).toContainText('Stopped');
 await expect(card(A).getByRole('button',{name:/Stop sub-agent/})).toHaveCount(0);
 await expect(tray.locator('.subagent-chip:not(.command)')).toHaveCount(1);

 // The failed one is in the parent's status line until it is looked at.
 const attention=chat.locator('.chat-heading .subagent-attention');
 await expect(attention).toContainText('1 failed');
 await attention.getByRole('button',{name:'1 sub-agent failed',exact:true}).click();
 await expect(card(D)).toBeInViewport();
 await expect(attention).toHaveCount(0);

 // Reduced motion stills every animation.
 assert.equal(await card(B).locator('.subagent-mark').first().evaluate(n=>getComputedStyle(n).animationName),'live-spin');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await card(B).locator('.subagent-mark').first().evaluate(n=>getComputedStyle(n).animationName),'none');
 assert.equal(await card(B).locator('.subagent-now-text').first().evaluate(n=>getComputedStyle(n).animationName),'none');
 await page.emulateMedia({reducedMotion:'no-preference'});

 // Phone width: the tray scrolls, a panel covers the chat as a sheet.
 await page.setViewportSize({width:390,height:844});
 await expect(tray.locator('.subagent-chip').first()).toBeVisible();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal page scroll');
 await card(B).getByRole('button',{name:'Open Audit worker events in a panel'}).click();
 const sheet=chat.getByRole('complementary',{name:'Sub-agent: Audit worker events'});
 await expect(sheet).toHaveAttribute('data-mode','sheet');
 await page.screenshot({path:'.cache/subagents-phone.png'});
 await sheet.getByRole('button',{name:'Close sub-agent panel'}).click();
 await expect(sheet).toHaveCount(0);
 // Opening a conversation that spawned 80 sub-agents (~10k events) stays fast; only the tail is mounted.
 await page.setViewportSize({width:1440,height:960});
 {const started=Date.now();await page.goto(`${base}/?view=workspace&collection=beta&session=beta-session#token=${f.token}`);
  const fan=page.locator('.embedded-chat').first().locator('.messages');
  await expect(fan.locator('.subagent-card[data-agent-id="claude-tool:fan79"] .subagent-outcome')).toContainText('FAN_END_79',{timeout:20000});
  const elapsed=Date.now()-started;assert.ok(elapsed<6000,`80 sub-agents opened in ${elapsed} ms`);
  const mounted=await fan.locator('.subagent-anchor').count();assert.ok(mounted>0&&mounted<=40,`only the latest cards are mounted (${mounted})`);
  console.log(`80 sub-agents, ${many.events.length} events: latest card in ${elapsed} ms`);}
 assert.deepEqual(errors,[]);
 console.log('PASS sub-agent cards (order, type, task, live action, elapsed, tools, tokens, progress, outcome, full result), timeline (prompt, prose, collapsed tools, windowed long run), tray (parallel chips, nested badge, keyboard, reveal), tree, panel (dock, follow, resize, float, move, Esc), stop, failed attention, reduced motion, phone sheet, background commands (short names, no card, script and output panel, header access), 80-sub-agent conversation opens fast. Fixture only.');
}finally{await browser?.close();await server.close();await f.close();}
