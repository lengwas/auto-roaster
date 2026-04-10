#!/usr/bin/env node
/**
 * Dump recent git history into src/data/changelog.json so the webapp can display it.
 * Runs as a prebuild step locally; on Vercel (where git is not available in the
 * build sandbox) the script no-ops and the committed JSON is used as-is.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/changelog.json');
const LIMIT = 100;

// On Vercel (or any env without a git repo), leave the committed file alone.
if (process.env.VERCEL || process.env.CI === 'true') {
  if (existsSync(OUT)) {
    console.log('[build-changelog] CI/Vercel detected, using committed changelog.json');
    process.exit(0);
  }
  // No file at all — write a stub so the import doesn't fail.
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), entries: [] }, null, 2));
  console.log('[build-changelog] CI/Vercel detected, wrote empty stub');
  process.exit(0);
}

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
  // Don't break the build — write a stub if no file exists yet.
  if (!existsSync(OUT)) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), entries: [] }, null, 2));
  }
  process.exit(0);
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
