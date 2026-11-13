#!/usr/bin/env node
'use strict';
/**
 * Builds the voice model library for the lens-libraries feed (docs/specs/voice.md): `lfm3-omni`, LFM3-Omni-2B (Liquid AI) as llama.cpp runs it, and prints
 * the two index entries voice needs (`lfm3-omni` and the runtime `llama`, whose 1.0.0 archive, llama.cpp b11960, is already a release of lens-libraries).
 * It does NOT publish and does NOT sign: tools/publish.js signs the index (the library key, ~/.lens-libraries/signing-key.pem).
 *
 *   node libraries/lfm3-omni/build.js [version, default 1.0.0] [--from <dir with the three upstream files>] [--out <dir>] [--llama <llama-1.0.0-darwin-arm64.tar.gz>]
 * (--llama: the runtime archive as published, lens-libraries dist/; it is copied beside the model archive and its index entry is written too.)
 *
 * The archive holds, at its top (as every library's archive does):
 *   LFM3-Omni-2B-Q4_K_M.gguf          the model (1.10 GB)
 *   mmproj-LFM3-Omni-2B-Q8_0.gguf     its audio and vision projector, with the speech decoder (507 MB)
 *   serve.json                        what electron/voice/omni.js starts llama-server with: { model, mmproj, ctx }
 *   LICENSE                           LFM Open License v1.0 (Liquid AI), as the model's repository ships it
 *   NOTICE.md                         where it came from, pinned
 * Every upstream file is pinned to a Hugging Face commit and checked by size and sha256 before it goes in (measured 2026-11-10).
 * Default output: ~/.cache/lens-models/dist (never inside a repository).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// the id is the library's folder and the version the release it is built for (the first argument, as every library's build takes it)
const VERSION = /^\d+\.\d+\.\d+$/.test(process.argv[2] || '') ? process.argv[2] : '1.0.0';
const lib = { id: path.basename(__dirname), ...JSON.parse(fs.readFileSync(path.join(__dirname, 'library.json'), 'utf8')), version: VERSION };
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const OUT = path.resolve(arg('out', path.join(os.homedir(), '.cache', 'lens-models', 'dist')));
const FROM = arg('from', null);
const LLAMA = arg('llama', null);
const sha256 = (file) => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-lfm3-omni-'));
  try {
    for (const f of lib.upstream.files) {
      const to = path.join(work, f.name);
      const have = FROM ? path.join(FROM, f.name) : null;
      if (have && fs.existsSync(have)) {
        fs.copyFileSync(have, to, fs.constants.COPYFILE_FICLONE); // a clone on APFS: no second copy of the bytes
      } else {
        const url = `https://huggingface.co/${lib.upstream.repo}/resolve/${lib.upstream.revision}/${f.name}`;
        console.log(`fetching ${f.name}`);
        execFileSync('curl', ['-sSfL', '--retry', '5', '-o', to, url], { stdio: 'inherit' });
      }
      const size = fs.statSync(to).size;
      if (f.size && size !== f.size) throw new Error(`${f.name} is ${size} bytes, the pin says ${f.size}`);
      if (f.sha256 && await sha256(to) !== f.sha256) throw new Error(`${f.name} does not match its pinned sha256`);
    }
    fs.writeFileSync(path.join(work, 'serve.json'), `${JSON.stringify(lib.serve, null, 2)}\n`);
    fs.writeFileSync(path.join(work, 'NOTICE.md'), [
      `# ${lib.name}`, '', lib.summary, '',
      `Model: ${lib.upstream.repo} at ${lib.upstream.revision} (https://huggingface.co/${lib.upstream.repo}/tree/${lib.upstream.revision}), unchanged:`,
      ...lib.upstream.files.map((f) => `- ${f.name} (${f.size} bytes, sha256 ${f.sha256 || 'as published'})`), '',
      `Licence: ${lib.license}. The full text is in LICENSE.`,
      `Runtime: the \`llama\` library (llama.cpp ${lib.runtime}); Homebrew llama.cpp of 2026-10 cannot load the lfm3 architecture.`, ''
    ].join('\n'));
    fs.mkdirSync(OUT, { recursive: true });
    const archive = path.join(OUT, `${lib.id}-${lib.version}-any.tar.gz`);
    // gzip -1: the model files hardly compress, so the archive is about their size either way and the fast level saves a minute
    execFileSync('/bin/sh', ['-c', `tar -cf - -C "${work}" . | gzip -1 > "${archive}"`], { stdio: 'inherit' });
    const entry = {
      id: lib.id, name: lib.name, summary: lib.summary, version: lib.version, license: lib.license,
      assets: { any: { url: `https://github.com/teminali/lens-libraries/releases/download/${lib.id}-v${lib.version}/${path.basename(archive)}`, sha256: await sha256(archive), size: fs.statSync(archive).size } }
    };
    const out = [entry];
    if (LLAMA && fs.existsSync(LLAMA)) {
      const beside = path.join(OUT, 'llama-1.0.0-darwin-arm64.tar.gz');
      if (path.resolve(LLAMA) !== beside) fs.copyFileSync(LLAMA, beside, fs.constants.COPYFILE_FICLONE); // the live scenario voice-real serves both from OUT
      out.push({
        id: 'llama', name: 'Model runtime', summary: 'Runs the voice model on this computer (llama.cpp b11960: llama-server).', version: '1.0.0', license: 'MIT (llama.cpp)',
        assets: { 'darwin-arm64': { url: 'https://github.com/teminali/lens-libraries/releases/download/llama-v1.0.0/llama-1.0.0-darwin-arm64.tar.gz', sha256: await sha256(LLAMA), size: fs.statSync(LLAMA).size } }
      });
    }
    fs.writeFileSync(path.join(OUT, `${lib.id}-${lib.version}.index-entries.json`), `${JSON.stringify(out, null, 2)}\n`);
    console.log(`${archive} (${(entry.assets.any.size / 1e9).toFixed(2)} GB, sha256 ${entry.assets.any.sha256})`);
    console.log(`index entries: ${path.join(OUT, `${lib.id}-${lib.version}.index-entries.json`)}`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

main().catch((e) => { console.error(`voice-library: FAILED: ${e.message}`); process.exit(1); });
