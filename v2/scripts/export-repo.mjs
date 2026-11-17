#!/usr/bin/env node
// Materializes the standalone Lazybox V2 repository (github.com/AntoineToussaint/lazybox)
// from this repository's v2/ folder at a Git commit:
//
//   node v2/scripts/export-repo.mjs --dest <dir> [--ref <commit-ish>]
//   make -C v2 export-repo DEST=<dir> [REF=<commit-ish>]
//
// v2/* becomes the repository root. Repository-level files V2 relies on are
// carried over (LICENSE, NOTICE, CODE_OF_CONDUCT.md, CLA.md as-is) or replaced
// by the V2 versions under scripts/export-repo/root/ (AGENTS.md, CLAUDE.md,
// SECURITY.md, CONTRIBUTING.md, SUPPORT.md, typos.toml, rust-toolchain.toml,
// tools/lazybox-snippets). The V2 workflow and its composite action are
// rewritten for root paths. Paths that assumed a v2/ folder are rewritten, links
// that left v2/ point at lazybox-v1, and the Runner's Go module path moves to
// where the module now lives (see GO_MODULE below).
//
// Only files committed at the selected commit are read, so ignored and
// untracked files (node_modules, .cache, build output, local state) can never
// be exported. The output is a pure function of that commit and this script:
// DEST is emptied (except .git) and rewritten, so running it again on a newer
// commit yields exactly the newer tree. Every targeted rewrite asserts that its
// anchor text exists, so a source change that invalidates one stops the export
// instead of silently exporting stale text.
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const overlayRoot = join(scriptDir, 'export-repo', 'root');

// lazybox-v1 revision that links to V1 sources resolve to (and that
// tools/lazybox-snippets pins in its manifest). A commit on lazybox-v1 main, so
// the links stay valid after feature branches are deleted.
const V1_REPOSITORY = 'https://github.com/AntoineToussaint/lazybox-v1';
const V1_REV = '28a9a73d1a44e7797d1285597257123a1db0a13f';

// The Runner's Go module lives at services/runner/code. A path ending in /v2 is
// a major-version suffix: Go resolves it only for a module at the repository
// root or in a v2/ directory, so the old path never named where the module is.
// The new path is the module's real location in the new repository.
const GO_MODULE = { from: 'github.com/AntoineToussaint/lazybox/v2', to: 'github.com/AntoineToussaint/lazybox/services/runner/code' };

// Repository-level files carried over unchanged.
const ROOT_AS_IS = ['LICENSE', 'NOTICE', 'CODE_OF_CONDUCT.md', 'CLA.md'];

// Links that left v2/ for these repository files now resolve inside the new
// root; so do links to any file the export writes at the root.
const ROOT_LINK_MAP = new Map([
  ['.github/workflows/v2.yml', '.github/workflows/ci.yml'],
  ['.github/workflows/v2-release.yml', '.github/workflows/release.yml'],
  ['.github/actions/v2-playwright', '.github/actions/playwright'],
]);

// Never exported, even if committed: the exporter itself and anything that
// looks like local state, build output or a credential.
const EXPORTER = path => path === 'scripts/export-repo.mjs' || path.startsWith('scripts/export-repo/');
const LOCAL_PARTS = new Set(['node_modules', '.cache', 'dist', 'target', 'build', 'bin', 'coverage', '.codefly', '.expo', 'playwright-report', 'test-results']);
const isLocalState = path => path.split('/').some(part => LOCAL_PARTS.has(part) || part === 'runner.config.json' || part === '.env' || (part.startsWith('.env.') && part !== '.env.example') || part.endsWith('.log') || part.endsWith('.tsbuildinfo'));
// Names that must never be published: an employer's name (and its domain and
// GitHub organization) and its internal module. Whole words only, so ordinary
// words that contain them (a probe in progress, a round-r-o-b-i-n rotation) pass.
// Spelled with a character class so this file never matches itself in a
// repository-wide search.
const PRIVATE_NAME_PATTERNS = [/(?<![A-Za-z])(?:[Oo]bin|[O]BIN)(?![a-z])/, /(?<![A-Za-z])R[o]bin(?![a-z])/];
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{36,}/, /github_pat_[A-Za-z0-9_]{60,}/, /sk-ant-[A-Za-z0-9_-]{40,}/, /sk-proj-[A-Za-z0-9_-]{40,}/,
  /AKIA[0-9A-Z]{16}/, /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, /xox[baprs]-[A-Za-z0-9-]{20,}/,
];

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: node v2/scripts/export-repo.mjs --dest <dir> [--ref <commit-ish>]');
  process.exit(2);
}

