# Student Atlas

**A personalized map of opportunities for high school students.**

Student Atlas helps students find research programs, internships, competitions, summer programs, scholarships, service, and leadership opportunities that fit them, especially students who don't have easy access to a college counselor. A short Pathway Wizard builds a private profile, every opportunity gets an explainable fit score, and **Zeus**, a built-in predictive guide, understands plain-English questions, searches the directory, and helps students plan their next steps.

## Features

- **200+ curated opportunities** across seven areas: STEM, Health & Medicine, Business, Arts & Media, Civics & Leadership, Service & Environment, and Scholarships & College Access. Each one links to its official site and lists grades, cost, format, and typical deadline.
- **Zeus, a predictive guide (no AI service).** Zeus runs entirely in the browser. It picks out what a student wants from plain English (interest area, grade, cost, online or in person, deadlines, state), ranks real opportunities with BM25 keyword search plus the student's match scores, and tolerates typos. It remembers the conversation ("only free ones", "show more", "tell me about the second one", "am I eligible for it?"), compares programs, builds grade-specific plans, answers common counseling questions, suggests what to type next, and responds safely to crisis language.
- **Pathway Wizard + explainable matching.** Students see a fit score for each opportunity with the reasons behind it ("Open to 10th graders", "Pays participants") and eligibility warnings.
- **Explore view** with search, filters (interest, type, grade, cost, format, affordable, deadline soon, eligible, saved), sorting, and shareable URLs.
- **My Pathway** dashboard: fit by interest area, top matches, saved list, upcoming deadlines, plus data export and deletion.
- **Community submissions**, validated on the server and queued for human review.
- **Accessibility**: text sizing, light/dark/auto theme, high contrast, readable font, color-blind friendly palette (Okabe-Ito), reduced motion, read-aloud, keyboard navigation, and screen-reader labels.

## Security & privacy

- No accounts or passwords. The profile, saved list, settings, and Zeus conversations live in the student's browser and are never sent to the server.
- No AI services, API keys, ads, analytics, or third-party scripts.
- A strict Content Security Policy (no inline scripts or styles, no third-party origins) and security headers via Helmet.
- Submissions are validated with Zod, size-limited, rate-limited, same-origin checked, and protected by a honeypot.
- Zeus's replies are rendered with a safe Markdown renderer that never uses `innerHTML` and only allows `http(s)` links.

See [SECURITY.md](SECURITY.md) for details.

## Getting started

Requirements: Node.js 20+.

```bash
npm install
npm run dev               # http://localhost:3000
```

No API keys or accounts are needed.

| Command | What it does |
| --- | --- |
| `npm start` | Start the server (reads environment variables) |
| `npm run dev` | Start with auto-reload and `.env` loading |
| `npm test` | Run the test suite (server, data, and Zeus engine) |
| `npm run validate-data` | Validate every opportunity against the schema |

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | (none) | Set to `production` to enable HSTS and caching |
| `TRUST_PROXY` | (none) | Set (e.g. `1`) when behind a reverse proxy so rate limits see real IPs |

## Deploying

Student Atlas runs on any Node.js host (the server adds security headers and receives community submissions). Render, Railway, and Fly.io all work. On Render, for example:

1. Create a new **Web Service** from this GitHub repository.
2. Build command: `npm install`. Start command: `npm start`.
3. Add environment variables: `NODE_ENV=production` and `TRUST_PROXY=1` (the host puts a proxy in front of the app; this lets rate limits see each visitor's real IP).

Community suggestions are written to `data/submissions/`. On hosts with temporary disks, attach a persistent disk there (or set `SUBMISSIONS_DIR`) so they aren't lost on redeploy.

## Project structure

```
server/            Express app, submissions, data loader
data/opportunities One JSON file per interest area (the database)
public/            Static site: HTML pages, CSS, and ES-module JavaScript
  js/lib/          Shared modules (Zeus engine + chat UI, matching, wizard, store, markdown, UI)
  js/pages/        One module per page
scripts/           Data validation
tests/             node:test suite
```

### Adding an opportunity

Add an entry to the right file in `data/opportunities/` and run `npm run validate-data`. The schema lives in `server/opportunities.js`. Community suggestions arrive in `data/submissions/queue.jsonl` (not committed) for review.

## Credits

Built with Node.js, Express, Helmet, express-rate-limit, Zod, and Lucide icons. Opportunity details are summarized from each organization's official website; always confirm current dates and eligibility there.
