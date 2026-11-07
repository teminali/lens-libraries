#!/usr/bin/env node
'use strict';
/**
 * Builds a small-model library (reader, decider, writer): dist/<id>-<version>-any.tar.gz
 *
 *   node tools/build_model.js reader 1.0.0
 *
 * The files named in libraries/<id>/library.json (upstream.files) are fetched from Hugging Face at the pinned revision, so a build is the same bytes
 * every time. The archive holds:
 *   <the model files>   LICENSE (the model's own)
 *   model.json          { id, version, repo, revision, serve } — how Lens Code starts it (serve: model, mmproj, args, endpoint)
 *   VERSION, NOTICE.md
 * A GitHub release asset is at most 2 GiB: a library that would be larger is refused here, not at publishing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [ID, VERSION] = process.argv.slice(2);
if (!ID || !/^\d+\.\d+\.\d+$/.test(VERSION || '')) { console.error('usage: node tools/build_model.js <id> <version>'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'libraries', ID, 'library.json'), 'utf8'));
const up = lib.upstream || {};
if (!up.repo || !up.revision || !Array.isArray(up.files) || !lib.serve) { console.error(`${ID}: library.json needs upstream.repo, upstream.revision, upstream.files and serve`); process.exit(2); }
const LIMIT = 2 * 1024 ** 3;

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `lens-${ID}-`));
  const out = path.join(work, ID);
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const file of up.files) {
      const target = path.join(out, file);
      const candidates = [
        path.join(os.homedir(), '.cache', 'lens-models', ID, file),
        path.join(os.homedir(), '.cache', 'lens-models', ID === 'reader' ? 'lfm3' : ID === 'decider' ? 'd1' : ID, file),
        path.join(os.homedir(), '.cache', 'lens-models', 'd1', file),
        path.join(os.homedir(), '.cache', 'lens-models', 'lfm3', file),
        path.join(os.homedir(), '.cache', 'lens-models', 'text', file),
        path.join('/tmp', file)
      ];
      const cached = candidates.find((f) => fs.existsSync(f));
      if (cached) {
        console.log(`reusing cached ${file} from ${cached}`);
        fs.copyFileSync(cached, target);
        continue;
      }
      const url = `https://huggingface.co/${up.repo}/resolve/${up.revision}/${file}`;
      console.log(`fetching ${file}`);
      // curl resumes and retries a dropped download; a file that does not arrive whole stops the build
      execFileSync('curl', ['-sSfL', '--retry', '5', '-C', '-', '-o', target, url], { stdio: 'inherit' });
    }
    // a build whose files come from a re-packager carries the licence from the model's own repository (upstream.licence)
    if (up.licence && up.licence.repo && up.licence.revision) {
      execFileSync('curl', ['-sSfL', '--retry', '5', '-o', path.join(out, 'LICENSE'), `https://huggingface.co/${up.licence.repo}/resolve/${up.licence.revision}/${up.licence.file || 'LICENSE'}`], { stdio: 'inherit' });
    }
    fs.writeFileSync(path.join(out, 'model.json'), `${JSON.stringify({ id: ID, version: VERSION, repo: up.repo, revision: up.revision, serve: lib.serve }, null, 1)}\n`);
    fs.writeFileSync(path.join(out, 'VERSION'), `${VERSION}\n`);
    fs.writeFileSync(path.join(out, 'NOTICE.md'), `# ${lib.name}\n\n${lib.summary}\n\nModel files from https://huggingface.co/${up.repo} at revision ${up.revision}, unchanged.\nLicence: ${lib.license} (see LICENSE).\n`);
    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    const archive = path.join(ROOT, 'dist', `${ID}-${VERSION}-any.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', out, '.']); // the contents at the top, as every library's archive is
    const size = fs.statSync(archive).size;
    if (size >= LIMIT) { fs.rmSync(archive); throw new Error(`${ID} is ${(size / 1e9).toFixed(2)} GB packed: over the 2 GiB a release asset can hold`); }
    console.log(`${archive} (${(size / 1e9).toFixed(2)} GB)`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.message); process.exit(1); });
