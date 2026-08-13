# Daily OG mirror patrol (ASCII only - Windows scheduled task).
# Runs after the 16:19 KST publish: mirrors any NEW hero images to R2 and
# commits the updated table so the next site build serves /og/ URLs for them.
# Registered as scheduled task WA_OgMirror (17:30 daily) on 2026-08-09.
$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\user\wa-main'

# The checkout used to live in %TEMP%, where Windows Disk Cleanup emptied it on
# 2026-08-13 (67 tracked files and most of node_modules). It has since moved out,
# but the healer stays: it costs nothing when the tree is intact, and the
# stash/pop below would otherwise carry any damage into the commit.
node scripts\heal-worktree.mjs 2>&1 | Out-File -Encoding utf8 "$env:TEMP\og-mirror-last.log"

git stash --quiet
git pull --rebase origin main 2>&1 | Out-Null
git stash pop --quiet 2>&1 | Out-Null

node scripts\mirror-og-images.mjs 2>&1 | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
# Region tiles without a photo: resumable, skips regions already covered.
node scripts\backfill-region-covers.mjs 2>&1 | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"

$diff = git status --porcelain data/og-mirror.json data/region-covers.json
if ($diff) {
  git add data/og-mirror.json data/region-covers.json
  # A patrol adds photo records; it never removes files. If a deletion reached
  # the index anyway (a purge the healer could not undo), unstage and stop --
  # pushing it would drop live data from main.
  $doomed = git diff --cached --name-only --diff-filter=D
  if ($doomed) {
    git reset --quiet
    "ABORT: staged deletions, refusing to commit: $doomed" | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
    exit 1
  }
  git commit -m "chore: og mirror + region cover catch-up (daily patrol)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  # Another session pushing first makes this push bounce. The old script ignored
  # that and exited 0, leaving the day's mirror table committed but local-only --
  # observed 2026-08-13, and invisible because nothing reads the log. Rebase on
  # top of whatever landed and try once more; say so loudly if it still fails.
  git push origin main | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
  if ($LASTEXITCODE -ne 0) {
    "push rejected - rebasing onto origin/main and retrying" | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
    git pull --rebase origin main | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
    git push origin main | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
    if ($LASTEXITCODE -ne 0) {
      "PUSH FAILED TWICE - mirror table is committed locally but not on main" | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"
      exit 1
    }
  }
}