function parseArgs(argv) {
  const options = { ref: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => inline ?? argv[++i] ?? usage(`${flag} needs a value`);
    if (flag === '--dest') options.dest = value();
    else if (flag === '--ref') options.ref = value();
    else if (flag === '--help' || flag === '-h') usage();
    else usage(`Unknown argument ${argv[i]}`);
  }
  if (!options.dest) usage('--dest is required');
  return options;
}

function git(repo, args, input) {
  const result = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  return result.stdout;
}

// Every blob under the given prefixes at a commit: path → { mode, data }.
function readTree(repo, sha, prefixes) {
  const listing = git(repo, ['ls-tree', '-r', '-z', '--full-tree', sha, '--', ...prefixes]).toString('utf8').split('\0').filter(Boolean);
  const entries = listing.map(line => {
    const [meta, path] = line.split('\t');
    const [mode, type, object] = meta.split(' ');
    return { mode, type, object, path };
  });
  const unsupported = entries.filter(entry => entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode));
  if (unsupported.length) throw new Error(`Unsupported tree entries (symlinks/submodules): ${unsupported.map(entry => entry.path).join(', ')}`);
  const output = git(repo, ['cat-file', '--batch'], entries.map(entry => entry.object).join('\n') + '\n');
  const files = new Map();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    const [object, type, size] = output.subarray(offset, headerEnd).toString().split(' ');
    if (object !== entry.object || type !== 'blob') throw new Error(`Unexpected object for ${entry.path}`);
    const start = headerEnd + 1, end = start + Number(size);
    files.set(entry.path, { mode: entry.mode, data: Buffer.from(output.subarray(start, end)) });
    offset = end + 1;
  }
  return files;
}

