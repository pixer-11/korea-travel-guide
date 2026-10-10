#!/usr/bin/env node
// Hand Bing today's quota of URLs through the URL Submission API, on top of
// IndexNow. See lib/bing-submit.mjs for why and in what order. Runs inside
// indexnow.yml; a refused batch is a warning, never a red job.
//   BING_API_KEY=… node scripts/bing-submit-urls.mjs          # submit
//   DRY=1 node scripts/bing-submit-urls.mjs                   # list only
import { fileURLToPath } from 'node:url';
import { loadPostsForBing, pickBingSubmissions, getSubmissionQuota, submitUrlBatch, MAX_PER_RUN } from './lib/bing-submit.mjs';

const key = process.env.BING_API_KEY;
const DRY = process.env.DRY === '1';
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST day, same clock as the other lists
const posts = loadPostsForBing(fileURLToPath(new URL('../src/content/', import.meta.url)));

if (DRY) {
  const urls = pickBingSubmissions(posts, today, MAX_PER_RUN);
  console.log(urls.join('\n'));
  console.log(`BING_SUBMIT dry=1 day=${today} would_submit=${urls.length}`);
  process.exit(0);
}
if (!key) { console.log('BING_API_KEY unset — Bing URL submission skipped'); process.exit(0); }

try {
  const quota = await getSubmissionQuota(key);
  const urls = pickBingSubmissions(posts, today, quota.daily);
  if (!urls.length) { console.log(`BING_SUBMIT day=${today} quota_daily=${quota.daily} submitted=0 (quota spent or pool empty)`); process.exit(0); }
  const n = await submitUrlBatch(key, urls);
  console.log(urls.slice(0, 5).map((u) => `  • ${u}`).join('\n') + (urls.length > 5 ? `\n  … +${urls.length - 5}` : ''));
  console.log(`BING_SUBMIT day=${today} quota_daily=${quota.daily} quota_monthly=${quota.monthly} submitted=${n}`);
} catch (e) {
  console.log(`::warning::Bing URL submission failed (non-fatal): ${String(e.message).slice(0, 200)}`);
}
