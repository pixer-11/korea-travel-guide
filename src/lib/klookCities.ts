// Klook destination map: post `region` -> Klook city id + slug (+country as a
// guard record). Sources & verification, 2026-08-07:
//  - id/slug pairs: Klook's own sitemap-city-plain_en-us.xml (1,462 cities) —
//    never guessed; a name that is not in the sitemap is simply not mapped.
//  - same-name-city risk: every candidate whose name exists in another country
//    (Valencia, Granada, San Sebastian, George Town, Naples, Hyderabad) was
//    opened on klook.com and its country confirmed against the post corpus.
//  - `widget: true` marks the 16 cities confirmed in the Travelpayouts price
//    widget dropdown. The others get the destination LINK only — an unverified
//    city_id fed to the widget renders an empty box, a link cannot.
// Regenerate candidates with: Klook city sitemap x post regions (see the
// 2026-08-07 session notes); keys must match a post's `region` exactly.
export interface KlookCity { id: number; slug: string; country: string; widget?: boolean }

export const KLOOK_CITY: Record<string, KlookCity> = {
  // Alias entries (2026-08-07 revenue audit): post regions whose name differs
  // from Klook's slug but whose page is verifiably the same place. Candidates
  // Miami (not in Klook's sitemap then) and Washington DC (Klook's
  // c84912-washington is Washington STATE — Seattle on the page) were REJECTED
  // on 08-07; both are mapped below since 10-05, to the right pages.
  // A search fallback beats a confidently wrong destination.
  "New Delhi": { id: 145, slug: 'delhi', country: 'India' },
  "Bordeaux": { id: 318, slug: 'bordeaux-south-west', country: 'France' },
  "Koh Samui": { id: 702414, slug: 'ko-samui', country: 'Thailand' },
  "Lombok": { id: 14443, slug: 'central-lombok', country: 'Indonesia' },
  "Seoul": { id: 13, slug: 'seoul', country: 'South Korea', widget: true },
  "Busan": { id: 46, slug: 'busan', country: 'South Korea', widget: true },
  "Incheon": { id: 158, slug: 'incheon', country: 'South Korea', widget: true },
  "Tokyo": { id: 28, slug: 'tokyo', country: 'Japan', widget: true },
  "Osaka": { id: 29, slug: 'osaka', country: 'Japan', widget: true },
  "Kyoto": { id: 30, slug: 'kyoto', country: 'Japan', widget: true },
  "Fukuoka": { id: 5209, slug: 'fukuoka-prefecture', country: 'Japan', widget: true },
  "Sapporo": { id: 133938, slug: 'sapporo', country: 'Japan', widget: true },
  "Okinawa": { id: 6484, slug: 'okinawa-prefecture', country: 'Japan', widget: true },
  "Nagoya": { id: 71, slug: 'nagoya', country: 'Japan', widget: true },
  "Nara": { id: 7062, slug: 'nara-prefecture', country: 'Japan', widget: true },
  "Hiroshima": { id: 5122, slug: 'hiroshima-prefecture', country: 'Japan', widget: true },
  "Bangkok": { id: 4, slug: 'bangkok', country: 'Thailand', widget: true },
  "Phuket": { id: 7, slug: 'phuket', country: 'Thailand', widget: true },
  "Shanghai": { id: 59, slug: 'shanghai', country: 'China', widget: true },
  "Xi'an": { id: 60, slug: 'xi-an', country: 'China', widget: true },
  "Beijing": { id: 57, slug: 'beijing', country: "China" },
  "Chengdu": { id: 61, slug: 'chengdu', country: "China" },
  "Guangzhou": { id: 12146, slug: 'guangzhou', country: "China" },
  "Guilin": { id: 62, slug: 'guilin', country: "China" },
  "Hangzhou": { id: 19190, slug: 'hangzhou', country: "China" },
  "Hong Kong": { id: 2, slug: 'hong-kong', country: "Hong Kong" }, // own country since 2026-08-13 (was region of China)
  "Macau": { id: 3, slug: 'macau', country: "Macau" }, // own country since 2026-10-06; Klook sitemap c3-macau; its districts reach it through the city-state rule
  "Qingdao": { id: 14950, slug: 'qingdao', country: "China" },
  "Shenzhen": { id: 23301, slug: 'shenzhen', country: "China" },
  "Suzhou": { id: 16549, slug: 'suzhou', country: "China" },
  "Wuhan": { id: 24369, slug: 'wuhan', country: "China" },
  "Lyon": { id: 365009, slug: 'lyon', country: "France" },
  "Marseille": { id: 185152, slug: 'marseille', country: "France" },
  "Nice": { id: 169424, slug: 'nice', country: "France" },
  "Paris": { id: 107, slug: 'paris', country: "France" },
  "Strasbourg": { id: 365224, slug: 'strasbourg', country: "France" },
  "Agra": { id: 214, slug: 'agra', country: "India" },
  "Chandigarh": { id: 12871, slug: 'chandigarh', country: "India" },
  "Delhi": { id: 145, slug: 'delhi', country: "India" },
  "Hyderabad": { id: 252, slug: 'hyderabad', country: "India" },
  "Jaipur": { id: 149, slug: 'jaipur', country: "India" },
  "Mumbai": { id: 132, slug: 'mumbai', country: "India" },
  "Udaipur": { id: 150, slug: 'udaipur', country: "India" },
  "Varanasi": { id: 211, slug: 'varanasi', country: "India" },
  "Bali": { id: 8, slug: 'bali', country: "Indonesia" },
  "Bandung": { id: 209, slug: 'bandung', country: "Indonesia" },
  "Jakarta": { id: 45, slug: 'jakarta', country: "Indonesia" },
  "Labuan Bajo": { id: 522, slug: 'labuan-bajo', country: "Indonesia" },
  "Surabaya": { id: 337, slug: 'surabaya', country: "Indonesia" },
  "Yogyakarta": { id: 163, slug: 'yogyakarta', country: "Indonesia" },
  "Bologna": { id: 340, slug: 'bologna', country: "Italy" },
  "Florence": { id: 115, slug: 'florence', country: "Italy" },
  "Milan": { id: 79468, slug: 'milan', country: "Italy" },
  "Naples": { id: 126, slug: 'naples', country: "Italy" },
  "Rome": { id: 92, slug: 'rome', country: "Italy" },
  "Siena": { id: 317, slug: 'siena', country: "Italy" },
  "Turin": { id: 322, slug: 'turin', country: "Italy" },
  "Venice": { id: 117, slug: 'venice', country: "Italy" },
  "Verona": { id: 339, slug: 'verona', country: "Italy" },
  "Aomori": { id: 14493, slug: 'aomori', country: "Japan" },
  "Chiba": { id: 22069, slug: 'chiba', country: "Japan" },
  "Kanazawa": { id: 445, slug: 'kanazawa', country: "Japan" },
  "Yokohama": { id: 26895, slug: 'yokohama', country: "Japan" },
  "George Town": { id: 365161, slug: 'george-town', country: "Malaysia" },
  "Ipoh": { id: 266, slug: 'ipoh', country: "Malaysia" },
  "Johor Bahru": { id: 191, slug: 'johor-bahru', country: "Malaysia" },
  "Kota Kinabalu": { id: 364959, slug: 'kota-kinabalu', country: "Malaysia" },
  "Kuala Lumpur": { id: 49, slug: 'kuala-lumpur', country: "Malaysia" },
  "Langkawi": { id: 190, slug: 'langkawi', country: "Malaysia" },
  "Penang": { id: 65, slug: 'penang', country: "Malaysia" },
  "Bohol": { id: 144, slug: 'bohol', country: "Philippines" },
  "Cebu": { id: 97, slug: 'cebu', country: "Philippines" },
  "Davao": { id: 331, slug: 'davao', country: "Philippines" },
  "Makati": { id: 10908, slug: 'makati', country: "Philippines" },
  "Manila": { id: 96, slug: 'manila', country: "Philippines" },
  "Palawan": { id: 121, slug: 'palawan', country: "Philippines" },
  "Taguig": { id: 26802, slug: 'taguig', country: "Philippines" },
  "Singapore": { id: 6, slug: 'singapore', country: "Singapore" },
  // Singapore NEIGHBOURHOODS used as regions in this corpus (the city-state's
  // posts are tagged by district). Without these, 27 posts fell back to the
  // robots-disallowed search page (full-audit 2026-08-10). All alias c6.
  "Marina Bay": { id: 6, slug: 'singapore', country: "Singapore" },
  "Little India": { id: 6, slug: 'singapore', country: "Singapore" },
  "Clarke Quay": { id: 6, slug: 'singapore', country: "Singapore" },
  "Sentosa": { id: 6, slug: 'singapore', country: "Singapore" },
  "Orchard Road": { id: 6, slug: 'singapore', country: "Singapore" },
  "Kampong Glam": { id: 6, slug: 'singapore', country: "Singapore" },
  "Chinatown": { id: 6, slug: 'singapore', country: "Singapore" },
  "Andong": { id: 8898, slug: 'andong', country: "South Korea" },
  "Daegu": { id: 545, slug: 'daegu', country: "South Korea" },
  "Gyeongju": { id: 8928, slug: 'gyeongju', country: "South Korea" },
  "Jeju": { id: 20544, slug: 'jeju', country: "South Korea" },
  "Pohang": { id: 705582, slug: 'pohang', country: "South Korea" },
  "Sokcho": { id: 11054, slug: 'sokcho', country: "South Korea" },
  "Yeosu": { id: 703649, slug: 'yeosu', country: "South Korea" },
  "Barcelona": { id: 108, slug: 'barcelona', country: "Spain" },
  "Bilbao": { id: 494, slug: 'bilbao', country: "Spain" },
  "Granada": { id: 495, slug: 'granada', country: "Spain" },
  "Madrid": { id: 109, slug: 'madrid', country: "Spain" },
  "Malaga": { id: 35920, slug: 'malaga', country: "Spain" },
  "San Sebastian": { id: 493, slug: 'san-sebastian', country: "Spain" },
  "Seville": { id: 122, slug: 'seville', country: "Spain" },
  "Valencia": { id: 381, slug: 'valencia', country: "Spain" },
  "Hualien": { id: 20, slug: 'hualien', country: "Taiwan" },
  "Kaohsiung": { id: 22, slug: 'kaohsiung', country: "Taiwan" },
  "Nantou": { id: 25303, slug: 'nantou', country: "Taiwan" },
  "New Taipei": { id: 6488, slug: 'new-taipei', country: "Taiwan" },
  "Taichung": { id: 25, slug: 'taichung', country: "Taiwan" },
  "Tainan": { id: 164, slug: 'tainan', country: "Taiwan" },
  "Taipei": { id: 19, slug: 'taipei', country: "Taiwan" },
  "Taitung": { id: 47, slug: 'taitung', country: "Taiwan" },
  "Ayutthaya": { id: 701356, slug: 'ayutthaya', country: "Thailand" },
  "Chiang Mai": { id: 5, slug: 'chiang-mai', country: "Thailand" },
  "Chiang Rai": { id: 216, slug: 'chiang-rai', country: "Thailand" },
  "Krabi": { id: 63, slug: 'krabi', country: "Thailand" },
  "Pattaya": { id: 17, slug: 'pattaya', country: "Thailand" },
  "Antalya": { id: 269, slug: 'antalya', country: "Turkey" },
  "Bodrum": { id: 116609, slug: 'bodrum', country: "Turkey" },
  "Cappadocia": { id: 270, slug: 'cappadocia', country: "Turkey" },
  "Istanbul": { id: 186, slug: 'istanbul', country: "Turkey" },
  "Izmir": { id: 701631, slug: 'izmir', country: "Turkey" },
  "Abu Dhabi": { id: 131, slug: 'abu-dhabi', country: "United Arab Emirates" },
  "Ajman": { id: 703511, slug: 'ajman', country: "United Arab Emirates" },
  "Al Ain": { id: 703500, slug: 'al-ain', country: "United Arab Emirates" },
  "Dubai": { id: 78, slug: 'dubai', country: "United Arab Emirates" },
  "Ras Al Khaimah": { id: 442, slug: 'ras-al-khaimah', country: "United Arab Emirates" },
  "Sharjah": { id: 426, slug: 'sharjah', country: "United Arab Emirates" },
  "Arlington": { id: 137040, slug: 'arlington', country: "United States" },
  "Chicago": { id: 701807, slug: 'chicago', country: "United States" },
  "Las Vegas": { id: 136, slug: 'las-vegas', country: "United States" },
  "Los Angeles": { id: 124, slug: 'los-angeles', country: "United States" },
  "New Orleans": { id: 557, slug: 'new-orleans', country: "United States" },
  "New York": { id: 93, slug: 'new-york', country: "United States" },
  "San Francisco": { id: 129, slug: 'san-francisco', country: "United States" },
  "Seattle": { id: 465, slug: 'seattle', country: "United States" },
  "Da Nang": { id: 74, slug: 'da-nang', country: "Vietnam" },
  "Hanoi": { id: 34, slug: 'hanoi', country: "Vietnam" },
  "Ho Chi Minh City": { id: 33, slug: 'ho-chi-minh-city', country: "Vietnam" },
  "Hoi An": { id: 75, slug: 'hoi-an', country: "Vietnam" },
  "Hue": { id: 35, slug: 'hue', country: "Vietnam" },
  "Nha Trang": { id: 208, slug: 'nha-trang', country: "Vietnam" },
  "Phu Quoc": { id: 130, slug: 'phu-quoc', country: "Vietnam" },
  // ── 2026-10-05 refresh: regions added since 08-13 fell back to the
  // robots-disallowed search page (full audit). Same method as 08-07 — Klook's
  // sitemap-city-plain_en-us.xml joined to post regions; a slug listed twice
  // (Portland, Perth, Hsinchu, Cambridge) or a same-name place elsewhere is not
  // mapped. Miami and Washington DC are in the sitemap now (c198, c166) and
  // their pages were checked to be the US cities.
  // Exact sitemap slug:
  "Adelaide": { id: 89, slug: 'adelaide', country: "Australia" },
  "Alanya": { id: 32303, slug: 'alanya', country: "Turkey" },
  "Alice Springs": { id: 20214, slug: 'alice-springs', country: "Australia" },
  "Amritsar": { id: 301, slug: 'amritsar', country: "India" },
  "Austin": { id: 99418, slug: 'austin', country: "United States" },
  "Avignon": { id: 143700, slug: 'avignon', country: "France" },
  "Bacolod": { id: 480, slug: 'bacolod', country: "Philippines" },
  "Baguio": { id: 365498, slug: 'baguio', country: "Philippines" },
  "Bath": { id: 374, slug: 'bath', country: "United Kingdom" },
  "Belfast": { id: 291, slug: 'belfast', country: "United Kingdom" },
  "Berlin": { id: 103, slug: 'berlin', country: "Germany" },
  "Brisbane": { id: 70, slug: 'brisbane', country: "Australia" },
  "Bursa": { id: 29490, slug: 'bursa', country: "Turkey" },
  "Byron Bay": { id: 517, slug: 'byron-bay', country: "Australia" },
  "Cairns": { id: 73, slug: 'cairns', country: "Australia" },
  "Cameron Highlands": { id: 488, slug: 'cameron-highlands', country: "Malaysia" },
  "Canberra": { id: 435, slug: 'canberra', country: "Australia" },
  "Cardiff": { id: 293, slug: 'cardiff', country: "United Kingdom" },
  "Chennai": { id: 274, slug: 'chennai', country: "India" },
  "Chiayi": { id: 436, slug: 'chiayi', country: "Taiwan" },
  "Colmar": { id: 700761, slug: 'colmar', country: "France" },
  "Cologne": { id: 79171, slug: 'cologne', country: "Germany" },
  "Coron": { id: 112652, slug: 'coron', country: "Philippines" },
  "Da Lat": { id: 207, slug: 'da-lat', country: "Vietnam" },
  "Darwin": { id: 95, slug: 'darwin', country: "Australia" },
  "Dresden": { id: 22901, slug: 'dresden', country: "Germany" },
  "Dumaguete": { id: 148, slug: 'dumaguete', country: "Philippines" },
  "Edinburgh": { id: 200, slug: 'edinburgh', country: "United Kingdom" },
  "El Nido": { id: 365356, slug: 'el-nido', country: "Philippines" },
  "Fethiye": { id: 61798, slug: 'fethiye', country: "Turkey" },
  "Frankfurt": { id: 112049, slug: 'frankfurt', country: "Germany" },
  "Fremantle": { id: 702822, slug: 'fremantle', country: "Australia" },
  "Genoa": { id: 321, slug: 'genoa', country: "Italy" },
  "Glasgow": { id: 294, slug: 'glasgow', country: "United Kingdom" },
  "Gold Coast": { id: 72, slug: 'gold-coast', country: "Australia" },
  "Guanajuato": { id: 26421, slug: 'guanajuato', country: "Mexico" },
  "Gurugram": { id: 15743, slug: 'gurugram', country: "India" },
  "Ha Giang": { id: 22489, slug: 'ha-giang', country: "Vietnam" },
  "Hamburg": { id: 353, slug: 'hamburg', country: "Germany" },
  "Harbin": { id: 182, slug: 'harbin', country: "China" },
  "Honolulu": { id: 703335, slug: 'honolulu', country: "United States" },
  "Hua Hin": { id: 125, slug: 'hua-hin', country: "Thailand" },
  "Iloilo": { id: 481, slug: 'iloilo', country: "Philippines" },
  "Inverness": { id: 372, slug: 'inverness', country: "United Kingdom" },
  "Kanchanaburi": { id: 254, slug: 'kanchanaburi', country: "Thailand" },
  "Khiva": { id: 10071, slug: 'khiva', country: "Uzbekistan" },
  "Kobe": { id: 135, slug: 'kobe', country: "Japan" },
  "Kolkata": { id: 271, slug: 'kolkata', country: "India" },
  "Kuantan": { id: 365089, slug: 'kuantan', country: "Malaysia" },
  "Kuching": { id: 16814, slug: 'kuching', country: "Malaysia" },
  "Lijiang": { id: 12291, slug: 'lijiang', country: "China" },
  "Liverpool": { id: 295, slug: 'liverpool', country: "United Kingdom" },
  "London": { id: 106, slug: 'london', country: "United Kingdom" },
  "Los Cabos": { id: 16830, slug: 'los-cabos', country: "Mexico" },
  "Lucca": { id: 99807, slug: 'lucca', country: "Italy" },
  "Malang": { id: 521, slug: 'malang', country: "Indonesia" },
  "Manchester": { id: 296, slug: 'manchester', country: "United Kingdom" },
  "Medan": { id: 338, slug: 'medan', country: "Indonesia" },
  "Melbourne": { id: 69, slug: 'melbourne', country: "Australia" },
  "Mexico City": { id: 5238, slug: 'mexico-city', country: "Mexico" },
  "Munich": { id: 118, slug: 'munich', country: "Germany" },
  "Naha": { id: 13641, slug: 'naha', country: "Japan" },
  "Nantes": { id: 223132, slug: 'nantes', country: "France" },
  "Nashville": { id: 71287, slug: 'nashville', country: "United States" },
  "Nikko": { id: 29364, slug: 'nikko', country: "Japan" },
  "Ninh Binh": { id: 30135, slug: 'ninh-binh', country: "Vietnam" },
  "Oaxaca": { id: 10473, slug: 'oaxaca', country: "Mexico" },
  "Oxford": { id: 297, slug: 'oxford', country: "United Kingdom" },
  "Pasay": { id: 26286, slug: 'pasay', country: "Philippines" },
  "Philadelphia": { id: 80779, slug: 'philadelphia', country: "United States" },
  "Phnom Penh": { id: 44, slug: 'phnom-penh', country: "Cambodia" },
  "Pisa": { id: 409, slug: 'pisa', country: "Italy" },
  "Playa del Carmen": { id: 544, slug: 'playa-del-carmen', country: "Mexico" },
  "Puebla": { id: 7105, slug: 'puebla', country: "Mexico" },
  "Puerto Princesa": { id: 88695, slug: 'puerto-princesa', country: "Philippines" },
  "Puerto Vallarta": { id: 9722, slug: 'puerto-vallarta', country: "Mexico" },
  "Pushkar": { id: 302, slug: 'pushkar', country: "India" },
  "Putrajaya": { id: 7086, slug: 'putrajaya', country: "Malaysia" },
  "Ravenna": { id: 20969, slug: 'ravenna', country: "Italy" },
  "Rishikesh": { id: 54891, slug: 'rishikesh', country: "India" },
  "Saitama": { id: 20814, slug: 'saitama', country: "Japan" },
  "Samarkand": { id: 706911, slug: 'samarkand', country: "Uzbekistan" },
  "San Diego": { id: 330, slug: 'san-diego', country: "United States" },
  "San Miguel de Allende": { id: 19640, slug: 'san-miguel-de-allende', country: "Mexico" },
  "Santiago de Compostela": { id: 69794, slug: 'santiago-de-compostela', country: "Spain" },
  "Sanya": { id: 22772, slug: 'sanya', country: "China" },
  "Sapa": { id: 290, slug: 'sapa', country: "Vietnam" },
  "Segovia": { id: 15091, slug: 'segovia', country: "Spain" },
  "Selcuk": { id: 61877, slug: 'selcuk', country: "Turkey" },
  "Sepang": { id: 365432, slug: 'sepang', country: "Malaysia" },
  "Siem Reap": { id: 10, slug: 'siem-reap', country: "Cambodia" },
  "Sihanoukville": { id: 279, slug: 'sihanoukville', country: "Cambodia" },
  "Sukhothai": { id: 255, slug: 'sukhothai', country: "Thailand" },
  "Sydney": { id: 68, slug: 'sydney', country: "Australia" },
  "Tagaytay": { id: 111159, slug: 'tagaytay', country: "Philippines" },
  "Takayama": { id: 9316, slug: 'takayama', country: "Japan" },
  "Tangerang": { id: 30210, slug: 'tangerang', country: "Indonesia" },
  "Tashkent": { id: 4494, slug: 'tashkent', country: "Uzbekistan" },
  "Toulouse": { id: 206478, slug: 'toulouse', country: "France" },
  "Tulum": { id: 17463, slug: 'tulum', country: "Mexico" },
  "Ubud": { id: 703018, slug: 'ubud', country: "Indonesia" },
  "Yilan": { id: 42, slug: 'yilan', country: "Taiwan" },
  "York": { id: 299, slug: 'york', country: "United Kingdom" },
  "Zamboanga City": { id: 15709, slug: 'zamboanga-city', country: "Philippines" },
  "Zaragoza": { id: 89775, slug: 'zaragoza', country: "Spain" },
  "Zhangjiajie": { id: 161, slug: 'zhangjiajie', country: "China" },
  // Country confirmed on the Klook page itself:
  "Birmingham": { id: 700008, slug: 'birmingham', country: "United Kingdom" },
  "Boston": { id: 167, slug: 'Boston', country: "United States" },
  "Brighton": { id: 464, slug: 'brighton', country: "United Kingdom" },
  "Can Tho": { id: 5661, slug: 'can-tho-mekong-delta', country: "Vietnam" },
  "Cordoba": { id: 496, slug: 'cordoba', country: "Spain" },
  "Guadalajara": { id: 25743, slug: 'guadalajara', country: "Mexico" },
  "Ha Long Bay": { id: 486, slug: 'halong', country: "Vietnam" },
  "Hobart": { id: 16897, slug: 'hobart', country: "Australia" },
  "Miami": { id: 198, slug: 'Miami', country: "United States" },
  "Mui Ne": { id: 556, slug: 'phan-thiet-mui-ne', country: "Vietnam" },
  "Pai": { id: 702661, slug: 'pai', country: "Thailand" },
  "Palermo": { id: 370, slug: 'palermo', country: "Italy" },
  "Sunshine Coast": { id: 171, slug: 'sunshine-coast', country: "Australia" },
  "Taiping": { id: 365414, slug: 'taiping', country: "Malaysia" },
  "Toledo": { id: 473, slug: 'toledo', country: "Spain" },
  "Washington DC": { id: 166, slug: 'Washington-DC', country: "United States" },
  // Klook spells it differently (Bengaluru = bangalore, Malacca = melaka…):
  "Battambang": { id: 6244, slug: 'battambang-province', country: "Cambodia" },
  "Bengaluru": { id: 195, slug: 'bangalore', country: "India" },
  "Chamonix": { id: 700232, slug: 'chamonix-mont-blanc', country: "France" },
  "Frankfurt am Main": { id: 112049, slug: 'frankfurt', country: "Germany" },
  "Goa": { id: 178, slug: 'Goa', country: "India" },
  "Kochi": { id: 151, slug: 'cochin', country: "India" },
  "Kumamoto": { id: 4351, slug: 'kumamoto-prefecture', country: "Japan" },
  "Malacca": { id: 276, slug: 'melaka', country: "Malaysia" },
  "Nagasaki": { id: 7057, slug: 'nagasaki-prefecture', country: "Japan" },
  "Tongyeong": { id: 24598, slug: 'tongyeong-si', country: "South Korea" },
  // Districts and sub-areas -> the city or area Klook sells them under:
  "Aberdeen": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Bugis": { id: 6, slug: 'singapore', country: "Singapore" },
  "Bukit Timah": { id: 6, slug: 'singapore', country: "Singapore" },
  "Causeway Bay": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Central": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Civic District": { id: 6, slug: 'singapore', country: "Singapore" },
  "Deira": { id: 78, slug: 'dubai', country: "United Arab Emirates" },
  "Dempsey Hill": { id: 6, slug: 'singapore', country: "Singapore" },
  "Downtown Dubai": { id: 78, slug: 'dubai', country: "United Arab Emirates" },
  "Dubai Marina": { id: 78, slug: 'dubai', country: "United Arab Emirates" },
  "Jiufen": { id: 6488, slug: 'new-taipei', country: "Taiwan" },
  "Jordan": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Jumeirah": { id: 78, slug: 'dubai', country: "United Arab Emirates" },
  "Jurong": { id: 6, slug: 'singapore', country: "Singapore" },
  "Katong": { id: 6, slug: 'singapore', country: "Singapore" },
  "Kennedy Town": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Koh Phi Phi": { id: 63, slug: 'krabi', country: "Thailand" },
  "Komodo": { id: 522, slug: 'labuan-bajo', country: "Indonesia" },
  "Lantau Island": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Mandalika": { id: 14443, slug: 'central-lombok', country: "Indonesia" },
  "Mong Kok": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "North Point": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Nusa Penida": { id: 8, slug: 'bali', country: "Indonesia" },
  "Palm Jumeirah": { id: 78, slug: 'dubai', country: "United Arab Emirates" },
  "Pingxi": { id: 6488, slug: 'new-taipei', country: "Taiwan" },
  "Saadiyat Island": { id: 131, slug: 'abu-dhabi', country: "United Arab Emirates" },
  "Sai Kung": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Sha Tin": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Sheung Wan": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Stanley": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Sun Moon Lake": { id: 25303, slug: 'nantou', country: "Taiwan" },
  "Taroko Gorge": { id: 20, slug: 'hualien', country: "Taiwan" },
  "Tiong Bahru": { id: 6, slug: 'singapore', country: "Singapore" },
  "Tsim Sha Tsui": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
  "Wan Chai": { id: 2, slug: 'hong-kong', country: "Hong Kong" },
};

