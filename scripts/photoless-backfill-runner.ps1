# One-shot detached runner (ASCII only): wait for the prose repair to finish,
# then fill the photoless LIVE events (patrol scope widened 2026-08-10),
# validate, commit. Wikimedia is paced inside the script itself.
Set-Location 'C:\Users\user\wa-main'
$log = "$env:TEMP\photoless-backfill.log"
"start $(Get-Date -Format o)" | Out-File -Encoding utf8 $log

# wait (max 40 min) for the prose runner's final marker
$deadline = (Get-Date).AddMinutes(40)
while ((Get-Date) -lt $deadline) {
  $p = "$env:TEMP\prose-repair.log"
  if ((Test-Path $p) -and (Select-String -Path $p -Pattern '^done ' -Quiet)) { break }
  Start-Sleep -Seconds 60
}
"prose runner settled $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log

# The checkout is inside %TEMP%, which Windows Disk Cleanup empties. Restore
# anything it took before staging a whole directory below.
node scripts\heal-worktree.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\backfill-photos-alt.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\validate-content.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
$diff = git status --porcelain src/content/posts data/visual-audit.json
if ($diff) {
  git add src/content/posts data/visual-audit.json
  # This sweep adds photos to posts; it never retires one. Any staged deletion
  # is damage (a purged checkout), and pushing it would delete live articles --
  # the 2026-07-26 accident that cost 40% of traffic.
  $doomed = git diff --cached --name-only --diff-filter=D
  if ($doomed) {
    git reset --quiet
    "ABORT: staged deletions, refusing to commit: $doomed" | Out-File -Append -Encoding utf8 $log
    exit 1
  }
  git commit -m "fix: photoless live events join the photo patrol - first sweep" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  git push origin main
}
"done $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log
