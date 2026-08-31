# SEO 균일성·배관 수리 실행 계획 (08-31 코덱스 감사 후속)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 08-31 코덱스 SEO 배관 감사에서 **저장소 원본으로 재현 확인된** 결함 7건을 고친다 — 중복 AI 고지, 이벤트 허브 메타 중복, Event 스키마의 장소 소실, 거짓 `lastmod`, 잘못 배치된 Dataset, 그리고 승인이 필요한 얇은 페이지 정책 2건.

**Architecture:** 부류를 고치는 3단 구조를 매 작업에 적용한다 — ①생성원(스크립트/컴포넌트)을 고치고 ②기존 코퍼스를 쓸어내고 ③재발을 막는 회귀 테스트를 같은 커밋에 넣는다. 렌더 로직은 `.astro`에서 순수 함수로 뽑아 `src/lib/*.mjs` 에 두고 옆에 `*.test.mjs` 를 붙인다(저장소 기존 관례, 현재 24개).

**Tech Stack:** Astro 정적 빌드 · Node `node --test` · `js-yaml` · 5개 언어 i18n(`src/i18n/ui.ts`)

**Spec:**
- `docs/superpowers/plans/2026-08-31-codex-seo-audit-raw.md` — 코덱스 감사 원문(미검증 지적 포함. **원문을 근거로 삼지 말 것** — 아래 요약이 재현 확인을 통과한 부분이다)
- 메모리 `wander-atlas-traffic-collapse.md` §"🔬 08-31 코덱스 SEO 배관 감사" — 저장소 원본으로 재현 확인된 판정만
- `docs/superpowers/plans/2026-08-31-thin-inventory.json` — Task 6이 근거로 쓰는 얇은 페이지 전수 실사(2026-08-31 기준. 발행이 이어지면 흐려지니 착수 시 재측정)

---

## Global Constraints

