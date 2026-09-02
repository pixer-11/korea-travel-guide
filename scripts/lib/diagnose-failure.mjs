// Read a failed run's log and say WHY, in the owner's language.
//
// Every scheduled workflow's failure funnels through job-failure-alert.yml,
// and until now that alert said the same sentence for all of them: "대부분
// 일시적 오류라 다음 실행에서 저절로 회복됩니다… 이틀 연속이면 클로드에게
// 물어보세요." On 2026-08-30 the cause was an Anthropic monthly spend cap that
// states its own reset time in the error text — the log knew, the alert did
// not, and the owner spent the morning relaying screenshots so I could read
// what was already written down.
//
// Signatures are added only from failures we have actually seen. A guess that
// names the wrong cause is worse than no name at all, so anything unmatched
// falls back to quoting the run's own last error line.

/** @type {{id:string, re:RegExp, cause:(m:RegExpMatchArray, log:string)=>string, selfHeals:boolean}[]} */
const SIGNATURES = [
  {
    id: 'anthropic-usage-limit',
    // "You have reached your specified API usage limits. You will regain
    // access on 2026-09-01 at 00:00 UTC." — an account spend cap, not a key
    // problem, and it lifts on its own at a stated time (2026-08-30).
    re: /reached your specified API usage limits/,
    cause: (m, log) => {
      const when = log.match(/regain access on ([0-9-]+) at ([0-9:]+) UTC/);
      return 'Anthropic API 월 사용 한도(계정 상한)에 도달했습니다. 키 만료가 아니라 한도이며 ' +
      (when ? `${when[1]} ${when[2]} UTC` : '콘솔에 적힌 리셋 시각') +
      '에 저절로 풀립니다. 더 빨리 재개하려면 Anthropic 콘솔에서 상한을 올리세요.'; },
    selfHeals: true,
  },
  {
    id: 'anthropic-overloaded',
    re: /"type":"(?:overloaded_error|rate_limit_error)"|529 .*overloaded/,
    cause: () => 'Anthropic API가 일시적으로 과부하/속도제한 상태였습니다. 다음 실행에서 저절로 회복됩니다.',
    selfHeals: true,
  },
  {
    id: 'places-quota',
    re: /RESOURCE_EXHAUSTED|Places[^\n]*\b429\b|quota-429/,
    cause: () => '구글 Places 한도(429)에 걸렸습니다. 하루 장부를 넘긴 것이라 다음 날 리셋되면 재개됩니다.',
    selfHeals: true,
  },
  {
    id: 'git-push-denied',
    re: /Permission to [^\s]+ denied|remote: Write access to repository not granted|fatal: Authentication failed/,
    cause: () => '깃허브 푸시 권한이 거부됐습니다. 토큰 만료·권한 축소일 수 있어 사람이 확인해야 합니다.',
    selfHeals: false,
  },
  {
    id: 'git-conflict',
    re: /CONFLICT \(content\)|Automatic merge failed|non-fast-forward|failed to push some refs/,
    cause: () => '다른 작업과 같은 파일이 겹쳐 저장(푸시)에 실패했습니다. 대개 다음 실행에서 풀립니다.',
    selfHeals: true,
  },
  {
    id: 'npm-install',
    re: /npm ERR!|ERESOLVE|Cannot find module/,
    cause: () => '의존성 설치/모듈 로드에서 실패했습니다. 최근 커밋이 원인일 수 있어 확인이 필요합니다.',
    selfHeals: false,
  },
  {
    id: 'test-failure',
    // The astro-check shape allows for the timestamp GitHub puts at the start
    // of the next line — `\s*\n?-` never matched a real log (2026-09-02).
    re: /# fail [1-9]|✖ failing tests|Result \(\d+ files\):[\s\S]{0,80}?-\s*[1-9]\d* error/,
    cause: () => '테스트/타입 검사가 실패했습니다. 코드 변경이 원인이므로 사람이 고쳐야 합니다.',
    selfHeals: false,
  },
  {
    id: 'secret-missing',
    re: /(?:API_KEY|ACCESS_TOKEN|_TOKEN)[^\n]{0,40}(?:not set|missing|is empty)/i,
    cause: () => '필요한 키(Secret)가 비어 있습니다. GitHub Secrets 확인이 필요합니다.',
    selfHeals: false,
  },
  {
    id: 'runner-disk',
    re: /ENOSPC|No space left on device/,
    cause: () => '실행 서버의 디스크가 가득 찼습니다. 대개 일시적이며 다음 실행에서 회복됩니다.',
    selfHeals: true,
  },
  {
    id: 'network',
    re: /ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo/,
    cause: () => '네트워크 오류로 외부 요청이 실패했습니다. 대개 일시적입니다.',
    selfHeals: true,
  },
];

