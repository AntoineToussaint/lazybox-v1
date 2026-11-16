// Putting a panel back from its own window, every way there is: a group popped
// out of the page (its labelled "Put back in main window", ⇧⌘D in its window,
// closing its window), a chat in its own window (the same button, ⇧⌘D, closing
// it), the main window's "In other windows" strip (Show, Put back, Put all
// back), the palette ("Put all windows back", "Put <panel> back in main
// window"), and a saved chat whose window is gone coming back when the page
// loads. Each returns where it was. WebKit (the desktop app's engine), the
// browser build's host, against the fake Runner fixture, in dark and light.
// The desktop's native windows (Tauri) are not exercised here: see the commit.
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
const server=await createServer({...testViteCache(import.meta.url),configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),logLevel:'warn',plugins:[react(),monacoVimCompat()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
await server.listen();
await mkdir('.cache',{recursive:true});
const url=`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=alpha-session#token=${fixture.token}`;
// A key that closes its own window: the key-up has nowhere to go.
const gone=error=>{if(!/closed/.test(String(error)))throw error;};
const box=async locator=>{const b=await locator.boundingBox();return b&&[b.x,b.y,b.width,b.height].map(Math.round).join(',');};
/** Where it was, to the pixel give or take the rounding of a share. */
const within=async(locator,expected)=>{const now=await box(locator);return !!now&&now.split(",").every((value,i)=>Math.abs(Number(value)-Number(expected.split(",")[i]))<=1);};

async function scenario(browser,scheme){
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:scheme});
 const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(String(e))));
 let page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 const shot=(target,name)=>target.screenshot({path:`.cache/reattach-${name}-${scheme}.png`});
 await page.goto(url);
 const tab=kind=>page.locator('.dv-tab').filter({has:page.locator(`[data-kind="${kind}"]`)});
 const content=kind=>page.locator(`[data-dock-panel]:has(> .panel-host > .panel-${kind})`);
 const strip=page.getByRole('region',{name:'In other windows'});
 const chat=page.locator('.page-layout .panel-chat');
 await expect(chat.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 // The editor beside the chat: a chat detached from here leaves the page, and comes back to its place.
 await page.locator('summary[aria-label="Panels"]').click();
 await page.getByRole('button',{name:'Show Editor'}).click();
 await expect(content('editor')).toBeVisible();
 await page.waitForTimeout(300);
 const chatAt=await box(content('chat')),editorAt=await box(content('editor'));
 await expect(strip).toHaveCount(0);

 // --- A popped-out group: labelled way back, in place.
 const popout=async()=>{const opened=page.waitForEvent('popup');await tab('editor').click({button:'right'});await page.getByRole('menuitem',{name:'Open in new window',exact:true}).click();const popup=await opened;await expect(popup.locator('section.workspace-panel.panel-editor')).toBeVisible();return popup;};
 let popup=await popout();
 const putBackButton=popup.getByRole('button',{name:'Put back in main window'});
 await expect(putBackButton).toBeVisible();
 assert.match(await putBackButton.getAttribute('title'),/\(.*D\)$/,'the tooltip names the key');
 await popup.waitForTimeout(200);await shot(popup,'popout');
 await expect(strip).toBeVisible();
 await expect(strip.getByRole('listitem')).toHaveCount(1);
 await expect(strip).toContainText('Editor');
 let closed=popup.waitForEvent('close');await putBackButton.click();await closed;
 await expect(content('editor')).toBeVisible();
 await expect.poll(()=>within(content('editor'),editorAt),{message:'the editor is back where it was'}).toBe(true);
 await expect(strip).toHaveCount(0);
 // ⇧⌘D in its window.
 popup=await popout();
 closed=popup.waitForEvent('close');await popup.locator('section.workspace-panel.panel-editor').click();await popup.keyboard.press('ControlOrMeta+Shift+d').catch(gone);await closed;
 await expect.poll(()=>within(content('editor'),editorAt),{message:'⇧⌘D put it back where it was'}).toBe(true);
 // Closing its window puts it back too.
 popup=await popout();
 closed=popup.waitForEvent('close');await popup.close();await closed;
 await expect.poll(()=>within(content('editor'),editorAt),{message:'closing its window put it back where it was'}).toBe(true);

 // --- A chat in its own window: labelled way back, ⇧⌘D, closing it; each returns it to its place.
 const detachChat=async()=>{const opened=page.waitForEvent('popup');await chat.getByRole('button',{name:'Open chat window ↗',exact:true}).click();const win=await opened;await expect(win.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();await expect(content('chat')).toHaveCount(0);return win;};
 let chatWindow=await detachChat();
 const chatPutBack=chatWindow.getByRole('button',{name:'Put back in main window'});
 await expect(chatPutBack).toBeVisible();
 assert.match(await chatPutBack.getAttribute('title'),/\(.*D\)$/,'the chat window tooltip names the key');
 await chatWindow.waitForTimeout(200);await shot(chatWindow,'chat-window');
 // The strip in the main window: what is where, Show and Put back.
 await expect(strip.getByRole('listitem')).toHaveCount(1);
 await strip.getByRole('button',{name:/^Show /}).click();
 await expect(chatWindow.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 closed=chatWindow.waitForEvent('close');await chatPutBack.click();await closed;
 await expect(content('chat')).toBeVisible();
 await expect.poll(()=>within(content('chat'),chatAt),{message:'the chat is back where it was'}).toBe(true);
 await expect(strip).toHaveCount(0);
 chatWindow=await detachChat();
 closed=chatWindow.waitForEvent('close');await chatWindow.getByRole('textbox',{name:'Message',exact:true}).click();await chatWindow.keyboard.press('ControlOrMeta+Shift+d').catch(gone);await closed;
 await expect.poll(()=>within(content('chat'),chatAt),{message:'⇧⌘D in the chat window put it back'}).toBe(true);
 chatWindow=await detachChat();
 closed=chatWindow.waitForEvent('close');await chatWindow.close();await closed;
 await expect.poll(()=>within(content('chat'),chatAt),{message:'closing the chat window put it back'}).toBe(true);
 await expect(strip).toHaveCount(0);

 // --- Two windows: the strip, Put back for one, Put all back.
 chatWindow=await detachChat();popup=await popout();
 await expect(strip.getByRole('listitem')).toHaveCount(2);
 await expect(strip.getByRole('button',{name:'Put all back'})).toBeVisible();
 await page.bringToFront();await page.waitForTimeout(200);
 await strip.screenshot({path:`.cache/reattach-strip-${scheme}.png`});await shot(page,'main');
 const closedBoth=[chatWindow.waitForEvent('close'),popup.waitForEvent('close')];
 await strip.getByRole('button',{name:'Put all back'}).click();await Promise.all(closedBoth);
 await expect.poll(()=>within(content('chat'),chatAt)).toBe(true);
 await expect.poll(()=>within(content('editor'),editorAt)).toBe(true);
 await expect(strip).toHaveCount(0);
 // Put back one of two from the strip.
 chatWindow=await detachChat();await page.waitForTimeout(300);
 // With the chat away the editor has the room; it comes back to that.
 const editorAlone=await box(content('editor'));
 popup=await popout();
 closed=popup.waitForEvent('close');await strip.getByRole('button',{name:'Put Editor back'}).click();await closed;
 await expect(strip.getByRole('listitem')).toHaveCount(1);
 await expect.poll(()=>within(content('editor'),editorAlone),{message:'the editor is back where it was, the chat still away'}).toBe(true);

 // --- The palette: Put <panel> back in main window, and Put all windows back.
 const palette=page.getByRole('dialog',{name:'Command palette'});
 popup=await popout();
 await page.bringToFront();
 await page.keyboard.press('ControlOrMeta+k');await expect(palette).toBeVisible();
 await palette.getByRole('combobox',{name:'Search commands'}).fill('put back');
 await expect(palette.getByRole('option',{name:/Put Editor back in main window/})).toBeVisible();
 await expect(palette.getByRole('option',{name:/Put all windows back/})).toBeVisible();
 await palette.screenshot({path:`.cache/reattach-palette-${scheme}.png`});
 closed=popup.waitForEvent('close');await palette.getByRole('option',{name:/Put Editor back in main window/}).click();await closed;
 await expect.poll(()=>within(content('editor'),editorAlone),{message:'the palette put the editor back'}).toBe(true);
 await expect(strip.getByRole('listitem')).toHaveCount(1);
 await page.keyboard.press('ControlOrMeta+k');await expect(palette).toBeVisible();
 await palette.getByRole('combobox',{name:'Search commands'}).fill('put all windows back');
 closed=chatWindow.waitForEvent('close');await palette.getByRole('option',{name:/Put all windows back/}).click();await closed;
 await expect.poll(()=>within(content('chat'),chatAt),{message:'the palette put the chat back'}).toBe(true);
 await expect.poll(()=>within(content('editor'),editorAt)).toBe(true);
 await expect(strip).toHaveCount(0);

 // --- A saved chat whose window is gone comes back when the page loads.
 chatWindow=await detachChat();
 await page.close();
 // Its window closes while the main window is gone: nobody hears it.
 await chatWindow.close();
 page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));await page.goto(url);
 await expect(page.locator('.page-layout .panel-chat').getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await expect(page.getByRole('region',{name:'In other windows'})).toHaveCount(0);
 await expect.poll(()=>within(page.locator('[data-dock-panel]:has(> .panel-host > .panel-chat)'),chatAt),{message:'back where it was after a reload'}).toBe(true);
 // Still open: it stays in its window through a reload of the main window.
 chatWindow=await (async()=>{const opened=page.waitForEvent('popup');await page.locator('.page-layout .panel-chat').getByRole('button',{name:'Open chat window ↗',exact:true}).click();return opened;})();
 await expect(chatWindow.getByRole('textbox',{name:'Message',exact:true})).toBeEnabled();
 await page.reload();
 await expect(page.getByRole('region',{name:'In other windows'}).getByRole('listitem')).toHaveCount(1);
 await page.waitForTimeout(1200);
 await expect(page.getByRole('region',{name:'In other windows'}).getByRole('listitem')).toHaveCount(1);
 assert.equal(chatWindow.isClosed(),false,'an open chat window is left alone');
 assert.deepEqual(errors,[]);
 await context.close();
}

let browser;
try{
 browser=await webkit.launch({headless:true});
 for(const scheme of ['dark','light'])await scenario(browser,scheme).catch(async error=>{let n=0;for(const context of browser.contexts())for(const p of context.pages())await p.screenshot({path:`.cache/reattach-failure-${n++}.png`}).catch(()=>{});throw error;});
 assert.equal(fixture.mutations.length,0,'putting windows back started or stopped nothing');
 console.log('PASS reattach: a popped-out group (labelled button, ⇧⌘D, closing its window) and a chat window (labelled button, ⇧⌘D, closing it) go back where they were; the "In other windows" strip shows, puts back one and all; the palette puts back one and all; a saved chat whose window is gone comes back on load, an open one stays. WebKit, dark and light, browser host and fake Runner; the desktop\'s native windows are not exercised.');
}finally{await browser?.close();await server.close();await fixture.close();}
