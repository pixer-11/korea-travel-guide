// Which active countries are still under the per-country cap, as one log line
// the notify step can quote. Born 2026-09-22: the backfill run's Telegram said
// "남은 발행 후보 10개 — 도시 추가가 필요합니다" while the global queue held
// ~3,900 targets. The 10 were the leftover combinations of the only two
// countries under the cap (Cambodia 45, Uzbekistan 46) — and both already list
// 12–14 cities. The number was true; the diagnosis was not. So the generator
// says what pool it counted.
export function underTargetLine(countryCounts, activeCountries, cap) {
  if (!Number.isFinite(cap)) return '';
  const under = (activeCountries || [])
    .map((c) => [c.name, countryCounts.get(c.name) || 0])
    .filter(([, n]) => n < cap)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name}=${n}`);
  return `UNDER_TARGET cap=${cap} ${under.length ? under.join(',') : 'none'}`;
}
