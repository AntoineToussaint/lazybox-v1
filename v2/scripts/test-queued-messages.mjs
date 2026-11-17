// Fixture only: a message sent while the agent is busy waits in the queue, and
// is never stuck there behind a server or a long build. The strip above the
// message box says it is queued and what the agent is busy with; Send now
// warns which step it stops, then interrupts the turn and sends the message
// next (Escape keeps waiting); Steer gives it to a Codex turn without stopping
// it; for Claude the strip says it cannot take a message mid-turn. Several
// queued messages collapse; a phone keeps it on screen.
import {testViteCache} from './fixtures/vite-cache.mjs';
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {chromium,expect} from '@playwright/test';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';import {startRunnerFixture} from './fixtures/runner-ui.mjs';

const f=await startRunnerFixture();
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const now=Date.now();
const busy=(session,provider)=>Object.assign(session,{provider,busy:true,status:'running',queued:0,queuedMessages:[],agents:[{id:'root',status:'running',phase:'tool',tool:'Bash',phaseSinceUnixMillis:String(now-300000),turnStartedAtUnixMillis:String(now-310000)}]});
const [claude,codex]=f.sessions;
busy(claude,'claude');
busy(codex,'codex');Object.assign(codex,{profileId:'codex-default',capabilities:{...codex.capabilities,steer:true}});
for(const session of [claude,codex]){
 const ch=f.openEvents(session.id),at=offset=>new Date(now+offset).toISOString();
 ch.push({type:'operation_accepted',text:'Start the app and check the home page.'},at(-310000));
 ch.push({type:'turn_started'},at(-309000));
 ch.push({type:'tool_activity',providerDataJson:b64({type:'tool_call',id:'toolu_dev',name:'Bash',status:'running',input:{command:'npm run dev'}})},at(-300000));
}
const deliveries=()=>f.mutations.filter(m=>m.method==='Apply'&&m.body.deliverQueued).map(m=>m.body.deliverQueued);

const server=await createServer({...testViteCache(import.meta.url),configFile:false,logLevel:'error',root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:f.url}}}});let browser;
try{
 await server.listen();await mkdir('.cache',{recursive:true});browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1400,height:900}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const open=async session=>page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=${session.collectionId}&session=${session.id}#token=${f.token}`);
 await open(claude);
 const chat=page.locator('.embedded-chat').first(),composer=chat.getByRole('textbox',{name:'Message',exact:true});
 const strip=chat.getByRole('region',{name:'Queued messages'});

 // ── Sent during a busy turn, the message waits, and the strip says why.
 await expect(chat.getByRole('region',{name:'What the agent is doing'})).toBeVisible();
 await expect(strip).toHaveCount(0);
 await composer.fill('Use port 4000 instead, 3000 is taken.');await composer.press('Enter');
 await expect(strip).toBeVisible({timeout:5000});
 await expect(strip.locator('.queued-head [role=status]')).toHaveText(/^Queued — Claude is busy \(Running a command · 5m \d\ds\)$/);
 const item=strip.getByRole('listitem');
 await expect(item.locator('q')).toHaveText('Use port 4000 instead, 3000 is taken.');
 // Claude cannot take a message mid-turn: no Steer, and the strip says so.
 await expect(item.getByRole('button',{name:'Steer'})).toHaveCount(0);
 await expect(strip.locator('.queued-note')).toHaveText('Claude can’t take a message in the middle of a turn: Send now stops its current step first, then sends yours.');
 await page.screenshot({path:'.cache/queued-claude.png'});

 // ── Send now is one click; its tooltip names the step it stops.
 const sendNow=item.getByRole('button',{name:'Send now'});
 await expect(sendNow).toHaveAttribute('title','Stop npm run dev and send this as the next turn');
 await page.screenshot({path:'.cache/queued-send-now.png'});
 await sendNow.click();
 await expect.poll(deliveries).toEqual([{operationId:f.mutations.find(m=>m.method==='Apply'&&m.body.message)?.body.operationId,how:'now'}]);
 assert.equal(claude.interrupted,1,'the Runner interrupts the turn');
 await expect(strip).toHaveCount(0,{timeout:5000});

 // ── Several queued messages: two shown, the rest counted, and the strip can be put away.
 for(const text of ['First follow-up','Second follow-up','Third follow-up']){await composer.fill(text);await composer.press('Enter');await expect.poll(()=>claude.queuedMessages.length).toBeGreaterThan(0);}
 await expect.poll(()=>claude.queuedMessages.length).toBe(3);
 await expect(strip.locator('.queued-head [role=status]')).toHaveText(/^3 messages queued — Claude is busy/,{timeout:5000});
 await expect(strip.getByRole('listitem')).toHaveCount(2);
 await expect(strip.locator('.queued-more')).toHaveText('and 1 more, sent in order after these');
 await strip.getByRole('button',{name:'Hide'}).click();
 await expect(strip.getByRole('listitem')).toHaveCount(0);
 await expect(strip.getByRole('button',{name:'Show'})).toHaveAttribute('aria-expanded','false');
 await strip.getByRole('button',{name:'Show'}).click();
 await expect(strip.getByRole('listitem')).toHaveCount(2);
 // A phone keeps the strip and its buttons on screen, without sideways scroll.
 await page.setViewportSize({width:390,height:844});
 {const chatTab=page.locator('.mobile-panel-switcher').getByRole('button',{name:/Agent chat/});if(await chatTab.count())await chatTab.first().click();}
 await expect(strip.getByRole('listitem').first().getByRole('button',{name:'Send now'})).toBeVisible();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal page scroll');
 await page.screenshot({path:'.cache/queued-phone.png'});
 await page.setViewportSize({width:1400,height:900});

 // ── Codex takes a message mid-turn: Steer delivers it without stopping the turn.
 await open(codex);
 await expect(chat.getByRole('region',{name:'What the agent is doing'})).toBeVisible();
 await composer.fill('Also log the port it picked.');await composer.press('Enter');
 await expect(strip).toBeVisible({timeout:5000});
 await expect(strip.locator('.queued-head [role=status]')).toHaveText(/^Queued — Codex is busy \(Running a command/);
 await expect(strip.locator('.queued-note')).toHaveCount(0);
 await page.screenshot({path:'.cache/queued-codex.png'});
 await strip.getByRole('listitem').getByRole('button',{name:'Steer'}).click();
 await expect.poll(()=>deliveries().at(-1)).toEqual({operationId:f.mutations.findLast(m=>m.method==='Apply'&&m.body.message)?.body.operationId,how:'steer'});
 assert.equal(codex.interrupted,undefined,'steering does not interrupt the turn');
 await expect(strip).toHaveCount(0,{timeout:5000});
 assert.deepEqual(errors,[]);
 console.log('PASS queued messages: a message sent during a busy turn shows as queued with what the agent is busy with; Send now delivers it in one click (interrupt, then next) and its tooltip names the step it stops; Steer for Codex delivers into the running turn; Claude says it cannot be steered; several collapse and hide; phone width. Fixture only.');
}finally{await browser?.close();await server.close();await f.close();}
