import test from 'node:test';
import assert from 'node:assert/strict';
import { fixPunctuation } from './fix-cjk-punctuation.mjs';

const fix = (s, marks) => fixPunctuation(s, marks).text;

// ── what must be converted ─────────────────────────────────────────────────
// Verbatim from live Chinese pages on 2026-08-16, when 506 of 1,007 carried
// half-width marks inside Han prose — the mechanical half of the 8%
// translationese score the naturalness judge was reporting for zh.
test('a comma between two Han characters becomes full-width', () => {
  assert.equal(fix('不要以为好东西都在水边,不妨沿河走走'), '不要以为好东西都在水边，不妨沿河走走');
});

test('a run of commas converts every one, not every other one', () => {
  // The lookahead exists for this: consuming the right-hand character would
  // leave 乙,丙 unmatched because 乙 was already eaten by the previous match.
  assert.equal(fix('甲,乙,丙,丁'), '甲，乙，丙，丁');
});

test('semicolon and colon in body prose convert too', () => {
  assert.equal(fix('午后时段最佳;正午几乎没有遮阴'), '午后时段最佳；正午几乎没有遮阴');
  assert.equal(fix('最大魅力在于双重身份:一半是艺术画廊'), '最大魅力在于双重身份：一半是艺术画廊');
});

test('a space after the mark is absorbed', () => {
  assert.equal(fix('这里少有遮蔽, 湿度也很高'), '这里少有遮蔽，湿度也很高');
});

// ── what must NOT be touched (the boundary that keeps this safe) ───────────
// Every case below has no Han character on the LEFT of the mark, which is the
// whole reason the narrow rule is safe to run across 1,000 files unattended.
test('a thousands separator between digits is left alone', () => {
  assert.equal(fix('共2,109条评论'), '共2,109条评论');
});

test('Latin prose keeps its half-width comma', () => {
  assert.equal(fix('地址是 River Valley Road, Singapore 附近'), '地址是 River Valley Road, Singapore 附近');
});

test('a URL keeps its colon and slashes', () => {
  assert.equal(fix('详见 https://example.com/zh 页面'), '详见 https://example.com/zh 页面');
});

test('a decimal rating is untouched', () => {
  assert.equal(fix('评分4.7分,共100条'), '评分4.7分，共100条');
});

test('code spans are exempt', () => {
  assert.equal(fix('设置 `key:值,另一个` 如下'), '设置 `key:值,另一个` 如下');
});

// Korean sets half-width commas correctly, so hangul must never satisfy the
// left-hand side of the rule — ko files are not in this tool's scope at all,
// but the pattern itself has to refuse them or a future caller would corrupt ko.
test('hangul does not count as CJK for this rule', () => {
  assert.equal(fix('한국어,다음'), '한국어,다음');
});

// ── the frontmatter boundary ──────────────────────────────────────────────
// The colon in a Chinese title is the site's own "名前:旅行指南" separator,
// which eventName.mjs and topic-key.mjs both parse. Frontmatter is passed the
// comma-only mark list precisely so this cannot move.
test('frontmatter mark list converts the comma but leaves the title colon', () => {
  assert.equal(fix('3Fils 阿布扎比店:旅行指南,精选', [',']), '3Fils 阿布扎比店:旅行指南，精选');
});

test('the same string in body scope does convert the colon', () => {
  assert.equal(fix('双重身份:一半是画廊'), '双重身份：一半是画廊');
});

// ── idempotence ───────────────────────────────────────────────────────────
test('running twice changes nothing the second time', () => {
  const once = fixPunctuation('评分很高,值得一去;推荐');
  const twice = fixPunctuation(once.text);
  assert.equal(twice.count, 0);
  assert.equal(twice.text, once.text);
});

test('already-correct full-width prose is reported as zero changes', () => {
  assert.equal(fixPunctuation('评分很高，值得一去；推荐').count, 0);
});
