# Security

## Design

- **Static by design**: production is plain static files plus one optional serverless function, `api/college-lab.js`. There is no database.
- **College Lab endpoint**: `POST /api/college-lab` calls the Claude API only when `ANTHROPIC_API_KEY` is set in the host's environment (never committed). Requests are schema-validated with size limits, cross-origin browser requests are rejected, each instance applies a per-IP rate limit (`COLLEGE_LAB_RATE_LIMIT`, default 30 per 10 minutes), responses are `no-store`, and essays, transcripts, and questions are never stored or logged (errors log only the task and status code). Student-provided text is wrapped in tags and the prompts tell the model to treat it as data. Set a monthly spend limit on the Anthropic key as a backstop.
- **Headers**: `vercel.json` (and the local dev server, from the same `server/headers.js`) sets a strict Content Security Policy (`default-src 'self'`, no inline script or style, `frame-ancestors 'none'`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, and HSTS. Tests keep the two in sync.
- **No third-party code at runtime**: icons are bundled locally; no CDNs, analytics, or trackers.
- **Output safety**: the browser builds all dynamic UI with `textContent`/`createElement`. Zeus's replies go through a Markdown renderer that never parses HTML and only allows `http(s)` links and `opp:` references to known ids.
- **Data validation**: every opportunity is validated against a strict schema (`https` links only) at build time.
- **Zeus guardrails**: Zeus runs locally and only recommends entries from the directory. It points students to 988 and 911 when it detects crisis language, redirects inappropriate messages, and discourages sharing contact details.
- **Privacy**: no accounts or cookies. Profiles, saved lists, College Lab work, and chats stay in the browser. College Lab sends an essay, transcript text, or mentor question (with the stats the student entered) to Claude only after the student opts in, and only when they press a button; with AI off or unconfigured, everything runs on-device. Resource suggestions are sent only when the person chooses to open the pre-filled GitHub issue (which is public), and the form collects no personal information.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
