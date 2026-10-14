// Local development server for Student Atlas.
// The site itself is fully static (public/), so production hosts like Vercel
// serve it directly; this server just mirrors that setup locally with the
// same security headers and clean URLs.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SECURITY_HEADERS } from './headers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => console.log(`Student Atlas running at http://localhost:${PORT}`));
}
