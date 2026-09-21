// 공개 저장소에 개인 식별 정보가 들어오는 것을 막는다.
//
// 2026-09-21: Qwoted 계정 정지 대응 초안을 커밋하면서 실명과 링크드인 주소가
// **공개 저장소**로 나갔다(커밋 01754fbc7). 같은 날 파일에서 지웠지만 — 깃은
// 지워도 이력에 남고, 그 커밋은 지금도 누구나 열 수 있다. 이력을 다시 쓰는 건
// 해시가 전부 바뀌고 강제 푸시가 필요한 데다 깃허브가 옛 커밋을 한동안 들고
// 있어서 반쪽짜리다. 그래서 **이미 나간 것은 그대로 두고, 다시 들어오는 것을
// 막는다.** 남은 것이 "정책 문서"뿐이면 다음에 또 들어온다 — 문서는 막지 않는다.
//
// 🔑 금지어를 평문으로 적으면 이 파일 자체가 유출이 된다. 그래서 **해시로** 넣는다.
//    새 항목을 추가할 때도 평문을 적지 말 것:
//      node -e "console.log(require('crypto').createHash('sha256').update('말'.toLowerCase()).digest('hex').slice(0,32))"
//    환경변수 PII_EXTRA_HASHES(쉼표 구분)로 저장소에 적지 않고 늘릴 수도 있다.

/** 토큰 단위로 대조하는 금지어(sha256 앞 32자, 소문자 기준). */
const BANNED_HASHES = new Set([
  '1e8d38c4edf46b4509cc60d5bf44158d', // 운영자 실명(이름)
  'd91ae1926faa9910bca6574bf6406609', // 링크드인 슬러그 전체
  'cc71103d44e289ea5adbf9f19f981802', // 링크드인 슬러그 꼬리
  ...String(process.env.PII_EXTRA_HASHES || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

// 값이 아니라 **모양**으로 잡는 것들 — 여기 적어도 유출이 아니다.
const SHAPES = [
  [/linkedin\.com\/in\/[A-Za-z0-9._-]+/gi, '링크드인 프로필 주소'],
];

import { createHash } from 'node:crypto';
const h = (s) => createHash('sha256').update(s.toLowerCase(), 'utf8').digest('hex').slice(0, 32);

// 단어 경계로 쪼갠다. 하이픈이 들어간 슬러그도 한 덩어리로 보게 하이픈은 남긴다.
const TOKEN = /[A-Za-z][A-Za-z0-9._-]{2,}/g;

/**
 * 글 한 덩어리에서 개인 식별 정보를 찾는다.
 * @returns {{kind: string, line: number, excerpt: string}[]}
 */
export function piiFindings(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [re, label] of SHAPES) {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) out.push({ kind: label, line: i + 1, excerpt: redact(line, m[0]) });
    }
    for (const m of line.matchAll(TOKEN)) {
      const tok = m[0];
      // 슬러그는 통째로도, 하이픈으로 쪼갠 조각으로도 본다.
      const parts = [tok, ...tok.split(/[-._]/)].filter((p) => p.length > 2);
      for (const p of parts) {
        if (BANNED_HASHES.has(h(p))) {
          out.push({ kind: '금지된 개인 식별자', line: i + 1, excerpt: redact(line, tok) });
          return; // 한 줄에 하나만 보고한다 — 출력 자체가 유출이 되지 않게.
        }
      }
    }
  });
  return out;
}

/** 찾은 값을 출력에 그대로 쓰지 않는다. 로그도 공개된다. */
function redact(line, hit) {
  const masked = hit.length <= 4 ? '****' : `${hit.slice(0, 2)}${'*'.repeat(Math.min(hit.length - 2, 12))}`;
  const s = line.replace(hit, masked).trim();
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
