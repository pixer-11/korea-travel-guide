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
