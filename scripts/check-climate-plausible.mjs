#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  기후 수치 상식 검사 — data/country-facts.json
//
//  2026-09-09에 기후 출처를 Open-Meteo에서 NASA POWER로 바꾸면서 드러난 것:
//  **옛 수치 두 나라가 명백히 틀려 있었고, 아무도 몰랐다.**
//    · 하노이: 1월 최고 32도 / 7월 최고 31도 — 북위 21도 도시에 계절이 없었다
//    · 발리:   연중 최고 21~24도 — 적도 섬이 서울 가을 날씨였다
//  두 값 다 "최고>최저"였고 범위 안이었으니, 그런 검사로는 절대 안 걸린다.
//  걸리는 것은 **위도와 계절폭의 관계**다. 위도가 높을수록 여름과 겨울이 벌어져야
//  하고, 적도 근처는 벌어지지 않아야 한다. 그 둘이 어긋나면 좌표나 격자가 잘못된
//  것이다(옛 값은 하노이 자리에 바다를, 발리 자리에 산을 집은 것으로 보인다).
//
//  이 검사는 게시를 막지 않는다 — 숫자가 이상하면 사람이 봐야 하고, 그 사이에도
//  나머지 페이지는 나가야 한다. 비-0으로 끝나고 워크플로가 그것을 읽는다.
//
//    node scripts/check-climate-plausible.mjs
// ─────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';

const FACTS = 'data/country-facts.json';

// 위도 |lat| 별로 기대되는 연교차(가장 더운 달 최고 − 가장 추운 달 최고).
// 넉넉하게 잡았다 — 잡으려는 것은 "미묘하게 다름"이 아니라 "계절이 통째로 없다"다.
export function seasonalSwingBounds(absLat) {
  if (absLat < 12) return { min: 0, max: 9 };    // 적도대: 거의 없어야 정상
  if (absLat < 20) return { min: 2, max: 20 };
  if (absLat < 30) return { min: 8, max: 30 };
  return { min: 8, max: 45 };                    // 온대·냉대: 계절이 반드시 있다
}

export function climateIssues(country, climate, absLat) {
  const out = [];
  if (!Array.isArray(climate) || climate.length !== 12) {
    return [`${country}: 12개월치가 아니다 (${climate?.length ?? 0}개월)`];
  }
  const his = climate.map((m) => m.hi);
  const los = climate.map((m) => m.lo);
  for (const m of climate) {
    if (!(m.hi > m.lo)) out.push(`${country} ${m.m}월: 최고(${m.hi})가 최저(${m.lo}) 이하`);
    if (m.hi > 55 || m.lo < -45) out.push(`${country} ${m.m}월: 기온이 지구 범위 밖 (${m.lo}~${m.hi})`);
    if (m.rain < 0 || m.rain > 2000) out.push(`${country} ${m.m}월: 강수 ${m.rain}mm`);
  }
  if (absLat != null) {
    const swing = Math.max(...his) - Math.min(...his);
    const { min, max } = seasonalSwingBounds(absLat);
    if (swing < min) {
      out.push(`${country}: 위도 ${absLat.toFixed(0)}도인데 연교차가 ${swing}도뿐 — 계절이 없다. 좌표가 바다·다른 도시일 가능성 (하노이 사례 2026-09-09)`);
    }
    if (swing > max) {
      out.push(`${country}: 위도 ${absLat.toFixed(0)}도인데 연교차가 ${swing}도 — 좌표가 산악·내륙 격자일 가능성`);
    }
    // 적도 근처가 서늘하면 고도를 집은 것이다(발리 사례).
    if (absLat < 12 && Math.max(...his) < 26) {
      out.push(`${country}: 적도대(위도 ${absLat.toFixed(0)}도)인데 가장 더운 달 최고가 ${Math.max(...his)}도 — 고지대 격자를 집었을 가능성 (발리 사례 2026-09-09)`);
    }
    if (absLat > 35 && Math.min(...los) > 15) {
      out.push(`${country}: 위도 ${absLat.toFixed(0)}도인데 가장 추운 달 최저가 ${Math.min(...los)}도 — 겨울이 없다`);
    }
  }
  return out;
}

// CLI로 실행될 때만 파일을 읽는다(테스트가 import 해도 안 돈다).
const isCli = process.argv[1] && process.argv[1].endsWith('check-climate-plausible.mjs');
if (isCli) {
  if (!existsSync(FACTS)) {
    console.log(`${FACTS} 가 없다 — 검사할 것이 없다.`);
    process.exit(1); // 볼 것이 없으면 통과를 보고하지 않는다
  }
  const { countries } = JSON.parse(readFileSync(FACTS, 'utf8'));
  // 위도는 수치를 뜬 바로 그 지점에서 온다(refresh-country-facts 가 같이 적는다).
  // 나라 중심 좌표로 대신하면 도쿄를 홋카이도 위도로 재는 식이 된다.
  const lats = {};
  for (const [n, c] of Object.entries(countries)) {
    if (typeof c?.climateLat === 'number') lats[n] = c.climateLat;
  }
  const names = Object.keys(countries);
  if (!names.length) {
    console.log('CLIMATE-CHECK: 나라가 하나도 없다 — 파일 형태가 바뀌었다.');
    process.exit(1);
  }
  let issues = [];
  for (const n of names) {
    const c = countries[n];
    if (!c?.climate) continue;
    issues.push(...climateIssues(n, c.climate, lats[n] == null ? null : Math.abs(lats[n])));
  }
  // 좌표를 모르면 계절 검사를 못 한다 = 볼 것을 못 본 것이다. 통과를 보고하지 않는다.
  const withLat = Object.keys(lats).length;
  console.log(`🌡️  ${names.length}개국 기후 수치 검사 (기준 좌표 아는 나라 ${withLat}곳)`);
  if (!withLat) {
    console.log('CLIMATE-CHECK: 어느 나라도 climateLat 을 갖고 있지 않다 — 계절 검사를 한 번도 못 했다. refresh-country-facts 를 새 판으로 한 번 돌릴 것.');
    process.exit(1);
  }
  for (const i of issues) console.log(`  ⚠ ${i}`);
  if (issues.length) {
    console.log(`\nCLIMATE-IMPLAUSIBLE: ${issues.length}건 — 해당 나라의 기준 좌표(climateCity)를 확인할 것.`);
    process.exit(1);
  }
  console.log('  ✓ 계절폭·범위 모두 위도와 앞뒤가 맞는다.');
}
