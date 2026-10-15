# Student Atlas

**A personalized map of opportunities for high school students.**

Student Atlas helps students find research programs, internships, competitions, summer programs, scholarships, service, and leadership opportunities that fit them, especially students who don't have easy access to a college counselor. A short Pathway Wizard builds a private profile, every opportunity gets an explainable fit score, and **Zeus**, a built-in predictive guide, understands plain-English questions, searches the directory, and helps students plan their next steps.

## Features

- **200+ curated opportunities** across seven areas: STEM, Health & Medicine, Business, Arts & Media, Civics & Leadership, Service & Environment, and Scholarships & College Access. Each one links to its official site and lists grades, cost, format, and typical deadline.
- **Zeus, a predictive guide (no AI service).** Zeus runs entirely in the browser. It picks out what a student wants from plain English (interest area, grade, cost, online or in person, deadlines, state), ranks real opportunities with BM25 keyword search plus the student's match scores, and tolerates typos. It remembers the conversation ("only free ones", "show more", "tell me about the second one", "am I eligible for it?"), compares programs, builds grade-specific plans, answers common counseling questions, suggests what to type next, and responds safely to crisis language.
- **Pathway Wizard + explainable matching.** Students see a fit score for each opportunity with the reasons behind it ("Open to 10th graders", "Pays participants") and eligibility warnings.
- **College Lab**, the application side of the site (`/college-lab`):
  - **Essays**: drafts with autosave and word counts for Common App and supplement prompts, rubric scores (insight, voice, specificity, structure, prompt fit, mechanics), prioritized revisions, line-by-line notes highlighted in the text, and a version history.
  - **Transcript**: paste or upload a transcript to get every course in an editable table, unweighted/weighted/core GPA, GPA by year and subject, course rigor, and plain-language strengths and concerns.
  - **Mentor**: a counselor-style chat that uses the student's stats, transcript, essay scores, and college list.
  - **Overview**: stats, activities, awards, and a reach/target/likely college list with deadlines, an application snapshot, and next steps.
  - Uses **Claude** for feedback when the site has an Anthropic API key and the student opts in; otherwise a built-in on-device engine gives the same features.
- **Explore view** with search, filters (interest, type, grade, cost, format, affordable, deadline soon, eligible, saved), sorting, and shareable URLs.
- **Application tracker** (`/tracker.html`): track what you're interested in, working on, applied to, and heard back from, with exact deadlines, decision dates, events (interviews, info sessions), a step checklist, and notes. Add opportunities that aren't in the directory too.
- **Calendar** of applied, planned, and bookmarked opportunities: a keyboard-navigable month view plus a phone-friendly list, estimated "usually due" months for bookmarks, and `.ics` export for Google Calendar, Apple Calendar, or Outlook.
- **Send opportunities** to a friend, parent, or counselor: copy a link, email, text, or the phone's share sheet. Lists open on the Explore page with a "Save all" button; status and dates are only included if the student chooses.
- **Optional family finances** (household size, income range, assistance programs, first-generation status), banded and stored only in the browser, so programs with income limits are flagged and ranked appropriately.
- **My Pathway** dashboard: fit by interest area, top matches, saved list, upcoming deadlines, plus data export and deletion.
- **Community suggestions** that open as a pre-filled GitHub issue for the team to review.
- **Accessibility**: text sizing, light/dark/auto theme, high contrast, readable font, color-blind friendly palette (Okabe-Ito), reduced motion, read-aloud, keyboard navigation, and screen-reader labels.

## Security & privacy

- No accounts or passwords. The profile (including optional family finance ranges), saved list, application tracker, College Lab work, settings, and Zeus conversations live in the student's browser.
- No ads, analytics, or third-party scripts. Zeus uses no AI service. College Lab can use Claude for feedback, only when the site owner sets an API key and the student opts in; nothing is stored or logged on the server.
- A strict Content Security Policy (no inline scripts or styles, no third-party origins) and security headers via Helmet.
- The site is static apart from one optional serverless function (`api/college-lab.js`), with no database.
- Zeus's replies are rendered with a safe Markdown renderer that never uses `innerHTML` and only allows `http(s)` links.

