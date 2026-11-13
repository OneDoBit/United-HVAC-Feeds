#!/usr/bin/env node
/**
 * Builds ONE Spanish (es-US) Google Merchant Center feed from the theme's paginated feed template.
 *
 * Why: templates/collection.google-feed-es.liquid can only serve 250 products per page, and Shopify
 * refuses to paginate a collection past the 25,000th product (pages 101+ repeat page 100). The catalog
 * is bigger, so we read the pages oldest-first (covers the first 25k), then newest-first (covers the
 * rest), keep each g:id once, and write a single XML file (+ .gz) for Merchant Center to fetch.
 *
 * Usage:  node scripts/build-google-feed-es.mjs [outDir]      (default outDir: dist)
 * Needs Node 18+ (global fetch). No dependencies.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const BASE = 'https://unitedhvacmotors.com/es/collections/all?view=google-feed-es&country=US';
const PAGE_SIZE = 250;
const MAX_PAGES = 100; // Shopify's 25,000-item pagination ceiling
const CONCURRENCY = 3;
const outDir = process.argv[2] || 'dist';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(sort, page) {
  const url = `${BASE}&sort_by=${sort}&page=${page}`;
  const ATTEMPTS = 8;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'UnitedHVACMotors-FeedBuilder/1.0' } });
      const text = await res.text();
      // Anything Shopify adds outside <item> blocks (e.g. its exit_interstitial <script>) is dropped here.
      if (res.ok && text.includes('<rss')) {
        return text.match(/<item>[\s\S]*?<\/item>/g) || [];
      }
      throw new Error(`HTTP ${res.status}, body starts: ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
    } catch (err) {
      if (attempt === ATTEMPTS) throw new Error(`${url} failed: ${err.message}`);
      // Back off harder on Shopify's rate limiting (429 / "local_rate_limited").
      const limited = /429|rate_limited/.test(err.message);
      await sleep((limited ? 15000 : 2000) * attempt);
    }
  }
}

/** Fetches pages 1..MAX_PAGES of one sort order in order-preserving batches; stops at a short page. */
async function* pages(sort) {
  for (let start = 1; start <= MAX_PAGES; start += CONCURRENCY) {
    const nums = [];
    for (let p = start; p < start + CONCURRENCY && p <= MAX_PAGES; p++) nums.push(p);
    const batch = await Promise.all(nums.map((p) => fetchPage(sort, p)));
    for (let i = 0; i < batch.length; i++) {
      yield { page: nums[i], items: batch[i] };
      if (batch[i].length < PAGE_SIZE) return;
    }
  }
}

const idOf = (item) => (item.match(/<g:id>([^<]+)<\/g:id>/) || [])[1];

const seen = new Set();
const kept = [];
let ascComplete = false;

for await (const { page, items } of pages('created-ascending')) {
  for (const it of items) {
    const id = idOf(it);
    if (id && !seen.has(id)) { seen.add(id); kept.push(it); }
  }
  if (items.length < PAGE_SIZE) ascComplete = true;
  process.stdout.write(`\rasc page ${page}: ${kept.length} items`);
}
console.log();

if (!ascComplete) {
  // Catalog exceeds 25k: read from the newest end until a whole page is already known.
  for await (const { page, items } of pages('created-descending')) {
    let fresh = 0;
    for (const it of items) {
      const id = idOf(it);
      if (id && !seen.has(id)) { seen.add(id); kept.push(it); fresh++; }
    }
    process.stdout.write(`\rdesc page ${page}: ${kept.length} items`);
    if (fresh === 0) break;
    if (page === MAX_PAGES) console.warn('\nWARNING: catalog over 50,000 products; feed is incomplete.');
  }
  console.log();
}

// Refuse to publish a truncated feed: Merchant Center would drop every product missing from it.
const MIN_ITEMS = Number(process.env.MIN_ITEMS || 20000);
if (kept.length < MIN_ITEMS) {
  console.error(`Only ${kept.length} items (< MIN_ITEMS=${MIN_ITEMS}); not writing the feed.`);
  process.exit(1);
}

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n' +
  '<title>United HVAC Motors – Feed de productos (es-US)</title>\n' +
  '<link>https://unitedhvacmotors.com/es</link>\n' +
  `<description>Google Shopping feed en español. ${kept.length} productos. Generado ${new Date().toISOString()}</description>\n` +
  kept.join('\n') +
  '\n</channel>\n</rss>\n';

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'google-feed-es.xml'), xml);
await writeFile(path.join(outDir, 'google-feed-es.xml.gz'), gzipSync(xml));
console.log(`Wrote ${kept.length} items, ${(xml.length / 1e6).toFixed(1)} MB to ${outDir}/google-feed-es.xml (+ .gz)`);
