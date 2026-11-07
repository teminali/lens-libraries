#!/usr/bin/env node
'use strict';
/**
 * Builds the model runtime library: dist/llama-<version>-<platform>.tar.gz for each platform asked (all those library.json names when none is).
 *
 *   node libraries/llama/build.js 1.0.0 darwin-arm64
 *
 * Each archive is llama.cpp's own release build for that platform (upstream.version), unchanged, laid out as Lens Code reads it:
 *   bin/llama-server (bin/llama-server.exe on Windows) and the libraries it loads beside it
 *   LICENSE (llama.cpp's), VERSION, NOTICE.md
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [VERSION, ...asked] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) { console.error('usage: node libraries/llama/build.js <version> [platform...]'); process.exit(2); }
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const lib = JSON.parse(fs.readFileSync(path.join(HERE, 'library.json'), 'utf8'));
const { version: TAG, assets } = lib.upstream;
const platforms = asked.length ? asked : Object.keys(assets);

/** Every file under a folder, depth first. */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

for (const platform of platforms) {
  const asset = assets[platform];
  if (!asset) { console.error(`llama: no build named for ${platform}`); process.exit(2); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-llama-'));
  try {
    const got = path.join(work, asset);
    console.log(`fetching ${asset}`);
    execFileSync('curl', ['-sSfL', '--retry', '5', '-o', got, `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${asset}`], { stdio: 'inherit' });
    const unpacked = path.join(work, 'unpacked');
    fs.mkdirSync(unpacked);
    if (asset.endsWith('.zip')) execFileSync('unzip', ['-q', got, '-d', unpacked]); else execFileSync('tar', ['-xzf', got, '-C', unpacked]);
    // the server, wherever the build put it, and everything in its folder (the libraries it loads)
    const server = walk(unpacked).find((f) => /^llama-server(\.exe)?$/.test(path.basename(f)));
    if (!server) throw new Error(`${asset} holds no llama-server`);
    const out = path.join(work, 'llama');
    fs.mkdirSync(path.join(out, 'bin'), { recursive: true });
    execFileSync('cp', ['-R', `${path.dirname(server)}/.`, path.join(out, 'bin')]);
    const licence = walk(unpacked).find((f) => /^LICEN[CS]E/i.test(path.basename(f)));
    if (licence) fs.copyFileSync(licence, path.join(out, 'LICENSE'));
    fs.writeFileSync(path.join(out, 'VERSION'), `${VERSION}\n`);
    fs.writeFileSync(path.join(out, 'NOTICE.md'), `# ${lib.name}\n\n${lib.summary}\n\nllama.cpp ${TAG}, the project's own build ${asset}, unchanged: https://github.com/ggml-org/llama.cpp/releases/tag/${TAG}\nLicence: ${lib.license}.\n`);
    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    const archive = path.join(ROOT, 'dist', `llama-${VERSION}-${platform}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', out, '.']); // the contents at the top, as every library's archive is
    console.log(`${archive} (${(fs.statSync(archive).size / 1e6).toFixed(1)} MB)`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
