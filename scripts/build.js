// Builds the static site in public/:
//   - validates data/opportunities/*.json and data/status.json (the weekly checker's results)
//     and writes public/data/opportunities.json
//   - copies the Lucide icon bundle and the QR code libraries to public/vendor/
// The outputs are committed, so hosts like Vercel can serve public/ as-is;
// running this again just regenerates them.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadOpportunities, loadStatus, withStatus, CLUSTERS, TYPES } from '../server/opportunities.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const opportunities = withStatus(loadOpportunities(), loadStatus());
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

// Login Pass QR codes: a generator (an ES module) and a reader (loaded only when scanning).
const vendor = (pkg, file, dir, as = path.basename(file)) => {
  const out = path.join(root, 'public', 'vendor', dir);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules', pkg, file), path.join(out, as));
};
vendor('qrcode-generator', 'dist/qrcode.mjs', 'qrcode-generator');
vendor('jsqr', 'dist/jsQR.js', 'jsqr');
vendor('jsqr', 'LICENSE', 'jsqr');

console.log(`Built public/data/opportunities.json (${opportunities.length} opportunities) and public/vendor/ (lucide, qrcode-generator, jsqr)`);
