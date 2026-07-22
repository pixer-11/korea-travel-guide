#!/usr/bin/env node
// Targeted fixes: flatten 4 nested-paren event titles; fill 3 empty quickAnswers
// and derive their descriptions. Line-level, CRLF-safe.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');
const yq = (s) => JSON.stringify(s);
const setScalar = (src, key, value) => src.replace(new RegExp(`^(${key}:)[^\\r\\n]*`, 'm'), `$1 ${yq(value)}`);
const clip = (s, n = 158) => { s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

const titles = {
  'chiba-tokyo-and-osaka-summer-sonic-2026': 'Summer Sonic 2026: What to Know (Tokyo & Osaka)',
  'saint-cloud-paris-region-rock-en-seine-2026': 'Rock en Seine 2026: What to Know (Saint-Cloud, Paris)',
  'monza-italian-grand-prix-formula-1': 'Formula 1 Italian Grand Prix 2026: What to Know (Monza)',
  'tokyo-comic-market-108-summer-comiket': 'Comic Market 108 (Summer Comiket): What to Know in Tokyo',
};

const quickAnswers = {
  'busan-seafood': "Busan's seafood scene centers on Jagalchi Market, Korea's largest fish market, where you pick a fresh catch and have it grilled or served as raw hoe upstairs. Go in the morning for the bustle, pair it with nearby Gukje Market street food, and take Busan Metro Line 1 to Jagalchi Station (exit 10).",
  'jeju-seongsan-ilchulbong': "Seongsan Ilchulbong (\"Sunrise Peak\") is a dramatic volcanic tuff cone on Jeju's east coast, famous for sunrise views from its crater rim after a 20-30 minute climb. Go early for the sunrise and lighter crowds; it's about 1-1.5 hours by intercity bus from Jeju City and pairs well with a nearby Udo island ferry trip.",
  'suwon-local-restaurant': "Suwon's signature dish is wang-galbi, king-sized beef short ribs, best eaten around Paldalmun Gate and Yeongdong Market in the historic center. Come hungry in the evening, combine it with a walk along Hwaseong Fortress, and reach the area via Suwon Station (Line 1) then a short taxi or bus.",
};

let n = 0;
for (const [slug, title] of Object.entries(titles)) {
  const p = join(DIR, `${slug}.md`);
  let s = await readFile(p, 'utf8');
  const next = setScalar(s, 'title', title);
  if (next !== s) { await writeFile(p, next, 'utf8'); n++; console.log(`  title: ${slug}`); }
}
for (const [slug, qa] of Object.entries(quickAnswers)) {
  const p = join(DIR, `${slug}.md`);
  let s = await readFile(p, 'utf8');
  s = setScalar(s, 'quickAnswer', qa);
  s = setScalar(s, 'description', clip(qa));
  await writeFile(p, s, 'utf8');
  n++; console.log(`  quickAnswer+desc: ${slug}`);
}
console.log(`\nDone. ${n} files updated.`);
