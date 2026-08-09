# One-shot detached runner (ASCII only): finish the prose repair queue,
# validate, commit. Survives harness timeouts. Started 2026-08-10.
Set-Location 'C:\Users\user\AppData\Local\Temp\wa-main'
$log = "$env:TEMP\prose-repair.log"
"start $(Get-Date -Format o)" | Out-File -Encoding utf8 $log
node scripts\repair-prose.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\validate-content.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\audit-translations.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
$diff = git status --porcelain src/content/posts
if ($diff) {
  git add src/content/posts data/full-audit.json
  git commit -m "fix: weekly prose repair batch - invented specifics removed or generalised" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  git push origin main
}
"done $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log
