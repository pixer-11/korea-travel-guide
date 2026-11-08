// wikimediaThumb 회귀 테스트.
//
// 2026-08-10: LCP를 줄이려고 히어로를 1920px → 손으로 만든 1200px 주소로 바꿨다.
// 1200은 위키미디어가 **서비스하지 않는 폭**이라 전 사이트의 대표 사진이 동시에
// 400을 받고 빈 네모가 됐다(본문 사진은 저장된 주소를 그대로 써서 멀쩡 —
// 픽서님이 "상단에 있는 사진만 깨진다"고 지목한 그 차이).
// 그래서 이 테스트의 핵심은 "폭을 바꾸는가"가 아니라 **"사다리에 없는 폭을
// 절대 만들지 않는가"** 다.
//   node scripts/../src/lib/wikimediaThumb.test.mjs
import { readFileSync } from 'node:fs';
import { wikimediaThumb, legalWidth, articlePhoto, WIKIMEDIA_WIDTHS } from './wikimediaThumb.mjs';

const W = (n) => `https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Foo.jpg/${n}px-Foo.jpg`;

const cases = [
  ['1920 저장본을 1280으로', wikimediaThumb(W(1920), 1280), W(1280)],
  ['1920 저장본을 500으로', wikimediaThumb(W(1920), 500), W(500)],
  // 요청 폭이 사다리에 없으면 위로 올림 — 1200 요청은 1280이 되어야 한다(그대로 두면 400).
  ['사다리에 없는 1200 요청 → 1280', wikimediaThumb(W(1920), 1200), W(1280)],
  ['사다리에 없는 480 요청 → 500', wikimediaThumb(W(1920), 480), W(500)],
  // 업스케일 금지: 저장본보다 큰 폭을 달라고 하면 원본 주소 그대로(요청하면 400).
  ['저장본보다 큰 요청은 그대로', wikimediaThumb(W(960), 1920), W(960)],
  ['같은 폭 요청은 그대로', wikimediaThumb(W(1280), 1280), W(1280)],
  // 위키미디어가 아닌 주소는 손대지 않는다.
  ['4sqi 주소는 무변경', wikimediaThumb('https://fastly.4sqi.net/img/general/original/abc.jpg', 500),
    'https://fastly.4sqi.net/img/general/original/abc.jpg'],
  ['R2 미러 주소는 무변경', wikimediaThumb('https://wanderatlasguides.com/og/abc.jpg', 500),
    'https://wanderatlasguides.com/og/abc.jpg'],
  ['thumb 구간 없는 원본은 무변경', wikimediaThumb('https://upload.wikimedia.org/wikipedia/commons/4/4a/Foo.jpg', 500),
    'https://upload.wikimedia.org/wikipedia/commons/4/4a/Foo.jpg'],
  ['빈 값도 안전', wikimediaThumb(null, 500), ''],
];

let fail = 0;
for (const [name, got, want] of cases) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${got}\n      want: ${want}`}`);
  if (!ok) fail++;
}

// 진짜 불변식: 어떤 요청 폭을 넣어도 결과 URL의 px 값은 반드시 사다리 위에 있어야 한다.
for (let want = 10; want <= 4000; want += 7) {
  const out = wikimediaThumb(W(3840), want);
  const w = Number(out.match(/\/(\d{2,4})px-/)[1]);
  if (!WIKIMEDIA_WIDTHS.includes(w)) {
    console.log(`FAIL  요청 ${want}px → 사다리에 없는 ${w}px 생성`);
    fail++;
    break;
  }
}
console.log(`PASS  0~4000px 어떤 요청도 사다리 밖 폭을 만들지 않음`);

