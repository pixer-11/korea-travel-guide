#!/usr/bin/env bash
# Deploys workers/social-alarm and hands it its runtime credentials.
# Called by .github/workflows/deploy-social-alarm.yml, which maps the values
# in from GitHub Secrets — same custody chain as every other workflow here.
# `wrangler secret put` reads each value from stdin; nothing is echoed.
set -euo pipefail

cd "$(dirname "$0")/../workers/social-alarm"

npx --yes wrangler@4 deploy

# An empty value would silently store a blank secret, so fail loudly first.
: "${GH_DISPATCH_TOKEN:?GH_DISPATCH_TOKEN missing}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN missing}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID missing}"
: "${FIRE_KEY:?FIRE_KEY missing}"

for name in GH_DISPATCH_TOKEN TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID FIRE_KEY; do
  printf '%s' "${!name}" | npx --yes wrangler@4 secret put "$name"
done

echo "social-alarm deployed; secrets stored."
