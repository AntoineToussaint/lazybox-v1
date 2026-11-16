// Fixture only: attached images as thumbnails. A real clipboard paste (an
// isolated headless clipboard, never the machine's), the hover and keyboard
// preview, the full-size lightbox, sent-message thumbnails read from the
// Runner only when they scroll into view, and every object URL revoked.
import {testViteCache} from './fixtures/vite-cache.mjs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, webkit, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startRunnerFixture } from './fixtures/runner-ui.mjs';

const fixture = await startRunnerFixture();
const server = await createServer({...testViteCache(import.meta.url), configFile: false, logLevel: 'error', root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: fixture.url } } } });
const VIEWPORT = { width: 1280, height: 800 };
// Screenshots after the fade and scale-in, not halfway through them.
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)));
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const reads = path => fixture.calls.filter(call => call.method === 'ReadAttachment' && (!path || call.body.path === path)).length;
const data = value => Buffer.from(JSON.stringify(value)).toString('base64');
// Object URLs the page holds, so the test can tell every one is revoked.
const trackObjectUrls = () => {
  const live = new Set(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = value => { const url = create(value); live.add(url); return url; };
  URL.revokeObjectURL = url => { live.delete(url); revoke(url); };
  window.liveObjectUrls = () => live.size;
};
// A 1600×900 PNG (a wide screenshot) from a canvas, put on the clipboard as an image.
const copyImage = page => page.evaluate(async () => {
  const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
  const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 1600, 900);
  gradient.addColorStop(0, '#3b6fd8'); gradient.addColorStop(1, '#d8743b'); context.fillStyle = gradient; context.fillRect(0, 0, 1600, 900);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return blob.size;
});
const pngBytes = (page, width, height) => page.evaluate(async ([width, height]) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); context.fillStyle = '#7ac27a'; context.fillRect(0, 0, width, height);
  return [...new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer())];
}, [width, height]);

