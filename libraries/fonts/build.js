#!/usr/bin/env node
'use strict';
/**
 * Builds the font library: dist/fonts-<version>-any.tar.gz
 *
 *   node libraries/fonts/build.js 1.0.0
 *
 * For each family in families.json, from github.com/google/fonts (ofl/<slug>): its font files converted to woff2 (fontTools, through uv), its OFL.txt, and
 * what METADATA.pb says of it. The archive holds:
 *   index.json                 { version, families: [{ family, slug, category, designer, axes: [{ tag, min, max }], files: [{ file, style, weight }] }] }
 *   families/<slug>/*.woff2    families/<slug>/OFL.txt
 *   VERSION, NOTICE.md
 * A family the repository does not hold (renamed or removed) is left out with a warning, never guessed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(VERSION || '')) { console.error('usage: node libraries/fonts/build.js <version>'); process.exit(2); }
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl';
const { families } = JSON.parse(fs.readFileSync(path.join(HERE, 'families.json'), 'utf8'));

const listing = (slug) => { try { return JSON.parse(execFileSync('gh', ['api', `repos/google/fonts/contents/ofl/${slug}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).map((f) => f.name); } catch (_) { return null; } };
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); };

/** The parts of METADATA.pb (protobuf text) the index keeps. */
function metadata(text) {
  const field = (name, src = text) => { const m = new RegExp(`^${name}: "([^"]*)"`, 'm').exec(src); return m ? m[1] : null; };
  const blocks = (name) => [...text.matchAll(new RegExp(`^${name} \\{([\\s\\S]*?)^\\}`, 'gm'))].map((m) => m[1]);
  return {
    family: field('name'),
    designer: field('designer'),
    category: (field('category') || '').toLowerCase().replace('_', '-'),
    fonts: blocks('fonts').map((b) => ({ style: (/style: "(\w+)"/.exec(b) || [])[1], weight: Number((/weight: (\d+)/.exec(b) || [])[1]), filename: (/filename: "([^"]+)"/.exec(b) || [])[1] })),
    axes: blocks('axes').map((b) => ({ tag: (/tag: "(\w+)"/.exec(b) || [])[1], min: Number((/min_value: ([\d.]+)/.exec(b) || [])[1]), max: Number((/max_value: ([\d.]+)/.exec(b) || [])[1]) }))
  };
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-fonts-'));
  const out = path.join(work, 'fonts');
  fs.mkdirSync(path.join(out, 'families'), { recursive: true });
  const ttf = path.join(work, 'ttf');
  fs.mkdirSync(ttf);
  const index = [];
  const convert = []; // [ttf, woff2]
  for (const slug of families) {
    const names = listing(slug);
    if (!names || !names.includes('METADATA.pb') || !names.includes('OFL.txt')) { console.warn(`fonts: ${slug} is not in google/fonts ofl/, left out`); continue; }
    const meta = metadata((await get(`${RAW}/${slug}/METADATA.pb`)).toString('utf8'));
    const dir = path.join(out, 'families', slug);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'OFL.txt'), await get(`${RAW}/${slug}/OFL.txt`));
    // one file per distinct source file (a variable font is listed once per named weight)
    const files = [];
    for (const f of meta.fonts) {
      if (!f.filename || files.some((x) => x.source === f.filename)) continue;
      const source = path.join(ttf, `${slug}--${f.filename}`);
      fs.writeFileSync(source, await get(`${RAW}/${slug}/${encodeURIComponent(f.filename)}`));
      const file = f.filename.replace(/\[[^\]]*\]/, '').replace(/\.ttf$/i, '.woff2').replace(/-$/, '') || `${slug}.woff2`;
      convert.push([source, path.join(dir, file)]);
      files.push({ source: f.filename, file, style: f.style, weight: f.weight });
    }
    const wght = meta.axes.find((a) => a.tag === 'wght');
    index.push({
      family: meta.family, slug, category: meta.category, designer: meta.designer,
      axes: meta.axes,
      // a variable font covers its whole weight axis; a static one its own weight
      files: files.map((f) => ({ file: f.file, style: f.style, weight: wght && /\[/.test(f.source) ? `${wght.min} ${wght.max}` : String(f.weight) }))
    });
    console.log(`fonts: ${meta.family} (${files.length} file${files.length === 1 ? '' : 's'})`);
  }
  // every file to woff2 in one Python run
  const list = path.join(work, 'convert.json');
  fs.writeFileSync(list, JSON.stringify(convert));
  execFileSync('uv', ['run', '--quiet', '--with', 'fonttools', '--with', 'brotli', 'python3', '-c',
    'import json,sys\nfrom fontTools.ttLib import TTFont\nfor a,b in json.load(open(sys.argv[1])):\n  f=TTFont(a); f.flavor="woff2"; f.save(b)', list], { stdio: 'inherit' });
  fs.writeFileSync(path.join(out, 'index.json'), `${JSON.stringify({ version: VERSION, families: index }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'VERSION'), `${VERSION}\n`);
  fs.copyFileSync(path.join(HERE, 'NOTICE.md'), path.join(out, 'NOTICE.md'));
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const archive = path.join(ROOT, 'dist', `fonts-${VERSION}-any.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', out, '.']);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`${archive} (${(fs.statSync(archive).size / 1048576).toFixed(1)} MB, ${index.length} families)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
