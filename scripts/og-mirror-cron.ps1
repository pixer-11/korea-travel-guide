# Daily OG mirror patrol (ASCII only - Windows scheduled task).
# Runs after the 16:19 KST publish: mirrors any NEW hero images to R2 and
# commits the updated table so the next site build serves /og/ URLs for them.
# Registered as scheduled task WA_OgMirror (17:30 daily) on 2026-08-09.
$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\user\AppData\Local\Temp\wa-main'

git stash --quiet
git pull --rebase origin main 2>&1 | Out-Null
git stash pop --quiet 2>&1 | Out-Null

node scripts\mirror-og-images.mjs 2>&1 | Out-File -Encoding utf8 "$env:TEMP\og-mirror-last.log"
# Region tiles without a photo: resumable, skips regions already covered.
node scripts\backfill-region-covers.mjs 2>&1 | Out-File -Append -Encoding utf8 "$env:TEMP\og-mirror-last.log"

$diff = git status --porcelain data/og-mirror.json data/region-covers.json
if ($diff) {
  git add data/og-mirror.json data/region-covers.json
  git commit -m "chore: og mirror + region cover catch-up (daily patrol)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  git push origin main
}
