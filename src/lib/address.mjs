// Google Places hands back addresses that START with an Open Location Code
// ("CC7W+96Q - Al Bustan - Ajman", "9H45+98Q Ayutthaya Historical Park, …")
// wherever the street grid is thin — 87 live guides on 2026-08-23, mostly the
// Gulf and rural Thailand. The code is meaningless to a reader and sat as the
// first thing in the At-a-glance card ("the address looks like a password",
// competitor audit). It is dropped at render time — the stored value stays as
// Google gave it, and the rest of the line ("Al Bustan - Ajman - UAE") is the
// part a human can use.
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,}\s*(?:[-–,·]\s*)?/;

/** The address without a leading plus code (and its separator); '' stays ''. */
export function stripPlusCode(address) {
  if (typeof address !== 'string') return '';
  const out = address.replace(PLUS_CODE, '').trim();
  // If the address WAS only a plus code, there is nothing readable to show.
  return out;
}
