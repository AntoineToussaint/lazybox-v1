// Finding artifacts (ARTIFACTS.md, "Finding an artifact"): an agent's
// `lazybox artifact put` shows a card in the conversation that opens the page,
// and an update offers its changes; the chat header's chip counts this
// conversation's artifacts and opens the panel on them; ⌘K finds an artifact
// of another workspace and opens it there; "All workspaces" groups every
// workspace's artifacts; with none, nothing shows. Fixture only; WebKit by
// default (the desktop engine).
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit,chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';
import {testViteCache} from './fixtures/vite-cache.mjs';
import {monacoVimCompat} from './monaco-vim-compat.mjs';

const fixture=await startRunnerFixture();const session=fixture.sessions[0];
Object.assign(session,{busy:false,status:'done',conversationId:'conversation-alpha',agents:[{id:'root',status:'done'}]});
const channel=fixture.openEvents(session.id);
const said=(title,id,version,kind)=>`Published “${title}” as artifact ${id}, version ${version} (${kind}). The user sees it in Lazybox → Artifacts. Publish a new version with --id ${id}.\n`;
let calls=0;
const tool=data=>channel.push({type:'tool_activity',turnId:'t1',providerDataJson:Buffer.from(JSON.stringify(data)).toString('base64')});
/** The agent runs a shell command and it completes with this output, as Claude reports it. */
const bash=(command,output,description)=>{const id=`toolu_${++calls}`;
 tool({type:'tool_call',id,name:'Bash',status:'running',input:{command,...(description?{description}:{})}});
 tool({type:'tool_call',id,name:'Bash',status:'completed',output:[{type:'text',text:output}]});};
