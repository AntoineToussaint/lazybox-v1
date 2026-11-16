// Fixture only: layout defects a person hits without doing anything unusual.
// A chat squeezed by docked panels keeps its title and a working message box;
// a phone reaches every page tab and keeps the running step on one row; a
// page opened from the header (Changes) closes again. WebKit, the desktop engine.
import { testViteCache } from './fixtures/vite-cache.mjs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { webkit, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startRunnerFixture } from './fixtures/runner-ui.mjs';

const fixture = await startRunnerFixture();
Object.assign(fixture.sessions[0], { title: 'Ship the front door with a long conversation title', busy: true, status: 'running' });
const server = await createServer({ ...testViteCache(import.meta.url), configFile: false, logLevel: 'error', root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: fixture.url } } } });
let browser;
/** a's box lies within b's, to a pixel. */
const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;
try {
  await server.listen(); await mkdir('.cache', { recursive: true });
  browser = await webkit.launch();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?view=workspace&collection=alpha&session=alpha-session#token=${fixture.token}`;
  const errors = [];
  const open = async viewport => { const page = await (await browser.newContext({ viewport })).newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(String(error))); await page.goto(url); await expect(page.getByRole('textbox', { name: 'Message', exact: true }).first()).toBeVisible(); return page; };

  // 1. A chat squeezed between the sidebar and three docked panels.
  {
    const page = await open({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Browse files', exact: true }).click();
    await page.getByRole('treeitem', { name: /api/ }).first().click();
    await page.getByRole('treeitem', { name: /README/ }).first().dblclick();
    await expect(page.locator('.panel-editor')).toBeVisible();
    await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
    await expect(page.locator('.panel-terminal')).toBeVisible();
    const chat = page.locator('.panel-chat'), box = await chat.boundingBox();
    assert.ok(box.width < 420, `the chat is narrow in this arrangement (${Math.round(box.width)}px)`);
    // The title is still there to read.
    const title = await chat.locator('.conversation-title-text').boundingBox();
    assert.ok(title.width >= Math.min(140, box.width * 0.5), `the conversation title keeps its room (${Math.round(title.width)}px of ${Math.round(box.width)}px)`);
    // Every header tool is inside the chat, none under a neighbour.
    for (const tool of await chat.locator('.chat-heading-actions button, .chat-heading-actions summary').all()) {
      if (!await tool.isVisible()) continue;
      assert.ok(inside(await tool.boundingBox(), box), `header tool "${await tool.getAttribute('aria-label') || await tool.textContent()}" stays inside the chat`);
    }
    // The message box: Send, Attach and Snippets are whole and inside it.
    const composer = await chat.locator('.composer').boundingBox();
    for (const name of ['Queue follow-up', 'Attach files', 'Snippets']) {
      const control = chat.getByRole('button', { name, exact: true }), bounds = await control.boundingBox();
      assert.ok(bounds && bounds.width >= 24 && bounds.height >= 24, `${name} keeps its size (${bounds && Math.round(bounds.width)}px wide)`);
      assert.ok(inside(bounds, composer), `${name} stays inside the message box`);
    }
    const bar = chat.getByRole('region', { name: 'What the agent is doing' });
    assert.ok(inside(await bar.getByRole('button', { name: 'Interrupt' }).boundingBox(), await bar.boundingBox()), 'Interrupt stays inside the live bar');
    await page.screenshot({ path: '.cache/polish-pass-narrow-chat.png' });
    await page.context().close();
  }

  // 2. A phone: page tabs, the chat header and the live bar.
  {
    const page = await open({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways page scroll');
    // A page tab that does not fit can be scrolled to: it is never cut with no way to reach it.
    const nav = page.locator('.workspace-header > nav');
    const tabs = await nav.evaluate(node => ({ fits: node.scrollWidth <= node.clientWidth + 1, scrolls: getComputedStyle(node).overflowX === 'auto' }));
    assert.ok(tabs.fits || tabs.scrolls, 'page tabs fit or scroll');
    const settings = nav.getByRole('button', { name: 'Settings', exact: true });
    await settings.scrollIntoViewIfNeeded();
    const navBox = await nav.boundingBox(), settingsBox = await settings.boundingBox();
    assert.ok(settingsBox.x >= navBox.x - 1 && settingsBox.x + settingsBox.width <= navBox.x + navBox.width + 1, 'the Settings tab can be brought fully into view');
    const chat = page.locator('.panel-chat'), box = await chat.boundingBox();
    const title = await chat.locator('.conversation-title-text').boundingBox();
    assert.ok(title.width >= 200, `the conversation title is readable on a phone (${Math.round(title.width)}px)`);
    for (const tool of await chat.locator('.chat-heading-actions button, .chat-heading-actions summary').all()) if (await tool.isVisible()) assert.ok(inside(await tool.boundingBox(), box), 'header tools stay on screen');
    // "Writing… · Interrupt" is one row, not two.
    const bar = chat.getByRole('region', { name: 'What the agent is doing' });
    const step = await bar.locator('.live-activity').boundingBox(), stop = await bar.getByRole('button', { name: 'Interrupt' }).boundingBox();
    assert.ok(Math.abs((step.y + step.height / 2) - (stop.y + stop.height / 2)) < 8, 'the step and Interrupt share a row');
    await page.screenshot({ path: '.cache/polish-pass-phone.png' });
    await page.context().close();
  }

  // 3. A page opened from the header closes again: its only panel's × takes the page with it.
  {
    const page = await open({ width: 1440, height: 900 });
    const pages = page.locator('.workspace-header > nav');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await expect(pages.getByRole('button', { name: 'Changes', exact: true })).toBeVisible();
    const close = page.getByRole('button', { name: 'Close Changes page', exact: true });
    await expect(close).toBeVisible();
    await close.focus(); await page.keyboard.press('Enter');
    await expect(pages.getByRole('button', { name: 'Changes', exact: true })).toHaveCount(0);
    await expect(pages.getByRole('button', { name: 'Work', exact: true })).toHaveClass(/selected/);
    await expect(page.locator('.panel-chat')).toBeVisible();
    // The last page keeps its conversation: the chat is not closable.
    await expect(page.locator('.panel-chat').getByRole('button', { name: /^Close .* (panel|page)$/ })).toHaveCount(0);
    // And it comes back from the same button.
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Workspace changes' })).toBeVisible();
    await page.context().close();
  }

  assert.deepEqual(errors, []);
  console.log('PASS polish pass: a narrow chat keeps its title and a whole message box; a phone reaches every page tab and keeps the step on one row; a page opened from the header closes with its ×. Fixture only.');
} finally { await browser?.close(); await server.close(); await fixture.close(); }
