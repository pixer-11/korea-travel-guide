#!/usr/bin/env bash
# Sends a run-result message (Korean) to Telegram. No-op (and never fails the job)
# if the TELEGRAM_* secrets aren't set.
# Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, JOB_STATUS, NEW, TOTAL
# Arg $1: label from the workflow (English key, mapped to Korean below).
LABEL="${1:-실행}"
UNIT="글" # item unit — "글"(posts) by default, "장"(photos) for venue photos

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "Telegram secrets not set — skipping notification."
  exit 0
fi

# Map the workflow's English label to Korean (and pick the right item unit).
case "$LABEL" in
  "Backfill")      LABEL="대량 발행" ;;
  "Daily publish") LABEL="일일 자동발행" ;;
  "Venue photos")  LABEL="장소 사진"; UNIT="장" ;;
esac

# Korean job status.
case "${JOB_STATUS:-}" in
  success) STATUS_KO="성공" ;;
  failure) STATUS_KO="실패" ;;
  *)       STATUS_KO="${JOB_STATUS:-알수없음}" ;;
esac

NEW="${NEW:-0}"
TOTAL="${TOTAL:-?}"
DATE="$(TZ='Asia/Seoul' date '+%Y-%m-%d %H:%M KST')"

# ✅ success with new items · ⚠️ success but 0 (quota used up / already full) · ❌ failed
if [ "${JOB_STATUS:-}" != "success" ]; then
  ICON="❌"; NOTE="
⚠️ 실행에 실패했어요. GitHub Actions 로그를 확인해 주세요."
elif [ "${NEW}" = "0" ]; then
  ICON="⚠️"; NOTE="
ℹ️ 새 ${UNIT} 0개 — 오늘 Places 한도 소진(또는 이미 목표치 도달)입니다. 한도가 리셋되면 다음 실행에서 더 채워져요."
else
  ICON="✅"; NOTE=""
fi

# Optional list of the posts published this run (title + URL, one entry per two
# lines), passed via NEW_LIST env, so the reader can open and check each new post.
LIST_BLOCK=""
if [ -n "${NEW_LIST:-}" ]; then
  LIST_BLOCK="

📄 오늘 발행된 글:
${NEW_LIST}"
fi

TEXT="🗺️ Wander Atlas — ${LABEL}
${ICON} 상태: ${STATUS_KO}
📝 새 ${UNIT}: ${NEW}개
📚 전체 글: ${TOTAL}개
🕒 ${DATE}${NOTE}${LIST_BLOCK}"

# Print the Telegram API response so failures are diagnosable (never contains the token).
RESP=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  -d "disable_web_page_preview=true")

if echo "$RESP" | grep -q '"ok":true'; then
  echo "✅ Telegram notification sent."
else
  echo "⚠️  Telegram send FAILED. API said: ${RESP}"
  echo "    (Common causes: wrong TELEGRAM_BOT_TOKEN → 401; wrong TELEGRAM_CHAT_ID → 400/403.)"
fi

exit 0
