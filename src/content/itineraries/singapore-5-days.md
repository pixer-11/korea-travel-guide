---
city: Singapore
country: Singapore
days: 5
title: '5-Day Singapore Itinerary: Gardens, Sentosa, Nature Reserves & Kampong Glam'
description: A 5-day Singapore itinerary moving from Marina Bay's gardens and Bukit Timah's rainforest to Sentosa's rides, East Coast Park, and the heritage streets of Kampong Glam.
quickAnswer: This is a 5-day Singapore itinerary that moves from Marina Bay's gardens and river to Bukit Timah's nature reserve and the Botanic Gardens, then to Sentosa for rides and a dusk garden installation, out to East Coast Park and a Geylang Serai market before Katong Park, and finally a full day exploring Kampong Glam's streets, mosque, and cafés."
pubDate: '2026-08-13T00:36:52.182Z'
stopsHash: a98ddd67c16724ce48f520da3c8caf985c9a94ce
packedAvailable: true
faq:
  - q: How much walking does this 5-day Singapore itinerary involve?
    a: Several days mix walkable clusters, like Kampong Glam's streets, with longer transit hops between areas such as East Coast Park and Geylang Serai, so comfortable shoes and some transit use are both needed.
  - q: Do I need to book transit or transport in advance?
    a: The itinerary notes when a stop is beyond walking distance and transit is needed, so plan on public transport or a ride for those longer legs between areas like Bukit Timah and Dempsey Hill.
  - q: Is this itinerary flexible if it rains?
    a: Days 1, 2, 4 and 5 have a listed rain-day alternative to swap in; the other day doesn't, so plans for that day would stay as scheduled.
  - q: Which day is the most nature-focused?
    a: Day two centers on Bukit Timah's forested hill and trails before moving to the calmer, cultivated Botanic Gardens in the evening.
  - q: Which day stays in one area the most?
    a: Day five is spent almost entirely around Kampong Glam, moving on foot between Bugis Street, the mosque, and Bussorah Street.
