// Screenshots of the artifact reader for design review, against the fake
// Runner: the sample design doc (fixtures/artifact-sample.mjs) in its own
// window and in the Artifacts panel, at 1440 and 390 wide, dark and light,
// at the top and scrolled to the tables. Writes
// .cache/artifact-reader-<label>-<view>-<width>-<scheme>.png.
//   node scripts/artifact-reader-screenshots.mjs [label]
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { startRunnerFixture } from './fixtures/runner-ui.mjs';
import { testViteCache } from './fixtures/vite-cache.mjs';
import { seedDesignDoc } from './fixtures/artifact-sample.mjs';

const label = process.argv[2] || 'current';
const fixture = await startRunnerFixture();
const artifact = seedDesignDoc(fixture);
const server = await createServer({ ...testViteCache(import.meta.url), configFile: false, logLevel: 'error', root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: fixture.url } } } });
let browser;
try {
  await server.listen(); await mkdir('.cache', { recursive: true });
  browser = await chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const scheme of ['dark', 'light']) for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: width < 600 ? 2 : 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.goto(`${base}/?view=artifact&collection=alpha&artifact=${artifact.id}#token=${fixture.token}`);
    await page.getByText('Move reads to the new datasource first').first().waitFor();
    await page.waitForTimeout(1500);
    const name = view => `.cache/artifact-reader-${label}-${view}-${width}-${scheme}.png`;
    await page.screenshot({ path: name('top') });
    await page.locator('#rollout-plan, h2:has-text("Rollout plan")').first().evaluate(node => node.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(800);
    await page.screenshot({ path: name('tables') });
    if (await page.getByRole('button', { name: /^History/ }).count()) {
      await page.getByRole('button', { name: /^History/ }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: name('history') });
      await page.getByRole('button', { name: 'Close history' }).click();
      await page.getByRole('tab', { name: 'Changes' }).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: name('changes') });
      await page.getByRole('tab', { name: 'Document' }).click();
    }
    if (width > 600) {
      await page.goto(`${base}/?view=workspace&collection=alpha&session=${fixture.sessions[0].id}#token=${fixture.token}`);
      await page.locator('summary[aria-label="Panels"]').click();
      await page.getByRole('button', { name: 'Show Artifacts', exact: true }).click();
      await page.getByRole('listbox', { name: 'Artifacts' }).getByRole('option', { name: /Datasource migration/ }).click();
      await page.getByText('Move reads to the new datasource first').first().waitFor();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: name('panel') });
    }
    await context.close();
  }
  console.log(`Screenshots in .cache/artifact-reader-${label}-*.png`);
} finally { await browser?.close(); await server.close(); await fixture.close(); }
