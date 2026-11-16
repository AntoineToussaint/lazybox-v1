// The review loop against the fake Runner (GITHUB.md, "The review loop"):
// round 1 finds a blocker, the reviewer asks the author a question and gets
// the reply (both conversations show it), you send the blocker, the author's
// fix starts round 2, the reviewer resolves it and the loop ends clean, with
// its timeline. Then the escalation path: the same blocker still open after
// two fixes stops the loop and asks you, in the tray and in the author's
// conversation. Then your controls: pause, resume, mode, take over; and the
// loop's settings. The fixture plays both agents.
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
api.files=[{path:'src/handler.go',indexStatus:' ',worktreeStatus:'M'}];
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
const blockerAt={path:'src/handler.go',startLine:4,snippet:['\tlog.Print("handle")'],severity:'blocker'};
const server=await createServer({...testViteCache(import.meta.url),configFile:false,logLevel:'error',root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
let browser;
try{
 await server.listen();await mkdir('.cache',{recursive:true});
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=${author.id}#token=${fixture.token}`);
 await expect(page.locator('.messages')).toContainText('REPLY_ONE');
 await page.getByRole('button',{name:'Review changes',exact:true}).click();
 const changes=page.getByRole('region',{name:'Workspace changes'});
 const tray=changes.getByRole('complementary',{name:'Review'});
 const chat=page.locator('section.panel-chat');
 const start=async(label='Review with Codex')=>{const before=fixture.reviewOf('alpha').runs.length;await changes.getByRole('group',{name:'Review with another agent'}).getByRole('button',{name:label}).click();await expect.poll(()=>fixture.reviewOf('alpha').runs.length).toBe(before+1);return fixture.reviewOf('alpha').runs.at(-1);};
 const reviewRow=run=>tray.locator(`li[data-review="${run.id}"]`);
 const sendAccepted=async n=>{await tray.getByRole('button',{name:`Send ${n} comment${n===1?'':'s'} to the agent`}).click();};

 // ---- Two rounds, ending clean ------------------------------------------
 const run=await start();
 const row=reviewRow(run);
 await expect(row).toContainText('Round 1 of 3 · reviewing');
 // Round 1: a blocker; the reviewer asks the author, and gets the reply.
 const blocker=fixture.fileFinding(run.id,{...blockerAt,title:'The error is logged, not returned',body:'Return it so callers can retry.'});
 fixture.exchange(run.id,{from:'reviewer',question:'Should Handle ever log?',answer:'No: return the error.'});
 await expect(chat.getByRole('note').filter({hasText:'Codex asked Claude:'})).toContainText('Should Handle ever log?');
 await expect(chat.getByRole('note').filter({hasText:'Claude answered Codex:'})).toContainText('No: return the error.');
 fixture.finishReview(run.id);
 await expect(row).toContainText('Round 1 of 3 · waiting for you to send findings',{timeout:15000});
 await expect(row.getByRole('group',{name:'Codex review loop'})).toBeVisible();
 await tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'The error is logged, not returned'}).getByRole('button',{name:'Accept'}).click();
 await tray.getByRole('button',{name:/^Pending/}).click();
 await sendAccepted(1);
 await expect(chat.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(/To ask about one, run `lazybox ask reviewer/);
 await expect(row).toContainText('Round 1 of 3 · Claude is fixing',{timeout:15000});
 // The author's turn ends with changes: round 2 re-reviews only that turn.
 fixture.authorFixed(run.id,2);
 await expect(row).toContainText('Round 2 of 3 · re-reviewing the fix',{timeout:15000});
 // The reviewer resolves the blocker; the loop ends clean.
 fixture.resolveFinding(blocker.id,'returns the error now');
 fixture.finishReview(run.id);
 await expect(row).toContainText('Clean ✓ after 2 rounds',{timeout:15000});
 await expect(row.getByRole('group',{name:'Codex review loop'})).toHaveCount(0);
 await row.locator('details.review-timeline>summary').click();
 const timeline=row.locator('details.review-timeline ol');
 for(const line of ['Codex asked Claude: Should Handle ever log?','Claude answered Codex: No: return the error.','Sent 1 finding to','Round 2: Claude changed 1 file in turn 2','Resolved “The error is logged, not returned”: returns the error now','Clean: no blocker open after 2 rounds.'])await expect(timeline).toContainText(line);
 await page.screenshot({path:'.cache/review-loop-clean.png'});

 // ---- Escalation: the same blocker still open after two fixes ------------
 const stuck=await start();
 const stuckRow=reviewRow(stuck);
 const again=fixture.fileFinding(stuck.id,{...blockerAt,title:'Errors are swallowed',key:'swallowed'});
 fixture.finishReview(stuck.id);
 await expect(stuckRow).toContainText('waiting for you to send findings',{timeout:15000});
 await tray.getByRole('button',{name:/^To triage/}).click();
 await tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'Errors are swallowed'}).getByRole('button',{name:'Accept'}).click();
 await tray.getByRole('button',{name:/^Pending/}).click();
 await sendAccepted(1);
 await expect(stuckRow).toContainText('Claude is fixing',{timeout:15000});
 fixture.authorFixed(stuck.id,3);
 fixture.reopenFinding(again.id,'still swallowed in the retry path');
 fixture.finishReview(stuck.id);
 // Reopened: pending again, to send with the next round.
 await expect(stuckRow).toContainText('Round 2 of 3 · waiting for you to send findings',{timeout:15000});
 await expect(tray.locator('.review-tray-list').getByRole('listitem').filter({hasText:'Errors are swallowed'})).toBeVisible();
 await sendAccepted(1);
 await expect(stuckRow).toContainText('Round 2 of 3 · Claude is fixing',{timeout:15000});
 fixture.authorFixed(stuck.id,4);
 fixture.finishReview(stuck.id); // the reviewer says nothing about it: still open
 await expect(stuckRow).toContainText('Stuck: the same blocker is still open after two fixes · needs you',{timeout:15000});
 await expect(stuckRow).toHaveClass(/needs-you/);
 // The author's conversation says so too, with the way to the review.
 await page.locator('.messages').first().waitFor();
 await chat.getByRole('textbox',{name:'Message',exact:true}).fill('');
 await expect(page.locator('section.panel-chat .review-alert')).toContainText('Review needs you. The blocker “Errors are swallowed”',{timeout:15000});
 await page.screenshot({path:'.cache/review-loop-stuck.png'});

 // ---- Your controls: pause, resume, mode, take over -----------------------
 const third=await start('Review with Codex');
 const thirdRow=reviewRow(third);
 const controls=thirdRow.getByRole('group',{name:'Codex review loop'});
 fixture.fileFinding(third.id,{...blockerAt,title:'Missing test',key:'test'});
 fixture.finishReview(third.id);
 await expect(thirdRow).toContainText('waiting for you to send findings',{timeout:15000});
 await controls.getByRole('button',{name:'Pause'}).click();
 await expect(thirdRow).toContainText('· paused');
 assert.equal(fixture.mutations.filter(m=>m.method==='UpdateReviewRun').at(-1).body.action,'pause');
 await controls.getByRole('button',{name:'Resume'}).click();
 await expect(thirdRow).not.toContainText('· paused');
 await controls.getByRole('combobox',{name:'Between rounds'}).selectOption('auto');
 await expect.poll(()=>fixture.mutations.filter(m=>m.method==='UpdateReviewRun').at(-1)?.body).toMatchObject({action:'loop',loop:'auto'});
 await controls.getByRole('button',{name:'Take over'}).click();
 await expect(thirdRow).toContainText('You took over');
 await expect(chat).toContainText('REPLY_ONE');

 // ---- Settings: between rounds, and the round limit -----------------------
 await page.keyboard.press(`${process.platform==='darwin'?'Meta':'Control'}+,`);
 await page.getByRole('tab',{name:'Agents & workspaces'}).click();
 await page.getByRole('combobox',{name:'Between rounds'}).selectOption('auto');
 await page.getByRole('spinbutton',{name:'Rounds before it asks you'}).fill('5');
 await page.getByRole('button',{name:'Save agent settings'}).click();
 await expect.poll(()=>fixture.mutations.filter(m=>m.method==='SaveRunnerSettings').at(-1)?.body.review).toMatchObject({loop:'auto',maxRounds:5});

 assert.deepEqual(errors,[]);
 console.log('Review loop: two rounds ending clean with a question answered between the agents; a stuck blocker escalated to you; pause, resume, mode and take over; settings.');
}finally{await browser?.close();await server.close();await fixture.close();}
