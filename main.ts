// token-radar-01 entry point (Node 22, standard library only, no network, deterministic).
//
// One run: read the sealed snapshot, score the pre-token universe in lib/model.ts, write
// /output/board.json and /output/data.js, copy dashboard/ and screenshots/ beside them, and
// last write /output/dossier.json with the vendored make.fun library. Two runs must produce
// the same bytes, so every list is explicitly ordered and nothing reads the clock.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardProblems, buildRadar, parseSnapshot, radarScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flag(name: string, fallback: string): string {
  const eq = `--${name}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === `--${name}` && i + 1 < process.argv.length) return process.argv[i + 1]!;
    if (a.startsWith(eq)) return a.slice(eq.length);
  }
  return fallback;
}

const inputPath = (() => {
  const p = flag('input', '/input');
  return p.endsWith('.json') ? p : join(p, 'snapshot.json');
})();
const outputDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

if (!existsSync(inputPath)) {
  process.stderr.write(`token radar: no snapshot at ${inputPath}; pass --input <file|dir>\n`);
  process.exit(2);
}

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);

const problems = boardProblems(board, snapshot);
if (problems !== null) {
  process.stderr.write(`token radar: the board fails the gate: ${problems}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), radarScript(radar));

/** Copy a directory's plain files (dot names skipped) in sorted order, so the output is stable. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from)
    .filter((n) => !n.startsWith('.'))
    .sort();
  const copied: string[] = [];
  for (const name of names) {
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyTree(join(HERE, 'dashboard'), join(outputDir, 'dashboard'));
const shots = copyTree(join(HERE, 'screenshots'), join(outputDir, 'screenshots'));

if (shots.length < 3 || shots.length > SCREENSHOT_CAPS.max) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length}; hand in 3 (board, detail, filtered)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name} is not a plain name\n`);
    process.exit(1);
  }
  const size = statSync(join(outputDir, 'screenshots', name)).size;
  if (size > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${size} bytes, over 512 KiB\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ` +
    `${board.length} ranked rows (${radar.meta.early_count} early), ${radar.live.length} live-context rows\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${readdirSync(join(outputDir, 'dashboard')).length} files), ` +
    `screenshots/ (${shots.length}), dossier.json\n`,
);
