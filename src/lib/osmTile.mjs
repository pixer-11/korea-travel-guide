// ─────────────────────────────────────────────────────────────
//  STATIC MAP FACADE — OpenStreetMap tiles as plain <img>, no iframe, no JS.
//
//  Pages that outrank ours show a map; ours showed a "Open in Google Maps"
//  link (competitor audit 2026-08-23). An embedded Google/Leaflet map costs
//  an iframe or a script on every guide (LCP/INP), and the Google Static Maps
//  API is closed to this account (Vietnam billing). So: a 2×2 mosaic of
//  standard OSM tiles around the place, lazy-loaded, a pin drawn in CSS at
//  the exact point, the whole thing a link to Google Maps. Four 256px images
//  per view, attribution shown — within the OSM tile usage policy for a site
//  of this size.
//
//  Pure math lives here (plain .mjs) so node --test can cover it and the
//  Astro component imports the same function.
// ─────────────────────────────────────────────────────────────

export const TILE = 256;

// CARTO's free "light" basemap (OSM data, CC-BY attribution "© OpenStreetMap
// contributors © CARTO"), not tile.openstreetmap.org: the OSM host fails the
// TLS handshake from the owner's network in Vietnam (2026-08-23, curl exit
// 35 and the browser's onerror in 155ms) — a map the owner and every
// Vietnamese reader would see as a grey box. CARTO answered in 221ms and its
// light style sits quietly under the hanji palette.
export const TILE_HOSTS = ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/light_all`);
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
export const tileUrl = (z, x, y) => `${TILE_HOSTS[(x + y) % TILE_HOSTS.length]}/${z}/${x}/${y}.png`;

/** Slippy-map tile coordinates (fractional) for a WGS84 point at zoom z. */
export function tileXY(lat, lng, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * A mosaic of `size`×`size` tiles chosen so the point sits as close to the
 * mosaic's centre as whole tiles allow. Returns the tiles (with their pixel
 * origin inside the mosaic) and the point's pixel position inside it, so the
 * caller can translate the mosaic to put the point at the container centre.
 */
export function tileMosaic(lat, lng, { z = 15, size = 2 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  const { x, y } = tileXY(lat, lng, z);
  const n = 2 ** z;
  // Start the mosaic so the point falls in its middle: for 2×2, the tile left
  // of the point if the point is in the left half of its tile, else the tile
  // containing it.
  const x0 = Math.floor(x - (size - 1) / 2), y0 = Math.floor(y - (size - 1) / 2);
  const tiles = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const tx = ((x0 + c) % n + n) % n; // wrap around the antimeridian
      const ty = y0 + r;
      if (ty < 0 || ty >= n) continue;
      tiles.push({ x: tx, y: ty, z, url: tileUrl(z, tx, ty), dx: c * TILE, dy: r * TILE });
    }
  }
  return { tiles, px: (x - x0) * TILE, py: (y - y0) * TILE, width: size * TILE, height: size * TILE };
}
