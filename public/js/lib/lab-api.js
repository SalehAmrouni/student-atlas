// Talks to the optional College Lab AI endpoint. When it isn't deployed or has
// no API key (static hosting, local dev without a key), aiAvailable() resolves
// false and the College Lab uses its on-device engine instead.

const ENDPOINT = '/api/college-lab';
let statusPromise = null;

export function aiAvailable() {
  statusPromise ??= (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(ENDPOINT, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(t);
      if (!res.ok) return false;
      const body = await res.json();
      return body?.ai === true;
    } catch {
      return false;
    }
  })();
  return statusPromise;
}

export class LabAiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const MESSAGES = {
  declined: 'The AI couldn’t review this one, so here is on-device feedback instead.',
  rate_limited: 'AI feedback is busy right now, so here is on-device feedback instead. Try AI again in a few minutes.',
  ai_unavailable: 'AI feedback isn’t set up on this site, so here is on-device feedback.',
  network: 'Couldn’t reach AI feedback, so here is on-device feedback instead.',
};
export const fallbackNotice = (err) => MESSAGES[err?.code] ?? 'AI feedback had a problem, so here is on-device feedback instead.';

/** POSTs a task; resolves to the AI result or throws LabAiError. */
export async function callLabAi(payload, { timeoutMs = 150000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch {
    throw new LabAiError('network');
  } finally {
    clearTimeout(t);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new LabAiError(body?.error ?? `http_${res.status}`);
  return body.result;
}
