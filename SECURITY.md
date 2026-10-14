# Security

## Design

- **Static by design**: production is plain static files. There is no server code, database, API, or secret to attack or leak.
- **Headers**: `vercel.json` (and the local dev server, from the same `server/headers.js`) sets a strict Content Security Policy (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, and HSTS. Tests keep the two in sync.
- **No third-party code at runtime**: icons are bundled locally; no CDNs, analytics, or trackers.
- **Output safety**: the browser builds all dynamic UI with `textContent`/`createElement`. Zeus's replies go through a Markdown renderer that never parses HTML and only allows `http(s)` links and `opp:` references to known ids.
- **Data validation**: every opportunity is validated against a strict schema (`https` links only) at build time.
- **Zeus guardrails**: Zeus runs locally and only recommends entries from the directory. It points students to 988 and 911 when it detects crisis language, redirects inappropriate messages, and discourages sharing contact details.
- **Privacy**: no accounts or cookies. Profiles, saved lists, and chats stay in the browser. Resource suggestions are sent only when the person chooses to open the pre-filled GitHub issue (which is public), and the form collects no personal information.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
