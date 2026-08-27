#!/usr/bin/env node
// Did today's publish actually run?
//
// 2026-08-27: it did not. The workflow was active, its cron (`19 7 * * *`) was
// unchanged, and six other scheduled workflows fired that morning — GitHub simply
// dropped this one. Nothing noticed. job-failure-alert watches for runs that FAIL;
// a run that never starts has no failure to report, so publishing can stop dead
// and the only symptom is a site that quietly stops growing.
//
// So this asks the plainest question there is: has publish.yml run today? If not,
// it says so in Telegram and, unless --no-dispatch, starts it.
//
//   GITHUB_TOKEN       repo token with actions:write
//   GITHUB_REPOSITORY  owner/repo, provided by Actions
//
//   node scripts/check-publish-ran.mjs                # check, alert, and start it
//   node scripts/check-publish-ran.mjs --no-dispatch  # check and alert only
//   node scripts/check-publish-ran.mjs --dry          # print only
import { telegram } from './lib/gsc.mjs';

const WORKFLOW = 'publish.yml';
const dry = process.argv.includes('--dry');
const noDispatch = process.argv.includes('--no-dispatch');

// KST, because that is the day both the owner and the schedule think in: the cron
// lands at 16:19 KST, and a UTC "today" would call the evening check a new day.
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.error('GITHUB_TOKEN / GITHUB_REPOSITORY missing — skipping.');
    return;
  }

  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  };

  const today = kstDay(new Date().toISOString());
  const runs = await api(`/actions/workflows/${WORKFLOW}/runs?per_page=10`);
  const ranToday = (runs.workflow_runs ?? []).filter((r) => kstDay(r.created_at) === today);

  if (ranToday.length) {
    const r = ranToday[0];
    console.log(`✅ 오늘(${today}) 발행 실행됨 — ${r.created_at.slice(11, 16)}Z ${r.status}/${r.conclusion ?? '진행중'} (${r.event})`);
    return;
  }

  const last = runs.workflow_runs?.[0];
  const lastSeen = last ? `${kstDay(last.created_at)} (${last.event})` : '기록 없음';
  console.log(`🚨 오늘(${today}) 발행이 실행되지 않았다. 마지막 실행: ${lastSeen}`);

  const lines = [
    '🚨 오늘 자동 발행이 실행되지 않았습니다',
    '',
    `오늘 날짜: ${today} (KST)`,
    `마지막 실행: ${lastSeen}`,
    '',
    '워크플로가 꺼진 게 아니라 GitHub이 예약 실행을 건너뛴 경우입니다.',
    '2026-08-27에 실제로 그랬고, 그날은 아무도 몰랐습니다.',
  ];

  if (dry) {
    console.log(lines.join('\n'));
    return;
  }

  if (noDispatch) {
    lines.push('', '자동 재시작은 꺼져 있습니다. 필요하면 Actions에서 수동 실행하세요.');
    await telegram(lines.join('\n'));
    return;
  }

  try {
    // No count is passed, so the run reads data/publish-throttle.json like a
    // scheduled one would. A rescue must not quietly publish past the throttle.
    await api(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main' }),
    });
    lines.push('', '▶️ 대신 지금 실행을 걸었습니다 (발행 편수는 스로틀 설정을 따릅니다).');
    console.log('발행을 수동으로 시작했다.');
  } catch (e) {
    lines.push('', `⚠️ 자동 재시작도 실패했습니다: ${e.message.slice(0, 150)}`);
    console.error(e.message);
    process.exitCode = 1;
  }

  await telegram(lines.join('\n'));
}

// Return rather than process.exit(): exiting while an undici handle is still open
// trips a libuv assertion on Windows and reports 127 to CI.
await main();
