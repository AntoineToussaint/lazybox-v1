// The console opens when a `lazybox run` starts in the viewed session and labels
// the run with what its agent received. Put away by the user (hidden, closed
// with ×, or from the keyboard), it stays away through later runs until they
// open it again, and every way of closing it has a way back.
import {testViteCache} from './fixtures/vite-cache.mjs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startRunnerFixture } from './fixtures/runner-ui.mjs';

const fixture = await startRunnerFixture();
const server = await createServer({...testViteCache(import.meta.url), configFile: false, root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: fixture.url } } } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace#token=${fixture.token}`);
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('alpha');
  await page.getByRole('combobox', { name: 'Session', exact: true }).selectOption('alpha-session');
  const chat = page.locator('[data-panel-id="alpha-work-chat"]');
  const composer = chat.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEnabled();
  const show = page.getByRole('button', { name: 'Show command output', exact: true });
  const hide = page.getByRole('button', { name: 'Hide command output', exact: true });
  const lists = () => fixture.calls.filter(call => call.method === 'ListCommands' && call.body.sessionId === 'alpha-session').length;

  // A command that existed before the session was viewed does not open the console.
  const baseline = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(baseline + 1);
  await expect(show).toBeVisible();

  // A run starts while the user is typing: the console opens on it, the composer keeps focus.
  await composer.click(); await composer.fill('typing while the agent runs tests');
  const run = fixture.startRun('alpha-session', 'go test ./...', { exitCode: 1, outputBytes: '1468006', agentBytes: '2150', filter: 'go-test', outputPath: '/state/command-output/alpha-session/go-1.log' });
  await expect(hide).toBeVisible({ timeout: 5000 });
  const report = page.getByTestId('command-report');
  await expect(report).toContainText('Exit 1 · the agent got a 2.1 KiB summary of 1.4 MiB (go-test filter)');
  await expect(page.locator('.command-panel select')).toHaveValue(run.id);
  await expect(page.locator('.command-panel footer')).toContainText('Exit 1');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('typing while the agent runs tests');

  // Hidden by the user, it stays hidden: the next run does not reopen it.
  await hide.click();
  await expect(show).toBeVisible();
  const next = fixture.startRun('alpha-session', 'npm test', { exitCode: 0, outputBytes: '120', agentBytes: '180', filter: 'passthrough', outputPath: '' });
  const closed = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(closed + 2);
  await expect(show).toBeVisible();

  // Opened again by the user, it shows the newest run and follows runs again.
  await show.click();
  await expect(page.locator('.command-panel select')).toHaveValue(next.id);
  await expect(report).toContainText('Exit 0 · the agent got all of it (120 B)');
  await expect(report.getByRole('button', { name: 'Copy log path' })).toHaveCount(0);
  await hide.click();
  await show.click();
  const third = fixture.startRun('alpha-session', 'make lint', { exitCode: 0, outputBytes: '90', agentBytes: '90', filter: 'passthrough', outputPath: '' });
  await expect(page.locator('.command-panel select')).toHaveValue(third.id, { timeout: 5000 });
  await expect(hide).toBeVisible();

  // × closes the panel: its control is plainly visible at rest, and a later run does not bring the panel back.
  const consolePanel = page.locator('.panel-console');
  const close = page.getByRole('button', { name: 'Close Command output panel', exact: true });
  assert.ok(Number(await close.evaluate(node => getComputedStyle(node).opacity)) >= 0.8, 'the close control is not faint at rest');
  await close.click();
  await expect(consolePanel).toHaveCount(0);
  const fourth = fixture.startRun('alpha-session', 'make build', { exitCode: 0, outputBytes: '70', agentBytes: '70', filter: 'passthrough', outputPath: '' });
  const removed = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(removed + 2);
  await expect(consolePanel).toHaveCount(0);
  // Closing does not survive only until a reload either.
  await page.reload();
  await expect(composer).toBeEnabled();
  await expect(consolePanel).toHaveCount(0);

  // The way back: the page menu lists it, and it opens on the newest run.
  await page.locator('.workspace-header-actions summary[aria-label="Page actions"]').click();
  await page.locator('.workspace-header-actions .show-panel', { hasText: 'Command output' }).click();
  await expect(consolePanel).toHaveCount(1);
  await expect(page.locator('.command-panel select')).toHaveValue(fourth.id);

  // From the keyboard: ]] o puts it away and brings it back.
  await page.locator('.workspace-brand').click();
  await page.keyboard.type(']]o');
  await expect(show).toBeVisible();
  await page.keyboard.type(']]o');
  await expect(hide).toBeVisible();

  // A run in another session leaves this console alone.
  await hide.click();
  fixture.startRun('beta-session', 'cargo test', { exitCode: 0, outputBytes: '10', agentBytes: '50', filter: 'passthrough' });
  const other = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(other + 1);
  await expect(show).toBeVisible();

  assert.equal(fixture.mutations.length, 0, 'opening the console must not mutate execution');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: the console opens for a run without taking focus, labels the run with what its agent received, and stays put away (hidden, closed with ×, or from the keyboard) until the user opens it again. Explicitly fake RPC fixture.');
} finally {
  await browser?.close(); await server.close(); await fixture.close();
}
