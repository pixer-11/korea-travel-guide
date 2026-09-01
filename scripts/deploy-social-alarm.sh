#!/usr/bin/env bash
# Deploys workers/social-alarm from a machine where wrangler is logged in
# (wrangler login, done 2026-08-29 on the owner's PC). Not wired to CI: the
# auto-mode classifier rightly refuses to let an agent author a workflow that
# handles token secrets, and local deploy needs no such file.
#
# The worker's runtime secrets are set separately (once, or on rotation):
#   npx wrangler@4 secret put GH_DISPATCH_TOKEN   # PAT, dispatch only
#   npx wrangler@4 secret put FIRE_KEY            # /fire auth
#   npx wrangler@4 secret put TELEGRAM_BOT_TOKEN  # alert channel (see below)
#   npx wrangler@4 secret put TELEGRAM_CHAT_ID
# Paste the value at the prompt rather than piping it in — a piped value can
# carry a trailing newline into the secret, and the prompt keeps it out of
# shell history. On Windows PowerShell call `npx.cmd`: the execution policy
# refuses to load npx.ps1 and the error looks nothing like the real cause.
# Smoke test after deploy (a real dispatch — idempotent, the day guard skips):
#   curl -X POST -H "Authorization: Bearer <FIRE_KEY>" <worker-url>/fire
# 200 = GitHub accepted; 502 = GitHub refused (check the PAT first).
# Since 2026-08-31 /fire wakes all three targets at once (threads-daily plus
# both watchdogs), so expect three entries back. Each is guarded, so the smoke
# test costs three no-op runs rather than three days of duplicated work — and
# the PAT must be able to dispatch the watchdogs too, not just threads-daily.
# Telegram secrets ARE set since 2026-09-01; they were deliberately absent
# before. The old reasoning — the safety net (three GitHub crons +
# schedule-watchdog) still delivers, so a worker-side alert is a second bell on
# the same door — holds for the WORK, but not for the alarm clock itself:
# nothing watches this worker, and a dead GH_DISPATCH_TOKEN would otherwise
# show up only as the watchdog rescuing more often. The alert fires solely on a
# dispatch GitHub refused, so it stays silent unless the PAT is really dead.
set -euo pipefail

cd "$(dirname "$0")/../workers/social-alarm"
npx --yes wrangler@4 deploy
echo "social-alarm deployed."
