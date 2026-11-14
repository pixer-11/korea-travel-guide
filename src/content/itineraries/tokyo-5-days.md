---
city: Tokyo
country: Japan
days: 5
title: '5-day Tokyo itinerary: temples, towers, gardens and hidden cafés'
description: A 5-day Tokyo itinerary moving from Minato City temples and Shibuya crossings to Skytree, Asakusa, Toyosu digital art, Shinjuku gardens and Daikanyama bookshops, with a rain-day swap built into each day."
quickAnswer: 'This is a 5-day Tokyo itinerary: day one covers Minato City temples and towers into Shibuya nightlife; day two moves through Sumida City''s Skytree and Taito City''s Senso-ji and market alleys; day three crosses from Koto City''s digital art museum to Chuo City''s fish market and bayside garden; day four threads Shinjuku''s alleys and gardens into Shibuya''s shrine forest and park; day five closes in Daikanyama, Ebisu and Setagaya City''s Sangenjaya with bookshops, a botanical bar and a small café."'
pubDate: '2026-09-22T00:58:38.905Z'
stopsHash: b0bc01d77679d57fa960ef30a6777702d1482bde
packedAvailable: true
faq:
  - q: How much walking does this 5-day Tokyo itinerary involve?
    a: Each day mixes short walks between nearby stops, like Zojo-ji to Tokyo Tower or Meiji Jingu to Yoyogi Park, with longer transit hops between areas such as Koto City to Chuo City on day three.
  - q: What's the best way to get between stops?
    a: Most same-area stops are walkable in well under half an hour, but several transitions, like Tokyo Tower to Shibuya Crossing or teamLab Planets to Tsukiji Outer Market, are listed as beyond walking distance and call for transit.
  - q: Should I visit popular spots like Tokyo Skytree or teamLab Planets early?
    a: Yes, both are busiest later in the day, so the itinerary places them in the morning slot when they're calmer.
  - q: Is this itinerary set up for rainy days?
    a: Each day has a listed rain-day alternative venue to swap in if the outdoor stops like gardens, shrines or market streets aren't workable in bad weather.
  - q: Does the itinerary stay in one part of Tokyo each day?
    a: No, several days cross between areas, such as day one moving from Minato City to Shibuya, or day four threading Shinjuku City into Shibuya.
