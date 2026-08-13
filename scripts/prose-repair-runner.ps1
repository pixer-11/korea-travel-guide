# One-shot detached runner (ASCII only): finish the prose repair queue,
# validate, commit. Survives harness timeouts. Started 2026-08-10.
Set-Location 'C:\Users\user\wa-main'
$log = "$env:TEMP\prose-repair.log"
"start $(Get-Date -Format o)" | Out-File -Encoding utf8 $log
# The checkout is inside %TEMP%, which Windows Disk Cleanup empties. Restore
# anything it took before staging a whole directory below.
node scripts\heal-worktree.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\repair-prose.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\validate-content.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\audit-translations.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
$diff = git status --porcelain src/content/posts
if ($diff) {
  git add src/content/posts data/full-audit.json
  # A prose repair rewrites posts; it never removes them. A staged deletion here
  # means the checkout was purged, and pushing it would delete live articles.
  $doomed = git diff --cached --name-only --diff-filter=D
  if ($doomed) {
    git reset --quiet
    "ABORT: staged deletions, refusing to commit: $doomed" | Out-File -Append -Encoding utf8 $log
    exit 1
  }
  git commit -m "fix: weekly prose repair batch - invented specifics removed or generalised" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  # A racing session's push makes this one bounce; ignoring that leaves the work
  # committed but local-only (seen on the og-mirror patrol, 2026-08-13).
  git push origin main | Out-File -Append -Encoding utf8 $log
  if ($LASTEXITCODE -ne 0) {
    git pull --rebase origin main | Out-File -Append -Encoding utf8 $log
    git push origin main | Out-File -Append -Encoding utf8 $log
    if ($LASTEXITCODE -ne 0) { "PUSH FAILED TWICE - committed locally, not on main" | Out-File -Append -Encoding utf8 $log }
  }
}
"done $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log
