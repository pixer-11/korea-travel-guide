// Loads .env for LOCAL runs. Imported first so env vars exist before any
// other module reads process.env. GitHub Actions passes env directly and has
// no .env file, so a missing file is fine.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no .env present — running in CI or dummy mode */
}
