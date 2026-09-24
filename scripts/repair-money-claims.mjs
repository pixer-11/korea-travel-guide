#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  지어낸 금액을 지운다 — 생성기는 이미 막혔고, 이것은 이미 나간 글의 몫.
//
//  audit-money-claims 가 찾은 금액은 전부 출처가 없다(우리는 priceLevel 1~4 만
//  받고 금액은 한 번도 받지 않는다). 그러니 "맞는지 확인"할 대상이 아니라 지울
//  대상이다. 다만 문장을 통째로 잘라내면 글이 깎이므로, 모델에게 **그 자리만**
//  고치게 하고 나머지 글자는 그대로 돌아오는지 검사한다.
//
//  금액은 본문에만 있지 않다: 2026-09-21 측정으로 본문 29건, quickAnswer 27건,
//  FAQ 37건, description 2건. 그래서 repair-prose(본문 전용)로는 3분의 1도
//  못 고친다. 프론트매터는 공용 편집기(lib/frontmatter-edit)로만 건드린다.
//
//  원문(EN)이 바뀌면 srcHash 가 달라져 4개 언어가 자동으로 재번역 큐에 들어간다.
//
//    node scripts/repair-money-claims.mjs --limit 5 --dry
//    node scripts/repair-money-claims.mjs --limit 40
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { moneyClaims } from './lib/money-claim.mjs';
import { editFrontmatter } from './lib/frontmatter-edit.mjs';

const POSTS = 'src/content/posts';
const MODEL = 'claude-sonnet-5';
const DRY = process.argv.includes('--dry');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Number(process.argv[i + 1]) : Infinity;
})();

