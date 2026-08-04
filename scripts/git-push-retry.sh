#!/usr/bin/env bash
# 공용 푸시 재시도 — 20개 워크플로가 매일 같은 main에 커밋하는데, 대부분은
# `git pull --rebase && git push` 1회짜리였다. 한 번 부딪히면 잡이 실패하고
# 그 실행의 유료 작업(Places 쿼터, vision 호출, 생성 비용)이 통째로 사라진다.
# discover-events.yml에만 있던 재시도 루프를 스크립트로 빼서 어디서나 쓴다.
#
#   bash scripts/git-push-retry.sh              # HEAD → main
#   bash scripts/git-push-retry.sh <branch>     # HEAD → <branch>
#
# -X theirs: 콘텐츠 봇끼리 같은 생성 파일을 건드렸을 때 원격을 존중하고
# 우리 변경을 그 위에 얹는다(경합의 실체가 "둘 다 새 파일 추가"라 안전).
#
# --autostash 가 반드시 필요하다 (2026-08-04): rebase 는 스테이징되지 않은
# 변경이 하나라도 있으면 시작 자체를 거부하고, 그러면 아래 `rebase --abort` 가
# "fatal: no rebase in progress" 를 뱉으며 5회 전부 헛돈다. 원격과 부딪히지도
# 않았는데 푸시가 실패하는 것이다. 워크플로 대부분은 생성물 경로만 골라
# 스테이징하므로(`git add data/... src/content/posts`) 다른 스크립트가 건드린
# 파일이 unstaged 로 남는 일이 정상적으로 일어난다 — 즉 이 경로는 예외가 아니라
# 평범한 밤에 밟을 수 있는 길이었다.
set -uo pipefail
BRANCH="${1:-main}"

for attempt in 1 2 3 4 5; do
  git fetch origin "$BRANCH" || true
  if git rebase --autostash -X theirs "origin/$BRANCH"; then
    if git push origin "HEAD:$BRANCH"; then
      echo "pushed (attempt $attempt)"
      exit 0
    fi
  else
    git rebase --abort || true
  fi
  echo "push attempt $attempt failed — syncing and retrying…"
  sleep $((attempt * 5))
done

echo "::error::could not push to $BRANCH after 5 attempts"
exit 1
