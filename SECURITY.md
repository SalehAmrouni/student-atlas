# Security

## Design

- **No secrets to leak**: Student Atlas uses no API keys or external services. `.env` files are git-ignored anyway.
- **Transport & headers**: Helmet sets a strict Content Security Policy (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, and HSTS in production. A `Permissions-Policy` disables camera, microphone, geolocation, payment, and USB.
- **Input validation**: submission bodies are validated with Zod (strict schemas, length limits, `http(s)` URLs only). JSON bodies are capped at 16 KB.
- **Abuse protection**: per-IP rate limits on submissions (5/hour) and reads; a honeypot field on the submission form; POSTs from other origins are rejected.
- **Output safety**: the browser builds all dynamic UI with `textContent`/`createElement`. Zeus's replies go through a Markdown renderer that never parses HTML and only allows `http(s)` links and `opp:` references to known ids.
- **Zeus guardrails**: Zeus runs locally and only recommends entries from the directory. It points students to 988 and 911 when it detects crisis language, redirects inappropriate messages, and discourages sharing contact details.
- **Privacy**: no accounts, cookies, analytics, or third-party scripts. Profiles, saved lists, and chats stay in the browser.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
