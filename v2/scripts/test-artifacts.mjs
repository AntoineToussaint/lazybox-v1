// Artifacts (ARTIFACTS.md): an agent's plan in a chat message becomes its own
// page from the message's right-click menu or its hover action; a later
// message updates it after a reviewed diff; the Artifacts panel lists it with
// its versions; it opens in its own window; it exports (copy, download); a
// Markdown file is tracked from Files and follows changes on disk; an agent's
// `lazybox artifact put` shows up; deleting asks first. Fixture only;
// WebKit by default (the desktop engine).
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit,chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';
import {testViteCache} from './fixtures/vite-cache.mjs';
import {monacoVimCompat} from './monaco-vim-compat.mjs';

const fixture=await startRunnerFixture();const session=fixture.sessions[0];
Object.assign(session,{busy:false,status:'done',conversationId:'conversation-alpha',agents:[{id:'root',status:'done'}]});
const channel=fixture.openEvents(session.id);
const plan1='# Datasource migration plan\n\nMove reads first, then writes.\n\n## Steps\n1. Phase one: dual read\n2. Phase two: dual write\n3. Phase three: cut over\n';
const plan2=plan1.replace('2. Phase two: dual write','2. Phase two: dual write behind a flag').replace('3. Phase three: cut over','3. Phase three: cut over\n4. Phase four: remove the old path');
channel.push({type:'operation_accepted',text:'Write the migration plan'});
channel.push({type:'message_delta',text:plan1,turnId:'t1'});
const server=await createServer({...testViteCache(import.meta.url),configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),logLevel:'warn',plugins:[react(),monacoVimCompat()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
let browser;
try{
 await mkdir('.cache',{recursive:true});await server.listen();browser=await (process.env.TEST_CHROMIUM?chromium:webkit).launch({headless:true});
 const context=await browser.newContext({viewport:{width:1400,height:900},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 // Copies are recorded; the rest of the real clipboard (which the editor uses) is left alone.
 await page.addInitScript(()=>{window.__copies=[];if(navigator.clipboard)navigator.clipboard.writeText=async text=>{window.__copies.push(text);};else Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copies.push(text);}}});});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=${session.id}#token=${fixture.token}`);
 const message=page.locator('.messages article.message.message_delta').filter({hasText:'Datasource migration plan'}).first();
 await expect(message).toBeVisible();

 // The hover action is quiet until the message is hovered; prompts have none.
 const hover=message.getByRole('button',{name:'Track as artifact…'});
 await message.hover();await expect(hover).toBeVisible();
 await expect(page.locator('.messages article.message.operation_accepted').getByRole('button',{name:'Track as artifact…'})).toHaveCount(0);

 // Right-click → Track as artifact…: title from the first heading, kind suggested.
 await message.click({button:'right'});
 const menu=page.getByRole('menu',{name:'Message actions'});
 await expect(menu.getByRole('menuitem')).toHaveText(['Track as artifact…','Copy message as Markdown']);
 await menu.getByRole('menuitem',{name:'Track as artifact…'}).click();
 const track=page.getByRole('dialog',{name:'Track as artifact'});
 await expect(track.getByLabel('Title')).toHaveValue('Datasource migration plan');
 await expect(track.getByRole('radio',{name:'Plan'})).toHaveAttribute('aria-checked','true');
 await expect(track.getByRole('region',{name:'Preview'})).toContainText('Phase three: cut over');
 await track.getByRole('button',{name:'Track artifact'}).click();
 await expect(track).toHaveCount(0);
 const put=fixture.mutations.find(m=>m.method==='PutArtifact');
 assert.equal(put.body.source.kind,'message');assert.equal(put.body.source.sessionId,session.id);assert.equal(put.body.source.conversationId,'conversation-alpha');assert.ok(put.body.source.messageId);

 // The Artifacts panel opens on the new page.
 const artifactPage=page.getByRole('article',{name:'Datasource migration plan'});
 await expect(artifactPage.getByRole('heading',{name:'Datasource migration plan',level:2})).toBeVisible();
 await expect(artifactPage.locator('.artifact-document')).toContainText('Phase one: dual read');
 await expect(artifactPage.locator('.artifact-meta')).toContainText('v1 · from a chat message');
 await page.screenshot({path:'.cache/artifacts-tracked.png'});

 // A later message of the same conversation offers an update, shown as a diff first.
 channel.push({type:'operation_accepted',text:'Refine it'});
 channel.push({type:'message_delta',text:plan2,turnId:'t2'});
 const newer=page.locator('.messages article.message.message_delta').filter({hasText:'Phase four'});
 await expect(newer).toBeVisible();
 await newer.click({button:'right'});
 await page.getByRole('menuitem',{name:'Update “Datasource migration plan” from this message…'}).click();
 const update=page.getByRole('dialog',{name:'Update artifact'});
 const diff=update.getByRole('region',{name:'Changes from v1'});
 await expect(diff.locator('.artifact-diff-line.is-add')).toHaveCount(2);
 await expect(diff.locator('.artifact-diff-line.is-remove')).toHaveCount(1);
 await expect(update.locator('.artifact-diff-stats')).toContainText('+2−1');
 await page.screenshot({path:'.cache/artifacts-update-diff.png'});
 await update.getByRole('button',{name:'Save as v2'}).click();
 await expect(update).toHaveCount(0);
 await expect(artifactPage.locator('.artifact-document')).toContainText('Phase four: remove the old path');
 // History is beside the document when the page is wide, and opened on demand over it when narrow.
 const versions=artifactPage.getByRole('listbox',{name:'Versions'});
 if(!await versions.isVisible())await artifactPage.getByRole('button',{name:'2 versions'}).click();
 await expect(versions.getByRole('option')).toHaveCount(2);
 if(await artifactPage.getByRole('button',{name:'Close history'}).isVisible())await artifactPage.getByRole('button',{name:'Close history'}).click();
 // The original message has nothing newer to offer for this artifact.
 await message.click({button:'right'});
 await expect(page.getByRole('menu',{name:'Message actions'}).getByRole('menuitem')).toHaveText(['Track as artifact…','Copy message as Markdown']);
 await page.keyboard.press('Escape');await expect(page.getByRole('menu',{name:'Message actions'})).toHaveCount(0);

 // Changes between versions, and an older version with a way back.
 await artifactPage.getByRole('tab',{name:'Changes'}).click();
 await expect(artifactPage.getByRole('region',{name:'Changes from v1 to v2'}).locator('.artifact-diff-line.is-add')).toHaveCount(2);
 await artifactPage.getByRole('tab',{name:'Document'}).click();
 if(!await versions.isVisible())await artifactPage.getByRole('button',{name:'2 versions'}).click();
 await artifactPage.getByRole('option',{name:/^v1/}).click();
 await expect(artifactPage.getByRole('note')).toContainText('You are viewing v1 of 2.');
 await expect(artifactPage.locator('.artifact-document')).not.toContainText('Phase four');
 await artifactPage.getByRole('button',{name:'Back to latest'}).click();
 await expect(artifactPage.locator('.artifact-document')).toContainText('Phase four');

 // Export: copy as Markdown and download a .md file.
 await artifactPage.getByLabel('Export',{exact:true}).click();
 await page.getByRole('button',{name:'Copy as Markdown'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__copies.at(-1))).toBe(plan2);
 await artifactPage.getByLabel('Export',{exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download .md'}).click()]);
 assert.equal(download.suggestedFilename(),'datasource-migration-plan.md');
 assert.equal(await readFile(await download.path(),'utf8'),plan2);

 // Rename in place.
 await artifactPage.getByRole('heading',{name:'Datasource migration plan',level:2}).dblclick();
 await page.getByLabel('Artifact title').fill('Datasource rollout plan');await page.keyboard.press('Enter');
 const renamed=page.getByRole('article',{name:'Datasource rollout plan'});
 await expect(renamed.getByRole('heading',{name:'Datasource rollout plan',level:2})).toBeVisible();

 // Its own window: the same page, following the same artifact.
 const [detached]=await Promise.all([context.waitForEvent('page'),renamed.getByRole('button',{name:'Open in its own window'}).click()]);
 await detached.waitForLoadState();
 await expect(detached.getByRole('heading',{name:'Datasource rollout plan',level:2})).toBeVisible();
 await expect(detached.locator('.artifact-document')).toContainText('Phase four');
 assert.match(detached.url(),/view=artifact/);
 await detached.screenshot({path:'.cache/artifacts-window.png'});
 await detached.close();

 // An agent's `lazybox artifact put` appears in the list.
 fixture.artifacts.agentPut({collectionId:'alpha',sessionId:session.id,conversationId:'conversation-alpha',title:'Review findings',kind:'report',content:'# Review findings\n\nNo blockers.\n'});
 const back=renamed.getByRole('button',{name:'Back to artifacts'});
 if(await back.isVisible())await back.click();
 const list=page.getByRole('listbox',{name:'Artifacts'});
 await expect(list.getByRole('option',{name:/Review findings/})).toContainText('published by an agent',{timeout:10000});

 // A Markdown file tracked from Files follows changes on disk.
 await page.getByLabel('Page actions',{exact:true}).click();
 await page.getByRole('button',{name:'Files',exact:true}).click();
 const tree=page.getByRole('tree',{name:'Workspace files'});
 const readme=tree.getByRole('treeitem',{name:/README\.md/}).first();
 await readme.click({button:'right'});
 const fileMenu=page.getByRole('menu',{name:/README\.md actions/});
 await expect(fileMenu.getByRole('menuitem',{name:'Track as artifact'})).toBeEnabled();
 await fileMenu.getByRole('menuitem',{name:'Track as artifact'}).click();
 await expect.poll(()=>fixture.mutations.some(m=>m.method==='TrackArtifactFile')).toBe(true);
 const tracked=fixture.mutations.find(m=>m.method==='TrackArtifactFile');assert.match(tracked.body.path,/README\.md$/);
 const filePage=page.getByRole('article',{name:'File preview'});
 await expect(filePage.locator('.artifact-meta')).toContainText(`Synced with ${tracked.body.path}`);
 fixture.artifacts.fileChanged('alpha',tracked.body.path,'# File preview\nEdited by an agent on disk.\n');
 await expect(filePage.locator('.artifact-document')).toContainText('Edited by an agent on disk.',{timeout:10000});
 await expect(filePage.locator('.artifact-meta')).toContainText('v2 · file changed on disk');

 // Deleting asks first, then the page and its row are gone.
 await filePage.getByLabel('Artifact actions',{exact:true}).click();
 await page.getByRole('button',{name:'Delete…'}).click();
 const confirm=page.getByRole('dialog',{name:'Delete artifact'});
 await expect(confirm).toContainText('stays in the repository');
 await confirm.getByRole('button',{name:'Delete artifact'}).click();
 await expect(page.getByRole('article',{name:'File preview'})).toHaveCount(0);
 await expect(list.getByRole('option',{name:/File preview/})).toHaveCount(0);
 await expect(list.getByRole('option')).toHaveCount(2);
 await page.screenshot({path:'.cache/artifacts-panel.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: track a chat message as an artifact (right-click and hover), update it after a reviewed diff, browse versions and changes, copy and download, rename, open in its own window, list an agent\'s artifact, track a Markdown file that follows disk changes, delete with confirmation. Fixture only.');
}finally{await browser?.close();await server.close();await fixture.close();}