itinerary:
  - label: Temple towers and Shibuya lights
    intro: The day starts in Minato City at the quiet grounds of Zojo-ji before moving to Tokyo Tower nearby for skyline views into sunset. From there you cross to Shibuya for the scramble crossing and a relaxed finish at a Nordic-leaning café-bar in Tomigaya.
    stops:
      - slug: tokyo-zojo-ji
        slot: morning
        why: Zojo-ji's wooden Sanmon gate framed against Tokyo Tower makes for a calm, free start to the day before the crowds settle in.
        dwellMin: 53
        walkToNext:
          km: 0.4
          minutes: 5
          transit: false
      - slug: tokyo-tokyo-tower
        slot: afternoon
        why: Tokyo Tower sits a short walk from Zojo-ji and rewards a late-afternoon visit as sunset turns into the night skyline.
        dwellMin: 75
        walkToNext:
          km: 5.3
          minutes: null
          transit: true
      - slug: tokyo-shibuya-crossing
        slot: afternoon
        why: Shibuya Crossing is the essential scramble-intersection experience, best caught around sunset for the mix of daylight and neon.
        dwellMin: 30
        walkToNext:
          km: 1.4
          minutes: 19
          transit: false
      - slug: tokyo-fuglen-tokyo
        slot: evening
        why: Fuglen Tokyo closes the day with a cozy, vintage-furnished room suited to an evening coffee or cocktail after a full day on foot.
        dwellMin: 90
        walkToNext: null
    rainSwapSlug: tokyo-ise-sueyoshi
  - label: Skytree, Senso-ji and market alleys
    intro: Day two is spent in Sumida City and Taito City, starting at Tokyo Skytree before heading to Asakusa's Senso-ji and its approach street. The evening winds down among the stalls of Ameyoko market between Ueno and Okachimachi.
    stops:
      - slug: tokyo-tokyo-skytree
        slot: morning
        why: Tokyo Skytree's two observation decks make a strong morning anchor for the day, with a quieter slot before the weekend crush arrives.
        dwellMin: 90
        walkToNext:
          km: 1.8
          minutes: 24
          transit: false
      - slug: tokyo-senso-ji
        slot: afternoon
        why: Senso-ji is Tokyo's oldest temple, and its Nakamise-dori approach and Five-Story Pagoda justify the dedicated afternoon.
        dwellMin: 105
        walkToNext:
          km: 2.7
          minutes: null
          transit: true
      - slug: tokyo-ameyoko-market
        slot: evening
        why: Ameyoko market's dense stalls between Ueno and Okachimachi make a lively, low-key way to close out the evening.
        dwellMin: 83
        walkToNext: null
    rainSwapSlug: tokyo-tokyo-national-museum
  - label: Digital art, fish stalls and a bayside garden
    intro: Starting in Koto City at teamLab Planets, the day then crosses to Chuo City for a stall-hopping lunch at Tsukiji Outer Market and finishes with a slower afternoon at Hamarikyu Gardens on Tokyo Bay.
    stops:
      - slug: tokyo-teamlab-planets-tokyo-dmm
        slot: morning
        why: teamLab Planets' barefoot water-and-light rooms are calmest in the morning, making it a natural opener for the day in Toyosu.
        dwellMin: 105
        walkToNext:
          km: 3.2
          minutes: null
          transit: true
      - slug: tokyo-fish-market-tsukiji-outer-market
        slot: lunch
        why: Tsukiji Outer Market's stalls and sit-down sushi counters are the ideal lunch stop between morning art and afternoon gardens.
        dwellMin: 105
        walkToNext:
          km: 1.1
          minutes: null
          transit: true
      - slug: tokyo-hamarikyu-gardens
        slot: afternoon
        why: Hamarikyu Gardens' Tokyo Bay setting and teahouse give the day a quiet, slower-paced finish.
        dwellMin: 75
        walkToNext: null
    rainSwapSlug: tokyo-smith-wollensky
  - label: Shinjuku alleys to shrine forest
    intro: The morning threads through the narrow bars of Shinjuku Golden-Gai before opening up into the wide lawns and gardens of Shinjuku Gyoen. The day then crosses into Shibuya for Meiji Jingu's forest approach and an evening wind-down at neighboring Yoyogi Park.
    stops:
      - slug: tokyo-shinjuku-golden-gai
        slot: morning
        why: Shinjuku Golden-Gai's maze of tiny alleys is far calmer on a weekday morning, letting you explore the lanes before the evening bar crowds.
        dwellMin: 90
        walkToNext:
          km: 1.4
          minutes: 19
          transit: false
      - slug: tokyo-shinjuku-gyoen-national-garden
        slot: afternoon
        why: Shinjuku Gyoen's blend of French, English and Japanese garden styles gives the day room to slow down over a couple of hours.
        dwellMin: 150
        walkToNext:
          km: 1.8
          minutes: 24
          transit: false
      - slug: tokyo-meiji-jingu
        slot: afternoon
        why: Meiji Jingu's forested approach between Harajuku and Yoyogi Park is a grounding counterpoint to the morning's dense alleys.
        dwellMin: 75
        walkToNext:
          km: 1
          minutes: 14
          transit: false
      - slug: tokyo-yoyogi-park
        slot: evening
        why: Yoyogi Park sits right beside Meiji Jingu, making it an easy, open-air spot to wind down the evening.
        dwellMin: 90
        walkToNext: null
    rainSwapSlug: tokyo-vannelli-coffee
  - label: Bookshop mornings to Sangenjaya nights
    intro: The final day begins slowly among the shelves and café of Tsutaya Books Daikanyama, then moves on to a forest-botanical bar near Ebisu Station. It ends in Setagaya City at a small Indonesian-Japanese café in Sangenjaya.
    stops:
      - slug: tokyo-tsutaya-books-daikanyama
        slot: morning
        why: Tsutaya Books Daikanyama's three-building complex and café make a gentle, browsing-paced start to the final day.
        dwellMin: 90
        walkToNext:
          km: 1
          minutes: 13
          transit: false
      - slug: tokyo-bar-satoyama-spirits-tokyo
        slot: afternoon
        why: Bar Satoyama Spirits Tokyo's wild-harvested Japanese botanicals offer a distinctive afternoon stop near Ebisu Station.
        dwellMin: 90
        walkToNext:
          km: 4.8
          minutes: null
          transit: true
      - slug: tokyo-samaa-samaa
        slot: evening
        why: Samaa's Super Milk Brew and Jamu Shot make for a memorable, low-key final stop in Sangenjaya.
        dwellMin: 90
        walkToNext: null
    rainSwapSlug: tokyo-oxomoco
aiGenerated: true
draft: false
updatedDate: '2026-11-14T08:44:57.078Z'
---

