// 우리 수리 도구가 이 글을 다시 써도 글이 살아남는가.
//
// 11개 스크립트가 `matter.stringify(content, data)` 로 글을 통째로 다시 써낸다
// (backfill-event-*, refresh-images, release-photoless-*, unpark-itineraries …).
// gray-matter 는 건네받은 본문을 **다시 파싱**하므로, 본문이 `---` 로 시작하면
// 그 부분을 프런트매터로 읽고 삼킨다 — 2026-09-07 에 414단어짜리 글이 2단어가
// 됐다. 같은 자리에서 `description: "09"` 의 따옴표가 사라져 문자열이 숫자 9 가
// 된 적도 있다(gray-matter 의 js-yaml 3 과 Astro 의 4 가 다르게 읽는다).
//
// 2026-09-08 전수 시뮬레이션: 7,646편 중 손상 0. 그래서 그 11개를 갈아엎지
// 않는다 — 멀쩡한 코드를 고치는 쪽이 더 위험하다. 대신 **위험한 모양의 글이
// 새로 태어나면** 여기서 잡는다. 라운드트립을 실제로 해 보고, 본문이 줄거나
// 프런트매터가 달라지면 실패한다. 5초면 끝난다.
//
// 못 잡는 것도 적어둔다: `description: "09"` 쪽은 이 라운드트립으로 안 보인다.
// gray-matter 는 따옴표를 유지한 채 되읽으므로 여기서는 같아 보이고, 문제는
// **Astro 의 js-yaml 4** 가 같은 줄을 다르게 읽는 데서 생겼다. 이 검사는
// "본문이 사라지는가"와 "프런트매터가 gray-matter 안에서 변하는가"까지다.
//
//   node scripts/check-writer-safety.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { requireExamined } from './lib/examined.mjs';

const DIRS = [
  'src/content/posts',
  'src/content/i18n/ko', 'src/content/i18n/ja', 'src/content/i18n/es', 'src/content/i18n/zh',
];

const words = (t) => t.split(/\s+/).filter(Boolean).length;

let examined = 0;
const hits = [];
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const path = join(dir, f);
    let before;
    // 읽지 못하는 글은 validate-content 의 몫이다. 여기서 조용히 넘어가되 세지도 않는다.
    try { before = matter(readFileSync(path, 'utf8')); } catch { continue; }
    examined++;

    let round;
    try { round = matter(matter.stringify(before.content, before.data)); }
    catch (e) { hits.push({ path, why: `다시 써내면 깨진다: ${e.message}` }); continue; }

    if (words(round.content) < words(before.content) * 0.9) {
      hits.push({ path, why: `본문이 ${words(before.content)}→${words(round.content)}단어로 줄어든다 (본문이 --- 로 시작하나?)` });
      continue;
    }
    const a = JSON.stringify(before.data);
    const b = JSON.stringify(round.data);
    if (a !== b) {
      const A = JSON.parse(a); const B = JSON.parse(b);
      const keys = Object.keys(A).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])).slice(0, 3);
      hits.push({ path, why: `프런트매터가 변한다: ${keys.map((k) => `${k} ${JSON.stringify(A[k])}→${JSON.stringify(B[k])}`).join(', ').slice(0, 160)}` });
    }
  }
}

requireExamined(examined, '글', 'src/content 가 비어 있나?');

for (const h of hits) console.log(`WRITER-UNSAFE: ${h.path} — ${h.why}`);
console.log(hits.length
  ? `\n❌ ${hits.length}편은 수리 도구가 다시 써내는 순간 손상된다. 그 글의 모양을 고치거나, 그 도구를 lib/frontmatter-edit 로 옮길 것.`
  : `✓ ${examined}편 — 어떤 글도 다시 써내기로 손상되지 않는다.`);
process.exit(hits.length ? 1 : 0);
