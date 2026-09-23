// ─────────────────────────────────────────────────────────────
//  브라우저가 우리 사이트 안에서 찾게 되는 바깥 주소.
//
//  2026-09-23 주간 링크 검사가 잡은 것:
//    404 /ja/posts/paris-2026-tour-de-france-final-stages-paris-finish/letour.fr
//
//  영어 원문은 `letour.fr` 을 **그냥 글자로** 썼다(링크 아님). 일본어 번역만
//  그걸 친절하게 `[letour.fr](letour.fr)` 로 링크로 만들었는데, 스킴이 없으니
//  마크다운은 그걸 **상대 경로**로 읽는다 → 글 주소 뒤에 붙어서 404.
//  ko·zh·es 는 글자로 뒀다. 즉 번역기가 주사위를 굴린 자리다.
//
//  판정은 모델 없이 공짜로 된다 — 스킴(`https:`, `mailto:` …)도 없고 사이트
//  경로(`/`, `#`)도 아닌 주소는 전부 이 부류다. 그래서 CI 에서 돈다.
//
//  왜 정규식이 아니라 파서인가 (같은 날, 코덱스 검토):
//  첫 판은 `[글자](주소)` 정규식이었는데 **렌더러가 링크로 만드는 모양 셋을 놓쳤다** —
//    · 제목 붙은 링크   [Tour](letour.fr "Official site")
//    · 참조형 링크     [Tour][t]   …   [t]: letour.fr
//  그리고 거꾸로 맞는 링크 하나를 오탐했다 — 꺾쇠 주소 [a](</tools/esim/>).
//  검사기가 렌더러와 다른 눈으로 보면 이런 틈은 계속 나온다. 그래서 사이트가
//  실제로 쓰는 파서(remark 의 mdast-util-from-markdown)로 읽는다: 렌더러가
//  링크로 만드는 것은 전부, 그리고 그것만 본다. 코드 블록 안의 예시는 링크가
//  아니므로 잡지 않는다.
//
//  비용: 9,494개 중 링크 문법이 있는 파일이 10개뿐이라(09-23 실측) 문자열
//  한 번 훑어 거르고 그것만 파싱한다. 정규식 판과 같은 1초.
// ─────────────────────────────────────────────────────────────
import { fromMarkdown } from 'mdast-util-from-markdown';
import yaml from 'js-yaml';

// 통과: 스킴이 있거나, 우리 사이트 안의 절대 경로이거나, 같은 페이지 앵커.
// 프로토콜 상대(`//example.com`)도 `/` 로 시작하므로 여기 든다 — 브라우저가
// 바깥으로 보내주니 깨지지 않는다.
const SAFE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

// 링크 문법이 아예 없는 글은 파서를 부를 필요도 없다. 링크·이미지는 `](`,
// 참조 정의는 `]:` 를 반드시 품는다.
const mayHaveLinks = (s) => s.includes('](') || s.includes(']:');

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function textOf(node) {
  if (typeof node.value === 'string') return node.value;
  return (node.children || []).map(textOf).join('');
}

function labelOf(node) {
  if (node.type === 'image') return node.alt || '';
  if (node.type === 'definition') return node.label || node.identifier || '';
  return textOf(node);
}

// 문서 순서대로 모은다 — 보고서가 파일을 위에서부터 읽는 순서와 같아야 찾기 쉽다.
function collect(node, out) {
  if ((node.type === 'link' || node.type === 'image' || node.type === 'definition')
      && typeof node.url === 'string' && !SAFE.test(node.url)) {
    out.push({ label: labelOf(node), href: node.url });
  }
  for (const child of node.children || []) collect(child, out);
}

function linksIn(markdown, out) {
  if (mayHaveLinks(markdown)) collect(fromMarkdown(markdown), out);
}

// YAML 값 안의 모든 문자열 — FAQ 답변, quickAnswer, description 이 여기 산다.
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/**
 * 렌더러가 링크·이미지로 만드는 것 가운데 주소에 스킴도 사이트 경로도 없는 것.
 * @param {string} text 마크다운 파일 전체(프론트매터 포함)
 * @returns {{label: string, href: string}[]}
 */
export function relativeLinks(text) {
  const s = String(text ?? '');
  if (!mayHaveLinks(s)) return [];

  const out = [];
  const fm = FRONTMATTER.exec(s);
  if (!fm) {
    linksIn(s, out);
    return out;
  }

  // 프론트매터는 따로 읽는다. 파일을 통째로 마크다운으로 읽으면 4칸 들여쓴
  // YAML 줄이 **코드 블록**이 되어 그 안의 링크를 못 본다 — 09-23 의 원래
  // 버그(FAQ 답변 안)가 잡혔던 건 그 줄이 `- q:` 목록 안이라 운이 좋았을 뿐이다.
  let data;
  try { data = yaml.load(fm[1]); } catch { data = undefined; }
  if (data !== undefined) {
    for (const str of strings(data)) linksIn(str, out);
  } else {
    // YAML 이 안 읽히면 원문 그대로라도 본다 — 못 읽었다고 통과시키지 않는다.
    linksIn(fm[1], out);
  }
  linksIn(s.slice(fm[0].length), out);
  return out;
}
