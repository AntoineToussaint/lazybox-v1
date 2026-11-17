// Fixture only: a subscription limit, as the person meets it. An automatic
// switch is one quiet line; without one, one card offers the best other
// subscription, waiting for the reset, and "Always switch automatically"; a
// message sent meanwhile goes once; ⋯ → Switch subscription… works any time.
import {testViteCache} from './fixtures/vite-cache.mjs';
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import {webkit,expect} from '@playwright/test';import {fileURLToPath} from 'node:url';import {mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';import {startRunnerFixture} from './fixtures/runner-ui.mjs';
const f=await startRunnerFixture();
const now=Date.now(),reset=Math.floor(now/1000)+3*3600;
const clock=seconds=>new Date(seconds*1000).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const backLabel=new RegExp(`(tomorrow )?at ${clock(reset).replace(/\s/g,'\\s')}`);
const saved=(id,label,availability)=>({id,label,provider:'claude',isolation:'environment',managed:true,availability});
f.profiles.push(saved('work-1','Work subscription 1',{state:'available',windows:[{name:'five_hour',usedPercent:37,durationMinutes:'300'}]}),saved('work-2','Work subscription 2',{state:'exhausted',resetAt:String(reset)}),saved('work-3','Work subscription 3',{state:'available'}));
const data=value=>Buffer.from(JSON.stringify(value)).toString('base64');
const limitEvent=resetAt=>({type:'failure',status:'exhausted',text:'rate_limit',account:{state:'exhausted',resetAt:String(resetAt)}});

// Alpha switched by itself when Work subscription 2 hit its limit.
Object.assign(f.sessions[0],{title:'Fix the flaky login test',provider:'claude',profileId:'work-1',status:'done',busy:false,rotationProfileIds:['work-2','work-3'],agents:[{id:'root',status:'done',lastTurnStatus:'completed'}]});
const alpha=f.openEvents('alpha-session');
for(const event of [{type:'operation_accepted',text:'The login test is flaky, can you find out why?'},{type:'message_delta',text:'Looking at the test first.'},limitEvent(reset),{type:'capacity_observation',status:'exhausted',account:{state:'exhausted',resetAt:String(reset)}},{type:'profile_switching',status:'exhausted'},{type:'profile_changed',text:'work-1',status:'checkpoint_handoff',providerDataJson:data({from:'work-2',fromState:'exhausted',resetAt:reset,requested:false})},{type:'message_delta',text:'Picking up where I stopped: the test races the session cookie.'},{type:'turn_ended',status:'completed'}])alpha.push(event);

// Beta started before automatic switching existed and stopped at the limit.
Object.assign(f.sessions[1],{title:'Ship the release notes',provider:'claude',profileId:'work-2',status:'failed',fault:'exhausted',busy:false,rotationProfileIds:[],account:{state:'exhausted',resetAt:String(reset)},agents:[{id:'root',status:'failed',lastTurnStatus:'failed'}]});
const beta=f.openEvents('beta-session');
for(const event of [{type:'operation_accepted',text:'Write the release notes for 0.1.21'},{type:'message_delta',text:'Collecting the merged pull requests.'},limitEvent(reset),{type:'turn_ended',status:'failed'}])beta.push(event);

// Gamma waits for a reset a few seconds away.
const soon=Math.floor(Date.now()/1000)+6;
f.collections.push({id:'gamma',name:'Gamma docs',workId:'gamma',root:'/fixture/collections/gamma',state:'ready',ownerExecutionId:'gamma-session',members:[{spec:{name:'api',repositoryId:'backend',baseRef:'main',branch:'lazybox/gamma/api'},path:'/fixture/collections/gamma/api',baseCommit:'c'.repeat(40),ready:true}]});
f.sessions.push({id:'gamma-session',collectionId:'gamma',workId:'gamma',title:'Tidy the docs',provider:'claude',profileId:'work-2',gatewayId:'direct',workingDirectory:'/fixture/collections/gamma',capabilities:{files:true,images:true,resume:true,livePermission:true},permission:'ask',pending:[],status:'failed',fault:'exhausted',rotationProfileIds:[],account:{state:'exhausted',resetAt:String(soon)},agents:[{id:'root',status:'failed',lastTurnStatus:'failed'}]});
const gamma=f.openEvents('gamma-session');
for(const event of [{type:'operation_accepted',text:'Tidy the docs folder'},limitEvent(soon),{type:'turn_ended',status:'failed'}])gamma.push(event);

const server=await createServer({...testViteCache(import.meta.url),configFile:false,logLevel:'error',root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:f.url}}}});let browser;
const raw=chat=>Promise.all([expect(chat).not.toContainText(/exhausted|rate_limit|provider failure|provider_error/i),expect(chat.locator('.account-notice')).toHaveCount(0)]);
try{
 await server.listen();await mkdir('.cache',{recursive:true});browser=await webkit.launch();
 const page=await browser.newPage({viewport:{width:1440,height:900},locale:'en-US'});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;

 // 1. Automatic: one quiet line says where the conversation went and when the old one resets.
 await page.goto(`${base}/?view=workspace&collection=alpha&session=alpha-session#token=${f.token}`);
 let chat=page.locator('.embedded-chat:visible').first();
 const line=chat.locator('.subscription-switched');
 await expect(line).toHaveCount(1);
 await expect(line).toHaveText(new RegExp(`^Switched to Work subscription 1 · Work subscription 2 is back ${backLabel.source}$`));
 await expect(chat).toContainText('Picking up where I stopped');
 await expect(chat.locator('.limit-card')).toHaveCount(0);
 await expect(chat.locator('.messages:visible .error')).toHaveCount(0);
 await raw(chat);
 await page.screenshot({path:'.cache/subscription-auto-switch.png'});

 // 4. ⋯ → Switch subscription… at any time, with automatic switching in the same place.
 await chat.locator('summary[aria-label="Session actions"]').click();
 await page.getByRole('button',{name:'Switch subscription…'}).click();
 let dialog=page.getByRole('dialog',{name:'Switch subscription'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('radio',{name:/Work subscription 1/})).toBeDisabled();
 await expect(dialog.getByRole('radio',{name:/Work subscription 1/})).toHaveAccessibleName(/current/);
 await expect(dialog.locator('.subscription-choice').filter({hasText:'Work subscription 2'})).toContainText(/Limit reached · back (tomorrow )?at/); // a reset after midnight reads "tomorrow at"
 await expect(dialog.locator('.subscription-choice').filter({hasText:'Work subscription 3'})).toContainText('Available');
 const auto=dialog.getByRole('checkbox',{name:'Switch automatically when a subscription reaches its limit'});
 await expect(auto).toBeChecked();
 await auto.uncheck();
 await expect.poll(()=>f.mutations.findLast(m=>m.method==='SetSessionRotation')?.body).toEqual({sessionId:'alpha-session'});
 await expect(auto).not.toBeChecked();
 await dialog.getByRole('radio',{name:/Work subscription 3/}).check();
 await page.screenshot({path:'.cache/subscription-switch-dialog.png'});
 await dialog.getByRole('button',{name:'Switch to Work subscription 3'}).click();
 await expect(dialog).toHaveCount(0);
 assert.deepEqual(f.mutations.findLast(m=>m.method==='SwitchSubscription').body,{sessionId:'alpha-session',profileId:'work-3'});
 await expect(chat.locator('.subscription-switched')).toHaveCount(2);
 await expect(chat.locator('.subscription-switched').last()).toHaveText('Switched to Work subscription 3');

 // 2. No automatic switching: ONE card, in words, with the best other subscription first.
 await page.goto(`${base}/?view=workspace&collection=beta&session=beta-session#token=${f.token}`);
 chat=page.locator('.embedded-chat:visible').first();
 const card=chat.locator('.limit-card');
 await expect(card).toHaveCount(1);
 await expect(card.getByRole('heading')).toHaveText(new RegExp(`^Work subscription 2 reached its limit · back ${backLabel.source} \\(in .+\\)$`));
 await expect(chat.locator('.chat-heading .chat-status')).toContainText(new RegExp(`Limit reached · back ${backLabel.source}`));
 await expect(chat.locator('.chat-heading .chat-status')).not.toContainText('Needs attention');
 await expect(chat.locator('.messages:visible .error')).toHaveCount(0);
 await raw(chat);
 await expect(card.getByRole('radio')).toHaveCount(3);
 await expect(card.getByRole('radio',{name:/Work subscription 1/})).toBeChecked();
 await expect(card.locator('.subscription-choice').filter({hasText:'Work subscription 1'})).toContainText('Available · 37% used');
 await expect(card.getByRole('button',{name:'Wait for reset'})).toBeVisible();
 const always=card.getByRole('checkbox',{name:'Always switch automatically'});
 await expect(always).toBeChecked();
 // A message sent while waiting is kept, and goes once.
 const composer=chat.getByRole('textbox',{name:'Message',exact:true});
 await expect(composer).toHaveAttribute('placeholder',/sent when the conversation continues/);
 await composer.fill('Also mention the shim fix');await composer.press('Enter');
 await expect(composer).toHaveValue('');
 await expect(card).toContainText('Your message is saved and will be sent once, when the conversation continues.');
 await page.screenshot({path:'.cache/subscription-limit-card.png'});
 await card.getByRole('button',{name:'Continue with Work subscription 1'}).click();
 await expect.poll(()=>f.mutations.findLast(m=>m.method==='SwitchSubscription')?.body).toEqual({sessionId:'beta-session',profileId:'work-1',enableRotation:true});
 await expect(chat.locator('.limit-card[aria-label="Subscription limit"]')).toHaveCount(0);
 await expect(chat.locator('.subscription-switched')).toHaveText(new RegExp(`^Switched to Work subscription 1 · Work subscription 2 is back ${backLabel.source}$`));
 await expect(chat.locator('.chat-heading .chat-status')).not.toContainText('Limit reached');
 // The first time, one small question: everywhere, or just here.
 const everywhere=chat.getByRole('region',{name:'Automatic switching'});
 await expect(everywhere).toContainText('Do the same for every Claude conversation?');
 await page.screenshot({path:'.cache/subscription-everywhere.png'});
 await everywhere.getByRole('button',{name:'Every conversation'}).click();
 await expect.poll(()=>f.mutations.findLast(m=>m.method==='SetSessionRotation')?.body).toEqual({sessionId:'beta-session',enabled:true,allSessions:true});
 await expect(everywhere).toHaveCount(0);
 // Never sent twice: the interrupted request continues on the Runner, the follow-up was one operation.
 const applies=f.mutations.filter(m=>m.method==='Apply'&&m.body.sessionId==='beta-session');
 assert.equal(applies.length,1,`one send, not ${applies.length}`);
 assert.equal(applies[0].body.message.text,'Also mention the shim fix');
 await page.waitForTimeout(2000);
 assert.equal(f.mutations.filter(m=>m.method==='Apply'&&m.body.sessionId==='beta-session').length,1,'no resend after the switch');
 await raw(chat);

 // 3. Wait for reset: a quiet line, then the same request continues on its own, once.
 f.sessions.find(s=>s.id==='gamma-session').account.resetAt=String(Math.floor(Date.now()/1000)+6);
 await page.goto(`${base}/?view=workspace&collection=gamma&session=gamma-session#token=${f.token}`);
 chat=page.locator('.embedded-chat:visible').first();
 await chat.locator('.limit-card').getByRole('button',{name:'Wait for reset'}).click();
 await expect(chat.locator('.limit-card.is-waiting')).toContainText(/Waiting for Work subscription 2: back .*at .* \(in .+\)\. The conversation continues on its own then\./);
 await expect(chat.locator('.limit-card.is-waiting').getByRole('button',{name:'Continue with Work subscription 1'})).toBeVisible();
 await page.screenshot({path:'.cache/subscription-waiting.png'});
 await expect.poll(()=>f.mutations.filter(m=>m.method==='SwitchSubscription'&&m.body.sessionId==='gamma-session').map(m=>m.body),{timeout:20000}).toEqual([{sessionId:'gamma-session',profileId:'work-2'}]);
 await expect(chat.locator('.subscription-switched')).toHaveText('Continued on Work subscription 2');
 await expect(chat.locator('.limit-card')).toHaveCount(0);
 await page.waitForTimeout(2500);
 assert.equal(f.mutations.filter(m=>m.method==='SwitchSubscription'&&m.body.sessionId==='gamma-session').length,1,'resumed once');
 assert.deepEqual(errors,[]);
 console.log('PASS automatic switch line, one limit card in words (best subscription, picker, wait, Always switch automatically), a message sent while limited goes once, the everywhere question, wait-for-reset resumes once, ⋯ Switch subscription with automatic switching. Fixture only.');
}finally{await browser?.close();await server.close();await f.close();}
