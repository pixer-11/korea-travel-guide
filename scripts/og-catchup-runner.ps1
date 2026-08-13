# One-shot catch-up runner (ASCII only): waits out the Wikimedia cooldown,
# then finishes the OG mirror and the region-cover backfill SEQUENTIALLY so
# the two scripts never hit the API at the same time. Logs to %TEMP%.
# Started detached on 2026-08-09; safe to re-run (both scripts are resumable).
Set-Location 'C:\Users\user\AppData\Local\Temp\wa-main'
$log = "$env:TEMP\og-catchup.log"
"start $(Get-Date -Format o)" | Out-File -Encoding utf8 $log
Start-Sleep -Seconds 1200
# The checkout is inside %TEMP%, which Windows Disk Cleanup empties -- after a
# 20 minute sleep it may have been purged out from under this run.
node scripts\heal-worktree.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
node scripts\mirror-og-images.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
Start-Sleep -Seconds 120
node scripts\backfill-region-covers.mjs 2>&1 | Out-File -Append -Encoding utf8 $log
"done $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log