channel.push({type:'operation_accepted',text:'Write the rollout plan'});
channel.push({type:'message_delta',text:'Looking at what exists first.',turnId:'t1'});
// A read of artifacts is no artifact.
bash('lazybox artifact list','No artifacts in this workspace yet.\n','List artifacts');
channel.push({type:'message_delta',text:'Nothing yet; I will write one.',turnId:'t1'});
const server=await createServer({...testViteCache(import.meta.url),configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),logLevel:'warn',plugins:[react(),monacoVimCompat()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
let browser;
try{
 await mkdir('.cache',{recursive:true});await server.listen();browser=await (process.env.TEST_CHROMIUM?chromium:webkit).launch({headless:true});
 const context=await browser.newContext({viewport:{width:1500,height:920}});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=${session.id}#token=${fixture.token}`);
 const messages=page.locator('.messages');
 await expect(messages.getByText('Nothing yet; I will write one.')).toBeVisible();

 // Nothing to find: no card, no chip, and the panel says in one sentence how artifacts appear.
 const chip=page.locator('.chat-heading').getByRole('button',{name:/artifacts? .*: show them$/});
 await expect(messages.locator('.artifact-card')).toHaveCount(0);
 await expect(chip).toHaveCount(0);
 const palette=page.getByRole('dialog',{name:'Command palette'}),search=palette.getByRole('combobox',{name:'Search commands'});
 const composer=page.locator('[data-agent-composer]');
 await expect(composer).toBeEnabled();await composer.focus();
 await page.keyboard.press('Meta+k');await expect(palette).toBeVisible();
 await search.fill('*');
 await expect(palette.locator('.command-palette-scope')).toHaveText('Artifacts');
 await expect(palette.getByRole('status')).toHaveText('No artifacts in any workspace yet.');
 await search.fill('Show artifacts');await page.keyboard.press('Enter');
 const panel=page.getByRole('region',{name:'Artifacts'});
 await expect(panel.locator('.artifacts-empty')).toContainText('No artifacts yet');
 await expect(panel.locator('.artifacts-empty p')).toHaveText(/^Plans and reports show up here when an agent publishes one, or when you right-click a message or a Markdown file → Track as artifact\.$/);
 await page.screenshot({path:'.cache/find-artifacts-empty.png'});

 // The agent publishes: a card in the conversation, and the chip in the header.
 const plan='# Rollout plan\n\nShip in three phases.\n\n1. Phase one\n2. Phase two\n';
 const v1=fixture.artifacts.agentPut({collectionId:'alpha',sessionId:session.id,conversationId:'conversation-alpha',title:'Rollout plan',kind:'plan',content:plan});
 bash('lazybox artifact put PLAN.md --title "Rollout plan" --kind plan',said('Rollout plan',v1.id,1,'plan'),'Publish the plan');
 channel.push({type:'message_delta',text:'Published the plan.',turnId:'t1'});
 const card=messages.getByRole('group',{name:'Artifact “Rollout plan”, v1'});
 await expect(card).toBeVisible();
 await expect(card).toContainText('Plan · v1 · published by the agent');
 await expect(card.getByRole('button',{name:/^Compare/})).toHaveCount(0);
 await expect(chip).toHaveText('1 artifact',{timeout:20000});
 await page.screenshot({path:'.cache/find-artifacts-card.png'});
 // Open: the page in the workspace's Artifacts panel.
 await card.getByRole('button',{name:'Open'}).click();
 const article=page.getByRole('article',{name:'Rollout plan'});
 await expect(article.locator('.artifact-document')).toContainText('Ship in three phases.');

 // An update: its card offers the changes, and opens on them.
 const v2=fixture.artifacts.agentPut({collectionId:'alpha',sessionId:session.id,conversationId:'conversation-alpha',artifactId:v1.id,content:plan+'3. Phase three\n'});
 assert.equal(v2.contentVersion,2);
 channel.push({type:'operation_accepted',text:'Add phase three'});
 bash(`lazybox artifact put - --id ${v1.id} < PLAN.md`,said('Rollout plan',v1.id,2,'plan'));
 const updated=messages.getByRole('group',{name:'Artifact “Rollout plan”, v2'});
 await expect(updated).toContainText('Plan · v2 · updated by the agent');
 await updated.getByRole('button',{name:'Compare with v1'}).click();
 await expect(article.getByRole('tab',{name:'Changes'})).toHaveAttribute('aria-selected','true');
 await expect(article.getByRole('region',{name:'Rendered changes'})).toBeVisible();
 // Open on the older card: that version, with the way back to the latest.
 await card.getByRole('button',{name:'Open'}).click();
 await expect(article.getByRole('tab',{name:'Document'})).toHaveAttribute('aria-selected','true');
 await expect(article.getByRole('note')).toContainText('You are viewing v1 of 2.');

 // The chip counts this conversation's artifacts and opens the panel on them.
 fixture.artifacts.agentPut({collectionId:'alpha',sessionId:'other-session',conversationId:'conversation-other',title:'Security review',kind:'report',content:'# Security review\n\nNo blockers.\n'});
 await expect(chip).toHaveAttribute('title',/1 artifact from this conversation · 2 in this workspace/,{timeout:20000});
 await chip.click();
 const filter=panel.locator('.artifacts-conversation-filter');
 await expect(filter).toContainText('From');
 const rows=panel.getByRole('listbox',{name:'Artifacts'});
 await expect(rows.getByRole('option')).toHaveCount(1);
 await expect(rows.getByRole('option',{name:/Rollout plan/})).toBeVisible();
 await expect(panel.locator('.artifacts-list-header strong')).toHaveText('1 artifact from this conversation');
 await page.screenshot({path:'.cache/find-artifacts-chip.png'});
 await filter.getByRole('button',{name:'Show every artifact of this workspace'}).click();
 await expect(rows.getByRole('option')).toHaveCount(2);

 // ⌘K finds an artifact of another workspace by its words or its workspace's, and opens it there.
 fixture.artifacts.agentPut({collectionId:'beta',sessionId:'beta-session',conversationId:'conversation-beta',title:'Beta design spec',kind:'spec',content:'# Beta design spec\n\nThe beta design.\n'});
 await composer.focus();
 await page.keyboard.press('Meta+k');await expect(palette).toBeVisible();
 await search.fill('*');
 const listed=palette.getByRole('option');
 await expect(listed).toHaveCount(3,{timeout:20000});
 await expect(listed.first()).toContainText('Beta design spec');
 await expect(listed.first()).toContainText('Spec · v1 · Beta release');
 await expect(palette.getByRole('option',{name:/Rollout plan/})).toContainText('This workspace');
 await search.fill('*beta spec');
 await expect(listed.first()).toContainText('Beta design spec');
 await page.keyboard.press('Enter');
 await expect(palette).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Workspace',exact:true})).toHaveValue('beta');
 const beta=page.getByRole('article',{name:'Beta design spec'});
 await expect(beta.locator('.artifact-document')).toContainText('The beta design.');
 await page.screenshot({path:'.cache/find-artifacts-palette.png'});

 // All workspaces: every workspace's artifacts, grouped by workspace, the one changed last first.
 const back=beta.getByRole('button',{name:'Back to artifacts'});
 if(await back.isVisible())await back.click();
 await panel.getByRole('radiogroup',{name:'Show artifacts of'}).getByRole('radio',{name:'All workspaces'}).click();
 const everywhere=panel.getByRole('listbox',{name:'Artifacts of every workspace'});
 const groups=everywhere.getByRole('group');
 await expect(groups).toHaveCount(2,{timeout:20000});
 await expect(groups.nth(0)).toHaveAccessibleName('Beta release');
 await expect(groups.nth(1)).toHaveAccessibleName('Alpha feature');
 await expect(groups.nth(1).getByRole('option')).toHaveCount(2);
 await expect(groups.nth(1).getByRole('option').first()).toContainText('Security review');
 await expect(panel.locator('.artifacts-list-header strong')).toHaveText('3 artifacts in 2 workspaces');
 await page.screenshot({path:'.cache/find-artifacts-all.png'});
 // From the keyboard: the rows run across workspaces, and Enter reads one where it is.
 await groups.nth(0).getByRole('option').first().focus();
 await page.keyboard.press('ArrowDown');
 await expect(groups.nth(1).getByRole('option').first()).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('article',{name:'Security review'}).locator('.artifact-document')).toContainText('No blockers.');
 assert.deepEqual(errors,[]);
 console.log('PASS: an agent\'s artifact put shows a card that opens the page (and an update its changes); the header chip counts this conversation\'s artifacts and opens the panel on them; ⌘K (and its * prefix) finds an artifact of another workspace and opens it there; All workspaces groups by workspace; with none, no card or chip and a one-sentence empty state. Fixture only.');
}finally{await browser?.close();await server.close();await fixture.close();}
