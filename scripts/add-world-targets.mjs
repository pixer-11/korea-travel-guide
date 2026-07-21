#!/usr/bin/env node
// One-off: merge curated famous-attraction targets for the launch countries into
// data/targets.json (dedup by query). Named topics → named, deep guides.
import { readFile, writeFile } from 'node:fs/promises';

const T = (country, region, topic, category, query) => ({ country, region, topic, category, query: query || `${topic} ${region} ${country}` });

const NEW = [
  // ── Japan ──
  T('Japan', 'Tokyo', 'Senso-ji Temple', 'attraction', 'Senso-ji Temple Asakusa Tokyo'),
  T('Japan', 'Tokyo', 'Shibuya Crossing', 'attraction'),
  T('Japan', 'Tokyo', 'Meiji Shrine', 'attraction'),
  T('Japan', 'Tokyo', 'Tsukiji Outer Market', 'restaurant', 'Tsukiji Outer Market food Tokyo'),
  T('Japan', 'Tokyo', 'teamLab Planets', 'trendy'),
  T('Japan', 'Kyoto', 'Fushimi Inari Shrine', 'attraction'),
  T('Japan', 'Kyoto', 'Kinkaku-ji Golden Pavilion', 'attraction'),
  T('Japan', 'Kyoto', 'Arashiyama Bamboo Grove', 'attraction'),
  T('Japan', 'Osaka', 'Osaka Castle', 'attraction'),
  T('Japan', 'Osaka', 'Dotonbori', 'restaurant', 'Dotonbori street food Osaka'),
  T('Japan', 'Nara', 'Nara Park', 'attraction', 'Nara Park deer Todai-ji'),
  T('Japan', 'Hiroshima', 'Itsukushima Shrine', 'attraction', 'Itsukushima Shrine Miyajima Hiroshima'),
  T('Japan', 'Sapporo', 'Sapporo Snow Festival', 'event'),
  T('Japan', 'Fukuoka', 'Fukuoka Yatai Food Stalls', 'restaurant'),

  // ── United States ──
  T('United States', 'New York', 'Statue of Liberty', 'attraction'),
  T('United States', 'New York', 'Central Park', 'attraction'),
  T('United States', 'New York', 'Times Square', 'attraction'),
  T('United States', 'New York', 'Metropolitan Museum of Art', 'attraction'),
  T('United States', 'Los Angeles', 'Griffith Observatory', 'attraction'),
  T('United States', 'Los Angeles', 'Santa Monica Pier', 'attraction'),
  T('United States', 'San Francisco', 'Golden Gate Bridge', 'attraction'),
  T('United States', 'San Francisco', 'Alcatraz Island', 'attraction'),
  T('United States', 'Las Vegas', 'The Las Vegas Strip', 'attraction'),
  T('United States', 'Chicago', 'Millennium Park Cloud Gate', 'attraction'),
  T('United States', 'New Orleans', 'French Quarter', 'hidden-gem'),
  T('United States', 'Seattle', 'Pike Place Market', 'restaurant'),

  // ── Thailand ──
  T('Thailand', 'Bangkok', 'Grand Palace', 'attraction', 'Grand Palace Bangkok Thailand'),
  T('Thailand', 'Bangkok', 'Wat Arun', 'attraction'),
  T('Thailand', 'Bangkok', 'Wat Pho Reclining Buddha', 'attraction'),
  T('Thailand', 'Bangkok', 'Chatuchak Weekend Market', 'hidden-gem'),
  T('Thailand', 'Bangkok', 'Yaowarat Chinatown Street Food', 'restaurant'),
  T('Thailand', 'Chiang Mai', 'Doi Suthep Temple', 'attraction'),
  T('Thailand', 'Chiang Mai', 'Chiang Mai Old City Temples', 'attraction'),
  T('Thailand', 'Phuket', 'Big Buddha Phuket', 'attraction'),
  T('Thailand', 'Phuket', 'Phi Phi Islands', 'attraction'),
  T('Thailand', 'Krabi', 'Railay Beach', 'attraction'),
  T('Thailand', 'Ayutthaya', 'Ayutthaya Historical Park', 'attraction'),
  T('Thailand', 'Chiang Rai', 'Wat Rong Khun White Temple', 'attraction'),

  // ── France ──
  T('France', 'Paris', 'Eiffel Tower', 'attraction'),
  T('France', 'Paris', 'Louvre Museum', 'attraction'),
  T('France', 'Paris', 'Notre-Dame Cathedral', 'attraction'),
  T('France', 'Paris', 'Montmartre and Sacre-Coeur', 'attraction'),
  T('France', 'Paris', 'Palace of Versailles', 'attraction'),
  T('France', 'Nice', 'Promenade des Anglais', 'attraction'),
  T('France', 'Nice', 'Vieux Nice Old Town', 'hidden-gem'),
  T('France', 'Lyon', 'Vieux Lyon Old Town', 'hidden-gem'),
  T('France', 'Marseille', 'Notre-Dame de la Garde', 'attraction'),
  T('France', 'Bordeaux', 'Bordeaux Wine Region', 'hidden-gem'),
  T('France', 'Provence', 'Provence Lavender Fields', 'attraction'),
  T('France', 'Strasbourg', 'Strasbourg Christmas Market', 'event'),

  // ── Italy ──
  T('Italy', 'Rome', 'Colosseum', 'attraction'),
  T('Italy', 'Rome', 'Vatican Museums and St Peters Basilica', 'attraction'),
  T('Italy', 'Rome', 'Trevi Fountain', 'attraction'),
  T('Italy', 'Rome', 'Pantheon', 'attraction'),
  T('Italy', 'Florence', 'Florence Cathedral Duomo', 'attraction'),
  T('Italy', 'Florence', 'Uffizi Gallery', 'attraction'),
  T('Italy', 'Venice', 'St Marks Square', 'attraction'),
  T('Italy', 'Venice', 'Grand Canal Venice', 'attraction'),
  T('Italy', 'Milan', 'Milan Cathedral Duomo', 'attraction'),
  T('Italy', 'Naples', 'Pompeii Ruins', 'attraction'),
  T('Italy', 'Amalfi Coast', 'Positano', 'attraction'),
  T('Italy', 'Bologna', 'Bologna Food Tour', 'restaurant'),

  // ── China ──
  T('China', 'Beijing', 'Great Wall of China Mutianyu', 'attraction'),
  T('China', 'Beijing', 'Forbidden City', 'attraction'),
  T('China', 'Beijing', 'Temple of Heaven', 'attraction'),
  T('China', 'Beijing', 'Summer Palace', 'attraction'),
  T('China', 'Shanghai', 'The Bund', 'attraction'),
  T('China', 'Shanghai', 'Yu Garden', 'attraction'),
  T('China', 'Xian', 'Terracotta Army', 'attraction', 'Terracotta Army Xian China'),
  T('China', 'Xian', 'Xian City Wall', 'attraction'),
  T('China', 'Chengdu', 'Giant Panda Breeding Base', 'attraction'),
  T('China', 'Guilin', 'Li River and Yangshuo', 'attraction'),
  T('China', 'Hangzhou', 'West Lake', 'attraction'),
  T('China', 'Suzhou', 'Suzhou Classical Gardens', 'attraction'),

  // ── Spain ──
  T('Spain', 'Barcelona', 'Sagrada Familia', 'attraction'),
  T('Spain', 'Barcelona', 'Park Guell', 'attraction'),
  T('Spain', 'Barcelona', 'La Rambla and Gothic Quarter', 'hidden-gem'),
  T('Spain', 'Madrid', 'Prado Museum', 'attraction'),
  T('Spain', 'Madrid', 'Royal Palace of Madrid', 'attraction'),
  T('Spain', 'Madrid', 'Retiro Park', 'attraction'),
  T('Spain', 'Seville', 'Royal Alcazar of Seville', 'attraction'),
  T('Spain', 'Seville', 'Seville Cathedral and Giralda', 'attraction'),
  T('Spain', 'Seville', 'Plaza de Espana Seville', 'attraction'),
  T('Spain', 'Granada', 'Alhambra', 'attraction'),
  T('Spain', 'Valencia', 'City of Arts and Sciences', 'attraction'),
  T('Spain', 'San Sebastian', 'San Sebastian Pintxos Bars', 'restaurant'),
];

const path = new URL('../data/targets.json', import.meta.url);
const data = JSON.parse(await readFile(path, 'utf8'));
const seen = new Set(data.targets.map((t) => t.query));
let added = 0;
for (const t of NEW) {
  if (!seen.has(t.query)) { data.targets.push(t); seen.add(t.query); added++; }
}
await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Added ${added} world targets → ${data.targets.length} total`);
