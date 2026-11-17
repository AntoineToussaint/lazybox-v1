// Conversation tabs (docs/guides/layouts.md, "Conversation tabs"): a single
// click on a conversation shows it in the chat group's preview tab (italic),
// which the next single click replaces; a double-click keeps it in a tab;
// ⌘-click opens a tab behind the one in front; typing in a preview tab keeps
// it; a row's Open beside splits right; a tab dragged to an edge splits; ⌘W
// closes a tab (the conversation keeps going) and ⇧⌘T reopens it where it
// was; a reload keeps every tab, preview or not; an orchestrator's agent opens
// as a tab next to its parent, behind it. WebKit (the desktop app's engine),
// the browser build, against the fake Runner fixture.
import {testViteCache} from './fixtures/vite-cache.mjs';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';
import {monacoVimCompat} from './monaco-vim-compat.mjs';

const fixture=await startRunnerFixture();
// Four conversations in Alpha, so the sidebar lists them under the workspace.
const first=fixture.sessions.find(s=>s.id==='alpha-session');
first.title='Main alpha conversation';
for(const [id,title] of [['alpha-second','Second alpha conversation'],['alpha-third','Third alpha conversation'],['alpha-fourth','Fourth alpha conversation'],['alpha-fifth','Fifth alpha conversation']])
 fixture.sessions.push({...structuredClone(first),id,workId:id,title,instructionsPending:false});
