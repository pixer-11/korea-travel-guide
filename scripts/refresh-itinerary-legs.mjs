#!/usr/bin/env node
// Re-sync the cached leg distances in itinerary files with the coordinates the
// posts actually carry today.
//
// Why this exists: an itinerary stores each leg's km/minutes/transit at build
// time. When a post's coordinates are later corrected — which the geocode and
// details backfills do routinely — those cached numbers go stale and
// validate-itineraries reports LEG-STALE every single day until someone acts.
// Regenerating the whole itinerary costs an LLM run and rewrites prose that was
// perfectly good, to fix one number.
//
// What it will NOT do, deliberately: it only rewrites `km`. If `minutes` or
// `transit` would change, the leg is REPORTED and left alone — those two are
// what the human-readable prose is written against ("a short 10-minute walk",
// "hop on the subway"). Silently changing them would make the numbers agree with
// each other while quietly contradicting the sentence next to them, which is the
// opposite of the accuracy this is meant to protect. Those cases need a real
// regenerate, and saying so is the correct outcome.
//
//   node scripts/refresh-itinerary-legs.mjs           # report only
//   node scripts/refresh-itinerary-legs.mjs --apply   # write the km fixes

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
// Reuse the validator's loader so this reads posts EXACTLY the way the check
// that reports LEG-STALE reads them — two loaders would eventually disagree,
// and then this tool would "fix" files into a state the validator still fails.
import { loadPostsFrom } from './validate-itineraries.mjs';
import { walkLeg } from '../src/lib/itinerary.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ITIN_DIR = path.join(ROOT, 'src/content/itineraries');
const APPLY = process.argv.includes('--apply');

const splitFm = (raw) => {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  return m ? { fm: m[1], body: m[2] ?? '' } : null;
};

async function main() {
  const posts = await loadPostsFrom(path.join(ROOT, 'src/content/posts'));
  const byId = new Map(posts.map((p) => [p.id, p]));

  let files = [];
  try {
    files = (await readdir(ITIN_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    console.log('✓ 일정 파일이 없어 확인할 것이 없습니다.');
    return;
  }

  const fixed = [];
  const needsRegen = [];

  for (const file of files) {
    const full = path.join(ITIN_DIR, file);
    const raw = await readFile(full, 'utf8');
    const parts = splitFm(raw);
    if (!parts) continue;
    const data = yaml.load(parts.fm);
    let text = raw;
    let touched = false;

    for (const [di, day] of (data.itinerary ?? []).entries()) {
      const stops = day.stops ?? [];
      for (const [si, stop] of stops.entries()) {
        const leg = stop.walkToNext;
        const next = stops[si + 1];
        if (!leg || !next) continue;
        const a = byId.get(stop.slug);
        const b = byId.get(next.slug);
        if (!a || !b) continue;

        const fresh = walkLeg(a, b);
        if (!fresh) continue;

        const where = `${file} · ${di + 1}일차 · ${stop.slug}`;
        if (fresh.minutes !== leg.minutes || fresh.transit !== leg.transit) {
          // Prose is written against these — a human has to look.
          needsRegen.push(
            `${where} — 소요시간/이동수단이 바뀜 (${leg.minutes}분/${leg.transit ? '대중교통' : '도보'} → ` +
              `${fresh.minutes}분/${fresh.transit ? '대중교통' : '도보'}) · 본문 서술과 함께 재생성 필요`
          );
          continue;
        }
        if (fresh.km === leg.km) continue;

        // Rewrite just this leg's km, anchored to the surrounding lines so a
        // repeated value elsewhere in the file cannot be hit by accident.
        const anchor = new RegExp(
          `(slug:\\s*${stop.slug}[\\s\\S]{0,600}?walkToNext:\\s*\\r?\\n\\s*km:\\s*)${String(leg.km).replace('.', '\\.')}\\b`
        );
        if (!anchor.test(text)) {
          needsRegen.push(`${where} — 파일에서 해당 값을 찾지 못해 자동 수정 불가`);
          continue;
        }
        text = text.replace(anchor, `$1${fresh.km}`);
        touched = true;
        fixed.push(`${where} — ${leg.km}km → ${fresh.km}km`);
      }
    }

    if (touched && APPLY) await writeFile(full, text, 'utf8');
  }

  if (fixed.length) {
    console.log(`${APPLY ? '거리 갱신' : '갱신 예정'} ${fixed.length}건`);
    for (const f of fixed) console.log(`  • ${f}`);
  }
  if (needsRegen.length) {
    console.log(`\n손대지 않음(재생성 필요) ${needsRegen.length}건`);
    for (const f of needsRegen) console.log(`  • ${f}`);
  }
  if (!fixed.length && !needsRegen.length) console.log('✓ 모든 구간 거리가 현재 좌표와 일치합니다.');
  if (!APPLY && fixed.length) console.log('\n(--apply 를 붙이면 실제로 기록합니다)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
