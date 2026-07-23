// Extracts ONLY the emoji this site actually uses from the 8.6 MB
// @iconify-json/fluent-emoji-flat set into a tiny src/data/emoji-flat.json.
// Emoji.astro imports that small file instead of the full package, so the
// Cloudflare build never has to load/parse the whole 8.6 MB set (which OOM'd
// the build container — the full-package import built fine locally but failed
// in CI). Re-run this whenever you add a new <Emoji name="…" />.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Keep in sync with the emoji referenced across src/ (static <Emoji name="…"/>,
// the PlanTrip services array, and the continent icon map).
const USED = [
  // essentials
  'passport-control', 'metro', 'credit-card', 'cherry-blossom', 'police-car-light',
  // CTAs / affiliate / newsletter / checklist
  'hotel', 'admission-tickets', 'wrapped-gift', 'printer', 'compass', 'round-pushpin', 'airplane',
  // plan-trip services
  'automobile', 'taxi', 'antenna-bars',
  // continent globes
  'globe-showing-asia-australia', 'globe-showing-europe-africa', 'globe-showing-americas', 'world-map',
];

const src = JSON.parse(
  await readFile(join(ROOT, 'node_modules/@iconify-json/fluent-emoji-flat/icons.json'), 'utf8')
);

const icons = {};
const missing = [];
for (const name of USED) {
  if (src.icons[name]) icons[name] = { body: src.icons[name].body };
  else missing.push(name);
}
if (missing.length) {
  console.error('❌ missing emoji in fluent-emoji-flat:', missing.join(', '));
  process.exit(1);
}

const out = { width: src.width ?? 32, height: src.height ?? 32, icons };
await mkdir(join(ROOT, 'src/data'), { recursive: true });
const dest = join(ROOT, 'src/data/emoji-flat.json');
await writeFile(dest, JSON.stringify(out) + '\n', 'utf8');

const kb = (JSON.stringify(out).length / 1024).toFixed(1);
console.log(`✓ wrote src/data/emoji-flat.json — ${USED.length} emoji, ${kb} KB`);