const ANSI = /\x1b\[[0-9;]*m/g;
const TIMESTAMP = /^\S*\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/;

/** The run's own last error line — evidence, used when nothing matches and shown when something does. */
// GitHub echoes every `run:` script into the step log in cyan before executing
// it. A signature that appears INSIDE a workflow's own shell — publish.yml greps
// its logs for "reached your specified API usage limits" — therefore appears in
// every run's log, success or failure, and matched first. Every publish failure
// was diagnosed as a self-healing spend cap (found 2026-09-02). The echoed
// lines are dropped before matching; the runner marks each with ESC[36;1m
// right after the timestamp, which real output never carries.
const ECHOED_COMMAND = /^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?\x1b\[36;1m/;
export function stripEchoedCommands(log) {
  return String(log ?? '').split('\n').filter((l) => !ECHOED_COMMAND.test(l)).join('\n');
}

// GitHub appends "##[error]Process completed with exit code N." to every failed
// step, so scanning backwards for the last ##[error] returned that epilogue
// every time and the owner's "로그 마지막 오류" line said nothing. Prefer the
// nearest real error above it; fall back to the epilogue only when the log has
// nothing else to say.
const EPILOGUE = /^Process completed with exit code \d+\.?$/;
const ERROR_SHAPED = /^(?:[A-Za-z]*Error|FATAL|fatal|error)\b:?/;
export function lastErrorLine(log) {
  const lines = log.replace(ANSI, '').split('\n');
  let epilogue = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].replace(TIMESTAMP, '').trim();
    if (!l) continue;
    const bare = l.replace(/^##\[error\]/, '');
    if (/^##\[error\]/.test(l)) {
      if (EPILOGUE.test(bare)) { if (!epilogue) epilogue = bare; continue; }
      return bare.slice(0, 300);
    }
    if (ERROR_SHAPED.test(l)) return l.slice(0, 300);
  }
  return epilogue;
}

/**
 * @param {string} log  raw (or ANSI-coloured) run log
 * @returns {{id:string|null, cause:string, evidence:string, selfHeals:boolean|null}}
 */
export function diagnose(log) {
  const clean = stripEchoedCommands(log).replace(ANSI, '');
  for (const s of SIGNATURES) {
    const m = clean.match(s.re);
    if (m) return { id: s.id, cause: s.cause(m, clean), evidence: lastErrorLine(clean), selfHeals: s.selfHeals };
  }
  return { id: null, cause: '', evidence: lastErrorLine(clean), selfHeals: null };
}

/** The Telegram body for a failed run — cause when known, evidence always. */
export function alertText(workflowName, url, log) {
  const d = diagnose(log);
  const head = `⚠️ 자동 작업 실패 — ${workflowName}`;
  const lines = [head, ''];
  if (d.cause) {
    lines.push(`원인: ${d.cause}`);
    lines.push(d.selfHeals ? '자동 회복 대상이라 따로 하실 일은 없습니다.' : '👉 사람이 확인해야 하는 종류입니다.');
  } else {
    lines.push('작업이 도중에 멈춰서 평소 오던 보고가 오지 않았습니다.');
    lines.push('대부분 일시적 오류라 다음 실행에서 저절로 회복됩니다.');
    lines.push(`같은 작업이 이틀 연속 실패하면 클로드에게 '${workflowName} 실패 원인 찾아줘'라고 말씀하세요.`);
  }
  if (d.evidence) lines.push('', `로그 마지막 오류: ${d.evidence}`);
  lines.push('', `실행 기록: ${url}`);
  return lines.join('\n');
}
