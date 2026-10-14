// Builds the static site in public/:
//   - validates data/opportunities/*.json and writes public/data/opportunities.json
//   - copies the Lucide icon bundle to public/vendor/lucide/
// The outputs are committed, so hosts like Vercel can serve public/ as-is;
// running this again just regenerates them.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadOpportunities, CLUSTERS, TYPES } from '../server/opportunities.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const opportunities = loadOpportunities();
const dataDir = path.join(root, 'public', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, 'opportunities.json'),
  `${JSON.stringify({ clusters: CLUSTERS, types: TYPES, count: opportunities.length, opportunities })}\n`,
);

const lucideDir = path.join(path.dirname(require.resolve('lucide/package.json')), 'dist', 'umd');
const vendorDir = path.join(root, 'public', 'vendor', 'lucide');
fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(path.join(lucideDir, 'lucide.min.js'), path.join(vendorDir, 'lucide.min.js'));

console.log(`Built public/data/opportunities.json (${opportunities.length} opportunities) and public/vendor/lucide/lucide.min.js`);
