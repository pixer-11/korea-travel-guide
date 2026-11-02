// Which paid PDF guide (data/gumroad-products.json) may be offered on an
// itinerary page — and when it must not be.
//
// The card promises "the print-ready version of this exact itinerary". On
// 2026-11-02 that promise was false: the Tokyo PDF was made on 08-14 from the
// stops of that day (stopsHash 752277df…, Tokyo Tower and Ramen Street among
// them), the itinerary was regenerated six times through 09-22, and the page
// had shown 11 different stops since — while still selling the old nine for
// $12. Nothing compared the two.
//
// So a product names the stopsHash it was built from, and the card appears only
// while the page shows that same itinerary. A product without a stopsHash is not
// offered at all: an unrecorded build is exactly the case that went wrong.
/**
 * @param {Record<string, {url:string, price:string, stopsHash?:string}>} products
 * @param {string} slug       itinerary collection id
 * @param {string|undefined} stopsHash  the itinerary's current stopsHash
 * @returns {{url:string, price:string}|null}
 */
export function guideProductFor(products, slug, stopsHash) {
  const p = products?.[slug];
  if (!p || typeof p !== 'object' || !p.url || !p.price) return null;
  if (!p.stopsHash || !stopsHash || p.stopsHash !== stopsHash) return null;
  return { url: p.url, price: p.price };
}
