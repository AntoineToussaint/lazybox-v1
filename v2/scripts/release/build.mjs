// Builds an installable Lazybox release for macOS (RELEASING.md):
//
//   make -C v2 release VERSION=0.1.0            # what CI runs on a v2-v0.1.0 tag
//   node scripts/release/build.mjs --version 0.1.0 [--gates] [--skip-smoke] [--publishable]
//
// Output, in dist/<version>/ beside the Makefile:
//   Lazybox_<version>_aarch64.dmg               the disk image (drag to Applications)
//   Lazybox_<version>_aarch64.app.tar.gz(.sig)  the updater's archive and its signature
//   latest.json                                 the update feed entry
//   lazybox-v2.rb                               the Homebrew cask
//   RELEASE_NOTES.md, SHA256SUMS, release.json  notes, checksums, what was signed how
//
// Signing follows the secrets present, never a flag: APPLE_SIGNING_IDENTITY
// signs with a Developer ID (hardened runtime), APPLE_ID/APPLE_PASSWORD/
// APPLE_TEAM_ID (or an App Store Connect API key) also notarize and staple.
// Without them the build is ad-hoc signed and says so everywhere: in
// release.json, in the release notes and in the GitHub release title.
// The updater key: TAURI_SIGNING_PRIVATE_KEY with packaging/updater.pub, or
// (never with --publishable) a throwaway key generated under .cache for a
// local build, which no installed app trusts.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile, readdir, stat, chmod, rename, access } from 'node:fs/promises';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChangelog, releaseBody, updaterNotes, updaterReleases, versionPattern, renderReleaseNotes, releaseNotesPath } from './changelog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPOSITORY = 'AntoineToussaint/lazybox';
/** The release tag of a version: its own namespace, so V1's cargo-dist tags (v0.1.21) never collide. */
export const tagOf = version => `v2-v${version}`;
/** The rolling release whose latest.json every installed app polls. */
export const UPDATES_TAG = 'v2-updates';
export const ARCH = { tauri: 'darwin-aarch64', file: 'aarch64', go: 'arm64', node: 'darwin-arm64' };

export function artifactNames(version) {
  const base = `Lazybox_${version}_${ARCH.file}`;
  return { dmg: `${base}.dmg`, updater: `${base}.app.tar.gz`, signature: `${base}.app.tar.gz.sig`, latest: 'latest.json', cask: 'lazybox-v2.rb', notes: 'RELEASE_NOTES.md', sums: 'SHA256SUMS', manifest: 'release.json' };
}

export function downloadURL(version, file) {
  return `https://github.com/${REPOSITORY}/releases/download/${tagOf(version)}/${file}`;
}

/**
 * The update feed entry the Tauri updater reads (plugins.updater.endpoints).
 * `lazybox.releases` carries the changelog's sections from this version
 * down, so an installed app shows everything since its own version before
 * the person installs (apps/desktop/src-tauri/src/updates.rs). The updater
 * ignores the field; only the signature decides what installs.
 */
export function latestJson({ version, notes, signature, releases = [], date = new Date() }) {
  if (!versionPattern.test(version)) throw new Error(`${version} is not a version`);
  if (!signature?.trim()) throw new Error('the updater archive has no signature');
  return {
    version,
    notes,
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: { [ARCH.tauri]: { signature: signature.trim(), url: downloadURL(version, artifactNames(version).updater) } },
    ...(releases.length ? { lazybox: { releases } } : {}),
  };
}

/** The cask, rendered from packaging/homebrew/lazybox-v2.rb.tmpl like V1's lazybox-desktop cask. */
export function renderCask(template, version, sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('invalid SHA-256');
  return template.replaceAll('__VERSION__', version).replaceAll('__SHA256__', sha256);
}

/** How this build signs, from the environment alone. */
export function signingPlan(env) {
  const identity = env.APPLE_SIGNING_IDENTITY?.trim() || '';
  const password = env.APPLE_PASSWORD || env.APPLE_APP_PASSWORD || '';
  const appleId = identity && env.APPLE_ID && password && env.APPLE_TEAM_ID ? { APPLE_ID: env.APPLE_ID, APPLE_PASSWORD: password, APPLE_TEAM_ID: env.APPLE_TEAM_ID } : undefined;
  const apiKey = identity && env.APPLE_API_KEY && env.APPLE_API_ISSUER && env.APPLE_API_KEY_PATH ? { APPLE_API_KEY: env.APPLE_API_KEY, APPLE_API_ISSUER: env.APPLE_API_ISSUER, APPLE_API_KEY_PATH: env.APPLE_API_KEY_PATH } : undefined;
  return { identity: identity || '-', signed: !!identity, notarize: appleId || apiKey, notarizeWith: appleId ? 'apple-id' : apiKey ? 'api-key' : '' };
}

