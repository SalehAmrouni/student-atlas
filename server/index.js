// Student Atlas web server: serves the static site, the opportunities API,
// and community submissions. Zeus runs entirely in the browser.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { loadOpportunities, CLUSTERS, TYPES } from './opportunities.js';
import { SubmissionSchema, saveSubmission } from './submissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LUCIDE_DIR = path.join(ROOT, 'node_modules', 'lucide', 'dist', 'umd');

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

export function createApp({ opportunities = loadOpportunities() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Set TRUST_PROXY (e.g. "1") when running behind a reverse proxy so rate
  // limits key on the real client IP instead of the proxy's.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  }));
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });

  // ---- API ----------------------------------------------------------------
  const api = express.Router();
  api.use(express.json({ limit: '16kb', strict: true }));

  // Reject cross-site API writes: browsers always send Origin on POST.
  // Compare hosts only, since TLS is often terminated by a proxy in front of
  // the app (the browser says https:// while Express sees http).
  api.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin');
    if (!origin) return next();
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* malformed */ }
    if (originHost !== req.get('host')) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    }
    next();
  });

  const standard = { standardHeaders: 'draft-8', legacyHeaders: false };
  const submitLimiter = rateLimit({ ...standard, windowMs: 60 * 60_000, limit: 5, message: { error: 'Too many submissions. Please try again later.' } });
  const readLimiter = rateLimit({ ...standard, windowMs: 60_000, limit: 120 });

  const meta = { clusters: CLUSTERS, types: TYPES, count: opportunities.length };
  const opportunitiesPayload = JSON.stringify({ ...meta, opportunities });

  api.get('/health', (_req, res) => res.json({ ok: true, opportunities: opportunities.length }));

  api.get('/opportunities', readLimiter, (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/json').send(opportunitiesPayload);
  });

  api.post('/submissions', submitLimiter, async (req, res, next) => {
    const parsed = SubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    }
    if (parsed.data.website2) return res.status(202).json({ ok: true }); // honeypot tripped: pretend success
    try {
      const id = await saveSubmission(parsed.data);
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // ---- Static site --------------------------------------------------------
  app.use('/vendor/lucide', express.static(LUCIDE_DIR, { maxAge: '7d', index: false }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html', maxAge: isProd ? '1h' : 0 }));
  app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

  // Never leak stack traces to clients.
  app.use((err, _req, res, _next) => {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('[server] error:', err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Student Atlas running at http://localhost:${PORT}`);
  });
}
