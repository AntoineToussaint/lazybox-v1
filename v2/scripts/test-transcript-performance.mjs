// Opening a long saved conversation must be fast. This replays a realistic
// long journal (tens of thousands of streamed deltas, large tool outputs, code
// blocks and Mermaid diagrams) from the fixture Runner and measures, in the
// page, when the latest answer is on screen and when the main thread is quiet
// again (no frame longer than 50 ms for one second: the Lighthouse TTI idea).
//
// PERF_TURNS, PERF_BROWSER=chromium|webkit, PERF_BUILD=1 (production bundle)
// and PERF_RUNS tune a manual measurement; the gate uses the defaults.
import {createServer,build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit,chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';
import {longConversation} from './fixtures/long-conversation.mjs';
import {monacoVimCompat} from './monaco-vim-compat.mjs';

const turns=Number(process.env.PERF_TURNS||200),runs=Number(process.env.PERF_RUNS||1);
// Generous against CI noise and dev-mode React; the unfixed reader took
// several times longer than this on the default fixture.
const budget={visible:Number(process.env.PERF_VISIBLE_BUDGET||5000),interactive:Number(process.env.PERF_INTERACTIVE_BUDGET||7000)};
const fixture=await startRunnerFixture();
const session=fixture.sessions[0];Object.assign(session,{closed:true,status:'stopped',busy:false,providerReference:'saved-claude-conversation',agents:[{id:'root',status:'done'}],provider:'claude'});
const channel=fixture.openEvents(session.id);
const events=longConversation({turns});for(const event of events)channel.push(event);channel.complete();
// Deliver the replay in many network chunks, as the Runner's per-record stream does.
channel.pace=Number(process.env.PERF_PACE||50);channel.paceMs=Number(process.env.PERF_PACE_MS||1);
const root=fileURLToPath(new URL('../apps/web',import.meta.url));
const proxy={'/lazybox.bench.v1.RunnerService/':{target:fixture.url}};
let server,out,browser;
try{
 if(process.env.PERF_BUILD){out=await mkdtemp(join(tmpdir(),'lazybox-perf-'));await build({configFile:false,root,logLevel:'warn',plugins:[react(),monacoVimCompat()],build:{outDir:out,emptyOutDir:true}});server=await preview({configFile:false,root,build:{outDir:out},preview:{host:'127.0.0.1',port:0,proxy}});}
 else{server=await createServer({configFile:false,root,logLevel:'warn',plugins:[react(),monacoVimCompat()],server:{host:'127.0.0.1',port:0,proxy}});await server.listen();}
 const port=(server.httpServer.address()).port;
 browser=await (process.env.PERF_BROWSER==='chromium'?chromium:webkit).launch({headless:true});
 const results=[];
 for(let run=0;run<=runs;run++){
  // Run 0 warms Vite's dependency optimisation and module cache; it is not measured.
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const marker=`ANSWER_END_${turns-1}`;
  await page.addInitScript(marker=>{
   const perf={first:undefined,visible:undefined,frames:[],marker};window.__perf=perf;let last=performance.now();
   const frame=now=>{const gap=now-last;last=now;if(gap>50)perf.frames.push({end:now,gap});
    if(perf.first===undefined&&document.querySelector('.messages .message'))perf.first=now;
    if(perf.visible===undefined&&document.querySelector('.messages')?.textContent?.includes(marker))perf.visible=now;
    requestAnimationFrame(frame);};
   requestAnimationFrame(frame);
  },marker);
  await page.goto(`http://127.0.0.1:${port}/?view=workspace&collection=alpha&session=${session.id}#token=${fixture.token}`);
  await expect.poll(()=>page.evaluate(()=>window.__perf.visible),{timeout:120000,intervals:[50]}).not.toBeUndefined();
  // Interactive: one full second without a long frame after the answer is visible.
  await expect.poll(()=>page.evaluate(()=>{const p=window.__perf,now=performance.now(),longest=p.frames.at(-1)?.end??0;return now-Math.max(longest,p.visible)>=1000;}),{timeout:120000,intervals:[100]}).toBe(true);
  const measured=await page.evaluate(()=>{const p=window.__perf,lastLong=p.frames.filter(f=>f.end>=0).at(-1)?.end??0;
   return{first:Math.round(p.first),visible:Math.round(p.visible),interactive:Math.round(Math.max(p.visible,lastLong)),longFrames:p.frames.length,blocking:Math.round(p.frames.reduce((sum,f)=>sum+f.gap-50,0)),worstFrame:Math.round(Math.max(0,...p.frames.map(f=>f.gap)))};});
  // The page answers input once interactive: typing reaches the composer promptly.
  const composer=page.getByRole('textbox',{name:'Message',exact:true});
  const started=Date.now();await composer.pressSequentially('ok');await expect(composer).toHaveValue('ok');measured.typing=Date.now()-started;
  await expect(page.locator('.messages')).toContainText(marker);
  // Latest first: only the tail is mounted; earlier history waits for the reader.
  const mounted=await page.locator('.messages .message').count();
  assert.ok(mounted>0&&mounted<=40,`a long conversation opens with its latest messages only (${mounted} mounted)`);
  await expect(page.getByRole('button',{name:'Show earlier messages'})).toBeVisible();
  assert.deepEqual(errors,[]);
  await page.close();
  if(run>0)results.push(measured);
 }
 const median=key=>results.map(r=>r[key]).sort((a,b)=>a-b)[Math.floor(results.length/2)];
 const summary={turns,events:events.length,browser:process.env.PERF_BROWSER||'webkit',bundle:process.env.PERF_BUILD?'production':'development',runs:results,median:{first:median('first'),visible:median('visible'),interactive:median('interactive'),blocking:median('blocking'),worstFrame:median('worstFrame')}};
 console.log(JSON.stringify(summary));
 assert.ok(summary.median.visible<=budget.visible,`latest answer took ${summary.median.visible} ms to appear (budget ${budget.visible} ms)`);
 assert.ok(summary.median.interactive<=budget.interactive,`page took ${summary.median.interactive} ms to become interactive (budget ${budget.interactive} ms)`);
 console.log(`PASS: a ${events.length}-event saved conversation shows its latest answer in ${summary.median.visible} ms and is interactive in ${summary.median.interactive} ms (budgets ${budget.visible}/${budget.interactive} ms). Fixture only.`);
}finally{await browser?.close();await server?.close?.();if(server?.httpServer)server.httpServer.close();await fixture.close();if(out)await rm(out,{recursive:true,force:true});}
