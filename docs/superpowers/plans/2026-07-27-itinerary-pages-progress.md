# SDD ledger — plan: docs/superpowers/plans/2026-07-27-itinerary-pages.md
Task 1: fix round 1/5 (3 addressed, 0 open; commits bb8c886..0175ecc)
Task 1: complete (commits 7eab524..0175ecc, review clean)
Task 2: complete (commits 0175ecc..cf327a8, review clean)
Task 3: complete (commit f965a7c). build passes. Real launch cities (Seoul 9, Tokyo 10, Bangkok 9 qualifying posts) don't yet clear gateFor().threeDay (needs 12) — no itinerary files produced against live data; script logic verified end-to-end on an isolated synthetic fixture instead. Task 3.5 (geocode backfill) in flight to close the gap; re-run builder after.
Task 3: fix round 1/1 (6 review items + Q2 response-shape validation addressed; commit cb035e2). Added scripts/build-itineraries.test.mjs (20 tests, all pass). Atomic temp-file+rename writes, per-city try/catch + incremental state persistence, rain-swap leak guard, hours/price prose guard (both with one retry), draft:true preserved, --city= now respects the new-city cap (--force-new-city to override). Re-verified end-to-end on the synthetic fixture — guard caught and fixed a real violation via retry, zero violations in shipped output. Did not re-run against real content per coordinator instruction (Task 3.5 backfill still in flight).
Task 3: fix round 2/2 (commit d81f0fa, on top of merge 0fc7eb9). Real build against real data blocked EVERY city — hours-language regex (\bopens?\b|\bcloses?\b) false-positived on ordinary prose ("close to the palace", "open-air market"). Fixed with 6 claim-anchored patterns; extracted shared src/lib/prose-guard.mjs used by both build-itineraries.mjs and validate-itineraries.mjs (was two drifting copies). Also found+fixed a second false-positive: rain-swap venue titles containing the city name (e.g. "...in Seoul") made the city name a match-everything token in findRainSwapLeaks — now excluded via rainVenueTerms(title, cityName). 61/61 tests pass. Merged origin/main (geocode backfill) to clear the 12-post gate — 3 add/add conflicts resolved (kept ours: itinerary.mjs, geocode-placeless.test.mjs; took theirs: geocode-placeless.yml). Seoul 13, Tokyo 13, Bangkok 12 qualifying. Real build: seoul/tokyo/bangkok-3-days.md generated, validator exits 0. Seoul prose inspected — reads as genuine first-hand visit report, no invented venues, zero hours/price leaks (independently re-scanned). Seoul day-1 rain-swap correctly dropped to null (leaked venue name survived retry) rather than shipped or hard-failed.
Task 3: paused mid-review — builder correct but real data blocks gates (Seoul 9/Tokyo 10/Bangkok 9 qualifying; 13 placeless posts lack coords). Inserted Task 3.5 geocode-placeless (script+workflow, CI-run because local Places IP 403).
Task 3.5: fix round 1/5 dispatched (line-endings Important + 2 minors)
Deferred minor (tree): @astrojs/check+typescript added to dependencies (should be devDependencies), uncommitted — tidy at final review
Task 3.5: fix round 1/5 (3 addressed, 0 open; commits 9ee7762..a5f63e8)
Task 3: fix round 1/5 dispatched (4 Important: atomic write, incremental state, rain-swap leak, prose guard; 2 minors)
Task 3: fix round 1/5 (6 addressed, 0 open; commits f965a7c..cb035e2)
Task 3: complete (commits a5f63e8..cb035e2, review clean)
Task 3.5: Seoul run OK — 3 attached / 4 skipped (2 closed venues, 1 name-variant false negative "Euljiro" vs "Eulji-ro", 1 correct reject). Seoul now 12 qualifying = gate cleared. All-regions run dispatched.
Deferred minor: name gate too strict on hyphen variants (Euljiro); 2 Seoul posts point at CLOSED venues (cafe-3-stripes TEMP, hakusi PERM) — content issue, not itinerary.
NOTE: concurrent non-SDD work present in working tree (gallery photos on ~18 posts, vision-check.mjs, PostArticle.astro) — NOT from this plan; all SDD commits stage explicit paths only.
Task 4: fix round 1/5 (2 addressed, 0 open; commits 5eedb0a..3e071c4)
Task 4: complete (commits cb035e2..3e071c4, review clean)
Deferred minor (T4): sanityCheckTemp and commitOrRejectTemp overlap in slug/post checks — redundant, simplification candidate for final review.
Task 3.5: fix round 3 dispatched (substring path too permissive — 3 false-accept classes found).
Task 5: complete pending review (commit 45b7ba7)
Task 3.5: fix round 3 (3 false-accept classes closed; commit 6b1aac7)
Task 1: CRITICAL regression found on REAL data — clusterByDay rebalance oscillates forever (Seoul 12 posts, days:3 hangs). Fix round 2 dispatched.
NOTE: another session commit 627eef2 on this branch captured in-progress files from an SDD agent — branch is shared; keep staging explicit paths.
T3.5: Bangkok geocode OK — Sala Daeng attached, Bangkok now 12 qualifying. All 3 launch cities cleared the gate (Seoul 12 / Tokyo 13 / Bangkok 12).
T1: hang fixed (commit 9273a25); real Seoul+Tokyo itineraries generate. Fix round 3 (slot chronology) dispatched.
T1: fix round 3 (slot chronology) verified on real data — all 9 days chronological. commit 8670d01
T3.5: fix round 4 (synthetic fixtures) commit 3a77c56; Bangkok+Seoul geocoded via CI; all 3 cities >=12 qualifying.
T3: prose guard FALSE POSITIVES found on first real run ("close to", "open-air") — blocked all 3 cities. Fix dispatched: precise hours patterns + shared src/lib/prose-guard.mjs used by builder AND validator.
T3: prose guard fixed (precise hours patterns, shared src/lib/prose-guard.mjs) + rain-swap city-token false positive fixed; 3 real itineraries generated, validator exit 0. commit d81f0fa
CONTROLLER AUDIT of generated itineraries:
  - rain swaps 0/9 days (indoor heuristic too narrow + few unused posts) — feature dead in output
  - routing flaws: Seoul Day2 12km leg; Bangkok Day1 palace->5.7km lunch->back to Wat Pho (lunch chosen without regard to distance)
  - all days within 10h budget; slot chronology correct
