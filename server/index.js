// Local development server for Student Atlas.
// The site is static (public/) plus the functions in api/ (reviews and
// College Lab AI feedback), so production hosts like Vercel serve it directly;
// this server mirrors that setup locally with the same security headers,
// clean URLs, and API routes.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SECURITY_HEADERS } from './headers.js';
import { handleCollegeLab } from './college-lab.js';
import { reviewHandlersFromEnv } from './reviews/index.js';
import { accountHandlersFromEnv } from './accounts/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

// Runs a web-standard (Request) => Response handler inside Express.
function webHandler(handler) {
  return async (req, res) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (['x-real-ip', 'x-forwarded-for', 'x-forwarded-host'].includes(key)) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('x-real-ip', req.socket.remoteAddress ?? 'unknown');
    const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body);
    const response = await handler(new Request(`http://${req.headers.host}${req.originalUrl}`, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
    }));
    res.status(response.status);
    response.headers.forEach((value, key) => res.set(key, value));
    res.send(Buffer.from(await response.arrayBuffer()));
  };
}

export function createApp({ env = process.env } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });

  const reviews = reviewHandlersFromEnv(env, { memoryFallback: true });
  const raw = express.raw({ type: () => true, limit: '8kb' });
  app.all('/api/reviews', raw, webHandler(reviews.reviews));
  app.all('/api/reviews-admin', raw, webHandler(reviews.admin));
  // Anonymous accounts, cloud sync, and classroom rooms.
  const accounts = accountHandlersFromEnv(env, { memoryFallback: true });
  const rawLarge = express.raw({ type: () => true, limit: '512kb' });
  app.all('/api/account', rawLarge, webHandler(accounts.account));
  app.all('/api/rooms', raw, webHandler(accounts.rooms));
  // College Lab AI feedback (api/college-lab.js in production).
  app.all('/api/college-lab', express.json({ limit: '200kb' }), handleCollegeLab);
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => console.log(`Student Atlas running at http://localhost:${PORT}`));
}