// City-level Klook landing URL: the curated destination page when the city is
// mapped, the search page only as a last resort (Klook's robots.txt disallows
// /search/, so a mapped city must never fall back to it).
//
// `country` (2026-10-05): an unmapped district of a city-state — Hong Kong's
// Jordan, Central, Aberdeen; Singapore's Katong — sent tours to a bare search
// for "Jordan" (the country) or "Aberdeen" (Scotland) while the same page's
// hotel link already said "Jordan Hong Kong". A country that is itself a key
// here is a city-state, so its district goes to the city-state's destination;
// anywhere else the search carries the country, as the hotel link does.
// Destinations Klook publishes in English but NOT in these locales: their
// localized city sitemaps (sitemap-city-plain_{ko,ja,es,zh-cn}.xml, 2026-10-05)
// lack the id, and the localized URL lands on "page not found — going home in
// 3 seconds". Every other mapped id is in all five. These send that reader to
// the English page instead, which exists and has Klook's own language switch.
export const KLOOK_LOCALE_GAPS: Record<number, string[]> = {
  293: ['ko', 'ja', 'es', 'zh-CN'],      // Cardiff
  14443: ['ko', 'ja', 'es', 'zh-CN'],    // Central Lombok (Lombok, Mandalika)
  701631: ['ko', 'ja', 'es', 'zh-CN'],   // Izmir
  32303: ['es'],                          // Alanya
  61798: ['es'],                          // Fethiye
  116609: ['es'],                         // Bodrum
};

export function klookCityDest(city: string, locale: string, country?: string): string {
  // A row of the same name in another country is not this city: Scotland's
  // Aberdeen landed on Hong Kong's (Codex, 10-05). A city-state row still
  // applies to itself whatever country a post files it under (Hong Kong/China).
  const fits = (r?: KlookCity) => r && (!country || r.country === country || r.country === city) ? r : undefined;
  const m = fits(KLOOK_CITY[city]) ?? (country ? fits(KLOOK_CITY[country]) : undefined);
  if (m) {
    const loc = KLOOK_LOCALE_GAPS[m.id]?.includes(locale) ? 'en-US' : locale;
    return `https://www.klook.com/${loc}/destination/c${m.id}-${m.slug}/`;
  }
  const q = country && country !== city ? `${city} ${country}` : city;
  return `https://www.klook.com/${locale}/search/?query=${encodeURIComponent(q)}`;
}