See [SECURITY.md](SECURITY.md) for details.

## Getting started

Requirements: Node.js 20+.

```bash
npm install
npm run dev               # http://localhost:3000
```

No API keys or accounts are needed. To try College Lab's AI feedback locally, run `ANTHROPIC_API_KEY=sk-ant-... npm run dev`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the site locally with auto-reload |
| `npm run build` | Validate the data and regenerate `public/data/opportunities.json` and the icon bundle |
| `npm test` | Run the test suite (data, static build, server, and Zeus engine) |
| `npm run validate-data` | Validate every opportunity against the schema |
| `npm run check-opportunities` | Visit every official site, update deadlines and status, and look for new opportunities |

## Deploying to Vercel

The site is static plus one optional serverless function (`api/college-lab.js`), and `vercel.json` configures everything (build, output folder, clean URLs, function timeout, and security headers).

1. In Vercel, **Add New → Project** and import this GitHub repository.
2. Leave **Root Directory** as the repository root (`./`), not `public`.
3. Leave the framework preset and the build, output, and install commands at their defaults. `vercel.json` sets them.
4. Optional, for College Lab AI feedback: under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` (from console.anthropic.com) for Production. Optionally set `COLLEGE_LAB_MODEL` (default `claude-opus-5-5`) and `COLLEGE_LAB_RATE_LIMIT` (requests per IP per 10 minutes, default 30). Set a spend limit on the key in the Anthropic Console. Without a key, College Lab uses its on-device engine.
5. Click **Deploy**.

If you already created the project with Root Directory set to `public`, change it under **Settings → Build and Deployment → Root Directory** to the repository root, then redeploy. (The site still loads from `public`, but you'd miss the security headers and clean URLs.)

Because everything in `public/` is plain static files, it also works on GitHub Pages, Netlify, or any static host.

## Project structure

```
api/               Vercel serverless function for College Lab AI feedback
server/            Local dev server, shared security headers, data loader, College Lab AI handler
data/opportunities One JSON file per interest area (the database)
public/            The deployable static site: HTML pages, CSS, ES-module JavaScript, data/ and vendor/ (generated)
  js/lib/          Shared modules (Zeus engine + chat UI, matching, wizard, store, markdown, UI)
  js/pages/        One module per page
  js/lab/          College Lab tabs (overview, essays, transcript, mentor, privacy)
scripts/           Build (static data + icons) and data validation
tests/             node:test suite
```

### Adding an opportunity

Add an entry to the right file in `data/opportunities/`, then run `npm run build` (it validates the data and regenerates `public/data/opportunities.json`) and commit both. The schema lives in `server/opportunities.js`. Community suggestions arrive as GitHub issues; to also accept them by email, set `SUGGESTIONS.email` in `public/js/config.js`.

### Weekly opportunity check

`.github/workflows/check-opportunities.yml` runs `scripts/check-opportunities.js` every Monday (or on demand from the **Actions** tab). It:

- visits each opportunity's official page as `StudentAtlasBot`, following `robots.txt`, waiting between requests to the same site, and never sending more than one request to a site at a time;
- records in `data/status.json` whether the link works, this cycle's exact deadline when the page states one with a year (with the sentence it came from), and whether the page says applications are closed;
- collects links that look like new programs, from those pages and from the listing pages in `data/sources.json`, into `data/candidates.json`;
- opens or updates one pull request with a readable report. Nothing changes on the live site until someone reviews and merges it.

On the site, cards show "Due Nov 20, 2026" when an exact date is known, and "Deadline passed" or "Applications closed" badges when the check finds those; the "Deadline soon" filter skips expired listings.

To promote a candidate, add a full entry to `data/opportunities/` and delete it from `data/candidates.json`; to dismiss one, set its `status` to `"rejected"` so it isn't suggested again. For the workflow to open pull requests, enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

## Credits

Built with HTML, CSS, and JavaScript, plus Zod (data validation), Express (local dev server), and Lucide icons. Opportunity details are summarized from each organization's official website; always confirm current dates and eligibility there.
