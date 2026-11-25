// MACHINE-WRITTEN by scripts/discover-events.mjs through scripts/lib/province-tz.mjs.
// The zone of every city discovery placed in a country that spans more than
// one, decided from the city's province (see that file). Hand entries in
// venue-tz.mjs win. tz null: the city could not be placed — its page shows no
// local-time state, and "why" says what was missing. Edit venue-tz.mjs instead.
export default {
  "United States": {
    "Newark": {
      "tz": "America/New_York",
      "province": "New Jersey"
    },
    "Frisco": {
      "tz": "America/Chicago",
      "province": "Texas"
    },
    "Indianapolis": {
      "tz": "America/Indiana/Indianapolis",
      "province": "Indiana"
    },
    "Atlanta": {
      "tz": "America/New_York",
      "province": "Georgia"
    }
  },
  "Indonesia": {
    "Semarang": {
      "tz": "Asia/Jakarta",
      "province": "Central Java"
    },
    "Toraja": {
      "tz": "Asia/Makassar",
      "province": "South Sulawesi"
    }
  },
  "Mongolia": {
    "Uvurkhangai": {
      "tz": "Asia/Ulaanbaatar",
      "province": "Ovorkhangai"
    },
    "Khatgal": {
      "tz": "Asia/Ulaanbaatar",
      "province": "Khovsgol"
    }
  },
  "Mexico": {
    "San Miguel de Cozumel": {
      "tz": "America/Cancun",
      "province": "Quintana Roo"
    },
    "Mazatlán": {
      "tz": "America/Mazatlan",
      "province": "Sinaloa"
    }
  },
  "Canada": {
    "Gatineau": {
      "tz": "America/Toronto",
      "province": "Quebec"
    },
    "Mississauga": {
      "tz": "America/Toronto",
      "province": "Ontario"
    }
  }
};
