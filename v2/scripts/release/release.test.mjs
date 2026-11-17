import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactNames, latestJson, renderCask, signingPlan, tagOf, tauriReleaseConfig, downloadURL } from './build.mjs';
import { parseChangelog, renderReleaseNotes, releaseBody, updaterNotes, updaterReleases, changelogPath, releaseNotesPath } from './changelog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a V2 tag never looks like a V1 tag', () => {
  assert.equal(tagOf('0.1.0'), 'v2-v0.1.0');
  assert.equal(downloadURL('0.1.0', 'x.dmg'), 'https://github.com/AntoineToussaint/lazybox/releases/download/v2-v0.1.0/x.dmg');
});

test('the update feed names the archive on this release and its signature', () => {
  const feed = latestJson({ version: '0.2.0', notes: 'Notes', signature: 'c2lnbmF0dXJl\n', date: new Date('2026-11-17T10:00:00.123Z') });
  assert.deepEqual(feed, {
    version: '0.2.0', notes: 'Notes', pub_date: '2026-11-17T10:00:00Z',
    platforms: { 'darwin-aarch64': { signature: 'c2lnbmF0dXJl', url: `https://github.com/AntoineToussaint/lazybox/releases/download/v2-v0.2.0/${artifactNames('0.2.0').updater}` } },
  });
  assert.throws(() => latestJson({ version: 'latest', notes: '', signature: 'x' }));
  // The changelog's sections ride along for the app's What's new before installing.
  const releases = [{ id: '0.2.0', date: '2026-12-01', title: 'Second', items: [{ title: 'New', body: 'It works.' }] }];
  assert.deepEqual(latestJson({ version: '0.2.0', notes: 'Notes', signature: 's', releases }).lazybox, { releases });
  assert.throws(() => latestJson({ version: '0.2.0', notes: '', signature: ' ' }), /signature/);
});

test('the cask is the template with the version and the disk image checksum', async () => {
  const template = await readFile(resolve(root, 'packaging/homebrew/lazybox-v2.rb.tmpl'), 'utf8');
  const sha = 'a'.repeat(64);
  const cask = renderCask(template, '0.2.0', sha);
  assert.match(cask, /cask "lazybox-v2" do/);
  assert.match(cask, /version "0\.2\.0"/);
  assert.match(cask, new RegExp(`sha256 "${sha}"`));
  assert.ok(!cask.includes('__'), 'a placeholder was left');
  // The download URL the cask builds is the one the release uploads.
  assert.ok(cask.includes('releases/download/v2-v#{version}/Lazybox_#{version}_aarch64.dmg'));
  assert.equal(artifactNames('0.2.0').dmg, 'Lazybox_0.2.0_aarch64.dmg');
  assert.throws(() => renderCask(template, '0.2.0', 'not-a-sum'));
});

test('signing follows the secrets present, never a flag', () => {
  assert.deepEqual(signingPlan({}), { identity: '-', signed: false, notarize: undefined, notarizeWith: '' });
  const id = 'Developer ID Application: Someone (ABCDE12345)';
  assert.equal(signingPlan({ APPLE_SIGNING_IDENTITY: id }).signed, true);
  assert.equal(signingPlan({ APPLE_SIGNING_IDENTITY: id }).notarize, undefined);
  const viaId = signingPlan({ APPLE_SIGNING_IDENTITY: id, APPLE_ID: 'a@b.c', APPLE_APP_PASSWORD: 'pw', APPLE_TEAM_ID: 'ABCDE12345' });
  assert.equal(viaId.notarizeWith, 'apple-id');
  assert.equal(viaId.notarize.APPLE_PASSWORD, 'pw', 'APPLE_APP_PASSWORD is accepted for V1\'s APPLE_PASSWORD');
  assert.equal(signingPlan({ APPLE_SIGNING_IDENTITY: id, APPLE_API_KEY: 'K', APPLE_API_ISSUER: 'I', APPLE_API_KEY_PATH: '/k.p8' }).notarizeWith, 'api-key');
  // Notarization credentials without a certificate cannot notarize anything.
  assert.equal(signingPlan({ APPLE_ID: 'a@b.c', APPLE_PASSWORD: 'pw', APPLE_TEAM_ID: 'T' }).notarize, undefined);
});

test('the release configuration adds the version, runtime and public key, and drops comments', async () => {
  const base = JSON.parse(await readFile(resolve(root, 'packaging/release.tauri.json'), 'utf8'));
  const config = tauriReleaseConfig(base, { version: '0.2.0', runtimeDir: '/stage/runtime', identity: '-', pubkey: 'PUB' });
  assert.equal(config.$comment, undefined);
  assert.equal(config.version, '0.2.0');
  assert.equal(config.identifier, 'ai.lazybox.app');
  assert.equal(config.productName, 'Lazybox');
  assert.deepEqual(config.bundle.resources, { '/stage/runtime/': 'runtime/' });
  assert.equal(config.bundle.macOS.signingIdentity, '-');
  assert.equal(config.bundle.macOS.hardenedRuntime, true);
  // The hardened runtime denies the microphone (voice dictation) without this entitlement.
  assert.equal(config.bundle.macOS.entitlements, 'Entitlements.plist');
  assert.match(await readFile(resolve(root, 'apps/desktop/src-tauri', config.bundle.macOS.entitlements), 'utf8'), /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.plugins.updater.pubkey, 'PUB');
  assert.ok(config.plugins.updater.endpoints.every(u => u.startsWith('https://')));
  assert.equal(config.plugins.updater.requireSignedVersion, true, 'a feed must not pair a new version with an older signed archive');
  assert.equal(base.plugins.updater.pubkey, undefined, 'the committed overlay carries no key');
});

