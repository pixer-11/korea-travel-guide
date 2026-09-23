"""Nationwide public holidays for one country, as JSON on stdout.

    python scripts/lib/holidays-export.py KR 2026 2027

Why this exists (2026-09-24): holidays came from date.nager.at, whose terms say
"For commercial purposes we require active sponsorship" and forbid using the
data "to publish or operate your own holiday portal". This site carries
affiliate links, so it is commercial. The `holidays` package (vacanza/holidays)
is MIT-licensed, covers all twenty of our countries, and runs offline.

Output rows match what refresh-country-facts.mjs has always stored:
    {"date": "YYYY-MM-DD", "name": <English>, "localName": <country language>}
"""
import json
import sys

import holidays


def names(iso2, years, language):
    kw = {"years": years}
    if language:
        kw["language"] = language
    return holidays.country_holidays(iso2, **kw)


def composed(lo, en_list, base_names, english):
    """English for a composed name such as a substitute day: find the plain
    holiday it is built from, translate that, and take the one English name on
    the day that contains it. Thailand's 7 December carries three in-lieu days
    at once, so position cannot tell them apart (2026-09-24)."""
    for base in base_names:
        if base != lo and base in lo:
            en_base = english.tr(base)
            hits = [e for e in en_list if en_base in e]
            if len(hits) == 1:
                return hits[0]
    return lo


def main():
    iso2 = sys.argv[1].upper()
    years = [int(y) for y in sys.argv[2:]]
    local = names(iso2, years, None)
    langs = set(getattr(local, "supported_languages", ()) or ())
    english_lang = next((l for l in ("en_US", "en_GB", "en") if l in langs), None)
    english = names(iso2, years, english_lang) if english_lang else local
    # Every plain holiday name this year, longest first — the pieces a composed
    # name ("<in-lieu prefix> National Day") is built from.
    base_names = sorted({n for d in local.keys() for n in local.get_list(d)}, key=len, reverse=True)
    rows = []
    for day in sorted(local.keys()):
        lo_list = local.get_list(day)
        en_list = english.get_list(day) if english is not local else lo_list
        for i, lo in enumerate(lo_list):
            # Pair names by TRANSLATION, not by position: each language sorts a
            # shared day's names on its own, so position swapped Italy's
            # 1 November (All Saints' Day beside "Giorno dell'unità nazionale" —
            # caught in review 2026-09-24). tr() maps the source-language name
            # through the package's own catalogue.
            en = english.tr(lo) if hasattr(english, "tr") else lo
            if en not in en_list:
                en = composed(lo, en_list, base_names, english)
            if en not in en_list:
                # With one name that day position is unambiguous; otherwise
                # keep the local name rather than guess.
                en = en_list[0] if len(lo_list) == 1 and en_list else lo
            rows.append({"date": day.isoformat(), "name": en, "localName": lo})
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(rows, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
