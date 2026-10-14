// Validates every file in data/opportunities/ against the schema and prints a
// per-cluster summary. Run with `npm run validate-data`; exits non-zero on error.

import { loadOpportunities, CLUSTERS } from '../server/opportunities.js';

try {
  const all = loadOpportunities();
  const byCluster = Object.fromEntries(Object.keys(CLUSTERS).map((k) => [k, 0]));
  for (const o of all) byCluster[o.cluster] += 1;
  console.log(`OK: ${all.length} opportunities`);
  console.table(byCluster);
} catch (err) {
  console.error(`Invalid data: ${err.message}`);
  process.exit(1);
}
