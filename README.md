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
- **My Pathway** dashboard: fit by interest area, top matches, saved list, upcoming deadlines, plus data export and deletion. Signed-in students land here instead of the homepage (the homepage is still at `/?home=1`).
- **Anonymous accounts and cloud sync.** Starting the Pathway Wizard creates a random username (e.g. 🪐 CosmicZeus42), kept in an HttpOnly cookie session. Students sign back in with a **picture password** (three of 20 pictures, in order) or a **Login Pass** (a QR code image they upload or show to the webcam); the older typed sign-in code still works as a backup. My Pathway, Applications, College Lab, and Suggest a Resource need an account: signed-out visitors go to `/signin.html` (or the wizard) and come back afterwards. The homepage, About, and the opportunity directory stay open. Profile, saved list, tracker, My Story, Zeus chat, and College Lab sync automatically; existing browser-only data moves into the account. **Log Out** ends the session and wipes the browser for the next class period.
- **School rooms** (`/join.html`): a student types the teacher's room code, their real name, and grade and gets a random username. Students who already have one use **Join a School Room** in My Pathway → Account and keep all their data. Real names are encrypted in the student's browser with the room's public key; only the teacher's key can read them.
- **Teacher & counselor dashboard** (`/teacher.html`): create a room in under a minute (room code + private teacher key), a live roster pairing real names with usernames and grades, triage filters, and a portfolio per student: Zeus Counselor Insights (a 10-second summary and the supports they need, e.g. financial aid guidance for a student who mostly saves free programs), application pipeline, milestones, saved opportunities, and My Story. Teachers can make a one-time **sign-in link** (with a QR code) for a student, **lock or unlock** an account, remove students, close joining, and **work with Zeus on strategies** (Claude when configured, on-device otherwise; Zeus gets an anonymized brief).
- **My Story** (My Pathway): academics and goals, extracurriculars and leadership, work/internships/volunteering, and personal insight. Zeus tailors the sections to the student's post–high school goal (e.g. ASVAB for military, certifications instead of test scores for trade and workforce). The Overcoming obstacles answer is shared with a teacher only if the student turns that on.
- **Milestone checklist** by grade and path, plus custom items, with **Zeus nudges** in the College Lab ("I noticed you have 3 junior year milestones checked off, but you haven't opened Khan Academy yet…").
- **Confetti** when an application moves into Applied (skipped with reduced motion).
- **Community suggestions** that open as a pre-filled GitHub issue for the team to review.
- **Student reviews**: star ratings and written reviews on every opportunity, with rating summaries on cards, reporting, and a moderation page. See [Turning on accounts, school rooms, and reviews](#turning-on-accounts-school-rooms-and-reviews-supabase).
- **Accessibility (WCAG 2.1 AA)**: text sizing, light/dark/auto theme, high contrast, readable font, color-blind friendly palette (Okabe-Ito), reduced motion, read-aloud, keyboard navigation, visible focus, Windows High Contrast support, screen-reader labels, and layouts that reflow down to 320px. See the accessibility statement on the About page.
- **Homepage carousels** for featured (or personally matched) opportunities and upcoming deadlines: swipe on phones, Previous/Next buttons or Tab on desktop, and no auto-advance.

## Security & privacy

- Accounts are anonymous: a random username plus a picture password, Login Pass, or sign-in code (all stored hashed), no email, password, or real name. Without an account everything stays in the browser. With one, the student's data is stored in Supabase Postgres under the username and expires after ~13 months of inactivity. Log Out wipes the browser.
- In school rooms, real names are encrypted in the student's browser (RSA-OAEP) with the room's public key; the private key is wrapped with a key derived from the teacher key, which never reaches the server. A database breach does not reveal names. It does reveal the progress data itself (grades, goals, milestones, and anything students write in My Story), which can identify a student in context, so treat it as student information. This is **not** a FERPA/COPPA exemption: schools should review it under their own policies and get parental consent where required.
- No ads, analytics, or third-party scripts. Zeus uses no AI service. College Lab can use Claude for feedback, only when the site owner sets an API key and the student opts in; nothing it sends is stored or logged on the server.
- A strict Content Security Policy (no inline scripts or styles, no third-party origins) and security headers defined once in `server/headers.js` and shared by the local server and `vercel.json`.
- The site is static except for optional functions in `api/`: reviews, which store only what a reviewer chooses to post plus a salted hash of their IP for rate limiting, and College Lab AI feedback, which stores nothing.
- Reviews refuse emails, phone numbers, links, and social handles, hold flagged language for a moderator, and are hidden automatically after several reports.
- Zeus's replies are rendered with a safe Markdown renderer that never uses `innerHTML` and only allows `http(s)` links.

See [SECURITY.md](SECURITY.md) for details.

## Getting started

Requirements: Node.js 20+.

```bash
npm install
npm run dev               # http://localhost:3000
npx playwright install chromium   # optional: lets `npm test` check Zeus's buttons in a real browser
```

No API keys or accounts are needed. Accounts, rooms, and reviews run on a temporary in-process Postgres (PGlite) with the same migrations as Supabase, so nothing is saved between runs; see [Turning on accounts, school rooms, and reviews](#turning-on-accounts-school-rooms-and-reviews-supabase) for production. To try College Lab's AI feedback locally, run `ANTHROPIC_API_KEY=sk-ant-... npm run dev`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the site locally with auto-reload |
| `npm run build` | Validate the data and regenerate `public/data/opportunities.json` and the icon bundle |
| `npm test` | Run the test suite (data, static build, server, database, Zeus engine, and Zeus's close buttons in a headless browser) |
| `npm run validate-data` | Validate every opportunity against the schema |
| `npm run check-opportunities` | Visit every official site, update deadlines and status, and look for new opportunities |

## Deploying to Vercel

The site is static apart from the functions in `api/` (reviews, accounts and rooms, and College Lab AI feedback), and `vercel.json` configures everything (build, output folder, clean URLs, function timeouts, and security headers).

1. In Vercel, **Add New → Project** and import this GitHub repository.
2. Leave **Root Directory** as the repository root (`./`), not `public`.
3. Leave the framework preset and the build, output, and install commands at their defaults. `vercel.json` sets them.
4. Optional, for College Lab AI feedback: under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` (from console.anthropic.com) for Production. Optionally set `COLLEGE_LAB_MODEL` (default `claude-opus-5-5`) and `COLLEGE_LAB_RATE_LIMIT` (requests per IP per 10 minutes, default 30). Set a spend limit on the key in the Anthropic Console. Without a key, College Lab uses its on-device engine.
5. Click **Deploy**.

If you already created the project with Root Directory set to `public`, change it under **Settings → Build and Deployment → Root Directory** to the repository root, then redeploy. (The site still loads from `public`, but you'd miss the security headers and clean URLs.)

Because everything in `public/` is plain static files, it also works on GitHub Pages, Netlify, or any static host (without reviews, which need the Vercel functions in `api/`).

### Turning on accounts, school rooms, and reviews (Supabase)

Accounts, cloud sync, school rooms, the teacher dashboard, and reviews are stored in a Supabase Postgres database. Until it's connected, the site works browser-only: the join and teacher pages say rooms aren't turned on, and each opportunity says reviews aren't turned on yet.

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough). Pick a region near your users.
2. Create the tables. Either install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run `supabase link --project-ref <your-ref>` then `supabase db push` from this repository, or open **SQL Editor** in the Supabase dashboard and run the contents of `supabase/migrations/20261015000000_student_atlas.sql` once.
3. In Supabase, open **Project Settings → API Keys** and copy the **secret** key (`sb_secret_...`; the legacy `service_role` key also works), and copy the **Project URL** from **Project Settings → Data API**.
4. In Vercel, under **Settings → Environment Variables** (Production), add:
   - `SUPABASE_URL`: the Project URL, like `https://abcd1234.supabase.co`
   - `SUPABASE_SECRET_KEY`: the secret key. It is only ever read by the server functions in `api/`. Never put it in `public/` or anywhere a browser can see it, and don't use the publishable/anon key here.
   - `ACCOUNTS_SALT`: a long random string used to hash picture passwords, Login Passes, sign-in codes, and IPs. Set it once and don't change it: changing it makes every existing way to sign in stop working.
   - `REVIEWS_ADMIN_TOKEN` (a random secret of at least 16 characters) and `REVIEWS_SALT` (another long random string), for reviews.
5. Redeploy. Students sign in at `/join.html`; teachers start at `/teacher.html`.

How the data is protected: the tables live in an `atlas` schema that Supabase's public API doesn't expose, row-level security is on for every table with no policies, and the anon and authenticated roles can't read the tables or call the `atlas_*` functions. Only the server, with the secret key, can. Real student names are encrypted in the browser before they're sent, so they're unreadable in the database too. Expired accounts, rooms, and sessions are cleared nightly by `pg_cron` (the migration schedules it).

#### Moving from Redis to Supabase

If the site already ran on Upstash Redis, copy the existing data once, before you remove Redis:

1. Do steps 1 to 3 above.
2. **Keep the same sign-in code salt.** If `ACCOUNTS_SALT` is already set in Vercel, leave it as is. If it isn't, sign-in codes were hashed with the first one set of `REVIEWS_SALT`, `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_TOKEN`: add `ACCOUNTS_SALT` with that exact value, or every student's sign-in code stops working.
3. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Vercel, then copy the data from your computer:
   ```bash
   vercel env pull .env.migrate      # Redis and Supabase variables (git ignores .env.*)
   node --env-file=.env.migrate scripts/migrate-redis-to-supabase.js --dry-run
   node --env-file=.env.migrate scripts/migrate-redis-to-supabase.js
   rm .env.migrate
   ```
   It only reads from Redis, copies accounts (with their synced data), sessions (so students stay signed in), rooms, room members, and reviews with their moderation state and reports, and skips rows that are already in Supabase, so it's safe to run again.
4. Redeploy. Once everything works, you can disconnect Upstash and delete `KV_REST_API_URL`/`KV_REST_API_TOKEN` (keep `ACCOUNTS_SALT`).

#### Moderating reviews

Moderate at `/moderate` with your `REVIEWS_ADMIN_TOKEN`. Approve or remove held reviews, and remove any published review.

How abuse is handled:

| Protection | What it does |
| --- | --- |
| Contact details and links | Reviews with emails, phone numbers, links, or social handles are refused with a clear message (students are minors). |
| Moderation queue | Reviews with flagged words, all caps, or spammy repetition wait for a moderator. Set `REVIEWS_MODERATION=all` to hold every review. |
| Reports | Any visitor can report a review; after 3 different people report it, it's hidden until a moderator decides. |
| Rate limits | Each visitor can post 3 reviews per 10 minutes and 10 per day, one review per opportunity, and 10 reports per hour. |
| Bots | A hidden honeypot field and a minimum fill time quietly drop automated posts. Cross-site posts are refused. |

Locally, `npm run dev` uses a temporary in-process database (it resets on restart), so you can try everything without an account.

## Project structure

```
server/            Local dev server, shared security headers, data loader, College Lab AI handler
  accounts/        Anonymous accounts, cloud sync, and classroom rooms
  reviews/         Review validation, storage, and request handlers
  db/              Supabase REST client, and an in-process Postgres (PGlite) for dev and tests
supabase/          Database migrations (tables, row-level security, and the atlas_* functions)
api/               Vercel functions: /api/reviews, /api/reviews-admin, /api/account, /api/rooms, and /api/college-lab
data/opportunities One JSON file per interest area (the database)
public/            The deployable static site: HTML pages, CSS, ES-module JavaScript, data/ and vendor/ (generated)
  js/lib/          Shared modules (Zeus engine + chat UI, matching, wizard, store, markdown, UI)
  js/pages/        One module per page
  js/lab/          College Lab tabs (overview, essays, transcript, mentor, privacy)
scripts/           Build (static data + icons), data validation, and the one-time Redis to Supabase copy
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
