---
city: Tokyo
country: Japan
days: 2
title: A Broken 2 Day Tokyo Itinerary (fixture)
description: Intentionally invalid fixture — duplicate slug across days and an over-budget day.
quickAnswer: This fixture itinerary is intentionally broken for validator testing.
pubDate: '2026-07-20T00:00:00.000Z'
stopsHash: fixturehash-bad-1
packedAvailable: false
faq: []
itinerary:
  - label: Asakusa
    intro: Temple, noodles, and a riverside park in old Asakusa.
    stops:
      - slug: tokyo-temple
        slot: morning
        why: The temple is the historic heart of Asakusa.
        dwellMin: 120
        walkToNext:
          km: 0.5
          minutes: 7
          transit: false
      - slug: tokyo-ramen
        slot: lunch
        why: A short walk from the temple for a bowl of ramen.
        dwellMin: 60
        walkToNext:
          km: 0.8
          minutes: 11
          transit: false
      - slug: tokyo-garden
        slot: afternoon
        why: A riverside park to close out the morning loop.
        dwellMin: 90
        walkToNext: null
    rainSwapSlug: null
  - label: Repeat visit (bug)
    intro: This day accidentally repeats a stop from day 1 and blows past the time budget.
    stops:
      - slug: tokyo-temple
        slot: morning
        why: Duplicate of day 1's stop — this should trigger DUPLICATE-SLUG.
        dwellMin: 300
        walkToNext:
          km: 1.0
          minutes: 15
          transit: false
      - slug: tokyo-tower
        slot: afternoon
        why: A long visit to the observation deck.
        dwellMin: 300
        walkToNext:
          km: 1.0
          minutes: 15
          transit: false
      - slug: tokyo-shrine
        slot: evening
        why: A long, unhurried visit to close the day.
        dwellMin: 300
        walkToNext: null
    rainSwapSlug: null
aiGenerated: true
draft: false
---
