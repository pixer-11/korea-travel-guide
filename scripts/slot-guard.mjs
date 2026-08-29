// CLI wrapper for lib/slot-served.mjs, for workflows whose payload spans many
// steps (pinterest): prints exactly `served=true` or `served=false` on stdout
// so a step can `| tee -a "$GITHUB_OUTPUT"` it and later steps can gate on
// `steps.<id>.outputs.served != 'true'`. Diagnostics go to stderr to keep the
// output file clean.
//
//   node scripts/slot-guard.mjs pinterest.yml
import { slotAlreadyServed } from './lib/slot-served.mjs';

const workflowFile = process.argv[2];
if (!workflowFile) {
  console.error('usage: node scripts/slot-guard.mjs <workflow-file.yml>');
  process.exit(2);
}

const v = await slotAlreadyServed(workflowFile);
if (v.served) {
  console.error(`SLOT_SERVED: run ${v.by} already served this slot — later steps will skip.`);
} else if (v.error) {
  console.error(`slot guard inconclusive (${v.error}) — not skipping.`);
} else if (!v.active) {
  console.error('slot guard inactive (not a schedule run, or no token/manifest entry).');
}
console.log(`served=${v.served ? 'true' : 'false'}`);