/** The Tauri configuration merged over tauri.conf.json for this release. */
export function tauriReleaseConfig(base, { version, runtimeDir, identity, pubkey }) {
  const { $comment, ...config } = structuredClone(base);
  config.version = version;
  config.bundle = { ...config.bundle, resources: { [runtimeDir.replace(/\/?$/, '/')]: 'runtime/' }, macOS: { ...config.bundle?.macOS, signingIdentity: identity } };
  config.plugins = { ...config.plugins, updater: { ...config.plugins?.updater, pubkey } };
  return config;
}

// ---- the pipeline ----

const cache = join(root, '.cache', 'release');
const buildEnv = { ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || '4', GOMAXPROCS: process.env.GOMAXPROCS || '4', GOFLAGS: process.env.GOFLAGS || '-p=4' };

function step(title) { console.log(`\n▸ ${title}`); }

async function run(command, args, { cwd = root, env = buildEnv, capture = false } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  let out = '';
  child.stdout?.on('data', chunk => { out += chunk; });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${signal || code})`);
  return out;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }

function parseArgs(argv) {
  const options = { version: process.env.VERSION || '', gates: false, smoke: true, publishable: false, launchd: process.env.LAZYBOX_V2_RELEASE_LAUNCHD === '1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') options.version = argv[++i] || '';
    else if (a === '--gates') options.gates = true;
    else if (a === '--skip-smoke') options.smoke = false;
    else if (a === '--publishable') options.publishable = true;
    else if (a === '--launchd') options.launchd = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!versionPattern.test(options.version)) throw new Error('Pass the release version: make -C v2 release VERSION=x.y.z');
  return options;
}

async function updaterKey(publishable) {
  const pubPath = join(root, 'packaging', 'updater.pub');
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    if (!await exists(pubPath)) throw new Error('TAURI_SIGNING_PRIVATE_KEY is set but packaging/updater.pub is missing: commit the public key of that pair (RELEASING.md)');
    return { pubkey: (await readFile(pubPath, 'utf8')).trim(), env: {}, kind: 'release' };
  }
  if (publishable) throw new Error('A publishable release needs the updater signing key: set TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD) and commit packaging/updater.pub (RELEASING.md)');
  // A local build only: a throwaway pair under .cache, which no installed app trusts.
  const key = join(cache, 'updater-test.key');
  if (!await exists(key)) {
    await mkdir(cache, { recursive: true });
    await run(join(root, 'node_modules/.bin/tauri'), ['signer', 'generate', '--ci', '--force', '-p', '', '-w', key], { capture: true });
  }
  console.log('  Updater: a local test key (.cache/release/updater-test.key). Installed releases will not accept this build as an update.');
  return { pubkey: (await readFile(key + '.pub', 'utf8')).trim(), env: { TAURI_SIGNING_PRIVATE_KEY: await readFile(key, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' }, kind: 'test' };
}

async function buildGo(runtime, version) {
  const ldflags = `-s -w -X github.com/AntoineToussaint/lazybox/v2/internal/version.Version=${version}`;
  const env = { ...buildEnv, GOOS: 'darwin', GOARCH: ARCH.go, CGO_ENABLED: '0' };
  const code = join(root, 'services/runner/code');
  await run('go', ['build', '-trimpath', '-ldflags', ldflags, '-o', join(runtime, 'bin', 'lazybox-runner'), '.'], { cwd: code, env });
  await run('go', ['build', '-trimpath', '-ldflags', ldflags, '-o', join(runtime, 'bin', 'lazybox'), './cmd/lazybox'], { cwd: code, env });
}

async function fetchNode(runtime) {
  const pin = JSON.parse(await readFile(join(root, 'scripts/release/node.json'), 'utf8'));
  const archive = pin.archives[ARCH.node];
  const downloads = join(cache, 'downloads');
  await mkdir(downloads, { recursive: true });
  const file = join(downloads, archive.file);
  if (!await exists(file) || await sha256(file) !== archive.sha256) {
    const url = `https://nodejs.org/dist/${pin.version}/${archive.file}`;
    console.log(`  Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await writeFile(file + '.part', Buffer.from(await response.arrayBuffer()));
    await rename(file + '.part', file);
  }
  const digest = await sha256(file);
  if (digest !== archive.sha256) throw new Error(`${archive.file} has SHA-256 ${digest}, pinned ${archive.sha256}`);
  const unpacked = join(cache, 'node');
  await rm(unpacked, { recursive: true, force: true });
  await mkdir(unpacked, { recursive: true });
  await run('tar', ['-xzf', file, '-C', unpacked, '--strip-components', '1']);
  await mkdir(join(runtime, 'node', 'bin'), { recursive: true });
  await cp(join(unpacked, 'bin', 'node'), join(runtime, 'node', 'bin', 'node'));
  await cp(join(unpacked, 'LICENSE'), join(runtime, 'node', 'LICENSE'));
  return pin.version;
}

/** The compiled worker and exactly the production packages the lockfile resolved for it. */
async function bundleWorker(runtime) {
  await run('npm', ['run', 'build:worker']);
  const worker = join(runtime, 'worker');
  await cp(join(root, 'workers/claude-sdk/dist'), join(worker, 'dist'), { recursive: true, filter: source => !source.endsWith('.test.js') && !source.endsWith('.d.ts') });
  await cp(join(root, 'workers/claude-sdk/package.json'), join(worker, 'package.json'));
  const listed = (await run('npm', ['ls', '--omit=dev', '--all', '--parseable', '-w', '@lazybox/claude-sdk-worker'], { capture: true })).split('\n').map(s => s.trim()).filter(Boolean);
  const modules = join(root, 'node_modules');
  const packages = listed.filter(p => p.startsWith(modules + '/') && !p.endsWith('@lazybox/claude-sdk-worker')).sort((a, b) => a.length - b.length);
  const copied = [];
  for (const path of packages) {
    if (copied.some(parent => path.startsWith(parent + '/'))) continue;
    await cp(path, join(worker, 'node_modules', relative(modules, path)), { recursive: true, filter: source => basename(source) !== '.bin' });
    copied.push(path);
  }
  if (!copied.some(p => p.endsWith(`claude-agent-sdk-${ARCH.node}`))) throw new Error(`The Claude Agent SDK for ${ARCH.node} is not installed; run npm ci on this platform`);
  return copied.length;
}

/** Mach-O files in the runtime: ours are signed here, a vendor's must carry a valid Developer ID signature. */
async function machOFiles(dir) {
  const found = [];
  const walk = async path => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && (await stat(full)).size > 4096) {
        const handle = await readFile(full).then(b => b.subarray(0, 4));
        const magic = handle.readUInt32BE(0);
        if ([0xcffaedfe, 0xcefaedfe, 0xfeedfacf, 0xfeedface, 0xcafebabe].includes(magic)) found.push(full);
      }
    }
  };
  await walk(dir);
  return found;
}

async function signRuntime(runtime, plan) {
  const ours = new Set([join(runtime, 'bin', 'lazybox'), join(runtime, 'bin', 'lazybox-runner')]);
  const report = [];
  for (const file of await machOFiles(runtime)) {
    const rel = relative(runtime, file);
    if (ours.has(file)) {
      const args = plan.signed ? ['--force', '--options', 'runtime', '--timestamp', '--sign', plan.identity, file] : ['--force', '--sign', '-', file];
      await run('codesign', args);
      report.push({ file: rel, signedBy: plan.signed ? plan.identity : 'ad-hoc' });
      continue;
    }
    // Node and Claude Code keep their publishers' signatures: re-signing would
    // only replace a notarized Developer ID with ours.
    await run('codesign', ['--verify', '--strict', file]);
    const details = await new Promise(done => {
      const child = spawn('codesign', ['-dvv', file]);
      let text = '';
      child.stderr.on('data', c => { text += c; });
      child.on('exit', () => done(text));
    });
    const authority = /Authority=(Developer ID Application: [^\n]+)/.exec(details)?.[1];
    if (!authority) throw new Error(`${rel} is not signed with a Developer ID; it cannot ship in a notarized app`);
    if (!/flags=0x10000\(runtime\)/.test(details)) throw new Error(`${rel} lacks the hardened runtime`);
    report.push({ file: rel, signedBy: authority });
  }
  return report;
}

async function dmgbuild() {
  const venv = join(cache, 'dmgbuild-venv');
  const marker = join(venv, '.requirements');
  const requirements = await readFile(join(root, 'packaging/dmg/requirements.txt'), 'utf8');
  if (!await exists(marker) || await readFile(marker, 'utf8') !== requirements) {
    await rm(venv, { recursive: true, force: true });
    await run('python3', ['-m', 'venv', venv]);
    await run(join(venv, 'bin', 'pip'), ['install', '--quiet', '--require-hashes', '--only-binary', ':all:', '-r', join(root, 'packaging/dmg/requirements.txt')]);
    await writeFile(marker, requirements);
  }
  return join(venv, 'bin', 'dmgbuild');
}

async function notarize(path, plan) {
  const credentials = plan.notarizeWith === 'apple-id'
    ? ['--apple-id', plan.notarize.APPLE_ID, '--password', plan.notarize.APPLE_PASSWORD, '--team-id', plan.notarize.APPLE_TEAM_ID]
    : ['--key', plan.notarize.APPLE_API_KEY_PATH, '--key-id', plan.notarize.APPLE_API_KEY, '--issuer', plan.notarize.APPLE_API_ISSUER];
  await run('xcrun', ['notarytool', 'submit', path, '--wait', '--timeout', '30m', ...credentials]);
  await run('xcrun', ['stapler', 'staple', path]);
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Releases are built on macOS');
  const options = parseArgs(process.argv.slice(2));
  const { version } = options;
  const plan = signingPlan(process.env);
  const names = artifactNames(version);
  const out = join(root, 'dist', version);
  const stage = join(cache, 'stage', version);
  const runtime = join(stage, 'runtime');
  console.log(`Lazybox ${version} for macOS (${ARCH.file})`);
  console.log(`  Signing: ${plan.signed ? `Developer ID (${plan.identity})` : 'ad-hoc (no APPLE_SIGNING_IDENTITY): an unsigned build'}`);
  console.log(`  Notarization: ${plan.notarize ? plan.notarizeWith : 'none'}`);
  if (options.publishable && !plan.signed) console.log('  This release will be published as UNSIGNED: macOS asks people to confirm before opening it.');

  step('Release notes');
  const releases = await readChangelog();
  if (await readFile(releaseNotesPath, 'utf8') !== renderReleaseNotes(releases)) throw new Error('packages/surfaces/src/release-notes.ts does not match CHANGELOG.md: run node scripts/release/changelog.mjs --write and commit');
  const prerelease = version.includes('-');
  const noteVersion = releases.some(r => r.id === version) ? version : prerelease ? releases.find(r => versionPattern.test(r.id))?.id : undefined;
  if (!noteVersion) throw new Error(`CHANGELOG.md has no section for ${version}; add "## [${version}] - YYYY-MM-DD · Title" at the top, then run node scripts/release/changelog.mjs --write`);
  if (noteVersion !== version) console.log(`  ${version} is a test version: using the notes of ${noteVersion}.`);

  const key = await updaterKey(options.publishable);

  if (options.gates) {
    step('Release gates (scripts/release-gates.json)');
    await run(process.execPath, ['scripts/release-gates.mjs', 'run', 'release', '--report', join(cache, `gates-${version}.json`)]);
  }

  step('Runtime: Runner, CLI, Node, Claude worker, phone app');
  await rm(stage, { recursive: true, force: true });
  await mkdir(join(runtime, 'bin'), { recursive: true });
  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  await buildGo(runtime, version);
  const nodeVersion = await fetchNode(runtime);
  const packages = await bundleWorker(runtime);
  await run('npm', ['run', 'build:web']);
  await cp(join(root, 'apps/web/dist'), join(runtime, 'web'), { recursive: true });
  // The documentation Ask Lazybox reads (the app bundles its own copy for
  // Help → Documentation): Markdown only, never docs/internal.
  const docs = join(root, 'docs');
  await cp(docs, join(runtime, 'docs'), { recursive: true, filter: source => { const rel = relative(docs, source); return !rel.startsWith('internal') && !rel.startsWith('images') && (!rel || rel.endsWith('.md') || !rel.includes('.')); } });
  await writeFile(join(runtime, 'VERSION'), version + '\n');
  for (const exe of ['bin/lazybox', 'bin/lazybox-runner', 'node/bin/node']) await chmod(join(runtime, exe), 0o755);
  console.log(`  Node ${nodeVersion}, ${packages} worker packages`);
  const signatures = await signRuntime(runtime, plan);

  step('Desktop app (Tauri)');
  await run('npm', ['run', 'build:ui', '-w', '@lazybox/desktop']);
  const base = JSON.parse(await readFile(join(root, 'packaging/release.tauri.json'), 'utf8'));
  const configPath = join(stage, 'tauri.release.json');
  await writeFile(configPath, JSON.stringify(tauriReleaseConfig(base, { version, runtimeDir: runtime, identity: plan.identity, pubkey: key.pubkey }), null, 2));
  const target = join(cache, 'target');
  const tauriEnv = { ...buildEnv, ...key.env, CARGO_TARGET_DIR: target };
  for (const name of ['APPLE_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_APP_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD']) delete tauriEnv[name];
  if (plan.signed) tauriEnv.APPLE_SIGNING_IDENTITY = plan.identity;
  if (plan.notarize) Object.assign(tauriEnv, plan.notarize);
  const bundles = join(target, 'release', 'bundle', 'macos');
  await rm(bundles, { recursive: true, force: true });
  await run(join(root, 'node_modules/.bin/tauri'), ['build', '--bundles', 'app', '--config', configPath], { cwd: join(root, 'apps/desktop'), env: tauriEnv });
  const app = join(bundles, 'Lazybox.app');
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (plan.notarize) {
    await run('xcrun', ['stapler', 'validate', app]);
    await run('spctl', ['--assess', '--type', 'exec', '-vv', app]);
  }

  step('Disk image');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const background = join(stage, 'background.tiff');
  await run('tiffutil', ['-cathidpicheck', join(root, 'packaging/dmg/background.png'), join(root, 'packaging/dmg/background@2x.png'), '-out', background]);
  const dmg = join(out, names.dmg);
  await run(await dmgbuild(), ['-s', join(root, 'packaging/dmg/dmg-settings.py'), '-D', `app=${app}`, '-D', `background=${background}`, '-D', `icon=${join(root, 'apps/desktop/src-tauri/icons/icon.icns')}`, 'Lazybox', dmg]);
  if (plan.signed) await run('codesign', ['--force', '--timestamp', '--sign', plan.identity, dmg]);
  if (plan.notarize) {
    await notarize(dmg, plan);
    await run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', dmg]);
  }

  step('Update feed, cask, notes, checksums');
  await cp(join(bundles, 'Lazybox.app.tar.gz'), join(out, names.updater));
  await cp(join(bundles, 'Lazybox.app.tar.gz.sig'), join(out, names.signature));
  const signature = await readFile(join(out, names.signature), 'utf8');
  await writeFile(join(out, names.latest), JSON.stringify(latestJson({ version, notes: updaterNotes(releases, noteVersion), releases: updaterReleases(releases, noteVersion), signature }), null, 2) + '\n');
  const dmgSum = await sha256(dmg);
  await writeFile(join(out, names.cask), renderCask(await readFile(join(root, 'packaging/homebrew/lazybox-v2.rb.tmpl'), 'utf8'), version, dmgSum));
  await writeFile(join(out, names.notes), releaseBody(releases, noteVersion, { unsigned: !plan.notarize }));
  const sums = [];
  for (const file of [names.dmg, names.updater, names.signature, names.latest, names.cask]) sums.push(`${await sha256(join(out, file))}  ${file}`);
  await writeFile(join(out, names.sums), sums.join('\n') + '\n');
  const manifest = {
    version, tag: tagOf(version), arch: ARCH.file, builtAt: new Date().toISOString(),
    signing: plan.signed ? 'developer-id' : 'ad-hoc', identity: plan.signed ? plan.identity : undefined,
    notarized: !!plan.notarize, updaterKey: key.kind, node: nodeVersion, runtimeSignatures: signatures,
    artifacts: Object.fromEntries(sums.map(line => line.split('  ').reverse())),
  };
  await writeFile(join(out, names.manifest), JSON.stringify(manifest, null, 2) + '\n');

  if (options.smoke) {
    step('Smoke test: the built Runner and CLI');
    const smokeEnv = { ...buildEnv, LAZYBOX_V2_RELEASE_RUNTIME: join(app, 'Contents', 'Resources', 'runtime'), ...(options.launchd ? { LAZYBOX_V2_RELEASE_LAUNCHD: '1' } : {}) };
    await run('go', ['test', '-count=1', '-timeout', '5m', '-v', '-run', '^TestRelease', './cmd/lazybox'], { cwd: join(root, 'services/runner/code'), env: smokeEnv });
  }

  console.log(`\n✓ Lazybox ${version} is in ${relative(process.cwd(), out) || out}`);
  console.log(`  ${plan.notarize ? 'Signed and notarized' : plan.signed ? 'Signed, NOT notarized' : 'Ad-hoc signed: an UNSIGNED build (RELEASING.md)'}; updater key: ${key.kind}.`);
  console.log(`  App: ${app}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`\n✗ ${error.message}`); process.exitCode = 1; });