- **저장소**: `C:/Users/user/wa-main`, 브랜치 `main`. 다른 세션과 공유하는 워크트리다 — **선별 스테이징**(`git add <파일명>`, `git add -A` 금지), 작업 끝나는 대로 조기 커밋.
- **5개 언어**: `en`/`ko`/`ja`/`es`/`zh`. 사용자에게 보이는 문자열은 반드시 `src/i18n/ui.ts` 의 5개 블록 전부에 추가한다. 한 언어만 넣으면 i18n 영어 누출이 된다.
- **frontmatter를 절대 YAML 라운드트립하지 말 것.** `yaml.load` → `yaml.dump` 로 다시 쓰면 `srcHash` 가 숫자로 바뀌고 날짜가 2001년이 된다(전례 있음). 본문만 문자열로 교체하고, frontmatter는 정규식으로 **해당 한 줄만** 바꾼다.
- **본문을 고치면 번역 4개가 재큐된다.** `srcHash` 는 title/description/quickAnswer/faq/body의 sha1이다(`scripts/lib/src-hash.mjs`). 영어만 고치면 번역 5,300여 편이 전부 stale이 되어 모델을 다시 태운다. **영어와 번역 4개를 같은 패스에서 고치고, 각 번역의 `srcHash` 를 새 영어 해시로 재스탬프**한다. 표준 선례: `scripts/reflow-paragraphs.mjs` (재큐 0건 달성). 해시는 반드시 `srcHashOfPostFile()` 을 써서 계산한다 — 직접 조립하면 값이 미묘하게 달라져 재스탬프가 무효가 된다(`resync-rating-badges` 전례).
- **대량 본문 스크립트에는 `--dry-run` 과 보존 검사가 필수.** 지운 바이트 수 = 지우려던 문자열 길이인지 파일마다 확인하고, 어긋나면 그 파일은 건너뛴다. 전부-아니면-전무 금지(일부만 성공해도 커밋 가능해야 한다).
- **테스트**: `node --test`. 테스트 파일은 대상 옆에 `*.test.mjs`, `node:test` + `assert/strict`. 전체 통과 기준선은 **748개**(2026-08-31). 커밋 전 `npm test`, 배포 전 `npm run ci`.
- **CRLF**: 이 체크아웃은 Windows다. 줄 끝 매칭은 `\r?\n` 으로 하고, 정규식이 `\r` 을 삼켜 LF 하나만 남기지 않게 한다(혼합 줄바꿈 → 전체 줄 diff).
- **의도적으로 해둔 것을 결함으로 고치지 말 것**: ①Event JSON-LD `name` 이 전 언어에서 영어 제목인 것(`src/lib/eventName.mjs` 가 일부러 그렇게 함) ②`dist/sitemap-0.xml` 이 인덱스에서 빠진 채 남아 있는 것(Bing 직접 제출 URL, 지우면 404).
- **보고·알림은 한국어, 시각은 KST.**

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/content/posts/bukhara-bolo-hauz-mosque.md` | 본문 첫 줄의 프롬프트 서문 제거 | 수정 (Task 0) |
| `scripts/validate-content.mjs` | `PROMPT-LEAK` 게이트 규칙 | 수정 (Task 0) |
| `scripts/lib/body-disclosure.mjs` | 본문 첫 줄의 AI 고지 blockquote를 언어 무관하게 인식·제거하는 순수 함수 | 신규 (Task 1) |
| `scripts/lib/body-disclosure.test.mjs` | 위 함수의 5개 언어 + 오탐 방지 테스트 | 신규 (Task 1) |
| `scripts/strip-body-disclosure.mjs` | 883편 × 5언어 일괄 제거 + srcHash 재스탬프 CLI | 신규 (Task 1) |
| `scripts/generate.mjs:1367-1380` | 신규 글에 고지를 더 이상 넣지 않음 | 수정 (Task 1) |
| `scripts/regenerate-content.mjs:63-69` | 죽은 `disclosureFor()` 제거 | 수정 (Task 1) |
| `scripts/validate-content.mjs` | `DOUBLE-DISCLOSURE` 게이트 규칙 | 수정 (Task 1) |
| `src/lib/eventsHubMeta.mjs` (+test) | 이벤트 국가 허브의 description 문자열 | 신규 (Task 2) |
| `src/components/EventsCountryHub.astro:92-95` | 위 함수 사용 | 수정 (Task 2) |
| `src/lib/eventLocation.mjs` (+test) | Event JSON-LD `location` 을 저장된 `eventVenue` 로 | 신규 (Task 3) |
| `src/components/PostArticle.astro:459-463` | 위 함수 사용 | 수정 (Task 3) |
| `src/lib/hub-lastmod.mjs` (+test) | 어떤 허브가 어떤 글로 갱신되는지의 규칙 | 신규 (Task 4) |
| `astro.config.mjs:90-135` | 위 함수 사용 | 수정 (Task 4) |
| `src/components/WhenToGoPage.astro:72-97` | Dataset 제거 | 수정 (Task 5) |
| `src/components/WhenToGoCountry.astro:65` | Dataset 추가 | 수정 (Task 5) |

---

## 착수 전 30초 점검 (매 세션 첫 행동)

```bash
cd C:/Users/user/wa-main && git pull --ff-only && git status --porcelain && npm test 2>&1 | tail -5
```

기준선: 워크트리 깨끗, 테스트 **748 pass / 0 fail**. 여기서 어긋나면 그 원인부터 처리하고 이 계획을 시작한다.

---

### Task 0: 라이브 페이지 하나가 LLM 프롬프트 서문을 그대로 싣고 있다 — 먼저 고친다

**왜:** 이 계획을 검증하다 찾았다. `src/content/posts/bukhara-bolo-hauz-mosque.md` 의 본문 **첫 줄**이 이렇다:

```
Below is the markdown body of a published travel guide, "Bolo Hauz Mosque: Bukhara Travel Guide (4.8★)".
```

`draft: false` 이고 **빌드 산출물에도 그대로 들어 있다**(`dist/posts/bukhara-bolo-hauz-mosque/index.html` 에서 1건 확인). 모델에게 준 지시문이 독자에게 나가고 있다. 부류 점검 결과 **이 한 편뿐**이다(영어 1,486편에서 유사 서문 패턴 전수 검색, 다른 한 건은 정상 문장 "Here's the twist: …"). 번역 4편에는 없다.

이걸 Task 1보다 먼저 하는 이유: 이 서문 때문에 고지 blockquote가 본문 첫 줄이 아니게 되어 **Task 1의 스윕이 이 파일만 건너뛴다**(실측 882/883). 서문을 지우면 883이 되어 스윕 숫자가 딱 떨어진다.

**Files:**
- Modify: `src/content/posts/bukhara-bolo-hauz-mosque.md` (본문 첫 줄 + 뒤 빈 줄 삭제)
- Modify: `scripts/validate-content.mjs` (재발 게이트)
- Modify: `scripts/validate-content.test.mjs`

- [ ] **Step 1: 게이트를 먼저 쓴다 (지금은 실패해야 정상)**

`scripts/validate-content.mjs` 상단 상수 근처에 추가:

```js
// Scaffolding the model was given, shipped to the reader. bukhara-bolo-hauz-
// mosque opened with "Below is the markdown body of a published travel guide,
// …" on the live page until 2026-09. One post today; the class costs nothing
// to watch, and a silent one is exactly how this one survived.
const PROMPT_LEAK = /^(?:Below is|Here is|Here's) the (?:markdown |full |complete )?(?:body|article|guide|text)\b|^(?:Sure|Certainly)[,!]\s|^As an AI\b/i;
```

`postProblems` 안, `STUB-BODY` 계열 검사 근처에 추가:

```js
  if (p.body && PROMPT_LEAK.test(p.body.trimStart())) {
    issues.push(`PROMPT-LEAK: ${p.f} — body opens with model scaffolding ("${p.body.trimStart().slice(0, 60)}…")`);
  }
```

- [ ] **Step 2: 양방향 테스트를 붙인다**

`scripts/validate-content.test.mjs` 는 `node:test` 가 아니라 **자체 러너**를 쓴다(`cases` 배열 + `clean()`/`flags()` 헬퍼, 끝에서 `process.exit`). 그 관례에 맞춰 `// ── 장소 데이터` 블록 앞에 추가:

```js
// ── 프롬프트 서문 유출 (bukhara-bolo-hauz-mosque, 2026-08-31 발견) ──
flags('model scaffolding as the first line', 'PROMPT-LEAK', {
  body: 'Below is the markdown body of a published travel guide, "X".\n\nThe lanes are quiet.',
});
flags('assistant preamble as the first line', 'PROMPT-LEAK', { body: 'Sure, here you go.\n\nThe lanes are quiet.' });
clean('a sentence that merely starts with "Below" is not a leak', {
  body: 'Below the mosque, a stepped tank holds the reflection that gives it its name.',
});
clean('"Here is" mid-paragraph is not a leak', {
  body: 'The lanes are residential. Here is where most visitors turn back.',
});
```

- [ ] **Step 3: 게이트가 진짜 걸리는지 확인한다**

```bash
cd C:/Users/user/wa-main && node scripts/validate-content.test.mjs 2>&1 | tail -8 && node scripts/validate-content.mjs 2>&1 | grep PROMPT-LEAK
```

Expected: 테스트 전부 PASS, 그리고 코퍼스 검사에서 `PROMPT-LEAK: bukhara-bolo-hauz-mosque.md` **1건**. 0건이면 정규식이 실제 문장을 못 잡은 것이고, 2건 이상이면 오탐이니 그 파일들을 눈으로 본다.

- [ ] **Step 4: 그 한 편을 고친다**

`src/content/posts/bukhara-bolo-hauz-mosque.md` 에서 본문 첫 줄과 뒤따르는 빈 줄만 지운다. frontmatter는 건드리지 않는다. 본문이 `> **How this guide was made:**` 로 시작하게 되면 성공.

```bash
cd C:/Users/user/wa-main && node -e "
const fs=require('fs');const f='src/content/posts/bukhara-bolo-hauz-mosque.md';
const raw=fs.readFileSync(f,'utf8');
const m=raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)\$/);
const out=m[2].replace(/^Below is the markdown body[^\r\n]*(\r?\n){1,2}/,'');
if(out===m[2]){console.error('첫 줄을 못 찾았다 — 손으로 확인할 것');process.exit(1);}
fs.writeFileSync(f,m[1]+out);console.log('제거 완료');
"
```

> 이 글은 번역 4개가 없다(확인함). 따라서 srcHash 재스탬프 대상이 아니다. 다음 번역 패스에서 정상 본문으로 번역된다.

- [ ] **Step 5: 검증하고 커밋**

```bash
cd C:/Users/user/wa-main && node scripts/validate-content.mjs 2>&1 | grep -c PROMPT-LEAK; npm test 2>&1 | tail -3
git add src/content/posts/bukhara-bolo-hauz-mosque.md scripts/validate-content.mjs scripts/validate-content.test.mjs
git commit -m "fix: a live guide opened with the prompt we gave the model"
```

Expected: `PROMPT-LEAK` 0건, 테스트 전부 통과.

---

### Task 1: 중복 AI 고지 제거 — 생성원·코퍼스·게이트 3단

**왜:** 878편의 라이브 글이 같은 AI 고지를 **두 번** 싣는다. 본문 맨 위 blockquote(`agra-taj-mahal.md:73`)와 컴포넌트의 `<details>`(`src/components/PostArticle.astro:839`, 5개 언어 i18n)다. 컴포넌트 쪽이 모든 글에 붙고 번역도 되어 있으므로 **컴포넌트를 남기고 본문 쪽을 없앤다**. 생성기(`scripts/generate.mjs:1370`)가 아직도 이걸 넣고 있으므로 코퍼스만 쓸면 다음 발행에 되살아난다.

**실측(2026-08-31):** 영어 `src/content/posts/*.md` 883편(라이브 878 + 초안 5), `src/content/i18n/{ko,ja,es,zh}/*.md` 각 883편. 영어는 **변형 1종뿐**(uniq 결과 883/883 동일 문자열).

**Files:**
- Create: `scripts/lib/body-disclosure.mjs`
- Test: `scripts/lib/body-disclosure.test.mjs`
- Create: `scripts/strip-body-disclosure.mjs`
- Modify: `scripts/generate.mjs:1367-1380`
- Modify: `scripts/regenerate-content.mjs:63-69`
- Modify: `scripts/validate-content.mjs` (규칙 추가)

**Interfaces:**
- Produces: `stripBodyDisclosure(body: string) → { body: string, removed: string | null }` — 본문 맨 앞의 고지 blockquote(와 뒤따르는 빈 줄)를 떼어낸다. 없으면 `body` 를 **바이트 동일하게** 돌려주고 `removed: null`.
- Produces: `hasBodyDisclosure(body: string) → boolean`
- Consumes(Task 1 내부): `srcHashOfPostFile` from `scripts/lib/src-hash.mjs`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`scripts/lib/body-disclosure.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripBodyDisclosure, hasBodyDisclosure } from './body-disclosure.mjs';

const EN = '> **How this guide was made:** Editor-reviewed, AI-assisted. Facts are pulled from live Google Places data; images are licensed or public domain. See our [editorial policy](/about).';
const KO = '> **이 가이드는 이렇게 만들어졌습니다:** 에디터 검수를 거쳤으며 AI의 도움을 받아 작성했습니다. 자세한 내용은 [편집 정책](/about)을 참고하세요.';
const JA = '> **このガイドについて：** 編集者によるレビューとAIによる補助を経て作成されています。詳しくは[編集方針](/about)をご覧ください。';
const ES = '> **Cómo se hizo esta guía:** revisada por un editor y con asistencia de IA. Consulte nuestra [política editorial](/about).';
const ZH = '> **本指南制作说明：** 经编辑审核，并借助人工智能辅助完成。详见我们的[编辑政策](/about)。';

for (const [lang, line] of [['en', EN], ['ko', KO], ['ja', JA], ['es', ES], ['zh', ZH]]) {
  test(`removes the ${lang} disclosure and leaves the rest byte-identical`, () => {
    const rest = '## First sight of the dome\n\nThe marble reads warm at dawn.\n';
    const out = stripBodyDisclosure(`${line}\n\n${rest}`);
    assert.equal(out.body, rest);
    assert.equal(out.removed, line);
  });
}

test('the real corpus shape: body starts with a blank line, which is preserved', () => {
  // Measured 2026-08-31: every translation and 601 of 883 English bodies begin
  // with a CRLF before the disclosure. An implementation anchored at index 0
  // matches 282 files and silently misses 601 — this test is why.
  const out = stripBodyDisclosure(`\r\n${EN}\r\n\r\n## Why go\r\n\r\nText.\r\n`);
  assert.equal(out.body, '\r\n## Why go\r\n\r\nText.\r\n');
  assert.equal(out.removed, EN);
});