Planned solver round: nearest-restaurant lunch selection (skip lunch if too far), broadened rain-swap search, intra-day spread reduction.
FACT-VERIFICATION (3 cities, 3 agents) COMPLETE. Zero invented facts. Defect classes found:
  C1 location misattribution (Saladaeng->Sukhumvit, Ise Sueyoshi->Yoyogi) — builder prompt lacked addresses [dispatched]
  C2 lunch detour zigzag (Bangkok D1 4.3km each way past Wat Pho 0.37km away) [dispatched R1]
  C3 dwell mismatches (Chatuchak 90 vs 3-4h source; Myeongdong 90 vs 2-3h) [FIXED f1aec72]
  C4 time-of-day mis-slotting (kaiseki dinner as lunch; night venue as afternoon) [dispatched R2]
  C5 self-contradiction (FAQ "four stops" vs 4/3/3) — builder structure payload [dispatched]
  C6 transit minutes were walking-pace (12km=160min) [FIXED f1aec72 -> null]
  C7 ferry leg called a walk (Wat Pho->Wat Arun) [dispatched R4]
  C8 rain swaps 0/9 [dispatched R3]
Side fix: DDP post said riveted-steel, body said aluminium -> corrected (987f024).
T1 round 5 (ccc8508) improved routing but introduced regressions found by controller re-verification: 2-stop days (Seoul D2, Bangkok D2), duplicate rain swaps (Tokyo, Bangkok), non-indoor rain swaps (street food, open-air market), and R2 not enforced (ise-sueyoshi still lunch). Round 6 dispatched.
LESSON: trust but verify every agent claim against real data — 3 of 4 claimed-verified items were wrong.
T3: fix round 3 (C1 location misattribution + C5 self-contradiction) — commits 554104e (prompt: per-stop place.address + place.name injection, LOCATION_ACCURACY_RULES, STRUCTURE_AND_DURATION_RULES, structureSummary(), --force flag, 5 new dayBlock tests, 25/25 pass) + e1e6205 (Tokyo regenerated). Verified via git show HEAD (immune to the working-tree churn — my uncommitted edits got wiped twice by concurrent commits landing mid-edit, recovered by single-Write+immediate-commit each time). Tokyo: all 3 days honestly narrate cross-area movement (no C1), structure/duration claims match exactly, rainSwapSlug/FAQ consistent. Seoul/Bangkok still cannot regenerate — same "day 2 has only 2 stops" from the known ccc8508 regression (line 47), confirmed reproducible against the now-stable 082e1fc too, so round 6 hasn't landed yet or didn't fully fix it. Bangkok's Saladaeng/C1 defect confirmed still present in the unregenerated file. New finding: generateProse's FAQ can go stale relative to a rain-swap the leak-guard's retry drops to null (not fixed, flagged). Also flagged: src/content.config.ts walkToNext.minutes non-nullable but solver now returns null for transit legs.
CRITICAL: round-7 rewrite (52e79fc) broke dwellMinutes — "Plan on 2-3 hours" -> 30min for 4 of 5 real posts. Seoul regenerated with 30-min palace visits. Fix dispatched to fresh implementer.
Validator status: seoul CLEAN, tokyo CLEAN, bangkok REJECTED by builder gate (UNIVERSAL-AREA-CLAIM) -> old file preserved (design working).
Builder: validator-driven self-correction retry dispatched.
CONTROLLER RULE: verify every agent claim against real data before accepting. 4 rounds now where reports were wrong.
T5 translations: 12 files (ko/ja/es/zh x 3 cities) DONE + verified (hash match, 9/9 whys, natural Korean).
T9 automation: DONE (d4f4a86) - publish.yml itinerary steps, Korean Telegram new-city notice, committed run log, gate boost in generate.mjs, generate.test.mjs added, isMain guard added.
SAFETY: agent accidentally executed generate.mjs live during testing (no isMain guard) - burned some Places quota, published.json reverted and verified intact at 669 entries.
T4 round 3: DWELL-STALE/LEG-STALE/DAY-TOTAL-TOO-SHORT/RAIN-SWAP checks added (670f60c); all 3 cities clean after regeneration.
Itineraries regenerated with correct dwell (Seoul 5.5/4.6/5.5h, Tokyo 4.5/5.3/3.8h, Bangkok 8.5/4.8/7.0h).
T8 cross-links: DONE (a89d71e) - post backlink, region+destination hub cards, llms.txt Itineraries section, sitemap x5 locales. Controller-verified in dist.
Content dedup: geocode backfill exposed a duplicate Gyeongju venue (2 posts, same place.id). Retired the weaker post + 301 to the kept guide in all 5 locales (astro.config.mjs). validate-content now clean: 463 posts.
T6/T7 DONE + controller-verified in real browser: pace filter 10->9 cards, date picker real weekdays ("Day 1 · Tue, Mar 3"), Closed Monday warning, .ics data URL, hash share (#p=relaxed&d=...).
T8 DONE (a89d71e), T9 DONE (d4f4a86), T5 DONE.
Pre-ship: 201/201 tests, itinerary validator clean (3+12 files), content validator clean (463 posts), merged origin/main.
NEXT: final build -> push -> live verification subagents.
LIVE VERIFICATION (deployed 7a38efa): 2 CRITICALs reported.
  #1 Gyeongbokgung "Closed Tuesday" chip allegedly unsourced -> FALSE POSITIVE. Verifier read a stale branch; main has openingHours with "Tuesday: Closed" from the 2026-07-28 backfill (8dbc12f). Chip is correctly Places-sourced.
  #2 Korean pages show English "getting there" text -> REAL. Fix dispatched (use postI18n text + localized station vocabulary).
All other live checks clean: ratings/review counts/dwell match sources on 19 stops, transit legs show no invented ETA, 13 links 200/302, JSON-LD TouristTrip+Breadcrumb+FAQ with no aggregateRating, cross-links live, disclosure present.
Hours coverage on itinerary stops: 11/28 (backfill prioritization shipped 8e9d752; daily chained run fills the rest).

=== SESSION HANDOFF (2026-07-28) ===
SHIPPED to production (main 7a38efa + follow-ups). 15 live pages verified.
OPEN #1: localized "getting there" renders English on ko/ja/es/zh itinerary pages. Fix in src/components/ItineraryPage.astro: use postI18n entry (<lang>/<slug>) for the transit sentence + widen the station regex to localized vocabulary (ko 호선/역/출구, ja 線/駅/出口, zh 线/站/出口, es linea/estacion/salida); keep English fallback. Korean source text already exists (src/content/i18n/ko/seoul-gwangjang-market.md).
OPEN #2: openingHours on 11/28 itinerary stops; daily chained backfill fills the rest (itinerary stops now processed first, commit 8e9d752).
OPEN #3 (deferred by design): 5-day variants at >=24 qualifying posts; themed variants when per-theme data suffices.
BRANCH: feature/itinerary-pages merged to main; worktrees at /tmp/wa-main (main) and /tmp/wa-feat (itin-build) can be pruned with `git worktree remove`.
