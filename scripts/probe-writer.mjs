#!/usr/bin/env node
// Runs the real writer once with the real key and checks the result. Writes
// nothing: no post, no data file, no commit. Exit code says whether it worked.
//
// Why it exists: a writer model change can pass every local check and still
// fail in production, because production uses a key we cannot read (a GitHub
// secret). The 2026-09-24 switch to claude-opus-5-5 had no way to prove the
// secret could reach that model short of waiting for the daily publish run.
// Run it from Actions with `gh workflow run writer-probe.yml` after changing
// the model, and before anything publishes with it.

import { writeArticle } from './lib/writer.mjs';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.log('FAIL: ANTHROPIC_API_KEY is not set');
  process.exit(1);
}

const model = process.env.WRITER_MODEL || '(writer default)';
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

// 1) Can this key see the model at all? A clear answer beats a 404 mid-run.
const wanted = process.env.WRITER_MODEL
  || (await import('node:fs')).readFileSync(new URL('./lib/writer.mjs', import.meta.url), 'utf8')
    .match(/WRITER_MODEL \|\| '([^']+)'/)?.[1];
const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
});
const list = res.ok ? (await res.json()).data.map((m) => m.id) : [];
check(res.ok, `models endpoint answered (HTTP ${res.status})`);
check(list.includes(wanted), `this key can use ${wanted}`);

// 2) The real writer path, end to end, with a guide shaped like a daily one.
const t = Date.now();
try {
  const r = await writeArticle({
    apiKey: key,
    title: 'Jagalchi Market: How to Pick a Fish and Have It Cooked',
    region: 'Busan',
    country: 'South Korea',
    category: 'food',
    facts: {
      name: 'Jagalchi Market',
      nearestStation: 'Jagalchi Station (Line 1), Exit 10',
      openingHours: '05:00-22:00; closed the 1st and 3rd Tuesday',
    },
  });
  const words = r.body.split(/\s+/).filter(Boolean).length;
  console.log(`writer (${model}) answered in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  check(r.quickAnswer.length > 40, 'quickAnswer present');
  check(words > 400, `body present (${words} words)`);
  check(Array.isArray(r.faq) && r.faq.length >= 4 && r.faq.every((f) => f.q && f.a), `faq shaped {q,a} (${r.faq.length})`);
  check((r.body.match(/\n\n/g) || []).length >= 5, 'paragraphs split');
  console.log(`em dashes in body: ${(r.body.match(/—/g) || []).length}`);
} catch (e) {
  check(false, `writer threw: ${e.status || ''} ${e.message}`);
}

console.log(failed ? `\nPROBE FAILED (${failed})` : '\nPROBE PASSED');
process.exit(failed ? 1 : 0);
