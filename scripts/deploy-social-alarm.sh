#!/usr/bin/env bash
# Deploys workers/social-alarm from a machine where wrangler is logged in
# (wrangler login, done 2026-08-29 on the owner's PC). Not wired to CI: the
# auto-mode classifier rightly refuses to let an agent author a workflow that
# handles token secrets, and local deploy needs no such file.
#
# The worker's runtime secrets are set separately (once, or on rotation):
#   printf ... | npx wrangler@4 secret put GH_DISPATCH_TOKEN   # PAT, dispatch only
#   printf ... | npx wrangler@4 secret put FIRE_KEY            # /fire auth
# Smoke test after deploy (a real dispatch — idempotent, the day guard skips):
#   curl -X POST -H "Authorization: Bearer <FIRE_KEY>" <worker-url>/fire
# 200 = GitHub accepted; 502 = GitHub refused (check the PAT first).
# No Telegram secrets on purpose — if the alarm dies, the existing safety net
# (three GitHub crons + schedule-watchdog) still delivers and the watchdog
# already telegrams when it rescues, so a worker-side alert would be a
# second bell on the same door.
set -euo pipefail

cd "$(dirname "$0")/../workers/social-alarm"
npx --yes wrangler@4 deploy
echo "social-alarm deployed."
