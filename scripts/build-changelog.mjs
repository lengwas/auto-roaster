#!/usr/bin/env node
/**
 * Dump recent git history into src/data/changelog.json so the webapp can display it.
 * Runs as a prebuild step (and can be invoked manually with `node scripts/build-changelog.mjs`).
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/changelog.json');
const LIMIT = 100;

const SEP = '\u0001';
const REC = '\u0002';
const fmt = ['%H', '%h', '%an', '%ad', '%s'].join(SEP) + REC;

let raw = '';
try {
  raw = execSync(`git log -n ${LIMIT} --date=iso-strict --pretty=format:"${fmt}"`, {
    encoding: 'utf8',
    cwd: resolve(__dirname, '..'),
  });
} catch (err) {
  console.error('[build-changelog] git log failed:', err.message);
  process.exit(0); // don't break build
}

const entries = raw
  .split(REC)
  .map(s => s.trim())
  .filter(Boolean)
  .map(line => {
    const [hash, short, author, date, ...rest] = line.split(SEP);
    return { hash, short, author, date, subject: rest.join(SEP) };
  });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2));
console.log(`[build-changelog] wrote ${entries.length} entries to ${OUT}`);