let browser;
try {
  await server.listen(); await mkdir('.cache', { recursive: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const open = async (view, session = 'alpha-session', collection = 'alpha') => {
    const context = await browser.newContext({ viewport: VIEWPORT, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(trackObjectUrls);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${base}/?view=${view}&session=${session}&collection=${collection}#token=${fixture.token}`);
    const chat = view === 'workspace' ? page.getByRole('region', { name: 'Agent chat', exact: true }) : page.locator('.agent-window');
    const composer = chat.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toBeEnabled();
    return { context, page, chat, composer, attached: chat.getByRole('list', { name: 'Attached files' }) };
  };

  // ── The embedded chat: everything, in detail.
  const alpha = fixture.openEvents('alpha-session');
  alpha.push({ type: 'message_delta', text: 'Ready when you are.', turnId: 't0' });
  const { context, page, chat, composer, attached } = await open('workspace');
  const urlsAtStart = await page.evaluate(() => window.liveObjectUrls());

  // A real paste of an image from the clipboard attaches it, and types nothing.
  await copyImage(page);
  await composer.focus(); await page.keyboard.press('ControlOrMeta+V');
  await expect(attached.locator('li')).toHaveCount(1);
  const thumb = attached.getByRole('button', { name: /^Open Pasted image \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d\.png, [\d.]+ [KM]iB$/ });
  await expect(thumb).toBeEnabled();
  await expect(composer).toHaveValue('');
  const thumbImage = thumb.locator('img');
  await expect.poll(() => thumbImage.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const natural = await thumbImage.evaluate(img => [img.naturalWidth, img.naturalHeight]);
  assert.ok(natural[0] <= 320 && natural[1] <= 320 && Math.abs(natural[0] / natural[1] - 16 / 9) < 0.02, `the chip shows a small copy of the right shape, not the 1600×900 original: ${natural}`);
  const box = await thumb.boundingBox();
  assert.ok(box.width >= 48 && box.width <= 64 && box.height >= 48 && box.height <= 64, `a 48–64 px thumbnail: ${JSON.stringify(box)}`);

  // A text paste stays a text paste.
  await page.evaluate(() => navigator.clipboard.writeText('see the screenshot'));
  await composer.focus(); await page.keyboard.press('ControlOrMeta+V');
  await expect(composer).toHaveValue('see the screenshot');
  await expect(attached.locator('li')).toHaveCount(1);

  // Resting the pointer shows it larger: fitted in 60% of the window, its shape kept.
  await thumb.hover();
  const preview = page.getByRole('tooltip');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Pasted image');
  await expect(preview).toContainText('1600 × 900');
  await settle(page);
  const shown = await preview.locator('img').boundingBox(), card = await preview.boundingBox();
  assert.ok(card.width <= VIEWPORT.width * 0.6 + 1 && card.height <= VIEWPORT.height * 0.6 + 1 && card.width >= VIEWPORT.width * 0.6 - 4, `the preview card uses 60% of the window: ${JSON.stringify(card)}`);
  assert.ok(Math.abs(shown.width / shown.height - 16 / 9) < 0.02, `at the image's aspect ratio: ${JSON.stringify(shown)}`);
  assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= VIEWPORT.width && card.y + card.height <= VIEWPORT.height, 'the preview stays inside the window');
  assert.ok(card.y + card.height <= box.y, 'above the composer, not over the thumbnail');
  assert.equal(await preview.evaluate(node => getComputedStyle(node).pointerEvents), 'none', 'the preview never takes the pointer');
  await page.screenshot({ path: '.cache/attachment-preview-hover.png' });
  await page.mouse.move(5, 5);
  await expect(preview).toHaveCount(0);

  // Keyboard: focus shows it, Esc hides it, Enter opens the lightbox, Esc closes it.
  await composer.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
  await expect(thumb).toBeFocused();
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(thumb).toBeFocused();
  await page.keyboard.press('Enter');
  const lightbox = page.getByRole('dialog', { name: /^Pasted image/ });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole('img')).toBeVisible();
  assert.deepEqual(await lightbox.getByRole('img').evaluate(img => [img.naturalWidth, img.naturalHeight]), [1600, 900], 'the lightbox shows the original');
  await expect(lightbox).toContainText('1600 × 900');
  await settle(page); await page.screenshot({ path: '.cache/attachment-lightbox.png' });
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await expect(thumb).toBeFocused();
  await expect(attached.locator('li'), 'Esc closed only the lightbox').toHaveCount(1);
  // A click opens it; a click beside the picture closes it.
  await thumb.click();
  await expect(lightbox).toBeVisible();
  await page.mouse.click(10, VIEWPORT.height / 2);
  await expect(lightbox).toHaveCount(0);
  await thumb.click(); await lightbox.getByRole('button', { name: 'Close image' }).click();
  await expect(lightbox).toHaveCount(0);

  // Reduced motion: nothing animates.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await thumb.hover(); await expect(preview).toBeVisible();
  assert.equal(await preview.evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.mouse.move(5, 5); await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Removing it revokes what it made.
  await chat.getByRole('button', { name: /^Remove Pasted image/ }).click();
  await expect(attached).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.liveObjectUrls())).toBe(urlsAtStart);

  // A file that claims to be an image but does not decode is a named chip, not a broken picture.
  await composer.evaluate(node => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['not a png'], 'broken.png', { type: 'image/png' }));
    node.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(attached.locator('li')).toHaveCount(1);
  await expect(attached.locator('li')).toContainText('broken.png');
  await expect(attached.getByRole('button', { name: /^Open broken/ })).toHaveCount(0);
  await chat.getByRole('button', { name: 'Remove broken.png' }).click();
  await expect(attached).toHaveCount(0);

  // Send an image and a text file: the message shows the image as a thumbnail
  // and the text file as a named chip; only the image is read back.
  await copyImage(page); await composer.focus(); await page.keyboard.press('ControlOrMeta+V');
  await expect(attached.locator('li')).toHaveCount(1);
  await composer.evaluate(node => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    node.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(attached.locator('li')).toHaveCount(2);
  await expect(attached.locator('li').nth(1)).toContainText('notes.txt');
  await composer.fill('What is wrong in this screenshot?'); await composer.press('Enter');
  await expect(attached).toHaveCount(0);
  const sent = chat.getByRole('list', { name: 'Sent attachments' }).last();
  const sentThumb = sent.getByRole('button', { name: /^Open Pasted image .*\.png, [\d.]+ [KM]iB$/ });
  await expect(sentThumb).toBeEnabled();
  await expect(sent).toContainText('notes.txt');
  const apply = fixture.mutations.findLast(m => m.method === 'Apply').body;
  const sentPath = [...fixture.attachments.keys()].find(path => path.includes(apply.message.attachments[0].name));
  // The clipboard re-encodes what it holds; what is sent is the PNG the paste delivered.
  const sentBytes = Buffer.from(apply.message.attachments[0].data, 'base64');
  assert.deepEqual([...sentBytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG is sent');
  assert.deepEqual([sentBytes.readUInt32BE(16), sentBytes.readUInt32BE(20)], [1600, 900], 'at its full size');
  assert.equal(apply.message.attachments[0].mediaType, 'image/png');
  assert.equal(reads(sentPath), 1, 'the sent image is read once');
  assert.equal(fixture.calls.filter(call => call.method === 'ReadAttachment' && call.body.path.endsWith('notes.txt')).length, 0, 'a text file is never read for preview');
  const sentBox = await sentThumb.boundingBox();
  assert.ok(Math.abs(sentBox.height - 90) <= 2 && sentBox.width > sentBox.height, `a sent screenshot keeps its wide shape: ${JSON.stringify(sentBox)}`);
  await sentThumb.hover(); await expect(preview).toBeVisible(); await expect(preview).toContainText('1600 × 900');
  await settle(page);
  assert.ok(!overlaps(await preview.boundingBox(), await sentThumb.boundingBox()), 'the preview never covers its thumbnail');
  await page.screenshot({ path: '.cache/attachment-sent-preview.png' });
  await sentThumb.click(); await expect(lightbox).toBeVisible();
  await page.keyboard.press('Escape'); await expect(lightbox).toHaveCount(0);
  assert.equal(reads(sentPath), 1, 'hover and lightbox reuse the loaded image');
  // Composer URLs are gone; the sent image holds its two (original and thumbnail).
  await expect.poll(() => page.evaluate(() => window.liveObjectUrls())).toBe(urlsAtStart + 2);

  // An attachment the Runner no longer has (a deleted conversation's) is a named chip.
  alpha.push({ type: 'operation_accepted', text: 'An old one', providerDataJson: data({ files: [{ name: 'gone.png', mediaType: 'image/png', size: 2048, path: '/fixture/attachments/alpha-session/' + '0'.repeat(64) + '/gone.png' }] }) });
  const gone = chat.locator('.sent-files li', { hasText: 'gone.png' });
  await expect(gone).toBeVisible();
  await expect(gone).toHaveAttribute('title', /Preview unavailable/);
  await context.close();

  // ── Lazy loading: an image far up the conversation is read only when scrolled to.
  const beta = fixture.openEvents('beta-session');
  const oldPath = `/fixture/attachments/beta-session/${'1'.repeat(64)}/early.png`, newPath = `/fixture/attachments/beta-session/${'2'.repeat(64)}/late.png`;
  {
    const scratch = await browser.newPage();
    await scratch.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '' })); await scratch.goto('http://localhost/');
    fixture.attachments.set(oldPath, { name: 'early.png', mediaType: 'image/png', data: Buffer.from(await pngBytes(scratch, 300, 600)) });
    fixture.attachments.set(newPath, { name: 'late.png', mediaType: 'image/png', data: Buffer.from(await pngBytes(scratch, 640, 480)) });
    await scratch.close();
  }
  beta.push({ type: 'operation_accepted', text: 'The first screenshot', turnId: 'b0', providerDataJson: data({ files: [{ name: 'early.png', mediaType: 'image/png', size: 100, path: oldPath }] }) });
  for (let i = 1; i <= 30; i++) beta.push({ type: 'message_delta', turnId: 'b' + i, text: `Answer ${i}.\n\n` + 'A long paragraph of findings. '.repeat(30) }), beta.push({ type: 'turn_ended', turnId: 'b' + i });
  beta.push({ type: 'operation_accepted', text: 'The latest screenshot', turnId: 'b99', providerDataJson: data({ files: [{ name: 'late.png', mediaType: 'image/png', size: 100, path: newPath }] }) });
  {
    const { context, page, chat } = await open('workspace', 'beta-session', 'beta');
    await expect(chat.getByRole('button', { name: /^Open late\.png/ })).toBeEnabled();
    await page.waitForTimeout(300);
    assert.equal(reads(oldPath), 0, 'an image out of view is not read');
    const pane = chat.locator('.messages');
    for (let i = 0; i < 20 && !(await chat.getByRole('button', { name: /^Open early\.png/ }).count()); i++) {
      await pane.evaluate(node => { node.scrollTop = 0; });
      const earlier = chat.getByRole('button', { name: /^Show earlier messages/ });
      if (await earlier.count()) await earlier.click();
      await page.waitForTimeout(100);
    }
    const early = chat.getByRole('button', { name: /^Open early\.png/ });
    await early.scrollIntoViewIfNeeded();
    await expect(early).toBeEnabled();
    assert.equal(reads(oldPath), 1, 'scrolled into view, it is read once');
    const tall = await early.boundingBox();
    assert.ok(tall.width < tall.height, `a tall image keeps a tall shape: ${JSON.stringify(tall)}`);
    await context.close();
  }

  // ── The detached chat window and the standalone agent window: paste, send, see it.
  for (const view of ['chat', 'agent']) {
    const { context, page, chat, composer, attached } = await open(view);
    await copyImage(page); await composer.focus(); await page.keyboard.press('ControlOrMeta+V');
    await expect(attached.getByRole('button', { name: /^Open Pasted image/ })).toBeEnabled();
    await attached.getByRole('button', { name: /^Open Pasted image/ }).hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.mouse.move(5, 5);
    await composer.fill(`From the ${view} window`); await composer.press('Enter');
    await expect(attached).toHaveCount(0);
    const sentThumb = chat.getByRole('list', { name: 'Sent attachments' }).last().getByRole('button', { name: /^Open Pasted image/ });
    await expect(sentThumb).toBeEnabled();
    await sentThumb.click();
    await expect(page.getByRole('dialog', { name: /^Pasted image/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /^Pasted image/ })).toHaveCount(0);
    await context.close();
  }

  // ── WebKit, the desktop app's engine: a dropped image, its preview and lightbox.
  {
    const engine = await webkit.launch();
    try {
      const page = await engine.newPage({ viewport: VIEWPORT }); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push('webkit: ' + String(error)));
      await page.goto(`${base}/?view=chat&session=alpha-session&collection=alpha#token=${fixture.token}`);
      const composer = page.getByRole('textbox', { name: 'Message', exact: true });
      await expect(composer).toBeEnabled();
      await composer.evaluate(async node => {
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; canvas.getContext('2d').fillRect(0, 0, 800, 600);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'diagram.png', { type: 'image/png' }));
        node.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      });
      const thumb = page.getByRole('button', { name: /^Open diagram\.png/ });
      await expect(thumb).toBeEnabled();
      await expect.poll(() => thumb.locator('img').evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      await thumb.hover(); await expect(page.getByRole('tooltip')).toContainText('800 × 600');
      await thumb.click(); await expect(page.getByRole('dialog', { name: 'diagram.png' })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'diagram.png' })).toHaveCount(0);
    } finally { await engine.close(); }
  }

  assert.deepEqual(errors, []);
  console.log('PASS: pasted/dropped images as thumbnails, text paste unaffected, hover and keyboard preview fitted to 60% of the window, lightbox with Esc and focus return, reduced motion, object URLs revoked, sent thumbnails read once and only when in view, unavailable attachments as named chips, in the workspace, detached chat and agent windows, and in WebKit. Fake RPC, isolated clipboard.');
} finally {
  await browser?.close(); await server.close(); await fixture.close();
}