test('a body without a disclosure comes back byte-identical', () => {
  const body = '## Why go\n\nA quiet courtyard behind the market.\n';
  const out = stripBodyDisclosure(body);
  assert.equal(out.body, body);
  assert.equal(out.removed, null);
});

test('leaves a blockquote that is not the disclosure alone', () => {
  // A pull-quote must survive: the rule is "first line, blockquote, links /about".
  const body = '> The queue moves faster than it looks.\n\n## Why go\n\nText.\n';
  assert.equal(stripBodyDisclosure(body).body, body);
});

test('leaves an /about link that is not a leading blockquote alone', () => {
  const body = '## Why go\n\nSee our [editorial policy](/about) for how we work.\n';
  assert.equal(stripBodyDisclosure(body).body, body);
});

test('survives CRLF without leaving a stray carriage return', () => {
  const out = stripBodyDisclosure(`${EN}\r\n\r\n## Why go\r\n\r\nText.\r\n`);
  assert.equal(out.body, '## Why go\r\n\r\nText.\r\n');
});

test('hasBodyDisclosure agrees with stripBodyDisclosure', () => {
  assert.equal(hasBodyDisclosure(`${KO}\n\n## 왜 가야 할까\n`), true);
  assert.equal(hasBodyDisclosure('## 왜 가야 할까\n'), false);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test scripts/lib/body-disclosure.test.mjs
```

Expected: FAIL — `Cannot find module './body-disclosure.mjs'`

- [ ] **Step 3: 최소 구현을 쓴다**

`scripts/lib/body-disclosure.mjs`:

```js
// The in-body AI disclosure blockquote that generate.mjs prepended to every
// guide until 2026-09. PostArticle.astro already renders the same disclosure
// as a localized <details> on EVERY post, so 878 live pages said it twice —
// the 08-31 SEO audit's cheapest finding. This removes the body copy only.
//
// Language-agnostic by SHAPE, not by wording: the disclosure is the first
// CONTENT line of the body, it is a blockquote, and it links to /about. A
// pull-quote (no /about link) and an /about link in prose (not a leading
// blockquote) both have to survive, which is what the tests pin down.
//
// Two things this got wrong on the first attempt, both caught by running it
// against the corpus rather than by reading it:
//   1. Bodies begin with a blank line — every translation and 601 of 883
//      English files. Anchoring at index 0 matched 282 and missed 601.
//   2. [^\n]* swallows the \r of a CRLF file, so the slice left a lone \n
//      behind and the file ended up with mixed line endings. Use [^\r\n]*.
const DISCLOSURE_LINE = /^>[ \t]*\*\*[^\r\n]*\]\(\/about\)[^\r\n]*/;
const LEADING_BLANKS = /^(?:[ \t]*\r?\n)*/;

/** @param {string} body @returns {{ body: string, removed: string | null }} */
export function stripBodyDisclosure(body) {
  const s = String(body);
  const lead = s.match(LEADING_BLANKS)[0];
  const rest = s.slice(lead.length);
  const m = rest.match(DISCLOSURE_LINE);
  if (!m) return { body: s, removed: null };
  // Drop the line, then at most one blank line after it — never more, so a
  // deliberate gap in the prose below is preserved. The leading blank line the
  // body already had stays, so a stripped file looks like a never-stamped one.
  const after = rest.slice(m[0].length).replace(/^(?:[ \t]*\r?\n){1,2}/, '');
  return { body: lead + after, removed: m[0] };
}

/** @param {string} body */
export function hasBodyDisclosure(body) {
  const s = String(body);
  return DISCLOSURE_LINE.test(s.slice(s.match(LEADING_BLANKS)[0].length));
}
```

> 이 구현은 **실제 코퍼스로 이미 검증했다**(2026-08-31): 영어 882/883 적중(나머지 1편은 Task 0이 고치는 bukhara), 번역 4개 언어 각 883 적중, 보존검사 위반 0, 잔여 `\r` 0. 풀쿼트·산문 속 `/about` 링크·깨끗한 본문 모두 무변경.

- [ ] **Step 4: 통과를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test scripts/lib/body-disclosure.test.mjs
```

Expected: PASS (11 tests)

- [ ] **Step 5: 생성원 두 곳을 막는다**

`scripts/generate.mjs` — 1367~1370행의 `src`/`disclosure` 선언을 지우고, 1380행의 조립에서 `${disclosure}` 를 뺀다:

```js
// before
  const src = place
    ? 'Facts are pulled from live Google Places data; images are licensed or public domain.'
    : 'Images are licensed or public domain. This is a general area/topic overview — verify specific venue details before visiting.';
  const disclosure = `> **How this guide was made:** Editor-reviewed, AI-assisted. ${src} See our [editorial policy](/about).\n\n`;
// …
  const markdown = `---\n${toYaml(fm)}---\n\n${disclosure}${escapeTildes(body)}\n`;

// after — the disclosure now lives ONLY in PostArticle.astro's localized
// <details>. Emitting it here too put it on the page twice (08-31 audit).
  const markdown = `---\n${toYaml(fm)}---\n\n${escapeTildes(body)}\n`;
```

`scripts/regenerate-content.mjs` — 63~69행의 `disclosureFor()` 는 **호출하는 곳이 없는 죽은 코드**다(확인함). 함수째 삭제한다.

- [ ] **Step 6: 생성기 회귀 테스트를 붙인다**

`scripts/generate.test.mjs` 끝에 추가:

```js
import { hasBodyDisclosure } from './lib/body-disclosure.mjs';
import { readFileSync } from 'node:fs';

test('generate.mjs no longer prepends the in-body AI disclosure', () => {
  // The localized <details> in PostArticle.astro is the single source. Two
  // copies on one page is what the 08-31 audit found on 878 live guides.
  const src = readFileSync(new URL('./generate.mjs', import.meta.url), 'utf8');
  assert.equal(/How this guide was made/.test(src), false);
});

test('hasBodyDisclosure still recognises the legacy line', () => {
  // Guards the sweep: if the detector ever stops matching, the corpus check
  // below goes quietly green on a corpus that still has 883 of them.
  assert.equal(hasBodyDisclosure('> **How this guide was made:** x [editorial policy](/about).\n'), true);
});
```

```bash
cd C:/Users/user/wa-main && node --test scripts/generate.test.mjs
```

Expected: PASS

- [ ] **Step 7: 여기서 커밋한다 (코퍼스 스윕 전에)**

```bash
cd C:/Users/user/wa-main
git add scripts/lib/body-disclosure.mjs scripts/lib/body-disclosure.test.mjs scripts/generate.mjs scripts/generate.test.mjs scripts/regenerate-content.mjs
git commit -m "fix: the AI disclosure was on every page twice — the generator stops adding it"
```

- [ ] **Step 8: 스윕 스크립트를 쓴다**

`scripts/strip-body-disclosure.mjs`:

```js
// Remove the in-body AI disclosure from the published corpus — all five
// languages in ONE pass.
//
//   node scripts/strip-body-disclosure.mjs --dry-run
//   node scripts/strip-body-disclosure.mjs
//   node scripts/strip-body-disclosure.mjs --only=agra-taj-mahal
//
// 883 English guides carry it; PostArticle.astro renders the same disclosure
// as a localized <details> on every post, so those pages say it twice.
//
// srcHash: the hash covers the body, so stripping English alone would mark
// every translation stale and re-queue ~5,300 files through the model. We
// strip the translations in the same pass and re-stamp their hash to the new
// English source — exactly the move reflow-paragraphs.mjs makes. Re-queued: 0.
//
// FRONTMATTER IS NEVER RE-SERIALISED. Only the body below the closing --- is
// rewritten, plus the single srcHash line.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripBodyDisclosure } from './lib/body-disclosure.mjs';
import { srcHashOfPostFile } from './lib/src-hash.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const I18N = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const LANGS = ['ko', 'ja', 'es', 'zh'];

const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;

/** Split into [frontmatterText, body] WITHOUT parsing the YAML. */
function halves(raw) {
  const m = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  return m ? [m[1], m[2]] : null;
}

const stats = { en: 0, tr: 0, skipped: 0, guarded: 0 };

for (const file of readdirSync(POSTS)) {
  if (!file.endsWith('.md')) continue;
  const slug = file.replace(/\.md$/, '');
  if (ONLY && slug !== ONLY) continue;

  const path = POSTS + file;
  const raw = readFileSync(path, 'utf8');
  const parts = halves(raw);
  if (!parts) { stats.skipped++; continue; }
  const [fm, body] = parts;

  const en = stripBodyDisclosure(body);
  if (!en.removed) continue;

  // Preservation guard: the ONLY thing that may disappear is the disclosure
  // line and the blank line after it. Anything else means the regex bit into
  // the prose — skip the file rather than shave an article.
  const shrank = body.length - en.body.length;
  if (shrank > en.removed.length + 4) {
    console.warn(`  ! ${slug}: would remove ${shrank} chars for a ${en.removed.length}-char line — skipped`);
    stats.guarded++;
    continue;
  }

  const newRaw = fm + en.body;
  if (!DRY) writeFileSync(path, newRaw);
  stats.en++;

  const freshHash = srcHashOfPostFile(newRaw);
  if (!freshHash) { console.warn(`  ! ${slug}: hash unreadable, translations left alone`); continue; }

  for (const lang of LANGS) {
    const tp = `${I18N}${lang}/${file}`;
    let traw;
    try { traw = readFileSync(tp, 'utf8'); } catch { continue; }
    const tparts = halves(traw);
    if (!tparts) continue;
    const [tfm, tbody] = tparts;

    const tr = stripBodyDisclosure(tbody);
    const tShrank = tbody.length - tr.body.length;
    if (tr.removed && tShrank > tr.removed.length + 4) {
      console.warn(`  ! ${lang}/${slug}: preservation guard tripped — skipped`);
      stats.guarded++;
      continue;
    }
    // Quoted, always: a 12-hex slice comes out all-digits about one time in
    // fifty, and YAML would hand Astro a number where the schema wants a string.
    const stamped = tfm.replace(
      /^(srcHash:)[ \t]*['"]?[0-9a-f]{6,}['"]?[ \t]*(?=\r?\n)/m,
      `$1 '${freshHash}'`,
    );
    if (!tr.removed && stamped === tfm) continue;
    if (!DRY) writeFileSync(tp, stamped + tr.body);
    stats.tr++;
  }
}

console.log(
  `${DRY ? '[dry-run] ' : ''}영어 ${stats.en}편 · 번역 ${stats.tr}편에서 중복 고지 제거` +
    (stats.guarded ? ` · 보존검사로 건너뜀 ${stats.guarded}` : '') +
    (stats.skipped ? ` · frontmatter 못 읽음 ${stats.skipped}` : ''),
);
```

- [ ] **Step 9: dry-run 으로 숫자를 확인한다**

```bash
cd C:/Users/user/wa-main && node scripts/strip-body-disclosure.mjs --dry-run
```

Expected: `[dry-run] 영어 883편 · 번역 3532편에서 중복 고지 제거` — 건너뜀 0.

**883 / 3,532 가 아니면 멈춘다.** 2026-08-31에 실측한 정확한 숫자다(번역 누락 0건도 확인). 적으면 정규식이 놓친 것이고, 많으면 다른 blockquote를 문 것이다. **882 가 나오면 Task 0을 안 한 것**이다 — bukhara 한 편이 프롬프트 서문 때문에 빠진다.

- [ ] **Step 10: 한 편만 실제로 고쳐 눈으로 본다**

```bash
cd C:/Users/user/wa-main && node scripts/strip-body-disclosure.mjs --only=agra-taj-mahal && git diff --stat && git diff src/content/i18n/ko/agra-taj-mahal.md
```

Expected: 영어 1편 + 번역 4편. ko diff에 **고지 한 줄 삭제 + `srcHash:` 한 줄 변경**만 보여야 한다. 다른 줄이 하나라도 바뀌었으면 `git checkout -- .` 하고 원인부터 찾는다.

- [ ] **Step 11: 전체를 실행하고 재큐가 0인지 확인한다**

```bash
cd C:/Users/user/wa-main && node scripts/strip-body-disclosure.mjs && node scripts/translate-posts.mjs --dry-run 2>&1 | tail -5
```

Expected: 번역 대기열 **0건**. 여기서 수천 건이 뜨면 srcHash 재스탬프가 실패한 것이다 — 커밋하지 말고 `srcHashOfPostFile` 호출부를 다시 본다(비용이 걸린 지점).

- [ ] **Step 12: 게이트를 붙인다 — 코퍼스가 다시 오염되지 않게**

`scripts/validate-content.mjs` 의 포스트별 규칙 함수(`SAME-PHOTO-TWICE` 규칙 바로 위, 대략 528행)에 추가:

```js
  // The AI disclosure is rendered once by PostArticle.astro as a localized
  // <details>. A copy in the body means the reader sees it twice — 878 live
  // guides shipped that way until the 2026-08-31 audit. Sweeping the corpus
  // without this gate just buys the same cleanup again in six weeks.
  if (p.body && hasBodyDisclosure(p.body)) {
    issues.push(`DOUBLE-DISCLOSURE: ${p.f} — the AI disclosure is in the body AND in the component`);
  }
```

파일 상단 import에 추가:

```js
import { hasBodyDisclosure } from './lib/body-disclosure.mjs';
```

- [ ] **Step 13: 게이트 회귀 테스트를 쓴다**

`scripts/validate-content.test.mjs` 는 `node:test` 가 아니라 **자체 러너**를 쓴다 — `cases` 배열에 `clean(name, over)` / `flags(name, tag, over)` 로 넣고, `base()` 가 건강한 글을 만들며 `run()` 이 `postProblems(base(over), {today})` 를 호출한다. 그 관례 그대로, Task 0에서 넣은 프롬프트 서문 블록 아래에 추가:

```js
// ── 중복 AI 고지 (컴포넌트가 이미 렌더한다, 2026-08-31 감사) ──
flags('disclosure repeated in the body', 'DOUBLE-DISCLOSURE', {
  body: '> **How this guide was made:** AI-assisted. See our [editorial policy](/about).\n\nThe lanes are quiet.',
});
flags('the Korean disclosure counts too', 'DOUBLE-DISCLOSURE', {
  body: '> **이 가이드는 이렇게 만들어졌습니다:** AI의 도움으로 작성했습니다. [편집 정책](/about)을 참고하세요.\n\n조용한 골목.',
});
clean('an /about link in prose is not a duplicate disclosure', {
  body: 'The lanes are residential. See our [editorial policy](/about) if you like.',
});
clean('a pull-quote is not a disclosure', { body: '> The queue moves faster than it looks.\n\nThe lanes are quiet.' });
```

- [ ] **Step 14: 양방향으로 검증한다**

```bash
cd C:/Users/user/wa-main && npm test 2>&1 | tail -5 && node scripts/validate-content.mjs 2>&1 | tail -20
```

Expected: 테스트 수가 **748보다 늘고 fail 0**. `validate-content` 는 `DOUBLE-DISCLOSURE` **0건**(스윕이 끝났으므로) — 막히는가(Step 13의 `flags`)와 정상까지 막진 않는가(`clean` + 코퍼스 0건)를 둘 다 본 것.

> `scripts/validate-content.test.mjs` 는 자체 러너라 `node --test` 에는 **파일 1개**로 잡힌다. 그 안의 케이스 수는 파일을 직접 실행해서 본다: `node scripts/validate-content.test.mjs | tail -1`

- [ ] **Step 15: 커밋**

```bash
cd C:/Users/user/wa-main
git add scripts/strip-body-disclosure.mjs scripts/validate-content.mjs scripts/validate-content.test.mjs src/content/posts src/content/i18n
git commit -m "fix: 878 guides said the same AI disclosure twice — swept, and the gate keeps it gone"
```

---

### Task 2: 이벤트 국가 허브의 title과 description이 글자 그대로 같다

**왜:** `src/components/EventsCountryHub.astro:92-95` 가 `title` 과 `description` 에 **같은 i18n 키**(`ev.upcomingIn`)를 넣는다. 17개 국가 허브 × 5언어 = 85페이지가 검색 결과에서 제목을 두 번 말한다. 쓸 수 있는 고유 문자열이 이미 i18n에 있다 — `ev.summaryCountry`("{n} upcoming events to plan a trip around.")와 `ev.noneCountry`.

**Files:**
- Create: `src/lib/eventsHubMeta.mjs`
- Test: `src/lib/eventsHubMeta.test.mjs`
- Modify: `src/components/EventsCountryHub.astro:92-95`

**Interfaces:**
- Produces: `eventsHubDescription({ t, countryLabel, upcomingCount }) → string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/eventsHubMeta.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsHubDescription } from './eventsHubMeta.mjs';

// Stand-in for useTranslations(lang): returns the raw en template.
const t = (k) => ({
  'ev.upcomingIn': 'Upcoming events in {country}',
  'ev.summaryCountry': '{n} upcoming events to plan a trip around.',
  'ev.noneCountry': 'No upcoming events listed in {country} right now — see past events below, or browse all destinations.',
}[k]);

test('describes the count when there are upcoming events', () => {
  assert.equal(
    eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: 7 }),
    '7 upcoming events to plan a trip around.',
  );
});

test('falls back to the empty-state copy when there are none', () => {
  assert.equal(
    eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: 0 }),
    'No upcoming events listed in Japan right now — see past events below, or browse all destinations.',
  );
});

test('never equals the page title', () => {
  const title = t('ev.upcomingIn').replace('{country}', 'Japan');
  for (const n of [0, 1, 12]) {
    assert.notEqual(eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: n }), title);
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test src/lib/eventsHubMeta.test.mjs
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`src/lib/eventsHubMeta.mjs`:

```js
// The meta description for /events/<country>. It used to be the TITLE string
// verbatim — 85 hub pages (17 countries × 5 languages) repeated their own
// headline in the SERP snippet, found by the 2026-08-31 SEO audit. Both
// strings below already exist in ui.ts in all five languages.
export function eventsHubDescription({ t, countryLabel, upcomingCount }) {
  return upcomingCount > 0
    ? t('ev.summaryCountry').replace('{n}', String(upcomingCount))
    : t('ev.noneCountry').replace('{country}', countryLabel);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test src/lib/eventsHubMeta.test.mjs
```

Expected: PASS (3 tests)

- [ ] **Step 5: 컴포넌트를 연결한다**

`src/components/EventsCountryHub.astro` — 상단 import에 추가:

```js
import { eventsHubDescription } from '../lib/eventsHubMeta.mjs';
```

92~95행:

```astro
<!-- before -->
<BaseLayout image={ogPhoto}
  title={t('ev.upcomingIn').replace('{country}', countryLabel)}
  description={t('ev.upcomingIn').replace('{country}', countryLabel)}

<!-- after -->
<BaseLayout image={ogPhoto}
  title={t('ev.upcomingIn').replace('{country}', countryLabel)}
  description={eventsHubDescription({ t, countryLabel, upcomingCount: upcoming.length })}
```

- [ ] **Step 6: 실제 출력으로 확인한다**

```bash
cd C:/Users/user/wa-main && npm run build 2>&1 | tail -3 && grep -o '<title>[^<]*</title>\|name="description" content="[^"]*"' dist/events/japan/index.html
```

Expected: title과 description이 **서로 다른 문장**. 5개 언어 중 하나도 확인:

```bash
grep -o 'name="description" content="[^"]*"' /c/Users/user/wa-main/dist/ko/events/japan/index.html
```

- [ ] **Step 7: 커밋**

```bash
cd C:/Users/user/wa-main
git add src/lib/eventsHubMeta.mjs src/lib/eventsHubMeta.test.mjs src/components/EventsCountryHub.astro
git commit -m "fix: 85 event hubs used their own title as the description"
```

---

### Task 3: Event JSON-LD가 저장해둔 공연장을 버리고 도시 이름만 내보낸다

**왜:** `src/content.config.ts:65` 에 `eventVenue` 필드가 있고 **24편**이 실제 값을 갖고 있다(예: `austin-formula-1-united-states-grand-prix.md:49` = `Circuit of the Americas`). 그런데 `src/components/PostArticle.astro:459-463` 은 `location.name` 과 `addressLocality` 를 **둘 다 `d.region`**(= `Austin`)으로 넣는다. 공연장 이름으로 검색하는 질의에 필요한 엔티티를 도시로 뭉갠 것 — "적은 검색어에만 노출"과 정확히 같은 방향의 손실이다.

**주의(의도적인 것):** 같은 블록의 `name: eventSchemaName(post.data.title)` 이 전 언어에서 영어 제목을 쓰는 것은 **일부러 그렇게 한 것**이다(`src/lib/eventName.mjs`). 건드리지 않는다.

**Files:**
- Create: `src/lib/eventLocation.mjs`
- Test: `src/lib/eventLocation.test.mjs`
- Modify: `src/components/PostArticle.astro:459-463`

**Interfaces:**
- Produces: `eventLocation({ venue, region, countryISO }) → object` — schema.org `Place`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/eventLocation.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLocation } from './eventLocation.mjs';

test('names the stored venue and keeps the city as the locality', () => {
  assert.deepEqual(
    eventLocation({ venue: 'Circuit of the Americas', region: 'Austin', countryISO: 'US' }),
    {
      '@type': 'Place',
      name: 'Circuit of the Americas',
      address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressCountry: 'US' },
    },
  );
});

test('falls back to the city when no venue is stored', () => {
  assert.deepEqual(
    eventLocation({ venue: undefined, region: 'Austin', countryISO: 'US' }),
    {
      '@type': 'Place',
      name: 'Austin',
      address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressCountry: 'US' },
    },
  );
});

test('omits addressCountry entirely when the ISO code is unknown', () => {
  // An empty addressCountry is worse than none — never emit a blank field.
  const out = eventLocation({ venue: 'Tokyo Dome', region: 'Tokyo', countryISO: undefined });
  assert.equal('addressCountry' in out.address, false);
});

test('treats a blank or whitespace venue as absent', () => {
  assert.equal(eventLocation({ venue: '   ', region: 'Austin' }).name, 'Austin');
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test src/lib/eventLocation.test.mjs
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`src/lib/eventLocation.mjs`:

```js
// schema.org Place for an event post. The venue is stored (content.config.ts
// `eventVenue`) but the JSON-LD used to print the CITY as both the place name
// and the locality, so "Circuit of the Americas" reached Google as "Austin" —
// the entity a venue query needs, thrown away. Found 2026-08-31; 24 posts
// carry a real venue today, and the rest correctly fall back to the city.
export function eventLocation({ venue, region, countryISO }) {
  const name = String(venue ?? '').trim() || region;
  return {
    '@type': 'Place',
    name,
    address: {
      '@type': 'PostalAddress',
      addressLocality: region,
      ...(countryISO && { addressCountry: countryISO }),
    },
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test src/lib/eventLocation.test.mjs
```

Expected: PASS (4 tests)

- [ ] **Step 5: 컴포넌트를 연결한다**

`src/components/PostArticle.astro` 상단 import에 추가:

```js
import { eventLocation } from '../lib/eventLocation.mjs';
```

459~463행:

```js
// before
    location: {
      '@type': 'Place',
      name: d.region,
      address: { '@type': 'PostalAddress', addressLocality: d.region, ...(countryISO && { addressCountry: countryISO }) },
    },

// after
    location: eventLocation({ venue: d.eventVenue, region: d.region, countryISO }),
```

- [ ] **Step 6: 실제 출력으로 확인한다**

```bash
cd C:/Users/user/wa-main && npm run build 2>&1 | tail -3 && grep -o '"Circuit of the Americas"' dist/posts/austin-formula-1-united-states-grand-prix/index.html
```

Expected: 매치 1건 이상. 매치가 없으면 프론트매터 필드 이름을 다시 확인한다(`grep -n eventVenue src/content/posts/austin-formula-1-united-states-grand-prix.md`).

- [ ] **Step 7: 커밋**

```bash
cd C:/Users/user/wa-main
git add src/lib/eventLocation.mjs src/lib/eventLocation.test.mjs src/components/PostArticle.astro
git commit -m "fix: the Grand Prix happened at a circuit, not at 'Austin' — Event schema uses the stored venue"
```

---

### Task 4: 사이트맵 `lastmod` 가 바뀌지 않은 페이지를 바뀌었다고 말한다

**왜:** `astro.config.mjs:120-133` 의 `hubLastmod()` 는 **아무 글이나** 발행·수정되면 그 나라의 이벤트 허브와 **when-to-go 12개월 전부**의 `lastmod` 를 올린다. 그런데 월 페이지에서 국가 전체 장소 목록은 이미 부모로 옮겼다(`src/components/WhenToGoPage.astro:128-137`). 식당 글 한 편을 올려도 12개 월 페이지 HTML은 한 글자도 안 바뀌는데 날짜만 새로 나간다. 같은 파일 86~89행의 주석은 `lastmod` 가 "실제 변경일"이라고 주장한다 — 코드와 주석이 어긋난 상태다.

**영향 정직하게:** 순위 하락의 직접 원인이라고 말할 근거는 없다. **재크롤 예산 낭비**이고, 색인이 얼어붙은 상태에서 크롤러에게 거짓 신선도를 계속 먹이는 것이 도움이 될 리 없다는 정도다.

**Files:**
- Create: `src/lib/hub-lastmod.mjs`
- Test: `src/lib/hub-lastmod.test.mjs`
- Modify: `astro.config.mjs:90-135`

**Interfaces:**
- Produces: `hubPathsFor(post) → string[]` — 이 글 하나가 정당하게 갱신하는 허브 경로들. `post` = `{ region, country, category, eventStartDate, date }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/hub-lastmod.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubPathsFor } from './hub-lastmod.mjs';

test('a restaurant guide freshens its region and country, not the calendar', () => {
  const paths = hubPathsFor({ region: 'Seoul', country: 'South Korea', category: 'restaurant', date: '2026-08-30' });
  assert.ok(paths.includes('/regions/seoul'));
  assert.ok(paths.includes('/destinations/south-korea'));
  // The twelve month pages do not render this post. Claiming they changed is
  // a lie to the crawler — the whole point of this module.
  assert.equal(paths.some((p) => p.startsWith('/tools/when-to-go/south-korea/')), false);
  assert.equal(paths.includes('/events/south-korea'), false);
});

test('an event freshens the events hub and ONLY its own month', () => {
  const paths = hubPathsFor({
    region: 'Austin', country: 'United States', category: 'event',
    eventStartDate: '2026-10-25', date: '2026-08-30',
  });
  assert.ok(paths.includes('/events/united-states'));
  assert.ok(paths.includes('/tools/when-to-go/united-states/october'));
  assert.equal(paths.filter((p) => p.startsWith('/tools/when-to-go/united-states/')).length, 1);
});

test('an event with no start date touches no month page', () => {
  const paths = hubPathsFor({ region: 'Austin', country: 'United States', category: 'event', date: '2026-08-30' });
  assert.ok(paths.includes('/events/united-states'));
  assert.equal(paths.some((p) => p.startsWith('/tools/when-to-go/united-states/')), false);
});

test('a region with no country still defaults to South Korea, as the old code did', () => {
  const paths = hubPathsFor({ region: 'Busan', category: 'attraction', date: '2026-08-30' });
  assert.ok(paths.includes('/destinations/south-korea'));
});

test('every post freshens the site-wide indexes', () => {
  const paths = hubPathsFor({ region: 'Seoul', country: 'South Korea', category: 'cafe', date: '2026-08-30' });
  for (const p of ['/destinations', '/regions', '/']) assert.ok(paths.includes(p), p);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test src/lib/hub-lastmod.test.mjs
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`src/lib/hub-lastmod.mjs`:

```js
// Which hub pages does ONE post actually change?
//
// Until 2026-09 the answer was "the events hub and all twelve when-to-go month
// pages for its country" — for every post, including a cafe guide. Those month
// pages stopped listing the country's venues on 2026-08-07 (WhenToGoPage.astro
// moved the twelve-month table and the venue grid to the parent), so publishing
// one restaurant re-dated up to 13 URLs whose HTML did not move a byte. The
// sitemap comment claimed lastmod was the real change date; this makes it true.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

const slugify = (s) => String(s).toLowerCase().trim().replace(/\s+/g, '-');

/** @param {{region?: string, country?: string, category?: string, eventStartDate?: string}} post */
export function hubPathsFor(post) {
  const out = [];
  const countrySlug = slugify(post.country || 'South Korea');

  if (post.region) {
    const r = slugify(post.region);
    out.push(`/regions/${r}`);
    for (const k of ['things-to-do', 'best-restaurants', 'cafes', 'hidden-gems']) out.push(`/regions/${r}/${k}`);
  }
  out.push(`/destinations/${countrySlug}`, `/essentials/${countrySlug}`);

  // The events hub lists event posts. Nothing else changes it.
  if (post.category === 'event') {
    out.push(`/events/${countrySlug}`);
    // A month page shows the events falling in THAT month. One month, not twelve.
    if (post.eventStartDate) {
      const m = new Date(post.eventStartDate).getUTCMonth();
      if (Number.isInteger(m) && MONTHS[m]) out.push(`/tools/when-to-go/${countrySlug}/${MONTHS[m]}`);
    }
  }

  out.push('/destinations', '/regions', '/tools/when-to-go', '/');
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd C:/Users/user/wa-main && node --test src/lib/hub-lastmod.test.mjs
```

Expected: PASS (5 tests)

- [ ] **Step 5: astro.config.mjs 를 연결한다**

`hubLastmod()` 안의 파일 순회는 그대로 두고, `bump(...)` 호출 뭉치(대략 120~133행)를 다음으로 바꾼다. `category` 와 `eventStartDate` 를 `val()` 로 새로 읽어야 한다:

```js
      const date = (val('updatedDate') || val('pubDate') || '').slice(0, 10);
      if (!date) continue;
      for (const path of hubPathsFor({
        region: val('region'),
        country: val('country'),
        category: val('category'),
        eventStartDate: val('eventStartDate'),
      })) bump(path, date);
```

파일 상단 import에 추가:

```js
import { hubPathsFor } from './src/lib/hub-lastmod.mjs';
```

86~89행의 주석은 이제 사실이 되었으므로 유지한다.

- [ ] **Step 6: 빌드 결과로 확인한다**

```bash
cd C:/Users/user/wa-main && npm run build 2>&1 | tail -3
node -e "const fs=require('fs');const x=fs.readFileSync('dist/sitemap-en-when-to-go.xml','utf8');const d=[...x.matchAll(/<lastmod>([^<]+)/g)].map(m=>m[1].slice(0,10));const u={};for(const v of d)u[v]=(u[v]||0)+1;console.log(u)"
```

Expected: 월 페이지들의 `lastmod` 가 **여러 날짜로 흩어져** 있다(수정 전에는 거의 전부 최근 발행일 하나로 몰려 있었다). 전부 같은 날짜면 연결이 안 된 것이다.

- [ ] **Step 7: 커밋**

```bash
cd C:/Users/user/wa-main
git add src/lib/hub-lastmod.mjs src/lib/hub-lastmod.test.mjs astro.config.mjs
git commit -m "fix: one cafe guide claimed thirteen pages had changed — lastmod now means what the comment says"
```

---

### Task 5: Dataset 스키마가 표 없는 페이지에 붙어 있다

**왜:** `src/components/WhenToGoPage.astro:72-97` 의 월 페이지가 `{country} climate normals by month` **전체 12개월 Dataset**을 주장한다. 그런데 12개월 표는 2026-08-07에 부모로 옮겼고, 지금 그 표를 실제로 렌더하는 건 `src/components/WhenToGoCountry.astro:104-109` 다 — 그리고 부모에는 Dataset이 **없다**(확인함). 정확히 거꾸로 붙어 있다.

**Files:**
- Modify: `src/components/WhenToGoPage.astro:72-97` (Dataset 블록 삭제)
- Modify: `src/components/WhenToGoCountry.astro:65` (`jsonLd` 그래프에 Dataset 추가)

- [ ] **Step 1: 월 페이지에서 Dataset 블록을 잘라낸다**

`src/components/WhenToGoPage.astro` 의 `jsonLd['@graph']` 배열에서 `{ '@type': 'Dataset', … }` 객체 전체(72~97행)를 **삭제**하고, 붙여넣기용으로 그대로 보관한다. `WebPage` 항목은 그대로 둔다.

- [ ] **Step 2: 부모 페이지에 붙인다**

`src/components/WhenToGoCountry.astro:65` 의 `const jsonLd = {` 그래프 배열(현재 `WebPage` + `BreadcrumbList` 두 개)에 방금 잘라낸 객체를 **세 번째 항목**으로 넣는다. 부모의 변수명은 확인했다 — 아래 세 곳만 바꾸면 되고, `site` 와 `pageUrl` 은 63~64행에 이미 있다:

| 월 페이지의 표현 | 부모에서 쓸 표현 |
|---|---|
| `data.country` | `first.country` |
| `data.climateYears` | `first.climateYears` |
| `data.climateCity` | `first.climateCity` |
| `url: pageUrl` | `url: pageUrl` (그대로) |

`license`, `variableMeasured`, `isBasedOn` 는 **그대로 옮긴다** — GSC가 2026-07-30에 1,020페이지의 license 누락을 지적해서 붙인 것들이라 빠지면 경고가 재발한다.

- [ ] **Step 3: 빌드하고 양쪽을 확인한다**

```bash
cd C:/Users/user/wa-main && npm run build 2>&1 | tail -3
echo "--- parent should HAVE it ---"; grep -c '"Dataset"' dist/tools/when-to-go/japan/index.html
echo "--- month should NOT ---";      grep -c '"Dataset"' dist/tools/when-to-go/japan/march/index.html
```

Expected: 부모 `1`, 월 `0`.

- [ ] **Step 4: 5개 언어 전부 확인한다**

```bash
for L in ko ja es zh; do printf "%s parent=" $L; grep -c '"Dataset"' /c/Users/user/wa-main/dist/$L/tools/when-to-go/japan/index.html; done
```

Expected: 전부 `1`.

- [ ] **Step 5: 커밋**

```bash
cd C:/Users/user/wa-main
git add src/components/WhenToGoPage.astro src/components/WhenToGoCountry.astro
git commit -m "fix: the climate Dataset was on the page without the table, and missing from the one with it"
```

---

### Task 6: 🔴 얇은 지역·월 URL 색인 기준 — **픽서님 승인 없이 시작 금지**

**결정이 필요한 이유:** 이건 코드 문제가 아니라 **정책 결정**이다. 실행하면 최대 **715개 허브 URL + 최대 171개 월 URL**이 색인에서 빠진다. 2026-07-26에 사진 없는 글 92편을 지웠다가 트래픽의 40%를 날린 전례가 있고, 지금은 색인이 07-25부터 얼어 있어 **뺀 URL이 언제 돌아올지 알 수 없다.**

**실측 근거 (`docs/superpowers/plans/2026-08-31-thin-inventory.json`, 지역·월 전수):**

| 항목 | 수치 |
|---|---|
| 지역 허브 총계 | 314개 (× 5언어 = 1,570 URL) |
| 글 1편뿐인 지역 | 46개 (14.6%) |
| 글 2편 이하 | 143개 (45.5%) → **×5언어 = 715 URL** |
| 글 중앙값 | 3편 |
| when-to-go 영어 월 페이지 | 240개 (× 5언어 = 1,200 URL) |
| 이벤트 섹션 없음 | 171개 (71%) |
| 휴일·이벤트 **둘 다** 없음 | 45개 (19%) |

생성 조건: `src/pages/regions/[region].astro:14` — 글이 **하나라도** 있으면 허브를 만든다.

**픽서님께 물을 것 (셋 중 하나 고르시면 그대로 실행):**

- **A안 (보수적, 권장)** — 색인은 건드리지 않는다. 대신 얇은 45개 월 페이지와 46개 1편 지역에 **콘텐츠를 채우는 것**을 발행 큐 우선순위로 올린다. 잃는 URL 0개.
- **B안 (중간)** — 휴일·이벤트가 **둘 다 없는 45개 월 페이지만** `noindex` + 사이트맵 제외. 지역 허브는 그대로. 잃는 URL 225개(45×5).
- **C안 (코덱스 권고)** — 지역 허브 기준을 글 4편 이상으로, 월 페이지는 고유 콘텐츠 기준 미달 시 제외. 잃는 URL 최대 940개.

**승인이 떨어지면 구현 형태(공통):**
- `src/lib/thin-page-policy.mjs` (+test) 에 판정 함수 하나 — `isIndexableRegionHub({postCount})`, `isIndexableMonthPage({hasEvents, hasHolidays})`
- 라우트는 페이지를 **계속 생성**하되(내부 링크와 사용자 경험 유지) `noindex` 만 붙인다. 라우트에서 아예 빼면 404가 되어 07-26 사고의 재판이 된다.
- 사이트맵 제외는 `astro.config.mjs` 의 `NOINDEX_SLUGS` 경로(82행)를 재사용한다 — 새 배관을 만들지 않는다.
- 되돌리기: 기준 상수 하나만 바꾸면 원복되도록 하드코딩 금지.

- [ ] **Step 1: 픽서님께 A/B/C 중 선택을 받는다** ← 이 계획에서 유일하게 사람이 필요한 지점
- [ ] **Step 2: 선택된 안으로 이 Task의 나머지 단계를 작성한 뒤 실행한다**

---

### Task 7: 🔴 기존 1,349편의 사이트 단위 균일성 — **범위·비용 승인 필요**

**왜:** 감사의 1순위 지목이자, 유일하게 "적은 검색어에만 노출"과 통계적으로 맞아떨어지는 항목이다. 라이브 1,349편 실측:

| 항목 | 비율 | 생성원 |
|---|---|---|
| 제목에 콜론 | 96.3% | `scripts/lib/titles.mjs:43` |
| 제목에 `Travel Guide` | 77.6% | 같은 곳 |
| **H2가 정확히 5개 또는 6개** | **98.4%** | 옛 writer 프롬프트 |
| 본문 616~756단어 | 80.6% | 같은 곳 |
| 첫 H2가 `Why go` | 63.3% | 같은 곳 |
| 설명이 `— what visitors say, hours, and tips.` 로 끝남 | 46.3% | `scripts/lib/serp.mjs:62-70` |
| 본문에 남은 em dash | 10,657개 | 옛 프롬프트(현 프롬프트는 금지) |

**이미 절반은 고쳐져 있다:** `scripts/lib/writer.mjs:152-170` 이 2026-08-28에 3가지 분량 형태(compact/standard/expansive)를 도입했다. **신규 글에만** 적용되고 기존 1,349편은 그대로다.

**왜 승인이 필요한가:** 본문을 고치면 `srcHash` 가 바뀌어 번역 4개가 재생성된다 = **모델 비용**. 1,349편 × 4언어를 한 번에 돌리는 건 청구서가 크다. 그리고 08-31 결론은 여전히 **백링크가 병목**이지 균일성이 병목이라고 증명된 게 아니다.

**제안하는 형태 (승인 시):**
- **전수 재생성 금지.** GSC에서 노출이 남아 있는 상위 100편만 대상으로 하는 표본 배치. 09-10 판정 때 그 100편과 나머지를 비교하면 **가설 검증까지 겸한다**.
- em dash 치환은 `srcHash` 를 건드리지 않는 경로가 없으므로, 본문 재편집과 **같은 배치에서 한 번에** 처리한다(따로 돌리면 비용을 두 번 낸다).
- 제목·설명만 바꾸는 것은 본문보다 훨씬 싸지만 `srcHash` 에 title/description이 들어가므로 **역시 재번역을 부른다.** `scripts/lib/frontmatter-field.mjs` + `srcHashOfPostFile` 재스탬프 조합으로 Task 1과 같은 패턴을 쓰면 **재번역 0으로 제목만** 바꿀 수 있다 — 다만 그러면 번역본 제목은 옛 제목으로 남는다. 영어만 다양화하고 번역은 다음 자연 갱신 때 따라오게 할지 결정이 필요하다.

- [ ] **Step 1: 픽서님께 물을 것 — ①대상 범위(상위 100편 vs 전수) ②번역 동시 갱신 여부(비용) ③09-10 판정 전에 할지 후에 할지**
- [ ] **Step 2: 답을 받은 뒤 이 Task를 구체 단계로 다시 쓴다**

---

## 실행 순서 요약

```
1주차 (승인 불필요, 바로 실행)
  Task 0  프롬프트 서문 유출     ← 라이브 결함, 10분, Task 1의 선행조건
  Task 1  중복 AI 고지          ← 가장 큼(883편×5), 여기가 본체
  Task 2  이벤트 허브 description
  Task 3  Event 공연장 스키마
  Task 5  Dataset 위치 교정
  Task 4  lastmod 정확화        ← 사이트맵 로직이라 마지막, 빌드 검증 필수

승인 대기
  Task 6  얇은 페이지 색인 정책  (A/B/C 택1)
  Task 7  기존 코퍼스 균일성 완화 (범위·비용)
```

의존 관계는 **Task 0 → Task 1** 하나뿐이다(0을 건너뛰면 1의 스윕이 882로 나오고 정지 조건에 걸린다). Task 2·3·5는 서로 독립이라 순서를 바꿔도 되고 병렬로 나눠도 된다. **Task 4는 마지막**에 둔다 — 사이트맵을 건드리므로 다른 변경과 섞이면 빌드 회귀를 분리하기 어렵다.

## 마무리 검증 (Task 0~5를 끝낸 뒤 한 번)

```bash
cd C:/Users/user/wa-main
npm run ci 2>&1 | tail -10
node scripts/validate-content.mjs 2>&1 | tail -20
node -e "const fs=require('fs');console.log('sitemap urls:', (fs.readFileSync('dist/sitemap-en-posts.xml','utf8').match(/<loc>/g)||[]).length)"
```

기준: `npm run ci` 통과 · `validate-content` 에 `DOUBLE-DISCLOSURE` 와 `PROMPT-LEAK` 각 0건 · 사이트맵 URL 총계가 **10,972에서 줄지 않았을 것**(Task 0~5는 URL을 하나도 없애지 않는다. 줄었으면 뭔가 잘못 지운 것).

배포 확인은 **CI 초록이 아니라 라이브**로 한다 — Cloudflare 빌드가 `skipped` 로 조용히 멈추는 전례가 있다(메모리 `cloudflare-build-skipped-stall.md`).

## 이 계획이 다루지 않는 것 (감사에서 "혐의 없음"으로 확인됨)

canonical · hreflang(301페이지 표본에서 self-hreflang 누락 0) · robots.txt · 사이트맵 분할 구조(자식 35개, 10,972 URL) · 페이지 속도 · 현재 내부 링크 고아. **여기에 시간을 쓰면 낭비다.**