test('the changelog is the one source of release notes', async () => {
  const releases = parseChangelog(await readFile(changelogPath, 'utf8'));
  assert.equal(await readFile(releaseNotesPath, 'utf8'), renderReleaseNotes(releases), 'run node scripts/release/changelog.mjs --write');
  assert.ok(releases.length > 0 && releases.every(r => r.items.length > 0));
});

test('a release body collects the dated notes since the previous version', () => {
  const releases = parseChangelog([
    '# Changelog', '', 'Intro.', '',
    '## [0.2.0] - 2026-12-01 · Second', '', '- **New thing** It works.', '',
    '## [2026-11-20.1] - 2026-11-20 · Between', '', '- **Dev only** First shipped to Dev,', '  then to everyone.', '',
    '## [0.1.0] - 2026-11-17 · First', '', '- **Old thing** Already released.',
  ].join('\n'));
  const body = releaseBody(releases, '0.2.0');
  assert.match(body, /## Second/);
  assert.match(body, /### Between/);
  assert.match(body, /- \*\*Dev only\.\*\* First shipped to Dev, then to everyone\./);
  assert.ok(!body.includes('Old thing'));
  assert.ok(!body.includes('Unsigned build'));
  assert.match(releaseBody(releases, '0.2.0', { unsigned: true }), /Unsigned build/);
  assert.throws(() => releaseBody(releases, '9.9.9'), /no section for 9\.9\.9/);
  assert.equal(updaterNotes(releases, '0.2.0'), 'Second\n• New thing: It works.');
  // The feed carries this version's section and the ones before it, so an app on any of them sees what changed since.
  assert.deepEqual(updaterReleases(releases, '0.2.0').map(r => r.id), ['0.2.0', '2026-11-20.1', '0.1.0']);
  assert.deepEqual(updaterReleases(releases, '2026-11-20.1').map(r => r.id), ['2026-11-20.1', '0.1.0']);
  assert.equal(updaterReleases(releases, '0.2.0', 1).length, 1);
  assert.deepEqual(updaterReleases(releases, '9.9.9'), []);
  assert.deepEqual(updaterReleases(releases, '2026-11-20.1')[0].items, [{ title: 'Dev only', body: 'First shipped to Dev, then to everyone.' }]);
  assert.throws(() => parseChangelog('## [x] - 2026-01-01 · T\n\nnot an item'), /only items/);
  assert.throws(() => parseChangelog('## 0.1.0\n'), /heading/);
});

test('a big section groups its items, and the notes show the groups as headings', () => {
  const releases = parseChangelog([
    '# Changelog', '',
    '## [0.2.0-pre.1] - 2026-12-01 · Big', '',
    '### Chat', '', '- **Send now** It sends.', '- **Boxes** Attachments.', '',
    '### Review', '', '- **Review** From the chat.', '',
    '## [2026-11-20.1] - 2026-11-20 · Between', '', '- **Plain** No groups.',
  ].join('\n'));
  assert.deepEqual(releases[0].items.map(i => i.group), ['Chat', 'Chat', 'Review']);
  assert.equal(releases[1].items[0].group, undefined);
  const body = releaseBody(releases, '0.2.0-pre.1');
  assert.match(body, /## Big\n\n### Chat\n\n- \*\*Send now\.\*\* It sends\.\n- \*\*Boxes\.\*\* Attachments\.\n\n### Review\n/);
  assert.match(body, /\n### Between\n\n- \*\*Plain\.\*\* No groups\.\n/);
  assert.equal(updaterNotes(releases, '0.2.0-pre.1'), 'Big\nChat\n• Send now: It sends.\n• Boxes: Attachments.\nReview\n• Review: From the chat.');
  assert.deepEqual(updaterReleases(releases, '0.2.0-pre.1')[0].items[2], { group: 'Review', title: 'Review', body: 'From the chat.' });
  assert.match(renderReleaseNotes(releases), /\{ group: 'Chat', title: 'Send now', body: 'It sends\.' \}/);
  assert.throws(() => parseChangelog('## [x] - 2026-01-01 · T\n\n- **A** a\n\n### G\n\n- **B** b'), /belong in a group/);
  assert.throws(() => parseChangelog('## [x] - 2026-01-01 · T\n\n### G\n\n- **A** a\n\n### G\n\n- **B** b'), /appears twice/);
});

test('the release notes of the current version are the whole of its section', async () => {
  const releases = parseChangelog(await readFile(changelogPath, 'utf8'));
  const [newest] = releases;
  const body = releaseBody(releases, newest.id);
  for (const item of newest.items) assert.ok(body.includes(`**${item.title}.** ${item.body}`), `${item.title} is missing from the notes`);
});