function readOverlay() {
  const files = new Map();
  const walk = directory => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Overlay contains a symlink: ${full}`);
      if (stat.isDirectory()) walk(full);
      else files.set(relative(overlayRoot, full).split('\\').join('/'), { mode: stat.mode & 0o111 ? '100755' : '100644', data: readFileSync(full) });
    }
  };
  walk(overlayRoot);
  return files;
}

// ---------------------------------------------------------------------------
// Protocol buffer descriptors: the go_package option is embedded, with length
// prefixes, in protoc-gen-go's raw descriptor, protoc-gen-es's base64
// descriptor and the Buf baseline. Rewrite it at the wire level.

function readVarint(bytes, pos) {
  let value = 0, scale = 1;
  for (;;) {
    if (pos >= bytes.length) throw new Error('Truncated varint');
    const byte = bytes[pos++];
    value += (byte & 0x7f) * scale;
    if (!(byte & 0x80)) return [value, pos];
    scale *= 128;
  }
}
function varint(value) {
  const out = [];
  do { let byte = value % 128; value = Math.floor(value / 128); if (value) byte |= 0x80; out.push(byte); } while (value);
  return Buffer.from(out);
}
// Splits a message into its fields, keeping each field's exact bytes.
function fields(bytes) {
  const list = [];
  for (let pos = 0; pos < bytes.length;) {
    const start = pos;
    let key; [key, pos] = readVarint(bytes, pos);
    const number = Math.floor(key / 8), wire = key % 8;
    let valueStart = pos, valueEnd;
    if (wire === 0) [, valueEnd] = readVarint(bytes, pos);
    else if (wire === 1) valueEnd = pos + 8;
    else if (wire === 5) valueEnd = pos + 4;
    else if (wire === 2) { let length; [length, valueStart] = readVarint(bytes, pos); valueEnd = valueStart + length; }
    else throw new Error(`Unsupported wire type ${wire}`);
    if (valueEnd > bytes.length) throw new Error('Truncated field');
    list.push({ number, wire, raw: bytes.subarray(start, valueEnd), key: bytes.subarray(start, pos), value: bytes.subarray(valueStart, valueEnd) });
    pos = valueEnd;
  }
  return list;
}
function rebuild(list, replace) {
  let changed = false;
  const parts = list.map(field => {
    const value = field.wire === 2 ? replace(field) : undefined;
    if (!value) return field.raw;
    changed = true;
    return Buffer.concat([field.key, varint(value.length), value]);
  });
  return changed ? Buffer.concat(parts) : undefined;
}
// FileDescriptorProto field 8 = FileOptions; FileOptions field 11 = go_package.
function rewriteFileDescriptor(bytes) {
  return rebuild(fields(bytes), field => field.number !== 8 ? undefined : rebuild(fields(field.value), option => {
    if (option.number !== 11) return undefined;
    const goPackage = option.value.toString('utf8');
    return goPackage.startsWith(GO_MODULE.from + '/') ? Buffer.from(GO_MODULE.to + goPackage.slice(GO_MODULE.from.length)) : undefined;
  }));
}
// FileDescriptorSet field 1 = FileDescriptorProto.
function rewriteDescriptorSet(bytes) {
  return rebuild(fields(bytes), field => field.number === 1 ? rewriteFileDescriptor(field.value) : undefined);
}

// Go string literals, exactly as protoc-gen-go writes them (fmt's %q, i.e.
// strconv.Quote, of each 0x0a-terminated chunk of the descriptor).
function decodeGoString(literal) {
  const out = [];
  for (let i = 1; i < literal.length - 1;) {
    const c = literal[i];
    if (c !== '\\') { const code = literal.codePointAt(i); out.push(...Buffer.from(String.fromCodePoint(code))); i += code > 0xffff ? 2 : 1; continue; }
    const e = literal[i + 1];
    const simple = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, "'": 39, '"': 34 };
    if (e in simple) { out.push(simple[e]); i += 2; }
    else if (e === 'x') { out.push(parseInt(literal.slice(i + 2, i + 4), 16)); i += 4; }
    else if (e === 'u' || e === 'U') { const n = e === 'u' ? 4 : 8; out.push(...Buffer.from(String.fromCodePoint(parseInt(literal.slice(i + 2, i + 2 + n), 16)))); i += 2 + n; }
    else if (/[0-7]/.test(e)) { out.push(parseInt(literal.slice(i + 1, i + 4), 8)); i += 4; }
    else throw new Error(`Unknown Go escape \\${e}`);
  }
  return Buffer.from(out);
}
function decodeRune(bytes, i) {
  const b0 = bytes[i];
  if (b0 < 0x80) return [b0, 1];
  const need = b0 >= 0xf0 && b0 <= 0xf4 ? 3 : b0 >= 0xe0 ? (b0 <= 0xef ? 2 : -1) : b0 >= 0xc2 ? 1 : -1;
  if (need < 0 || i + need >= bytes.length) return [-1, 1];
  let rune = b0 & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
  for (let k = 1; k <= need; k++) { const b = bytes[i + k]; if ((b & 0xc0) !== 0x80) return [-1, 1]; rune = rune * 64 + (b & 0x3f); }
  const min = need === 1 ? 0x80 : need === 2 ? 0x800 : 0x10000;
  if (rune < min || rune > 0x10ffff || (rune >= 0xd800 && rune <= 0xdfff)) return [-1, 1];
  return [rune, need + 1];
}
const hex = (value, width) => value.toString(16).padStart(width, '0');
function quoteGo(bytes) {
  let out = '"';
  for (let i = 0; i < bytes.length;) {
    const [rune, width] = decodeRune(bytes, i);
    i += width;
    if (rune < 0) { out += '\\x' + hex(bytes[i - 1], 2); continue; }
    const char = String.fromCodePoint(rune);
    if (rune === 0x22 || rune === 0x5c) out += '\\' + char;
    else if (rune === 0x20 || (rune > 0x20 && rune !== 0x7f && /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(char))) out += char;
    else if ({ 7: 'a', 8: 'b', 12: 'f', 10: 'n', 13: 'r', 9: 't', 11: 'v' }[rune]) out += '\\' + { 7: 'a', 8: 'b', 12: 'f', 10: 'n', 13: 'r', 9: 't', 11: 'v' }[rune];
    else if (rune < 0x20 || rune === 0x7f) out += '\\x' + hex(rune, 2);
    else if (rune < 0x10000) out += '\\u' + hex(rune, 4);
    else out += '\\U' + hex(rune, 8);
  }
  return out + '"';
}
function goDescriptorLines(bytes) {
  const lines = [];
  for (let start = 0; start < bytes.length;) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline < 0 ? bytes.length : newline + 1;
    lines.push(quoteGo(bytes.subarray(start, end)));
    start = end;
  }
  return lines.map((line, index) => '\t' + line + (index < lines.length - 1 ? ' +' : '')).join('\n') + '\n';
}
function rewriteGoRawDescriptor(text) {
  const match = /(const \w+_rawDesc = "" \+\n)((?:\t".*" \+\n)*\t".*"\n)/.exec(text);
  if (!match) throw new Error('No protoc-gen-go raw descriptor found');
  const body = match[2];
  const bytes = Buffer.concat(body.split('\n').filter(Boolean).map(line => decodeGoString(line.replace(/^\t/, '').replace(/ \+$/, ''))));
  if (goDescriptorLines(bytes) !== body) throw new Error('Raw descriptor re-encoding does not reproduce protoc-gen-go output; update quoteGo');
  const rewritten = rewriteFileDescriptor(bytes);
  if (!rewritten) throw new Error('Raw descriptor carries no go_package to rewrite');
  return text.slice(0, match.index) + match[1] + goDescriptorLines(rewritten) + text.slice(match.index + match[0].length);
}
function rewriteEsDescriptor(text) {
  let count = 0;
  const result = text.replace(/fileDesc\("([A-Za-z0-9+/]+)"/g, (whole, encoded) => {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== encoded) throw new Error('Unexpected base64 descriptor encoding');
    const rewritten = rewriteFileDescriptor(bytes);
    if (!rewritten) return whole;
    count++;
    return `fileDesc("${rewritten.toString('base64').replace(/=+$/, '')}"`;
  });
  if (!count) throw new Error('protoc-gen-es descriptor carries no go_package to rewrite');
  return result;
}

// ---------------------------------------------------------------------------
// Text rewrites.

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Exact-text edits. `pre` edits apply to the committed text before the general
// rules, `post` edits to the result. Each must match (once, unless `all`).
const PATCHES = [
  // The release workflow (v2/RELEASING.md) runs from the repository root, where
  // V1's tag-triggered workflows no longer exist beside it.
  { file: '.github/workflows/release.yml', find: 'name: V2 Release\n', replace: 'name: Release\n' },
  { file: '.github/workflows/release.yml', find: "#\n# V1's release.yml and release-desktop.yml ignore `v2-v*` tags.\n", replace: '' },
  { file: '.github/workflows/release.yml', find: '        shell: bash\n        working-directory: v2\n', replace: '        shell: bash\n' },
  { file: '.github/workflows/release.yml', find: /v2\/dist\//g, replace: 'dist/', all: true },
  { file: 'Makefile', find: 'PROJECT ?= $(abspath ..)', replace: 'PROJECT ?= $(abspath .)' },
  { file: 'Makefile', find: /\n# export-repo: begin[^]*?# export-repo: end\n\n/, replace: '\n', optional: true },
  // The snippet helper was built from the V1 Cargo workspace around v2/; it is
  // now its own crate pinned to a lazybox-v1 revision.
  { file: 'scripts/environments.mjs', find: `async function buildSnippetAdapter(source) {
  // The helper reuses V1's config library; no duplicated paths or YAML semantics.
  const workspace = resolve(source, '..');
  const target = join(source, '.cache', 'snippet-adapter');
  await run('cargo', ['build', '-p', 'lazybox-config', '--bin', 'lazybox-snippets'], workspace, {...buildEnv, CARGO_TARGET_DIR:target});`, replace: `async function buildSnippetAdapter(source) {
  // The helper (tools/lazybox-snippets) links V1's config library at a pinned
  // lazybox-v1 revision; no duplicated paths or YAML semantics.
  const target = join(source, '.cache', 'snippet-adapter');
  await run('cargo', ['build', '--locked', '--manifest-path', join(source, 'tools/lazybox-snippets/Cargo.toml')], source, {...buildEnv, CARGO_TARGET_DIR:target});` },
  { file: 'scripts/environments.mjs', find: "snippetDirectory: channel === 'dev' ? resolve(source, '..') : source,", replace: 'snippetDirectory: source,' },
  // The docs site's workflow is written at the root from the overlay (scripts/export-repo/root).
  { file: 'RELEASING.md', find: 'with its **Docs** workflow (`.github/workflows/docs.yml`, written by the\n   export from `scripts/export-repo/root/`; it never runs in the monorepo).\n', replace: 'with its **Docs** workflow (`.github/workflows/docs.yml`).\n' },
  { file: 'RELEASING.md', find: ' v2/scripts/export-repo/root/.github/workflows/docs.yml`', replace: ' .github/workflows/docs.yml`' },
  // The repository is V2 alone and V2 is on main.
  { file: 'docs/getting-started.md', find: 'cd lazybox\ngit switch feat/v2-command-output        # V2 lives on this branch for now\n', replace: 'cd lazybox\n' },
  { file: 'docs/README.md', find: 'They describe what is on the `feat/v2-command-output` branch today;', replace: 'They describe what is on `main` today;' },
  { file: 'docs/internal/README.md', find: 'The internal pages live next to the code at the top of `v2/`, where code', replace: 'The internal pages live next to the code at the repository root, where code' },
  { file: 'docs/internal/README.md', find: 'These documents describe V2. Existing repository documentation outside `v2/`\ncontinues to describe V1 unless it says otherwise. The V1\n[positioning]', replace: 'These documents describe V2. V1 and its documentation live in\n[lazybox-v1](https://github.com/AntoineToussaint/lazybox-v1). The V1\n[positioning]' },
  { file: 'docs/internal/README.md', find: 'The source stays in this repository with separate V2 Go/npm workspaces, as\nrecorded in [D01]', replace: 'V2 has its own repository, with the Go module and npm workspace\nrecorded in [D01]' },
  { file: 'STRUCTURE.md', find: "The npm workspace remains at this folder's root.", replace: 'The npm workspace is at the repository root.' },
  { file: 'STRUCTURE.md', find: '```text\nv2/\n', replace: '```text\n./\n' },
  { file: 'STRUCTURE.md', find: '  scripts/                          viewer, browser checks, generation drift check\n', replace: "  scripts/                          viewer, browser checks, generation drift check\n  tools/lazybox-snippets/           snippet catalog helper linking V1's lazybox-config\n" },
  { file: 'WORKSPACES.md', find: 'helper links the existing `lazybox-config` Rust library so', replace: 'helper (`tools/lazybox-snippets`) links V1\'s `lazybox-config` Rust library, pinned to a lazybox-v1 revision, so' },
  { file: 'RELEASE_GATES.md', find: 'request that touches `v2/**` (and on pushes to `main`), so', replace: 'request (and on pushes to `main`), so' },
  { file: 'RELEASE_GATES.md', find: 'The repository is public, so macOS\nrunners cost no minutes; their limit is five concurrent jobs per account, so\none of these six macOS jobs can queue behind the others.', replace: 'The repository is private, so macOS\nminutes are billed (at the macOS rate) against the account\'s included minutes;\nat most five macOS jobs run at once per account, so one of these six macOS jobs\ncan queue behind the others.' },
  { file: 'RELEASE_GATES.md', find: "| `ui` ×3 | macOS | every `scope: \"ui\"` gate, through this gate runner |\n", replace: "| `ui` ×3 | macOS | every `scope: \"ui\"` gate, through this gate runner |\n| `typos` | Linux | spelling across the repository ([`typos.toml`](typos.toml)) |\n" },
  { file: 'RELEASE_GATES.md', find: '`v2 ci` is one check that passes only when every job did. It runs only when the\nworkflow does, so requiring it in branch protection needs a paths-aware rule;\notherwise a PR without `v2/` changes waits on a check that never starts.', replace: '`ci` is one check that passes only when every job did; it is the one to\nrequire in branch protection.' },
  { file: 'DECISIONS.md', phase: 'post', find: '**Status:** source layout selected and scaffolded. **Needed for:** V2 007.\n', replace: `**Status:** source layout selected and scaffolded. **Needed for:** V2 007.

**2026-11-16: own repository.** V2 moved out of the V1 repository (now
[lazybox-v1](${V1_REPOSITORY})) into this one, imported without history, with the
former \`v2/\` folder as the repository root; \`v2/\` in older records means this
root. Native identifiers (\`ai.lazybox.v2.*\`), \`LAZYBOX_V2_*\` settings, the
wire namespace and every state location are unchanged, so existing Dev and
Working installations keep their state. The Runner's Go module path changed from
\`${GO_MODULE.from}\` to \`${GO_MODULE.to}\`: a path
ending in \`/v2\` is a major-version suffix, which Go resolves only for a module
at the repository root or in a \`v2/\` directory, so it never named where the
module is. The new path does. The proto \`go_package\` follows, and the
\`contracts/runner-v1.binpb\` baseline's \`go_package\` option was rewritten to
match: an option change with no wire effect, which keeps \`buf breaking\`'s FILE
rules, FILE_SAME_GO_PACKAGE included, in force.
` },
  // The V2 workflow, rewritten for a repository that is V2 alone.
  { file: '.github/workflows/ci.yml', find: '# V2 (`v2/**`) per-change CI. It runs', replace: '# Per-change CI. It runs' },
  { file: '.github/workflows/ci.yml', find: " V1's `ci.yml` is untouched and never\n# looks under `v2/`.\n", replace: '\n' },
  { file: '.github/workflows/ci.yml', find: '# | ui (N)     | macos-15     | ui: every `scope: "ui"` gate, sharded           |\n', replace: '# | ui (N)     | macos-15     | ui: every `scope: "ui"` gate, sharded           |\n# | typos      | ubuntu-24.04 | spelling across the repository (typos.toml)     |\n' },
  { file: '.github/workflows/ci.yml', find: '# macOS. Linux carries the platform-independent checks. This repository is\n# public, so standard macOS runners cost no minutes; what binds is the\n# account\'s 5 concurrent macOS jobs. These are 6 (go, launcher, desktop and\n# UI_SHARDS shards), so the shortest can queue briefly behind the others.', replace: '# macOS. Linux carries the platform-independent checks. This repository is\n# private, so macOS minutes are billed (at the macOS rate) against the\n# account\'s included minutes, and the account runs at most 5 macOS jobs at\n# once. These are 6 (go, launcher, desktop and UI_SHARDS shards), so the\n# shortest can queue briefly behind the others.' },
  { file: '.github/workflows/ci.yml', find: 'name: V2 CI\n', replace: 'name: CI\n' },
  { file: '.github/workflows/ci.yml', find: /\non:\n[^]*?\n {2}workflow_dispatch:\n/, replace: '\non:\n  pull_request:\n  push:\n    branches: [main]\n  workflow_dispatch:\n' },
  { file: '.github/workflows/ci.yml', find: '    shell: bash\n    working-directory: v2\n', replace: '    shell: bash\n' },
  { file: '.github/workflows/ci.yml', find: /\n {8}working-directory: \.\n/g, replace: '\n', all: true },
  { file: '.github/workflows/ci.yml', find: 'name: v2-ui-${{ matrix.shard }}', replace: 'name: ui-${{ matrix.shard }}' },
  // The gate report and most screenshots are under .cache/, a hidden folder,
  // which upload-artifact leaves out unless told; a failed shard then uploads
  // only /tmp's screenshots.
  { file: '.github/workflows/ci.yml', find: '          if-no-files-found: warn\n', replace: '          include-hidden-files: true\n          if-no-files-found: warn\n' },
  { file: '.github/workflows/ci.yml', find: /\n {2}# One stable check name for branch protection: it fails unless every job\n {2}# above passed\.[^]*?\n {2}v2-ci:\n {4}name: v2 ci\n/, replace: `
  typos:
    name: typos
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
      # Pinned to a tagged release so a silent upstream change cannot flip CI.
      - uses: crate-ci/typos@v1.50.3

  # One stable check name for branch protection: it fails unless every job
  # above passed.
  ci:
    name: ci
` },
  { file: '.github/workflows/ci.yml', find: 'needs: [plan, go, generated, typescript, launcher, desktop, ui]', replace: 'needs: [plan, go, generated, typescript, launcher, desktop, ui, typos]' },
  { file: '.github/workflows/ci.yml', find: '- name: Every V2 job passed', replace: '- name: Every job passed' },
  { file: '.github/actions/playwright/action.yml', find: "# Installs the Playwright browsers V2's suites launch, cached per OS, browser\n# set and Playwright version (read from v2's installed @playwright/test, so a", replace: "# Installs the Playwright browsers the UI suites launch, cached per OS, browser\n# set and Playwright version (read from the installed @playwright/test, so a" },
  { file: '.github/actions/playwright/action.yml', find: 'name: v2-playwright\ndescription: Install and cache Playwright browsers for v2.', replace: 'name: playwright\ndescription: Install and cache Playwright browsers for the UI suites.' },
  { file: '.github/actions/playwright/action.yml', find: /\n {6}working-directory: v2\n/g, replace: '\n', all: true },
];

// Files whose text is test input, not a path: left exactly as committed.
const KEEP_V2_TEXT = new Set(['scripts/activity-detail.test.ts']);

function applyPatch(text, patch) {
  if (typeof patch.find === 'string') {
    const count = text.split(patch.find).length - 1;
    if (count === 0 && patch.optional) return text;
    if (count !== 1) throw new Error(`${patch.file}: expected the anchor once, found ${count}: ${JSON.stringify(patch.find.slice(0, 80))}`);
    return text.replace(patch.find, () => patch.replace);
  }
  const matches = text.match(new RegExp(patch.find.source, patch.find.flags.includes('g') ? patch.find.flags : patch.find.flags + 'g')) || [];
  if (matches.length === 0 && patch.optional) return text;
  if (matches.length === 0 || (!patch.all && matches.length !== 1)) throw new Error(`${patch.file}: expected ${patch.all ? 'at least one match' : 'one match'} of ${patch.find}, found ${matches.length}`);
  return text.replace(patch.find, () => patch.replace);
}

function relinkMarkdown(path, text, rootFiles) {
  const directory = posix.dirname(path);
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return whole;
    const [pathPart, anchor] = target.split(/(?=#)/);
    const inside = posix.normalize(posix.join(directory, pathPart));
    if (!inside.startsWith('../')) return whole;
    const fromRoot = posix.normalize(posix.join('v2', directory, pathPart)).replace(/\/$/, '');
    const mapped = ROOT_LINK_MAP.get(fromRoot) ?? (rootFiles.has(fromRoot) ? fromRoot : undefined);
    if (mapped) return `](${posix.relative(directory, mapped) || '.'}${anchor || ''})`;
    return `](${V1_REPOSITORY}/blob/${V1_REV}/${fromRoot}${anchor || ''})`;
  });
}

function rewriteText(path, text, topLevel, rootFiles) {
  const rules = [];
  const apply = (name, fn) => { const next = fn(text); if (next !== text) { rules.push(name); text = next; } };
  if (path.endsWith('.md')) apply('links', value => relinkMarkdown(path, value, rootFiles));
  apply('go-module', value => value.replace(new RegExp(escapeRegExp(GO_MODULE.from) + '(?=[/";`\\s)]|$)', 'gm'), GO_MODULE.to));
  if (!KEEP_V2_TEXT.has(path)) {
    apply('workflow-names', value => value.replaceAll('.github/workflows/v2.yml', '.github/workflows/ci.yml').replaceAll('`v2.yml`', '`ci.yml`').replaceAll('.github/workflows/v2-release.yml', '.github/workflows/release.yml').replaceAll('(v2-release.yml)', '(release.yml)').replaceAll('.github/actions/v2-playwright', '.github/actions/playwright'));
    // Keeps aligned trailing comments aligned: the six characters go before the `#`.
    apply('make-C-v2', value => value.replace(/make -C v2 ([^\n#`]*?)( {2,}#)/g, 'make $1      $2').replaceAll('make -C v2 ', 'make '));
    // A `cd v2` line in a shell example; in code it is test input, kept as is.
    if (path.endsWith('.md')) apply('cd-v2', value => value.replace(/^cd v2\n/gm, ''));
    apply('from-v2', value => value.replace(/([Ff])rom (`?)v2\/\2(?![\w.])/g, '$1rom the repository root'));
    const names = [...topLevel].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
    apply('v2-prefix', value => value.replace(new RegExp(`(?<![\\w./@~\\\\-])v2/(?=(?:${names})(?:\\.(?!\\w)|[^\\w.-]|$))`, 'gm'), ''));
  }
  return { text, rules };
}

const isBinary = (path, data) => data.includes(0) || /\.(png|jpe?g|gif|ico|icns|webp|woff2?|ttf|binpb|wasm|zip|gz)$/i.test(path);

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = git(scriptDir, ['rev-parse', '--show-toplevel']).toString().trim();
  const sha = git(repo, ['rev-parse', '--verify', `${options.ref}^{commit}`]).toString().trim();
  const dest = resolve(options.dest);
  const inside = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); };
  const repoReal = realpathSync(repo), destReal = existsSync(dest) ? realpathSync(dest) : dest;
  if (inside(repoReal, destReal) || inside(destReal, repoReal)) throw new Error(`Refusing DEST ${dest}: it overlaps the source repository`);
  // DEST is emptied except .git: never a checkout that holds Dev/Working state.
  if (existsSync(join(dest, '.cache', 'environments'))) throw new Error(`Refusing DEST ${dest}: it holds .cache/environments (live Dev/Working state). Export into a dedicated clone.`);

  const source = readTree(repo, sha, ['v2', ...ROOT_AS_IS, '.github/workflows/v2.yml', '.github/workflows/v2-release.yml', '.github/actions/v2-playwright']);
  const output = new Map(), summary = [];
  const record = (path, mode, data, note) => {
    if (output.has(path)) throw new Error(`Two sources for ${path}`);
    output.set(path, { mode, data });
    if (note) summary.push([path, note]);
  };

  const v2Files = [...source.keys()].filter(path => path.startsWith('v2/')).map(path => path.slice(3)).filter(path => !EXPORTER(path));
  const local = v2Files.filter(isLocalState);
  if (local.length) throw new Error(`Committed files look like local state or credentials; refusing to export: ${local.join(', ')}`);
  // `.cache` and `bin` are never committed: local state, screenshots and binaries.
  const topLevel = new Set([...v2Files.map(path => path.split('/')[0]), '.cache', 'bin']);
  const overlay = readOverlay();
  const rootFiles = new Set([...ROOT_AS_IS, ...overlay.keys()]);
  const patchesFor = (path, phase) => PATCHES.filter(patch => patch.file === path && (patch.phase || 'pre') === phase);

  const transform = (path, mode, data, origin) => {
    let notes = [];
    if (path === 'contracts/runner-v1.binpb' || path.endsWith('.binpb')) {
      const rewritten = rewriteDescriptorSet(data);
      if (rewritten) { data = rewritten; notes.push('go_package (descriptor set)'); }
    } else if (!isBinary(path, data)) {
      let text = data.toString('utf8');
      if (path === 'services/runner/code/pkg/gen/api.pb.go') { text = rewriteGoRawDescriptor(text); notes.push('go_package (raw descriptor)'); }
      if (path === 'packages/protocol/src/gen/api_pb.ts') { text = rewriteEsDescriptor(text); notes.push('go_package (es descriptor)'); }
      for (const patch of patchesFor(path, 'pre')) { const next = applyPatch(text, patch); if (next !== text) notes.push('edit'); text = next; }
      const result = rewriteText(path, text, topLevel, rootFiles);
      text = result.text; notes.push(...result.rules);
      for (const patch of patchesFor(path, 'post')) { const next = applyPatch(text, patch); if (next !== text) notes.push('edit'); text = next; }
      data = Buffer.from(text, 'utf8');
    }
    notes = [...new Set(notes)];
    record(path, mode, data, notes.length ? `${origin}: ${notes.join(', ')}` : origin === 'v2' ? undefined : origin);
  };

  for (const path of v2Files) {
    if (path === '.gitignore') continue;
    const { mode, data } = source.get('v2/' + path);
    transform(path, mode, data, 'v2');
  }
  for (const name of ROOT_AS_IS) { const file = source.get(name); if (!file) throw new Error(`Missing ${name} at ${sha}`); record(name, file.mode, file.data, 'carried as-is'); }
  const workflow = source.get('.github/workflows/v2.yml'), action = source.get('.github/actions/v2-playwright/action.yml');
  if (!workflow || !action) throw new Error('Missing the V2 workflow or its Playwright action');
  transform('.github/workflows/ci.yml', workflow.mode, workflow.data, 'from .github/workflows/v2.yml');
  transform('.github/actions/playwright/action.yml', action.mode, action.data, 'from .github/actions/v2-playwright');
  const release = source.get('.github/workflows/v2-release.yml');
  if (!release) throw new Error('Missing the V2 release workflow');
  transform('.github/workflows/release.yml', release.mode, release.data, 'from .github/workflows/v2-release.yml');
  const ignore = source.get('v2/.gitignore');
  record('.gitignore', '100644', Buffer.concat([ignore.data, Buffer.from('\n# Editor and OS files, local agent state.\n.DS_Store\n*.swp\n*.swo\n.claude/\n')]), 'merged from v2/.gitignore');
  for (const [path, file] of overlay) record(path, file.mode, file.data, 'V2 version (scripts/export-repo/root)');

  // Nothing may still name the old module, name what must stay private, or look
  // like a secret.
  const problems = [];
  for (const [path, { data }] of output) {
    if (['/', '"', '\n', ';'].some(next => data.includes(GO_MODULE.from + next))) problems.push(`${path}: still names ${GO_MODULE.from}`);
    const text = data.toString('latin1');
    if (!isBinary(path, data)) text.split('\n').forEach((line, index) => {
      for (const pattern of PRIVATE_NAME_PATTERNS) if (pattern.test(line)) problems.push(`${path}:${index + 1}: names something private (${pattern})`);
    });
    for (const pattern of SECRET_PATTERNS) if (pattern.test(text)) problems.push(`${path}: matches secret pattern ${pattern}`);
  }
  for (const patch of PATCHES) if (!patch.optional && !output.has(patch.file)) problems.push(`${patch.file}: patched file missing from export`);
  if (problems.length) throw new Error('Export check failed:\n  ' + problems.join('\n  '));

  // Materialize: empty DEST except .git, then write the tree.
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(dest)) if (name !== '.git') rmSync(join(dest, name), { recursive: true, force: true });
  for (const path of [...output.keys()].sort()) {
    const { mode, data } = output.get(path);
    const full = join(dest, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
    chmodSync(full, mode === '100755' ? 0o755 : 0o644);
  }

  // Remaining mentions of v2/ are reported for review, not rewritten.
  const leftovers = [];
  for (const [path, { data }] of output) {
    if (KEEP_V2_TEXT.has(path) || data.includes(0)) continue;
    data.toString('utf8').split('\n').forEach((line, index) => {
      if (/(?<![\w./@~\\-])v2\/|make -C v2/.test(line) || (path.endsWith('.md') && /\]\((?:\.\.\/)+(?:crates|docs)\//.test(line))) leftovers.push(`${path}:${index + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  console.log(`Exported v2/ at ${sha} (${options.ref}) to ${dest}: ${output.size} files.`);
  console.log(`Go module: ${GO_MODULE.from} -> ${GO_MODULE.to}; V1 links pinned to ${V1_REPOSITORY}@${V1_REV.slice(0, 12)}.`);
  console.log(`\nRewritten or added (${summary.length}):`);
  for (const [path, note] of summary.sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${path}  (${note})`);
  if (leftovers.length) { console.log(`\nRemaining v2/ mentions, left as written (${leftovers.length}):`); for (const line of leftovers) console.log('  ' + line); }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
