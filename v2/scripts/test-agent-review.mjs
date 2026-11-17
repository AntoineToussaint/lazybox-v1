// One-click cross-agent review against the fake Runner (GITHUB.md, "Agent
// review"): Review with Codex from Changes opens a read-only reviewer
// conversation with its brief; the reviewer's findings land in the Review
// tray with their severity and author; accept one, dismiss one with a reason,
// send the accepted one to the author's message box exactly as filed; the
// author's conversation shows the review live, then its outcome. Then the
// other ways in: a turn's ⋯ menu, the PR card, the file list's context menu,
// ⌘K, and Settings → Agents & workspaces → Review by another agent.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';
import {testViteCache} from './fixtures/vite-cache.mjs';

const fixture=await startRunnerFixture();
const author=fixture.sessions[0];
Object.assign(author,{title:'Harden the handler',provider:'claude',status:'ready',busy:false,agents:[{id:'root',name:'Main agent',status:'done'}]});
const events=fixture.openEvents(author.id);
events.push({type:'operation_accepted',operationId:'op-1',text:'Return errors from Handle instead of logging them'});
events.push({type:'message_delta',text:'REPLY_ONE: Handle returns its error now.'});events.push({type:'turn_ended'});
fixture.setCheckpoints(author.id,{turns:[{operationId:'op-1',prompt:'Return errors from Handle instead of logging them',files:[{member:'api',path:'src/handler.go',status:'M',additions:2,deletions:1}]}]});
const api=fixture.shipState('alpha','api');
Object.assign(api,{githubRepository:'fixture-team/api',files:[{path:'src/handler.go',indexStatus:' ',worktreeStatus:'M'}]});
fixture.diffs.set('alpha/api/src/handler.go',`diff --git a/src/handler.go b/src/handler.go
--- a/src/handler.go
+++ b/src/handler.go
@@ -1,5 +1,6 @@
 package api

-func Handle() {
+func Handle() error {
+\tlog.Print("handle")
 \treturn
 }
`);
const starts=()=>fixture.mutations.filter(m=>m.method==='StartReview').map(m=>m.body);
const server=await createServer({...testViteCache(import.meta.url),configFile:false,logLevel:'error',root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
let browser;
try{
 await server.listen();await mkdir('.cache',{recursive:true});
 browser=await chromium.launch({headless:true});
 let page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const mod=process.platform==='darwin'?'Meta':'Control';
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=${author.id}#token=${fixture.token}`);
 await expect(page.locator('.messages')).toContainText('REPLY_ONE');
 await page.getByRole('button',{name:'Review changes',exact:true}).click();
 const changes=page.getByRole('region',{name:'Workspace changes'});
 await expect(changes.getByRole('grid',{name:'File diff'})).toContainText('log.Print("handle")');

 // 1. One click: Codex (the other provider than Claude, the author) reviews the changes.
 const reviewWith=changes.getByRole('group',{name:'Review with another agent'});
 await expect(reviewWith.getByRole('button',{name:'Review with Codex'})).toBeVisible();
 await page.screenshot({path:'.cache/agent-review-start.png'});
 await reviewWith.getByRole('button',{name:'Review with Codex'}).click();
 await expect.poll(()=>starts().length).toBe(1);
 assert.deepEqual((({collectionId,sourceSessionId,scope,compare='',provider,profileId=''})=>({collectionId,sourceSessionId,scope,compare,provider,profileId}))(starts()[0]),{collectionId:'alpha',sourceSessionId:author.id,scope:'changes',compare:'',provider:'codex',profileId:''});
 const reviewer=fixture.sessions.find(s=>s.title==='Review · Changes · Codex');
 assert.equal(reviewer.permission,'read-only');assert.equal(reviewer.provider,'codex');
 // The reviewer conversation opens beside the work, its brief its first message:
 // an event from Lazybox, never the person's words, that opens to the brief as sent.
 const chat=page.locator('section.panel-chat');
 const briefEvent=chat.locator('.system-event[data-kind=review_brief]');
 await expect(briefEvent.locator('.system-event-text')).toHaveText("Asked Codex to review Claude's work");
 await expect(briefEvent.locator('.system-event-detail')).toHaveText('Changes');
 await expect(chat.locator('article.message.operation_accepted')).toHaveCount(0);
 await briefEvent.locator('.system-event-toggle').click();
 await expect(briefEvent.locator('.system-event-body')).toContainText('You are an independent reviewer (Codex) of work Claude did');
 await expect(briefEvent.locator('.system-event-body')).toContainText('lazybox review add');
 // The tray follows the review live.
 const tray=changes.getByRole('complementary',{name:'Review'});
 await expect(tray.getByRole('list',{name:'Agent reviews'})).toContainText('Codex is reviewing changes');

 // 2. Codex files two findings (`lazybox review add`): they arrive to triage,
 // with their severity and author.
 const run=fixture.reviewOf('alpha').runs[0];
 const blocker=fixture.fileFinding(run.id,{path:'src/handler.go',startLine:3,endLine:4,snippet:['func Handle() error {','\tlog.Print("handle")'],severity:'blocker',title:'The error is logged, not returned',body:'Return it so callers can retry. Logged here, the failure never reaches the request handler, which answers 200 with an empty body instead.'});
 const minor=fixture.fileFinding(run.id,{path:'src/handler.go',startLine:4,snippet:['\tlog.Print("handle")'],severity:'minor',title:'Use the structured logger',body:'log.Print loses the request id.'});
 await expect(tray.getByRole('button',{name:/^To triage/})).toContainText('2',{timeout:15000});
 await expect(tray.getByRole('button',{name:/^To triage/})).toHaveAttribute('aria-pressed','true');
 const blockerRow=tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'The error is logged, not returned'});
 await expect(blockerRow).toContainText('Blocker');await expect(blockerRow).toContainText('from Codex');
 await expect(tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'Use the structured logger'})).toContainText('Minor');
 // A finding's text and the review's summary wrap in the narrow tray: nothing is cut off.
 const clipped=await tray.locator('.review-tray-body, .review-run-summary').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.textContent));
 assert.deepEqual(clipped,[],'no tray text runs past its box');
 // Filters: by severity, by author.
 await tray.getByRole('combobox',{name:'Severity'}).selectOption('blocker');
 await expect(tray.locator('.review-tray-list').getByRole('listitem')).toHaveCount(1);
 await tray.getByRole('combobox',{name:'Severity'}).selectOption('');
 await expect(tray.getByRole('combobox',{name:'Author'})).toContainText('Codex');
 await page.screenshot({path:'.cache/agent-review-findings.png'});
 // In the diff: a finding card with its severity, title and triage.
 const finding=changes.getByRole('article',{name:'Blocker finding on lines 3–4'});
 await expect(finding).toContainText('The error is logged, not returned');await expect(finding).toContainText('from Codex');

 // 3. Accept the blocker; dismiss the minor, saying why.
 await blockerRow.getByRole('button',{name:'Accept'}).click();
 await expect.poll(()=>fixture.mutations.filter(m=>m.method==='SetReviewDisposition').at(-1)?.body).toMatchObject({ids:[blocker.id],disposition:'open'});
 const minorRow=tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'Use the structured logger'});
 await minorRow.getByRole('button',{name:'Dismiss'}).click();
 await minorRow.getByRole('textbox',{name:'Why dismiss it'}).fill('Out of scope for this change');
 await page.keyboard.press('Enter');
 await expect.poll(()=>fixture.mutations.filter(m=>m.method==='SetReviewDisposition').at(-1)?.body).toMatchObject({ids:[minor.id],disposition:'dismissed',note:'Out of scope for this change'});
 await tray.getByRole('button',{name:/^Done/}).click();
 await expect(tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'Use the structured logger'})).toContainText('Dismissed: Out of scope for this change');

 // 4. Ask the reviewer: its conversation, with a follow-up started.
 await tray.getByRole('button',{name:/^Pending/}).click();
 await tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'The error is logged, not returned'}).getByRole('button',{name:'Ask Codex'}).click();
 const box=chat.getByRole('textbox',{name:'Message',exact:true});
 await expect(box).toHaveValue(`About your finding ${blocker.id} (blocker at api/src/handler.go:3–4, “The error is logged, not returned”): `);

 // 5. Send the accepted finding to the author, exactly as filed; never sent for the person.
 const applies=fixture.mutations.filter(m=>m.method==='Apply').length;
 await tray.getByRole('button',{name:'Send 1 comment to the agent'}).click();
 await expect(box).toHaveValue(/^Please address this review comment/);
 await expect(box).toHaveValue(new RegExp(`### 1\\. api/src/handler\\.go:3–4\\n\\n\\*\\*Blocker: The error is logged, not returned\\*\\* \\(finding ${blocker.id}, from Codex\\)`));
 await expect(box).toHaveValue(/Return it so callers can retry\./);
 assert.equal(fixture.mutations.filter(m=>m.method==='Apply').length,applies,'the review must not be sent on the person\'s behalf');
 assert.equal(fixture.mutations.filter(m=>m.method==='SetReviewDisposition').at(-1).body.sessionId,author.id);

 // 6. The reviewer ends its turn: the author's conversation shows the outcome.
 fixture.finishReview(run.id);
 const card=page.locator('.messages').getByRole('group',{name:'Codex review'});
 await expect(card).toContainText('Codex reviewed changes · 1 blocker',{timeout:15000});
 await page.screenshot({path:'.cache/agent-review-card.png'});
 await card.getByRole('button',{name:'Open review'}).click();
 await expect(tray.getByRole('list',{name:'Agent reviews'})).toContainText('Codex reviewed changes · 1 blocker');

 // 7. A review of a review is never offered: from the reviewer's conversation
 // the work under review is still the author's.
 await page.locator('.messages').getByRole('group',{name:'Codex review'}).getByRole('button',{name:'Open conversation'}).click();
 await expect(chat.locator('.system-event[data-kind=review_brief] .system-event-text')).toHaveText("Asked Codex to review Claude's work");
 // A narrow Changes panel shows the files or the tray in its left column: the files come to the front.
 await changes.getByRole('tab',{name:/^Files/}).click();
 await changes.getByRole('navigation',{name:'Changed files'}).getByRole('button',{name:/src\/handler\.go/}).first().click({button:'right'});
 const menu=page.getByRole('menu');
 await menu.getByRole('menuitem',{name:'Review the changes with Codex'}).click();
 await expect.poll(()=>starts().length).toBe(2);
 assert.equal(starts()[1].sourceSessionId,author.id,'the reviewer conversation is never itself reviewed');

 // 8. ⌘K: "Review changes with Claude".
 await page.keyboard.press(`${mod}+k`);
 const palette=page.getByRole('dialog',{name:'Command palette'});
 await palette.getByRole('combobox',{name:'Search commands'}).fill('review changes with claude');
 await expect(palette.getByRole('option').first()).toContainText('Review changes with Claude');
 await page.keyboard.press('Enter');
 await expect.poll(()=>starts().length).toBe(3);
 assert.equal(starts()[2].provider,'claude');

 // 9. A turn's ⋯ menu: "Review this turn with Codex".
 // A fresh window on the author's conversation.
 await page.close();page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=${author.id}#token=${fixture.token}`);
 const marker=page.locator('.messages').getByRole('group',{name:'Turn 1 checkpoint'});
 await marker.getByLabel('Turn 1 actions',{exact:true}).click();
 await marker.getByRole('button',{name:'Review this turn with Codex'}).click();
 await expect.poll(()=>starts().length).toBe(4);
 assert.deepEqual((({scope,turn,provider})=>({scope,turn,provider}))(starts()[3]),{scope:'turn',turn:1,provider:'codex'});
 await expect(page.locator('section.panel-chat .system-event[data-kind=review_brief] .system-event-detail')).toHaveText('Turn 1');

 // 9b. The message box: `/review claude` (and `/review` alone is the default reviewer).
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=${author.id}#token=${fixture.token}`);
 const message=page.locator('section.panel-chat').getByRole('textbox',{name:'Message',exact:true});
 await message.click();await page.keyboard.type('/review cla');
 await expect(page.getByRole('option',{name:/Review with Claude/})).toBeVisible();
 await page.keyboard.press('Enter');
 await expect.poll(()=>starts().length).toBe(5);
 assert.deepEqual((({scope,provider,sourceSessionId})=>({scope,provider,sourceSessionId}))(starts()[4]),{scope:'changes',provider:'claude',sourceSessionId:author.id});
 assert.equal(fixture.mutations.filter(m=>m.method==='Apply'&&m.body.sessionId===author.id&&/\/review/.test(m.body.message?.text||'')).length,0,'/review runs in Lazybox; nothing is sent to the agent');

 // 10. The PR card: "Review the PR with Codex".
 api.pr={number:'7',title:'Return handler errors',url:'https://github.com/fixture-team/api/pull/7',state:'open',draft:false,base:'main',headSha:api.head,mergeableState:'clean',reviewDecision:'',checksState:'success',author:'fixture-user',checks:[]};
 await page.getByRole('button',{name:'Review changes',exact:true}).click();
 const pr=page.getByRole('region',{name:'Workspace changes'}).getByRole('region',{name:'Pull request #7'});
 await pr.getByRole('button',{name:'Review the PR with Codex'}).click();
 await expect.poll(()=>starts().length).toBe(6);
 assert.deepEqual((({scope,member})=>({scope,member}))(starts()[5]),{scope:'pr',member:'api'});
 await expect(page.locator('section.panel-chat .system-event[data-kind=review_brief] .system-event-detail')).toHaveText('PR #7');

 // 11. Settings: the default reviewer, automatic reviews, the brief, and its reset.
 await page.keyboard.press(`${mod}+,`);
 await page.getByRole('tab',{name:'Agents & workspaces'}).click();
 await page.getByRole('combobox',{name:'Default reviewer'}).selectOption('codex-saved');
 const auto=page.getByRole('checkbox',{name:'Review every turn that changes files'});
 await expect(auto).not.toBeChecked();await auto.check();
 const brief=page.getByRole('textbox',{name:'Review brief'});
 await expect(brief).toHaveValue(/You are an independent reviewer/);
 await brief.fill('Be terse. Review {{scope}}.');
 await page.getByRole('button',{name:'Save agent settings'}).click();
 await expect.poll(()=>fixture.mutations.filter(m=>m.method==='SaveRunnerSettings').at(-1)?.body.review).toMatchObject({reviewer:'codex-saved',autoStart:true,template:'Be terse. Review {{scope}}.'});
 await page.getByRole('button',{name:'Reset the brief to the built-in one'}).click();
 await expect(brief).toHaveValue(/You are an independent reviewer/);
 await page.getByRole('button',{name:'Save agent settings'}).click();
 await expect.poll(()=>fixture.mutations.filter(m=>m.method==='SaveRunnerSettings').at(-1)?.body.review?.template||'').toBe('');
 await page.screenshot({path:'.cache/agent-review-settings.png'});

 assert.deepEqual(errors,[]);
 console.log('Agent review: one click from Changes, a turn, the PR card, the file list, /review and ⌘K; findings triaged and sent as filed; settings.');
}finally{await browser?.close();await server.close();await fixture.close();}
