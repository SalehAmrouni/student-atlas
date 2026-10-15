# Student Atlas

**A personalized map of opportunities for high school students.**

Student Atlas helps students find research programs, internships, competitions, summer programs, scholarships, service, and leadership opportunities that fit them, especially students who don't have easy access to a college counselor. A short Pathway Wizard builds a private profile, every opportunity gets an explainable fit score, and **Zeus**, a built-in predictive guide, understands plain-English questions, searches the directory, and helps students plan their next steps.

## Features

- **200+ curated opportunities** across seven areas: STEM, Health & Medicine, Business, Arts & Media, Civics & Leadership, Service & Environment, and Scholarships & College Access. Each one links to its official site and lists grades, cost, format, and typical deadline.
- **Zeus, a predictive guide (no AI service).** Zeus runs entirely in the browser. It picks out what a student wants from plain English (interest area, grade, cost, online or in person, deadlines, state), ranks real opportunities with BM25 keyword search plus the student's match scores, and tolerates typos. It remembers the conversation ("only free ones", "show more", "tell me about the second one", "am I eligible for it?"), compares programs, builds grade-specific plans, answers common counseling questions, suggests what to type next, and responds safely to crisis language.
- **Pathway Wizard + explainable matching.** Students see a fit score for each opportunity with the reasons behind it ("Open to 10th graders", "Pays participants") and eligibility warnings.
- **Explore view** with search, filters (interest, type, grade, cost, format, affordable, deadline soon, eligible, saved), sorting, and shareable URLs.
- **Application tracker** (`/tracker.html`): track what you're interested in, working on, applied to, and heard back from, with exact deadlines, decision dates, events (interviews, info sessions), a step checklist, and notes. Add opportunities that aren't in the directory too.
- **Calendar** of applied, planned, and bookmarked opportunities: a keyboard-navigable month view plus a phone-friendly list, estimated "usually due" months for bookmarks, and `.ics` export for Google Calendar, Apple Calendar, or Outlook.
- **Send opportunities** to a friend, parent, or counselor: copy a link, email, text, or the phone's share sheet. Lists open on the Explore page with a "Save all" button; status and dates are only included if the student chooses.
- **Optional family finances** (household size, income range, assistance programs, first-generation status), banded and stored only in the browser, so programs with income limits are flagged and ranked appropriately.
- **My Pathway** dashboard: fit by interest area, top matches, saved list, upcoming deadlines, plus data export and deletion.
- **Community suggestions** that open as a pre-filled GitHub issue for the team to review.
- **Accessibility**: text sizing, light/dark/auto theme, high contrast, readable font, color-blind friendly palette (Okabe-Ito), reduced motion, read-aloud, keyboard navigation, and screen-reader labels.

## Security & privacy

- No accounts or passwords. The profile (including optional family finance ranges), saved list, application tracker, settings, and Zeus conversations live in the student's browser and are never sent to the server.
- No AI services, API keys, ads, analytics, or third-party scripts.
- A strict Content Security Policy (no inline scripts or styles, no third-party origins) and security headers via Helmet.
- The site is fully static: no server code, database, or API runs in production.
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
| `npm run dev` | Run the site locally with auto-reload |
| `npm run build` | Validate the data and regenerate `public/data/opportunities.json` and the icon bundle |
| `npm test` | Run the test suite (data, static build, server, and Zeus engine) |
| `npm run validate-data` | Validate every opportunity against the schema |

## Deploying to Vercel

The site is fully static, and `vercel.json` configures everything (build, output folder, clean URLs, and security headers).

1. In Vercel, **Add New → Project** and import this GitHub repository.
2. Leave **Root Directory** as the repository root (`./`), not `public`.
3. Leave the framework preset and the build, output, and install commands at their defaults. `vercel.json` sets them.
4. Click **Deploy**.

If you already created the project with Root Directory set to `public`, change it under **Settings → Build and Deployment → Root Directory** to the repository root, then redeploy. (The site still loads from `public`, but you'd miss the security headers and clean URLs.)

Because everything in `public/` is plain static files, it also works on GitHub Pages, Netlify, or any static host.

## Project structure

```
server/            Local dev server, shared security headers, data loader
data/opportunities One JSON file per interest area (the database)
public/            The deployable static site: HTML pages, CSS, ES-module JavaScript, data/ and vendor/ (generated)
  js/lib/          Shared modules (Zeus engine + chat UI, matching, wizard, store, markdown, UI)
  js/pages/        One module per page
scripts/           Build (static data + icons) and data validation
tests/             node:test suite
```

### Adding an opportunity

Add an entry to the right file in `data/opportunities/`, then run `npm run build` (it validates the data and regenerates `public/data/opportunities.json`) and commit both. The schema lives in `server/opportunities.js`. Community suggestions arrive as GitHub issues; to also accept them by email, set `SUGGESTIONS.email` in `public/js/config.js`.

## Credits

Built with HTML, CSS, and JavaScript, plus Zod (data validation), Express (local dev server), and Lucide icons. Opportunity details are summarized from each organization's official website; always confirm current dates and eligibility there.
