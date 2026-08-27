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

# 한쪽이 지우고 한쪽이 고친 파일(modify/delete)은 -X theirs 로 풀리지 않는다.
# -X 는 "양쪽 다 내용이 있을 때" 어느 쪽 줄을 쓸지 고르는 전략이라, 한쪽에
# 파일 자체가 없는 충돌에는 고를 줄이 없기 때문이다. 2026-08-27 밤에 이것이
# 실제로 터졌다: 발행 런이 만료 이벤트의 번역 파일을 지웠고, 그 40분 사이 다른
# 워크플로가 같은 파일을 고쳐 올렸다. rebase 는 매번 같은 지점에서 멈췄고 —
# 상태가 변하지 않으니 재시도 5회가 전부 똑같이 실패했다 — 그날 만든 글 36편이
# 러너와 함께 사라졌다. 텔레그램은 그 36편의 링크를 자랑스럽게 나열했고 전부
# 404였다.
#
# 그래서 이 종류의 충돌만 원격의 결정대로 정리하고 rebase 를 계속한다.
# 원격에 파일이 남아 있으면 남기고(우리의 삭제를 이번엔 포기), 원격이 지웠으면
# 지운다(그 파일에 대한 우리 수정을 포기). 어느 쪽이든 잃는 것은 파일 하나에
# 대한 판단 한 번이고 — 다음 실행이 다시 시도한다 — 지키는 것은 그 실행이 만든
# 나머지 전부다. 내용이 양쪽에 다 있는 진짜 충돌은 손대지 않고 종전대로 abort.
resolve_delete_conflicts() {
  local acted=0
  local path stages
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    stages=$(git ls-files -u -- "$path" | awk '{print $3}' | sort -u | tr '\n' ' ')
    case "$stages" in
      *2*3*)
        echo "  ↳ 자동 해결 불가(양쪽 모두 내용 있음): $path"
        return 1 ;;
      *2*)
        git add -- "$path" || return 1
        echo "  ↳ 원격에 남아 있어 유지, 이번 삭제는 포기: $path"
        acted=1 ;;
      *3*)
        git rm -q -f -- "$path" || return 1
        echo "  ↳ 원격이 지운 파일이라 삭제, 이번 수정은 포기: $path"
        acted=1 ;;
      *)
        echo "  ↳ 자동 해결 불가(알 수 없는 충돌 상태 '$stages'): $path"
        return 1 ;;
    esac
  done < <(git diff --name-only --diff-filter=U)

  [ "$acted" = "1" ] || return 1

  # 남은 변경이 없으면 --continue 는 "빈 커밋" 이라며 멈춘다 — 그때는 건너뛴다.
  if git diff --cached --quiet && git diff --quiet; then
    GIT_EDITOR=true git rebase --skip
  else
    GIT_EDITOR=true git rebase --continue
  fi
}

for attempt in 1 2 3 4 5; do
  git fetch origin "$BRANCH" || true
  rebased=0
  if git rebase --autostash -X theirs "origin/$BRANCH"; then
    rebased=1
  elif [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
    echo "rebase 충돌 — 삭제/수정 충돌인지 확인한다"
    if resolve_delete_conflicts; then
      echo "  ↳ 정리하고 rebase 를 계속했다"
      rebased=1
    else
      git rebase --abort || true
    fi
  fi
  if [ "$rebased" = "1" ]; then
    if git push origin "HEAD:$BRANCH"; then
      echo "pushed (attempt $attempt)"
      exit 0
    fi
  fi
  echo "push attempt $attempt failed — syncing and retrying…"
  sleep $((attempt * 5))
done

echo "::error::could not push to $BRANCH after 5 attempts"
exit 1