itinerary:
  - label: Marina Bay gardens and river lights
    intro: Day one settles into Marina Bay, starting with the sweeping outdoor and indoor gardens before a stylish lunch stop right in the same district. The afternoon returns to the gardens' iconic grove for its evening show, then the day wraps up across the water with a quieter riverside café near Clarke Quay.
    stops:
      - slug: marina-bay-gardens-by-the-bay
        slot: morning
        why: This waterfront park anchors the day with its mix of free outdoor grove and cooled conservatories, giving a broad first taste of Marina Bay.
        dwellMin: 240
        walkToNext:
          km: 0.8
          minutes: 11
          transit: false
      - slug: marina-bay-le-noir
        slot: lunch
        why: A moody, art-filled spot inside Marina Bay Sands makes for a well-rated midday pause without straying from the district.
        dwellMin: 150
        walkToNext:
          km: 0.8
          minutes: 11
          transit: false
      - slug: bugis-supertree-grove
        slot: afternoon
        why: Returning to the gardens' grove in late day sets up the free nightly light-and-sound show as the afternoon's centerpiece.
        dwellMin: 45
        walkToNext:
          km: 3
          minutes: null
          transit: true
      - slug: clarke-quay-home-dawn-cafe-clarke-quay
        slot: evening
        why: A low-key riverside café offers a quiet, relaxed close to the day, away from the busier entertainment strip nearby.
        dwellMin: 45
        walkToNext: null
    rainSwapSlug: chinatown-chinatown-heritage-centre
  - label: Rainforest hill and botanic calm
    intro: Day two is built around Bukit Timah's forested hill, moving from the visitor centre straight into the reserve itself for a longer stretch of trail time. The evening shifts to the Botanic Gardens, a calmer, manicured counterpoint to the morning's rainforest.
    stops:
      - slug: bukit-timah-bukit-timah-nature-reserve-visitor-centre
        slot: morning
        why: The visitor centre is the natural gateway to the reserve's trails and primary rainforest, ideal for starting the day slowly.
        dwellMin: 240
        walkToNext:
          km: 0
          minutes: 0
          transit: false
      - slug: bukit-timah-bukit-timah-nature-reserve
        slot: afternoon
        why: Staying on for the reserve itself extends the morning into a longer stretch on Singapore's tallest hill and its trails.
        dwellMin: 135
        walkToNext:
          km: 7.6
          minutes: null
          transit: true
      - slug: dempsey-hill-singapore-botanic-gardens
        slot: evening
        why: This free, expansive heritage park offers a calmer, cultivated contrast to the morning's forest hike.
        dwellMin: 150
        walkToNext: null
    rainSwapSlug: singapore-casa-mori
  - label: Sentosa thrills and sensory dusk
    intro: Day three heads to Sentosa for a morning of chairlift-and-luge action, followed by a refined sit-down lunch nearby. As evening falls, a short move brings you to a garden-and-light installation best experienced at dusk.
    stops:
      - slug: sentosa-skyline-luge-singapore
        slot: morning
        why: The chairlift-and-luge combo is an active, scenic way to start a Sentosa day.
        dwellMin: 105
        walkToNext:
          km: 1.3
          minutes: 18
          transit: false
      - slug: sentosa-fiamma
        slot: lunch
        why: An upscale Italian restaurant inside Capella offers a refined, sit-down lunch away from the island's busier beach spots.
        dwellMin: 90
        walkToNext:
          km: 1
          minutes: 13
          transit: false
      - slug: sentosa-sentosa-sensoryscape
        slot: evening
        why: This free garden-and-light installation is designed to be experienced at dusk, making it a fitting close to the day.
        dwellMin: 53
        walkToNext: null
    rainSwapSlug: null
  - label: Coast, market, and old fort park
    intro: Day four opens on the long beachfront stretch of East Coast Park, then heads inland to browse the stalls of a wet market and hawker centre. It closes out gently at a small park on Fort Road, built around the last trace of an old fort.
    stops:
      - slug: katong-east-coast-park
        slot: morning
        why: The long reclaimed beachfront is a natural, open start to the day, good for a walk or ride along the coast.
        dwellMin: 150
        walkToNext:
          km: 3
          minutes: null
          transit: true
      - slug: dempsey-hill-pasar-geylang-serai
        slot: afternoon
        why: This wet market and hawker centre offers a browsing-and-food stop with a different pace from the beach morning.
        dwellMin: 90
        walkToNext:
          km: 3.4
          minutes: null
          transit: true
      - slug: katong-katong-park
        slot: evening
        why: A small leafy park built around a fort remnant makes for a gentle, short wind-down to end the day.
        dwellMin: 38
        walkToNext: null
    rainSwapSlug: little-india-super-deluxe-kitchen
  - label: Kampong Glam street life
    intro: Day five is spent almost entirely around Kampong Glam, opening with the covered stalls of Bugis Street before crossing into the mosque and heritage lanes nearby. The evening stays put on Bussorah Street for a relaxed, unhurried meal.
    stops:
      - slug: bugis-bugis-street
        slot: morning
        why: Hundreds of stalls packed into covered lanes make for a lively, market-style start to the day.
        dwellMin: 90
        walkToNext:
          km: 0.6
          minutes: 8
          transit: false
      - slug: kampong-glam-sultan-mosque
        slot: afternoon
        why: Singapore's largest mosque anchors the district and is a quick, essential stop before wandering the surrounding lanes.
        dwellMin: 38
        walkToNext:
          km: 0.2
          minutes: 2
          transit: false
      - slug: kampong-glam-kampong-glam
        slot: afternoon
        why: Wandering Bussorah Street, Arab Street, and Haji Lane gives a fuller sense of this historic Malay-Muslim quarter.
        dwellMin: 150
        walkToNext:
          km: 0
          minutes: 0
          transit: false
      - slug: kampong-glam-kampong-glam-cafe
        slot: evening
        why: A quick, casual plate on pedestrianized Bussorah Street makes for an easy, unhurried finish to the day.
        dwellMin: 45
        walkToNext: null
    rainSwapSlug: little-india-tekka-centre
aiGenerated: true
draft: false
updatedDate: '2026-08-24T09:52:47.838Z'
---

