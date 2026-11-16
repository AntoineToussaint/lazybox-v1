// Workspace terminal panel against the fake Runner: open from the header,
// type into the shell, open one in a member repository, close it, and
// re-attach after a reload without starting another shell. WebKit by default
// (the desktop app's engine); TEST_CHROMIUM=1 runs Chromium.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit, chromium, expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';

const fixture=await startRunnerFixture();
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
const calls=method=>fixture.calls.filter(call=>call.method===method);
let browser;
try {
 await server.listen();browser=await (process.env.TEST_CHROMIUM?chromium:webkit).launch();
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=alpha-session#token=${fixture.token}`);
 await expect(page.locator('.panel-chat').getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 assert.equal(calls('OpenTerminal').length,0,'showing a workspace never starts a shell');

 await page.getByRole('button',{name:'Open terminal',exact:true}).click();
 const panel=page.locator('.panel-terminal');
 const screen=panel.getByTestId('terminal');
 await expect(screen).toContainText('fixture shell in Alpha feature');
 await expect.poll(()=>calls('OpenTerminal').length).toBe(1);
 assert.equal(calls('OpenTerminal')[0].body.collectionId,'alpha');
 // The view fits the panel and tells the Runner its real size.
 await expect.poll(()=>calls('ResizeTerminal').length).toBeGreaterThan(0);
 const [first]=fixture.terminals.values();
 assert.ok(first.cols>20&&first.rows>3&&!(first.cols===80&&first.rows===24),`fitted size ${first.cols}x${first.rows}`);

 await screen.click();await page.keyboard.type('ls -la');await page.keyboard.press('Enter');
 await expect(screen).toContainText('ran: ls -la');
 assert.equal(first.input.join(''),'ls -la\r','keystrokes reach the shell in order');

 await panel.getByLabel('Terminal directory').selectOption('api');
 await panel.getByRole('button',{name:'New terminal',exact:true}).click();
 await expect(panel.getByRole('tab',{name:'api',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(screen).toContainText('fixture shell in Alpha feature / api');
 assert.equal(calls('OpenTerminal').at(-1).body.directory,'api');
 await page.screenshot({path:'/tmp/lazybox-terminal.png'});
 await panel.getByRole('button',{name:'Close terminal api',exact:true}).click();
 await expect(panel.getByRole('tab',{name:'api',exact:true})).toHaveCount(0);
 await expect(panel.getByRole('tab',{name:'Workspace root',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(screen).toContainText('ran: ls -la');

 // A reload re-attaches to the running shell with its scrollback.
 const opened=calls('OpenTerminal').length;
 await page.reload();
 await expect(page.locator('.panel-terminal').getByTestId('terminal')).toContainText('ran: ls -la');
 assert.equal(calls('OpenTerminal').length,opened,'re-attaching does not start another shell');
 assert.deepEqual(errors,[]);
 console.log('PASS terminal: header opens a shell, fitted size, ordered input, member directory, close, re-attach after reload.');
} finally {await browser?.close();await server.close();await fixture.close();}
