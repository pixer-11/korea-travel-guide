// The Telegram digest is the owner's only view of most checks, so a message
// shape it cannot read is a warning that never arrives. These pin the two ways
// that has happened: an unmapped code, and a bullet glyph nobody stripped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { koDigest, koIssueLine } from './issue-ko.mjs';

test('✗ findings are read as findings, not as "대상 미상"', () => {
  const out = koIssueLine('  ✗ DESIGN-CROWD-PALETTE: crowd chart palette regressed (busy must be #e08574)');
  assert.match(out, /혼잡도 그래프 색/);
  assert.doesNotMatch(out, /대상 미상/);
  assert.doesNotMatch(out, /[A-Za-z]{4,}\s+[A-Za-z]{3,}/, `English survived: ${out}`);
});

test('every design-uniformity code has Korean of its own', () => {
  const codes = [
    'DESIGN-CROWD-PALETTE', 'DESIGN-NEWSLETTER-CQ', 'DESIGN-ICON-PLATE',
    'DESIGN-COLOR-SCHEME', 'DESIGN-REGION-TILE', 'DESIGN-DIST-STALE',
  ];
  for (const code of codes) {
    const out = koIssueLine(`  ✗ ${code}: something in English`);
    assert.doesNotMatch(out, /점검 필요 \(코드/, `${code} is unmapped: ${out}`);
  }
});

test('an icon-plate finding names which icon', () => {
  assert.match(koIssueLine('  ✗ DESIGN-ICON-PLATE: icon plate missing for ".hotels-ico"'), /hotels-ico/);
});

// A whole-site check names no file. It used to be announced as "대상 미상",
// which reads as a second problem sitting next to the real one.
test('a finding with no file drops the empty location prefix', () => {
  assert.match(koIssueLine('✗ DESIGN-NEWSLETTER-CQ: gone'), /^• 뉴스레터/);
});

test('a clean audit run digests to nothing at all', () => {
  const clean = ['  ✓ crowd chart: busy=red, mid=beige', '  ✓ icon plate: .plan-ico', '', '✅ All design-uniformity checks passed'].join('\n');
  assert.equal(koDigest(clean), '');
});

test('a failing run still counts and shows its findings', () => {
  const dirty = [
    '  ✓ icon plate: .plan-ico',
    '  ✗ DESIGN-REGION-TILE: region tiles without a photo: 3 (Nantou, Taitung, Pasay City)',
    '  ✗ DESIGN-COLOR-SCHEME: color-scheme: dark missing from system-dark path',
    '',
    '❌ 2 uniformity check(s) failed',
  ].join('\n');
  const out = koDigest(dirty);
  assert.match(out, /문제 2건/); // the tally line is the run's own count, not a third finding
  assert.match(out, /검은 상자/);
  assert.match(out, /다크 모드/);
});

test('a validator closing tally is chrome, not a second finding', () => {
  const stdout = [
    'REGION-OUTLIER: koh-phi-phi-x.md — 36.4 km from the centre; address names Krabi',
    '',
    '1 post(s) whose region does not match their address or coordinates.',
  ].join('\n');
  const digest = koDigest(stdout);
  assert.match(digest, /^문제 1건/);
  assert.ok(!digest.includes('대상 미상'), digest);
});

// 2026-09-08: the tense audit prints two parenthesised asides after its count
// line. Neither names a file, neither is a finding, and both are English — so
// they reached the owner as two "점검 항목 — 실행 로그 확인 필요" lines above the
// two real ones. Context in parentheses is chrome, exactly like a tally.
test('a parenthesised aside is chrome, not a finding', () => {
  const stdout = [
    '64 finished, published event(s); 2 translation(s) still read as upcoming',
    '(13 finished event(s) are quarantined drafts — not published, not counted)',
    '(4 more say "before the show", which is not a tense error — not counted)',
    'ENDED-EVENT-I18N-TENSE: ko/barcelona-the-weeknd — ended 2026-09-01, still says "진행됩니다"',
    'ENDED-EVENT-I18N-TENSE: ko/bhubaneswar-meet — ended 2026-08-22, still says "진행됩니다"',
  ].join('\n');
  const digest = koDigest(stdout);
  assert.match(digest, /^문제 2건/, digest);
  assert.ok(!digest.includes('실행 로그 확인 필요') && !digest.includes('대상 미상'), digest);
});

test('a parenthesised line that names a file is still a finding', () => {
  const digest = koDigest('(see broken-post.md — the hero is missing)');
  assert.match(digest, /문제 1건/, digest);
});

// 09-25: 번역 검사 줄이 "점검 항목 — 파일"로만 나갔다. 사유가 한국어로 보여야 한다.
test('번역 검사 사유가 한국어로 나온다', () => {
  assert.equal(koIssueLine('• posts/zh/austin-texas-farmers-market-at-mueller.md: broken-bold'),
    '• zh 번역 · austin-texas-farmers-market-at-mueller — 굵게 표시(**)가 깨져 별표가 그대로 보임');
  assert.match(koIssueLine('• essentials/ko/japan.md: broken-syllable, translator-chatter'), /한글 글자가 깨져.*번역기의 잡담/);
  assert.doesNotMatch(koIssueLine('• posts/es/x.md: cjk-leak'), /점검 항목/);
});

test('대문자 사유가 섞여도 번역 검사 줄을 알아본다 (코덱스 09-26)', () => {
  const out = koIssueLine('• posts/zh/a.md: broken-bold, MISSING-SRCHASH');
  assert.match(out, /굵게 표시.*번역 점검 필요 \(MISSING-SRCHASH\)/);
});

// 2026-10-05: 61 unreviewed event heroes reached the owner as "문제 248건", most
// lines "대상 미상" — every detail line and the closing advice were counted —
// and audit-rating-floor's clean ⭐ headline read as one problem.
test('detail lines (↳), ⭐ headlines and "(es)" tallies are not findings', async () => {
  const { koDigest } = await import('./issue-ko.mjs');
  const out = [
    '132 event hero(es) whose filename barely names the event; 2 of them unreviewed',
    'EVENT-HERO-IDENTITY: abu-dhabi-tarkan-live-in-abu-dhabi.md — photo: Tarkan_en_concert.JPG',
    '    ↳ post : TARKAN Live in Abu Dhabi',
    '    ↳ shared word(s): tarkan',
    'EVENT-HERO-IDENTITY: adana-world-rak-festival.md — photo: Adana_Raki_Festival2.jpg',
    '    ↳ post : World Raki Festival',
    '↳ A person has to read these: does the FILENAME describe this event, this artist?',
  ].join('\n');
  const d = koDigest(out);
  assert.match(d, /^문제 2건/);
  assert.match(d, /abu-dhabi-tarkan-live-in-abu-dhabi\.md/);
  assert.doesNotMatch(d, /대상 미상/);
  assert.equal(koDigest('⭐ 평점 기준선 감사 — 1974편 검사\n✓ 기준선 아래 공개글 없음.'), '');
});
