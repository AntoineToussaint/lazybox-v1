// The Workspaces sidebar has one fixed width: switching workspace or resizing
// the window never moves it, and dragging its edge changes it everywhere.
import {testViteCache} from './fixtures/vite-cache.mjs';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';
import {monacoVimCompat} from './monaco-vim-compat.mjs';

const fixture=await startRunnerFixture();
const server=await createServer({...testViteCache(import.meta.url),configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),logLevel:'warn',plugins:[react(),monacoVimCompat()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
await server.listen();
let browser;
try{
 browser=await webkit.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:850}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const [first,second]=fixture.sessions;
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=${first.collectionId}#token=${fixture.token}`);
 const nav=page.getByRole('navigation',{name:'Workspaces'});
 await expect(nav).toBeVisible();
 const width=()=>page.locator('.sidebar-cell').first().evaluate(n=>Math.round(n.getBoundingClientRect().width));
 const initial=await width();
 assert.equal(initial,280,'default sidebar width');
 // Switch workspace: same width.
 await page.locator('.workspace-row').filter({hasText:'Beta release'}).locator('button').first().click();
 await page.waitForTimeout(600);
 assert.equal(await width(),initial,'switching workspace kept the width');
 // Resize the window: same width.
 await page.setViewportSize({width:1100,height:850});await page.waitForTimeout(200);
 assert.equal(await width(),initial,'resizing the window kept the width');
 await page.setViewportSize({width:1400,height:850});
 // Drag the edge: the new width holds in the other workspace and after reload.
 const handle=page.locator('.sidebar-cell + .split-handle, .split-handle:has(+ .sidebar-cell)').first();
 const box=await handle.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2,{steps:5});await page.mouse.up();
 const dragged=await width();
 assert.ok(Math.abs(dragged-(initial+80))<=4,`dragged to ${dragged}`);
 await page.goto(page.url());
 await expect(nav).toBeVisible();
 assert.equal(await width(),dragged,'the dragged width applies to every workspace');
 // Keyboard on the edge.
 await handle.focus();await page.keyboard.press('ArrowLeft');
 assert.equal(await width(),dragged-16,'arrow keys resize');
 assert.deepEqual(errors,[]);
 console.log(`PASS: sidebar fixed at ${initial}px across workspaces and window sizes; drag (${dragged}px) and arrows apply everywhere.`);
}finally{await browser?.close();await server.close();await fixture.close();}