if (!DRY && !process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic();

const TOOL = {
  name: 'repaired',
  description: 'The same fields with every money amount removed and nothing else changed.',
  input_schema: {
    type: 'object',
    properties: {
      body: { type: 'string', description: 'The full markdown body, byte-identical except where a money amount was removed.' },
      quickAnswer: { type: 'string' },
      description: { type: 'string' },
      faq: {
        type: 'array',
        description: 'The SAME questions in the SAME order; only answers containing an amount change.',
        items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
      },
    },
    required: ['body', 'quickAnswer', 'description', 'faq'],
  },
};

const PROMPT = `You are repairing a published travel guide. It states prices that nobody ever measured: this site is given Google's price LEVEL (1-4) and never an amount, so every currency figure below was invented by the writer that produced it.

Remove every amount of money. Rules:
- Change NOTHING else. Every other sentence, heading, list item and link comes back byte-identical.
- Do not substitute a different figure, a range, or "approximately". The amount goes away.
- Where the sentence needs to keep saying something about cost, use the price LEVEL in ordinary words ("mid-range for the city", "on the pricier side", "budget-friendly"), or say where the current price is posted (the gate, the menu, the official site). Never both invent and hedge.
- If removing the amount leaves a hollow sentence, cut that sentence rather than padding it.
- Keep the same FAQ questions, in the same order and the same number of them. Only answers change.
- An amount that was never a price — a banknote a tree appears on, a historical construction cost — is a fact. Leave it.
- A menu, dish or ticket price is a price even when it is historical or famous ("the $100 phở" becomes "the luxury bowl of phở that made international headlines"). Remove it.
- Keep every markdown structure intact.`;

const files = readdirSync(POSTS).filter((f) => f.endsWith('.md'));
let done = 0, skipped = 0, failed = 0, clean = 0;
for (const f of files) {
  // --limit 은 시도 횟수다. 성공만 세면 거절된 수리가 한도 없이 모델을 부른다(코덱스 09-25).
  if (done + failed >= LIMIT) break;
  const path = join(POSTS, f);
  const raw = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const cut = raw.indexOf('\n---', 3);
  if (cut === -1) continue;
  let fm;
  try { fm = yaml.load(raw.slice(4, cut)); } catch { continue; }
  if (!fm) continue;
  const body = raw.slice(cut + 4);
  const faq = Array.isArray(fm.faq) ? fm.faq : [];

  const before = {
    body: moneyClaims(body),
    quickAnswer: moneyClaims(fm.quickAnswer || ''),
    description: moneyClaims(fm.description || ''),
    faq: faq.flatMap(({ q, a }) => moneyClaims(`${q} ${a}`)),
  };
  const total = Object.values(before).reduce((n, v) => n + v.length, 0);
  if (!total) { clean++; continue; }

  const slug = f.replace(/\.md$/, '');
  console.log(`\n💸 ${slug} — ${total}건`);
  for (const [where, hits] of Object.entries(before)) for (const h of hits) console.log(`   [${where}] ${h.amount} … ${h.context.slice(0, 80)}`);
  if (DRY) { done++; continue; }

  let out;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'repaired' },
      messages: [{ role: 'user', content: `${PROMPT}\n\nTITLE: ${fm.title}\n\nquickAnswer:\n${fm.quickAnswer || ''}\n\ndescription:\n${fm.description || ''}\n\nfaq:\n${JSON.stringify(faq, null, 1)}\n\nbody:\n${body.trim()}` }],
    });
    out = msg.content.find((c) => c.type === 'tool_use')?.input;
  } catch (e) { console.log(`   ⚠️  모델 오류 — 그대로 둠 (${String(e.message).slice(0, 70)})`); failed++; continue; }
  if (!out) { console.log('   ⚠️  응답에 결과가 없음 — 그대로 둠'); failed++; continue; }

  // ── 보존 검사. 수리가 글을 깎으면 수리가 아니다. ──
  if (!out.body || out.body.trim().length < body.trim().length * 0.85) {
    console.log(`   ⚠️  본문이 ${body.trim().length}자 → ${String(out.body || '').trim().length}자로 줄었다 — 그대로 둠`); failed++; continue;
  }
  if (!Array.isArray(out.faq) || out.faq.length !== faq.length || out.faq.some((x, i) => String(x.q).trim() !== String(faq[i].q).trim())) {
    console.log('   ⚠️  FAQ 질문이 바뀌었다 — 그대로 둠'); failed++; continue;
  }
  const leftovers = [
    ...moneyClaims(out.body),
    ...moneyClaims(out.quickAnswer || ''),
    ...moneyClaims(out.description || ''),
    ...out.faq.flatMap(({ q, a }) => moneyClaims(`${q} ${a}`)),
  ];
  if (leftovers.length) {
    console.log(`   ⚠️  금액 ${leftovers.length}건이 살아남았다 (${leftovers[0].amount}) — 그대로 둠`); failed++; continue;
  }

  // 프론트매터는 바뀐 키만, 공용 편집기로. 본문은 글자 그대로 갈아끼운다.
  const patch = {};
  if (before.quickAnswer.length) patch.quickAnswer = out.quickAnswer.trim();
  if (before.description.length) patch.description = out.description.trim();
  if (before.faq.length) patch.faq = out.faq.map(({ q, a }) => ({ q: String(q).trim(), a: String(a).trim() }));
  let next = raw;
  if (Object.keys(patch).length) next = editFrontmatter(next, patch);
  if (before.body.length) {
    const c = next.indexOf('\n---', 3);
    next = `${next.slice(0, c + 4)}\n${out.body.trim().replace(/(^|[^\\])~/g, '$1\\~')}\n`;
  }
  writeFileSync(path, next, 'utf8');
  console.log('   ✓ 수리됨');
  done++;
}

console.log(`\n📦 지어낸 가격 수리 — 고침 ${done} · 이미 깨끗 ${clean} · 건너뜀 ${skipped} · 실패 ${failed}${DRY ? ' (DRY)' : ''}`);
console.log(`MONEY_REPAIR_SUMMARY repaired=${done} clean=${clean} failed=${failed}`);