const server=await createServer({...testViteCache(import.meta.url),configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),logLevel:'warn',plugins:[react(),monacoVimCompat()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
await server.listen();
await mkdir('.cache',{recursive:true});
const url=`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=alpha-session#token=${fixture.token}`;

let browser;
try{
 browser=await webkit.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1600,height:900},colorScheme:'dark'});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const shot=name=>page.screenshot({path:`.cache/conversation-tabs-${name}.png`});
 await page.goto(url);

 const chatTabs=page.locator('.dock-tab[data-kind="chat"]');
 /** The chat tabs' titles, in reading order (every group). */
 const titles=()=>chatTabs.locator('.dock-tab-title').allTextContents();
 const previews=()=>page.locator('.dock-tab[data-kind="chat"][data-preview] .dock-tab-title').allTextContents();
 const tab=title=>chatTabs.filter({hasText:title});
 const row=title=>page.locator('.page-layout .panel-collections .conversation-link').filter({hasText:title});
 /** The group a tab is in, and whether it is the tab in front of it. */
 const groupOf=title=>page.locator('.dv-groupview').filter({has:tab(title)});
 const inFront=title=>groupOf(title).locator('.dv-tab.dv-active-tab .dock-tab-title').textContent().then(text=>text===title);
 const shown=page.locator('.page-layout .panel-chat').filter({visible:true});
 const fontStyle=title=>tab(title).locator('.dock-tab-title').evaluate(node=>getComputedStyle(node).fontStyle);
 const key=async combo=>{await page.keyboard.press(combo);await page.waitForTimeout(60);};

 await expect(shown.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 // The page's conversation is its preview tab.
 await expect.poll(titles).toEqual(['Main alpha conversation']);
 await expect.poll(previews).toEqual(['Main alpha conversation']);

 // ---- A single click shows the preview tab (italic); the next single click replaces it.
 await row('Second alpha conversation').click();
 await expect.poll(titles).toEqual(['Second alpha conversation']);
 await expect.poll(previews).toEqual(['Second alpha conversation']);
 assert.equal(await fontStyle('Second alpha conversation'),'italic','a preview tab reads in italics');
 await expect(shown).toContainText('Retained conversation for alpha-second');
 await row('Third alpha conversation').click();
 await expect.poll(titles,{message:'the preview tab is replaced, not stacked'}).toEqual(['Third alpha conversation']);
 await shot('preview');

 // ---- A double-click keeps it: a regular tab, upright; the next click opens a preview beside it.
 await row('Third alpha conversation').dblclick();
 await expect.poll(previews).toEqual([]);
 assert.equal(await fontStyle('Third alpha conversation'),'normal');
 await row('Second alpha conversation').click();
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation']);
 await expect.poll(previews).toEqual(['Second alpha conversation']);
 await expect.poll(()=>inFront('Second alpha conversation')).toBe(true);

 // ---- ⌘-click opens a tab behind the one in front, right after it.
 await row('Main alpha conversation').click({modifiers:['Meta']});
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation','Main alpha conversation']);
 await expect.poll(()=>inFront('Second alpha conversation'),{message:'the tab in front stays in front'}).toBe(true);
 await expect(shown).toContainText('Retained conversation for alpha-second');
 assert.equal(await fontStyle('Main alpha conversation'),'normal','a tab opened behind is a regular tab');
 // Typing in a preview tab keeps it.
 await shown.getByRole('textbox',{name:'Message',exact:true}).fill('a draft keeps this tab');
 await expect.poll(previews).toEqual([]);
 await expect(shown.getByRole('textbox',{name:'Message',exact:true}),'the draft stays in the tab it kept').toHaveValue('a draft keeps this tab');
 // A conversation already in a tab is brought forward, never opened twice.
 await row('Third alpha conversation').click();
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation','Main alpha conversation']);
 await expect.poll(()=>inFront('Third alpha conversation')).toBe(true);
 await expect(row('Third alpha conversation')).toHaveAttribute('aria-current','page');
 // Bringing a tab forward selects its conversation: the sidebar follows.
 await tab('Second alpha conversation').click();
 await expect(shown.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('a draft keeps this tab');
 await expect(row('Second alpha conversation')).toHaveAttribute('aria-current','page');
 await shot('tabs');

 // ---- Drag a tab to the right edge of the chat group: it splits out to the right.
 const drag=async(from,to)=>{
  const a=await from.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2+14,a.y+a.height/2+14,{steps:4});
  await page.mouse.move(to.x,to.y,{steps:12});
  await page.waitForTimeout(120);
  await page.mouse.up();
 };
 const chatGroup=await groupOf('Second alpha conversation').boundingBox();
 await drag(tab('Main alpha conversation'),{x:chatGroup.x+chatGroup.width-24,y:chatGroup.y+chatGroup.height/2});
 await expect.poll(async()=>{const a=await groupOf('Second alpha conversation').boundingBox(),b=await groupOf('Main alpha conversation').boundingBox();return !!a&&!!b&&b.x>=a.x+a.width-4;},{message:'the dragged tab is in a group of its own, on the right'}).toBe(true);
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation','Main alpha conversation']);
 await expect(page.locator('.dv-groupview').filter({has:chatTabs})).toHaveCount(2);

 // ---- The row's menu: Open beside splits right of the conversation on screen.
 await tab('Second alpha conversation').click();
 await row('Fourth alpha conversation').click({button:'right'});
 const menu=page.getByRole('menu');
 for(const label of ['Open in new tab','Open beside','Open below','Open in new window','Move to new page'])await expect(menu.getByRole('menuitem',{name:new RegExp(`^${label}`)})).toBeVisible();
 await menu.getByRole('menuitem',{name:/^Open beside/}).click();
 await expect.poll(async()=>{const a=await groupOf('Second alpha conversation').boundingBox(),b=await groupOf('Fourth alpha conversation').boundingBox();return !!a&&!!b&&b.x>=a.x+a.width-4&&Math.abs(b.y-a.y)<4;},{message:'Open beside: right of the conversation on screen'}).toBe(true);
 await expect(page.locator('.dv-groupview').filter({has:chatTabs})).toHaveCount(3);
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation','Fourth alpha conversation','Main alpha conversation']);
 await expect(row('Fourth alpha conversation')).toHaveAttribute('aria-current','page');
 // A tab's own menu offers the tab commands.
 await tab('Third alpha conversation').click({button:'right'});
 for(const label of ['Split right','Split down','Open in new window','Move to new page','Close other tabs','Close tabs to the right'])await expect(page.getByRole('menuitem',{name:new RegExp(`^${label}`)})).toBeVisible();
 await key('Escape');
 await shot('split');

 // ---- ⌘W closes the tab (the conversation keeps going); ⇧⌘T brings it back where it was.
 const mutations=fixture.mutations.length;
 await tab('Second alpha conversation').click();
 await expect.poll(()=>inFront('Second alpha conversation')).toBe(true);
 await key('Meta+w');
 await expect.poll(titles).toEqual(['Third alpha conversation','Fourth alpha conversation','Main alpha conversation']);
 assert.equal(fixture.mutations.length,mutations,'closing a tab neither stops nor ends its conversation');
 assert.ok(!fixture.sessions.find(s=>s.id==='alpha-second').closed);
 await key('Meta+Shift+T');
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation','Fourth alpha conversation','Main alpha conversation']);
 await expect.poll(()=>inFront('Second alpha conversation')).toBe(true);
 await expect(shown.filter({hasText:'Retained conversation for alpha-second'})).toHaveCount(1);
 // ⌃⇥ walks the tabs: Third, then Second, in the same group.
 await tab('Third alpha conversation').click();
 await key('Control+Tab');
 await expect.poll(()=>inFront('Second alpha conversation')).toBe(true);

 // ---- A reload keeps every tab, where it was, regular or preview.
 await row('Fifth alpha conversation').click();
 await expect.poll(titles).toEqual(['Third alpha conversation','Second alpha conversation','Fifth alpha conversation','Fourth alpha conversation','Main alpha conversation']);
 await expect.poll(previews).toEqual(['Fifth alpha conversation']);
 const before={titles:await titles(),previews:await previews()};
 await page.reload();
 await expect(page.locator('.page-layout .panel-chat').first()).toBeAttached();
 await expect.poll(titles).toEqual(before.titles);
 await expect.poll(previews).toEqual(before.previews);
 await expect(page.locator('.dv-groupview').filter({has:chatTabs})).toHaveCount(3);

 // ---- An orchestrator's agent opens as a tab next to its parent, behind it.
 const mission=fixture.missions.handle('CreateMission',{title:'Ship search'}).value;
 fixture.missions.handle('UpdateMission',{missionId:mission.id,grant:{sessionId:'alpha-session',ceiling:{maxChildren:3}}});
 fixture.missions.spawnChild('alpha-session',{title:'Index the corpus',role:'worker'});
 await tab('Main alpha conversation').click();
 const parent=page.locator(`[data-dock-panel="${await tab('Main alpha conversation').getAttribute('data-panel-tab')}"]`);
 const chip=parent.locator('.orchestrator-chip');
 await expect(chip).toBeVisible({timeout:20_000});
 await chip.click();
 const child=page.locator('.orchestrator-children li').filter({hasText:'Index the corpus'});
 await expect(child).toBeVisible({timeout:20_000});
 await child.getByRole('button').click();
 await expect.poll(titles).toEqual([...before.titles,'Index the corpus']);
 await expect.poll(()=>inFront('Main alpha conversation'),{message:'the parent stays in front'}).toBe(true);
 assert.equal(await fontStyle('Index the corpus'),'normal');
 await expect(page.getByTestId('dock-announcer')).toContainText('next to');
 await shot('related');

 assert.deepEqual(errors,[]);
 console.log('PASS conversation tabs: preview tab (italic) replaced by the next click, double-click and typing keep it, ⌘-click opens behind, one tab per conversation, the sidebar follows the tab in front, drag to an edge splits, Open beside splits right, tab menus, ⌘W and ⇧⌘T, ⌃⇥ walks tabs, a reload keeps the tabs, an orchestrator’s agent opens next to its parent. WebKit, fake Runner fixture.');
}finally{
 await browser?.close();
 await server.close();
 await fixture.close?.();
}
