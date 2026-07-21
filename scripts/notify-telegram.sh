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

NEW="${NEW:-0}"
TOTAL="${TOTAL:-?}"
DATE="$(date -u '+%Y-%m-%d %H:%M UTC')"

# ✅ only when the run succeeded AND actually added posts; ⚠️ on success-but-0
# (usually the Places daily quota is used up, or a country is already full).
if [ "${JOB_STATUS:-}" != "success" ]; then
  ICON="❌"; NOTE=""
elif [ "${NEW}" = "0" ]; then
  ICON="⚠️"; NOTE="
ℹ️ 0 posts — Places daily quota likely reached (or already at target). The next run after quota reset will add more."
else
  ICON="✅"; NOTE=""
fi

TEXT="🗺️ Wander Atlas — ${LABEL}
${ICON} status: ${JOB_STATUS:-unknown}
📝 new posts: ${NEW}
📚 total posts: ${TOTAL}
🕒 ${DATE}${NOTE}"

# Print the Telegram API response so failures are diagnosable. The response
# never contains the bot token, so it's safe to show in the log.
RESP=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  -d "disable_web_page_preview=true")

if echo "$RESP" | grep -q '"ok":true'; then
  echo "✅ Telegram notification sent."
else
  echo "⚠️  Telegram send FAILED. API said: ${RESP}"
  echo "    (Common causes: wrong TELEGRAM_BOT_TOKEN → 401 Unauthorized;"
  echo "     wrong TELEGRAM_CHAT_ID or you never messaged the bot → 400/403.)"
fi

exit 0
