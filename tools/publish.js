#!/usr/bin/env node
'use strict';
/**
 * Publishes the library index Lens Code reads (electron/libraries/manager.js in the Lens Code repo), and, given archives, a new version of one library.
 *
 *   node tools/publish.js                                  re-sign and re-publish the index from what is released
 *   node tools/publish.js <id> <version> <platform>=<archive> [...]   release a version of a library, then the index
 *
 * A version of a library is a GitHub release tagged `<id>-v<version>` holding one archive per platform (`darwin-arm64`, `linux-x64`, ..., or `any`).
 * The index is the release tagged `index`, holding libraries.json and libraries.json.sig (base64 ed25519 over the exact bytes of libraries.json).
 * For each library in libraries/<id>/library.json, the index lists its newest release, with each archive's address, size and sha256.
 *
 * The signing key never leaves this computer: LIBRARIES_SIGNING_KEY_FILE (default ~/.lens-libraries/signing-key.pem).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'teminali/lens-libraries';
const ROOT = path.join(__dirname, '..');
const KEY_FILE = process.env.LIBRARIES_SIGNING_KEY_FILE || path.join(os.homedir(), '.lens-libraries', 'signing-key.pem');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const semver = (v) => v.split('.').map((n) => parseInt(n, 10));
const newer = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

function described() {
  const dir = path.join(ROOT, 'libraries');
  return fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, 'library.json')))
    .map((id) => ({ id, ...JSON.parse(fs.readFileSync(path.join(dir, id, 'library.json'), 'utf8')) }));
}

function releases() {
  try { return JSON.parse(gh('release', 'list', '--repo', REPO, '--limit', '200', '--json', 'tagName')).map((r) => r.tagName); } catch (_) { return []; }
}

/** One library's release: its version's archives, by platform, with address, size and checksum (read back from GitHub, so the index says what is there). */
function assetsOf(tag) {
  const info = JSON.parse(gh('release', 'view', tag, '--repo', REPO, '--json', 'assets'));
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-lib-'));
  const out = {};
  for (const a of info.assets) {
    const m = /-(any|[a-z]+-[a-z0-9]+)\.(tar\.gz|zip)$/.exec(a.name);
    if (!m) continue;
    gh('release', 'download', tag, '--repo', REPO, '--pattern', a.name, '--dir', dl, '--clobber');
    const file = path.join(dl, a.name);
    out[m[1]] = { url: `https://github.com/${REPO}/releases/download/${tag}/${a.name}`, sha256: sha256(file), size: fs.statSync(file).size };
  }
  fs.rmSync(dl, { recursive: true, force: true });
  return out;
}

function release(id, version, archives) {
  const lib = described().find((l) => l.id === id);
  if (!lib) throw new Error(`libraries/${id}/library.json is missing`);
  const tag = `${id}-v${version}`;
  const files = archives.map((spec) => {
    const [platform, file] = spec.split('=');
    const ext = file.endsWith('.zip') ? 'zip' : 'tar.gz';
    const named = path.join(os.tmpdir(), `${id}-${version}-${platform}.${ext}`);
    fs.copyFileSync(file, named);
    return named;
  });
  if (!releases().includes(tag)) gh('release', 'create', tag, '--repo', REPO, '--title', `${lib.name} ${version}`, '--notes', `${lib.name} ${version}.`, ...files);
  else gh('release', 'upload', tag, '--repo', REPO, '--clobber', ...files);
  for (const f of files) fs.rmSync(f, { force: true });
}

function publishIndex() {
  const tags = releases();
  const libraries = [];
  for (const lib of described()) {
    const versions = tags.map((t) => new RegExp(`^${lib.id}-v(\\d+\\.\\d+\\.\\d+)$`).exec(t)).filter(Boolean).map((m) => m[1]);
    if (!versions.length) continue;
    const latest = versions.reduce((a, b) => (newer(b, a) ? b : a));
    const assets = assetsOf(`${lib.id}-v${latest}`);
    if (!Object.keys(assets).length) continue;
    libraries.push({ id: lib.id, name: lib.name, summary: lib.summary, version: latest, ...(lib.license ? { license: lib.license } : {}), assets, ...(lib.check ? { check: lib.check } : {}) });
  }
  const text = `${JSON.stringify({ version: 1, libraries }, null, 2)}\n`;
  const sig = crypto.sign(null, Buffer.from(text), crypto.createPrivateKey(fs.readFileSync(KEY_FILE, 'utf8'))).toString('base64');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-index-'));
  fs.writeFileSync(path.join(dir, 'libraries.json'), text);
  fs.writeFileSync(path.join(dir, 'libraries.json.sig'), sig);
  if (!tags.includes('index')) gh('release', 'create', 'index', '--repo', REPO, '--title', 'Library index', '--notes', 'The signed list of libraries Lens Code reads. Replaced on every publish.', '--latest=false');
  gh('release', 'upload', 'index', '--repo', REPO, '--clobber', path.join(dir, 'libraries.json'), path.join(dir, 'libraries.json.sig'));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`index: ${libraries.map((l) => `${l.id} ${l.version} (${Object.keys(l.assets).join(', ')})`).join('; ') || 'no libraries yet'}`);
}

const [id, version, ...archives] = process.argv.slice(2);
if (id) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !archives.length) { console.error('usage: node tools/publish.js <id> <version> <platform>=<archive> [...]'); process.exit(2); }
  release(id, version, archives);
}
publishIndex();