// legalWidth 자체
const lw = [[1, 20], [1200, 1280], [1920, 1920], [2000, 3840], [99999, 3840]];
for (const [want, expect] of lw) {
  const ok = legalWidth(want) === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  legalWidth(${want}) = ${expect}`);
  if (!ok) fail++;
}

// 본문 사진(2026-11-08): 3840px·2MB 저장본이 폰의 342px 칸에 그대로 내려왔다.
const FSQ = 'https://fastly.4sqi.net/img/general/original/abc.jpg';
const photoCases = [
  ['3840 저장본은 1280으로', articlePhoto(W(3840)), W(1280)],
  ['1920 저장본도 1280으로', articlePhoto(W(1920)), W(1280)],
  // 작은 저장본을 키우면 400 — 그대로 둔다.
  ['960 저장본은 그대로', articlePhoto(W(960)), W(960)],
  ['포스퀘어 원본은 width1200으로', articlePhoto(FSQ), 'https://fastly.4sqi.net/img/general/width1200/abc.jpg'],
  ['이미 작은 포스퀘어는 그대로', articlePhoto('https://fastly.4sqi.net/img/general/width960/abc.jpg'),
    'https://fastly.4sqi.net/img/general/width960/abc.jpg'],
  ['자체 사진은 그대로', articlePhoto('https://wanderatlasguides.com/og/abc.webp'), 'https://wanderatlasguides.com/og/abc.webp'],
  ['thumb 구간 없는 위키미디어 원본은 그대로', articlePhoto('https://upload.wikimedia.org/wikipedia/commons/4/4a/Foo.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/4/4a/Foo.jpg'],
  ['빈 값도 안전', articlePhoto(undefined), ''],
];
for (const [name, got, want] of photoCases) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${got}\n      want: ${want}`}`);
  if (!ok) fail++;
}

// 템플릿 불변식: 갤러리 두 곳이 다시 저장 주소를 직접 쓰거나, 폴백을 잃으면 잡는다.
const tpl = readFileSync(new URL('../components/PostArticle.astro', import.meta.url), 'utf8');
const count = (needle) => tpl.split(needle).length - 1;

// 폴백의 실체는 data-stored 가 아니라 되돌아가는 onerror 다. 저장 주소 개수만 세면 onerror 가
// 사라져도 초록이다(2026-11-08 검토). 그래서 모든 주소가 죽었다고 치고 핸들러를 실제로 돌린다.
// src 세터의 정규화는 브라우저 그대로다: 저장 주소에 비ASCII 가 있으면 this.src 가 저장 주소와
// 영원히 달라, this.onerror=null 이 없으면 같은 주소를 끝없이 다시 요청한다.
function urlsTried(tag, first, dataset) {
  const code = tag.match(/\sonerror="([^"]*)"/)?.[1];
  const tried = [first];
  if (!code) return tried;
  let current = first;
  let failures = 1;
  const img = {
    dataset,
    onerror: 'armed',
    get src() { return current; },
    set src(url) { current = encodeURI(url); tried.push(url); failures++; },
    // 허브 대표 사진은 주소가 다 죽으면 자기 자리를 치운다.
    closest: () => ({ classList: { remove() {} } }),
    remove() {},
  };
  const handler = new Function(code);
  for (let guard = 0; failures > 0 && img.onerror !== null && guard < 8; guard++) {
    failures--;
    handler.call(img);
  }
  return tried;
}
const imgTags = (src) => [...src.matchAll(/<img\b[^>]*?\/>/g)].map((m) => m[0]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const STORED = W(3840);
const STORED_NON_ASCII = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Köln.jpg/3840px-Köln.jpg';
const gallery = imgTags(tpl).filter((t) => t.includes('data-stored={img.url}'));
// 2026-08-10 에 실제로 빈칸이 된 자리. 글·지역·나라 허브의 대표 사진이 같은 불변식을 쓴다.
const heroes = ['PostArticle', 'RegionHub', 'DestinationHub']
  .map((c) => imgTags(readFileSync(new URL(`../components/${c}.astro`, import.meta.url), 'utf8')).filter((t) => t.includes('data-full=')));

const tplChecks = [
  ['갤러리가 저장 주소를 그대로 쓰지 않는다', count('src={img.url}') === 0],
  ['갤러리 두 곳 모두 articlePhoto 를 거친다', count('src={articlePhoto(img.url)}') === 2],
  ['갤러리 두 곳 모두 저장 주소를 폴백으로 든다', count('data-stored={img.url}') === 2],
  ['갤러리 img 태그 두 개를 찾았다', gallery.length === 2],
  ['갤러리 사진이 실패하면 저장 주소로 되돌아간다', gallery.every((t) => same(urlsTried(t, W(1280), { stored: STORED }), [W(1280), STORED]))],
  ['저장 주소까지 죽어도 되돌림은 한 번뿐이다', gallery.every((t) => same(urlsTried(t, W(1280), { stored: STORED_NON_ASCII }), [W(1280), STORED_NON_ASCII]))],
  ['저장 주소를 그대로 쓴 사진은 같은 주소를 다시 요청하지 않는다', gallery.every((t) => same(urlsTried(t, STORED, { stored: STORED }), [STORED]))],
  ['대표 사진 세 곳을 찾았다', heroes.length === 3 && heroes.every((h) => h.length === 1)],
  // 앞의 세 단계만 본다: 세 주소가 전부 죽은 뒤 두 저장 주소를 왕복하는 것은 별건이다(2026-11-08 보고).
  ['대표 사진은 표시 폭 → data-full → data-stored 순으로 물러선다', heroes.every(([t]) => same(urlsTried(t, W(960), { full: W(1280), stored: STORED }).slice(0, 3), [W(960), W(1280), STORED]))],
  ['대표 사진의 저장 주소가 하나면 거기서 멈춘다', heroes.every(([t]) => same(urlsTried(t, W(960), { full: STORED, stored: STORED }), [W(960), STORED]))],
  // 위키미디어는 라이트박스가 1920으로 올려 주지만, 포스퀘어는 올릴 단이 없어 저장 원본을 쓴다.
  ['라이트박스가 포스퀘어를 저장 원본으로 확대한다', /4sqi\\?\.net.*dataset\.stored/.test(tpl)],
];
for (const [name, ok] of tplChecks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fail++;
}

process.exit(fail ? 1 : 0);
