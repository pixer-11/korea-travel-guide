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
//  경로(`/`, `#`)도 아닌 href 는 전부 이 부류다. 그래서 CI 에서 돈다.
// ─────────────────────────────────────────────────────────────

// `[글자](주소)` — 주소에 공백이 없는 보통의 마크다운 링크.
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

// 통과: 스킴이 있거나, 우리 사이트 안의 절대 경로이거나, 같은 페이지 앵커.
// 프로토콜 상대(`//example.com`)도 `/` 로 시작하므로 여기 든다 — 브라우저가
// 바깥으로 보내주니 깨지지 않는다.
const SAFE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * 스킴도 사이트 경로도 없는 마크다운 링크를 모두 돌려준다.
 * @param {string} text 마크다운 본문(프론트매터 포함해도 된다)
 * @returns {{label: string, href: string}[]}
 */
export function relativeLinks(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(LINK)) {
    if (SAFE.test(m[2])) continue;
    out.push({ label: m[1], href: m[2] });
  }
  return out;
}
