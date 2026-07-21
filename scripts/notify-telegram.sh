#!/usr/bin/env bash
# Sends a run-result message to Telegram. No-op (and never fails the job) if the
# TELEGRAM_* secrets aren't set.
# Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, JOB_STATUS, NEW, TOTAL
# Arg $1: label shown in the message (e.g. "Backfill", "Daily publish").
LABEL="${1:-Run}"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "Telegram secrets not set — skipping notification."
  exit 0
fi

if [ "${JOB_STATUS:-}" = "success" ]; then ICON="✅"; else ICON="❌"; fi
NEW="${NEW:-0}"
TOTAL="${TOTAL:-?}"
DATE="$(date -u '+%Y-%m-%d %H:%M UTC')"

TEXT="🗺️ Wander Atlas — ${LABEL}
${ICON} status: ${JOB_STATUS:-unknown}
📝 new posts: ${NEW}
📚 total posts: ${TOTAL}
🕒 ${DATE}"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  -d "disable_web_page_preview=true" > /dev/null \
  && echo "Telegram notification sent." || echo "Telegram send failed (non-fatal)."

exit 0
