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

// Esri's Light Gray canvas, third provider in this slot and each exit is on
// record so nobody circles back:
//  · tile.openstreetmap.org — fails the TLS handshake from the owner's
//    network in Vietnam (2026-08-23 and re-measured 2026-08-27, curl exit
//    35): a grey box for him and any reader on that path.
//  · CARTO light — worked on 08-23, then began stamping "API KEY REQUIRED"
//    across every keyless tile; the owner spotted the watermark on a live
//    guide on 2026-08-27. Policy change, not an outage: keyless is over.
//  · Esri Canvas/World_Light_Gray_Base — no key, 200 from the owner's
//    network, quiet gray that sits under the hanji palette like CARTO's
//    light did. NOTE the path is /tile/{z}/{y}/{x} — y BEFORE x, unlike
//    the slippy convention the previous two used.
export const TILE_HOSTS = ['https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile'];
export const TILE_ATTRIBUTION = '© Esri · OpenStreetMap contributors';
export const tileUrl = (z, x, y) => `${TILE_HOSTS[0]}/${z}/${y}/${x}`;

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
