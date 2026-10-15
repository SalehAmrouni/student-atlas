// Validates every file in data/opportunities/ against the schema and prints a
// per-cluster summary. Run with `npm run validate-data`; exits non-zero on error.

import { loadOpportunities, loadStatus, CLUSTERS } from '../server/opportunities.js';

try {
  const all = loadOpportunities();
  const byCluster = Object.fromEntries(Object.keys(CLUSTERS).map((k) => [k, 0]));
  for (const o of all) byCluster[o.cluster] += 1;
  console.log(`OK: ${all.length} opportunities`);
  console.table(byCluster);
  const status = loadStatus();
  const ids = new Set(all.map((o) => o.id));
  const unknown = Object.keys(status).filter((id) => !ids.has(id));
  if (unknown.length) throw new Error(`status.json has entries for unknown ids: ${unknown.join(', ')}`);
  console.log(`OK: status for ${Object.keys(status).length} opportunities`);
} catch (err) {
  console.error(`Invalid data: ${err.message}`);
  process.exit(1);
}
