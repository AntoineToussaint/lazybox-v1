// Home checkouts against the fake Runner: the person gives a repository a home
// (its own clone outside the workspace) from the workspace's repositories
// dialog, opens a shell there in the Terminal panel, and runs what the agent
// handed back ("run in the home checkout of api: `make playground`", a login
// in the home folder) with one click from its last message. Everything is
// reachable from the keyboard. Settings → Repositories lists the homes.
// WebKit by default (the desktop app's engine); TEST_CHROMIUM=1 runs Chromium.
import {testViteCache} from './fixtures/vite-cache.mjs';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {webkit, chromium, expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {startRunnerFixture} from './fixtures/runner-ui.mjs';

const fixture=await startRunnerFixture();
const session=fixture.sessions.find(s=>s.id==='alpha-session');session.agents=[];session.status='ready';session.busy=false;
const channel=fixture.openEvents(session.id);
const push=event=>channel.push({turnId:'t1',...event});
push({type:'operation_accepted',text:'Add the playground target'});
push({type:'message_delta',text:'I ran `go test ./...` and it passes.'});
push({type:'message_delta',text:[
 'Done: the playground target is in.',
 '',
 'To try it, run in the home checkout of api: `make playground`, and `make stop` when done.',
 'The sandbox needs your cloud credentials: run in your home folder: `gcloud auth application-default login`',
].join('\n')});

const server=await createServer({...testViteCache(import.meta.url),configFile:false,root:fileURLToPath(new URL('../apps/web',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:0,proxy:{'/lazybox.bench.v1.RunnerService/':{target:fixture.url}}}});
const calls=method=>fixture.calls.filter(call=>call.method===method);
const mutations=method=>fixture.mutations.filter(m=>m.method===method);
const shots='.cache';
let browser;
try {
 await server.listen();await mkdir(shots,{recursive:true});
 browser=await (process.env.TEST_CHROMIUM?chromium:webkit).launch();
 const page=await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=alpha-session#token=${fixture.token}`);
 const chat=page.locator('.panel-chat');
 await expect(chat.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();

 // ── The agent's last message hands two commands back; earlier words offer nothing.
 const offers=chat.getByRole('group',{name:'Commands for you to run'});
 await expect(offers).toHaveCount(1);
 await expect(offers.locator('.home-run')).toHaveCount(2);
 // No home yet: the repository's offer says it clones one first; the login runs in the home folder.
 await expect(offers.getByRole('button',{name:/^Create api home and run make playground$/})).toBeVisible();
 await expect(offers.getByRole('button',{name:/^Run in your home folder gcloud auth application-default login$/})).toBeVisible();
 assert.equal(calls('OpenTerminal').length,0,'showing offers starts nothing');

 // ── Set a home: the workspace's repositories dialog lists each member's home.
 await page.getByRole('button',{name:'2 repositories',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Repositories in Alpha feature'});
 const apiRow=dialog.getByRole('listitem',{name:'api home checkout'});
 await expect(apiRow).toContainText('No home checkout');
 await page.screenshot({path:`${shots}/home-checkouts-dialog-empty.png`});
 await apiRow.getByRole('button',{name:/^Create at /}).click();
 await expect.poll(()=>mutations('SetRepositoryHome').length).toBe(1);
 assert.deepEqual(mutations('SetRepositoryHome')[0].body,{repositoryId:'backend',action:'create'},'created at the suggested place');
 await expect(apiRow).toContainText('/fixture/home/lazybox/repos/fixture-team/backend');
 await expect(apiRow).toContainText('main · clean');
 await page.screenshot({path:`${shots}/home-checkouts-dialog.png`});
 // Using an existing folder needs an absolute path; a wrong one is said in words.
 const webRow=dialog.getByRole('listitem',{name:'web home checkout'});
 await webRow.getByRole('button',{name:'Use an existing folder…'}).click();
 await webRow.getByLabel('Existing checkout of frontend').fill('relative/web');
 await webRow.getByLabel('Existing checkout of frontend').press('Enter');
 await expect(webRow.getByRole('alert')).toContainText('A home checkout needs an absolute path.');
 await webRow.getByLabel('Existing checkout of frontend').fill('~/src/web');
 await webRow.getByRole('button',{name:'Use folder',exact:true}).click();
 await expect(webRow).toContainText('/fixture/home/src/web');

 // ── Keyboard: the row's ⋯ opens its menu with the first item focused; Finder is one arrow away.
 await apiRow.getByRole('button',{name:'More for api home'}).focus();
 await page.keyboard.press('Enter');
 const menu=page.locator('.context-menu[data-depth="0"]');
 await expect(menu).toBeVisible();
 assert.deepEqual((await menu.locator('.context-menu-label').allTextContents()).slice(0,3),['Open in terminal',/Mac/.test(await page.evaluate(()=>navigator.platform))?'Open in Finder':'Open in file manager','Open in VS Code']);
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect.poll(()=>mutations('OpenRepositoryHome').length).toBe(1);
 assert.deepEqual(mutations('OpenRepositoryHome')[0].body,{repositoryId:'backend',app:'finder'});

 // ── Open the home in the shell panel: the dialog steps aside, the shell starts there, focused.
 await apiRow.getByRole('button',{name:'Open in terminal',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 const panel=page.locator('.panel-terminal');
 const screen=panel.getByTestId('terminal');
 await expect(panel.getByRole('tab',{name:'api home',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(screen).toContainText('fixture shell in /fixture/home/lazybox/repos/fixture-team/backend');
 assert.equal(calls('OpenTerminal').length,1,'one shell, no extra workspace shell');
 assert.equal(calls('OpenTerminal')[0].body.repositoryHome,'backend');
 await expect(screen.locator('textarea')).toBeFocused();
 await page.screenshot({path:`${shots}/home-checkouts-shell.png`});
 // The panel's directory list offers the homes and the home folder too.
 const directories=await panel.getByLabel('Terminal directory').locator('option').allTextContents();
 assert.ok(directories.includes('api home')&&directories.includes('web home')&&directories.includes('Home folder (~)'),`directories: ${directories}`);

 // ── Run in home, from the agent's message: now that api has a home, one click runs it there.
 const runApi=offers.getByRole('button',{name:/^Run in api home make playground$/});
 await expect(runApi).toBeVisible();
 await runApi.click();
 await expect.poll(()=>calls('OpenTerminal').length).toBe(2);
 assert.equal(calls('OpenTerminal')[1].body.repositoryHome,'backend');
 const second=[...fixture.terminals.values()].at(-1);
 await expect.poll(()=>second.input.join('')).toBe('make playground\r');
 await expect(panel.getByRole('tab',{name:'api home',exact:true}).last()).toHaveAttribute('aria-selected','true');
 await expect(screen).toContainText('ran: make playground');
 // A login may ask for input: the shell has the keyboard.
 await expect(screen.locator('textarea')).toBeFocused();
 await page.screenshot({path:`${shots}/home-checkouts-run.png`});

 // ── From the keyboard: Tab reaches the offer, Enter runs the login in the home folder.
 const runLogin=offers.getByRole('button',{name:/^Run in your home folder /});
 await runApi.focus();
 // WebKit on macOS tabs to buttons with ⌥Tab (Full Keyboard Access off), as Safari does.
 await page.keyboard.press(process.env.TEST_CHROMIUM?'Tab':'Alt+Tab');
 await expect(runLogin).toBeFocused();
 await page.keyboard.press('Enter');
 await expect.poll(()=>calls('OpenTerminal').length).toBe(3);
 assert.equal(calls('OpenTerminal')[2].body.userHome,true);
 const third=[...fixture.terminals.values()].at(-1);
 await expect.poll(()=>third.input.join('')).toBe('gcloud auth application-default login\r');
 await expect(panel.getByRole('tab',{name:'~',exact:true})).toHaveAttribute('aria-selected','true');

 // ── A block's Run menu offers each home and the home folder.
 push({turnId:'t2',type:'operation_accepted',text:'And the seed data?'});
 push({turnId:'t2',type:'message_delta',text:'Seed it yourself:\n\n```sh\nmake seed\n```\n'});
 const block=chat.locator('.code-block.is-runnable').last();
 await expect(block).toBeVisible();
 await block.getByRole('button',{name:'More ways to run'}).click();
 const labels=await menu.locator('.context-menu-label').allTextContents();
 assert.ok(labels.includes('Run in api home')&&labels.includes('Run in web home')&&labels.includes('Run in your home folder'),`block menu: ${labels}`);
 await page.keyboard.press('Escape');
 // The new last message takes the offers; the earlier one no longer shows them.
 await expect(chat.getByRole('group',{name:'Commands for you to run'})).toHaveCount(1);
 await expect(chat.getByRole('group',{name:'Commands for you to run'}).locator('.home-run')).toHaveText([/Run in api home\s*make seed/]);

 // ── Settings → Repositories lists every home with its state.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('tab',{name:'Repositories',exact:true}).click();
 const settings=page.locator('.home-checkouts-settings');
 await expect(settings.getByRole('listitem',{name:'backend home checkout'})).toContainText('main · clean');
 await expect(settings.getByRole('listitem',{name:'frontend home checkout'})).toContainText('/fixture/home/src/web');
 await settings.scrollIntoViewIfNeeded();
 await page.screenshot({path:`${shots}/home-checkouts-settings.png`});
 assert.deepEqual(errors,[],'no page errors');
 console.log('home checkouts: set, opened in the shell, run from an agent message, keyboard reachable, listed in Settings');
} finally {
 await browser?.close();await server.close();await fixture.close();
}
