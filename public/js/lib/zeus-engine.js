// Zeus engine: a predictive, rule-based guide that runs entirely in the browser.
//
// No AI service is involved. Each message is:
//   1. normalized and checked for safety,
//   2. scanned for entities (interest area, type, grade, cost, format, timing,
//      state) and references to specific opportunities,
//   3. classified into an intent (search, details, compare, advice, follow-up…),
//   4. answered by searching the real opportunities database (BM25 ranking +
//      the student's match scores) and composing a reply from the results.
//
// Conversation state (last results, active filters, what the student told us)
// carries over, so follow-ups like "only free ones", "show more", or
// "tell me about the second one" work.
//
// This module has no DOM dependencies so it can be unit-tested in Node.

import { scoreOpportunity } from './match.js';
import { monthsUntilDeadline, gradeLabel, isExpired } from './data.js';

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9#+\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stem(word) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed') && !word.endsWith('eed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) return word.slice(0, -1);
  return word;
}

const STOPWORDS = new Set(`a an the and or but if then so of to in on at by for with from into about as is are was were be been being
i im me my mine we our you your yours he she they them their it its this that these those there here what which who whom whose
when where why how can could should would will shall may might must do does did doing done have has had having get got
any some all more most much many very really just also too not no yes please pls thanks thank hi hello hey zeus
want wanna need like love looking look find show give tell know let lets go going help something things thing stuff kind kinds
good great best cool nice fun interesting maybe probably right now currently one ones other another program programs opportunity
opportunities option options ideas idea stuff school high student students teen teens year years`.split(/\s+/));

function tokens(text) {
  return normalize(text).split(' ').filter(Boolean);
}

function contentTerms(text) {
  return tokens(text).filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(stem);
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const ordinal = (n) => `${n}th`;
const list = (items, conj = 'and') => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${conj} ${items.at(-1)}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------------------------------------------------------------------------
// Vocabulary for entity extraction
// ---------------------------------------------------------------------------

const CLUSTER_WORDS = {
  STEM: ['stem', 'science', 'sciences', 'technology', 'tech', 'engineering', 'engineer', 'coding', 'code', 'programming', 'computer', 'computers', 'cs', 'math', 'maths', 'mathematics', 'robotics', 'robot', 'robots', 'physics', 'chemistry', 'astronomy', 'space', 'cybersecurity', 'cyber', 'ai', 'data', 'aerospace', 'software', 'hackathon'],
  Health: ['health', 'medicine', 'medical', 'doctor', 'doctors', 'nurse', 'nursing', 'premed', 'pre-med', 'hospital', 'biomedical', 'neuroscience', 'brain', 'cancer', 'healthcare', 'dentist', 'pharmacy', 'psychology', 'mental'],
  Business: ['business', 'entrepreneur', 'entrepreneurs', 'entrepreneurship', 'startup', 'startups', 'finance', 'financial literacy', 'investing', 'invest', 'stocks', 'stock', 'economics', 'econ', 'marketing', 'money management'],
  Arts: ['art', 'arts', 'music', 'musician', 'writing', 'writer', 'poetry', 'poem', 'poems', 'film', 'filmmaking', 'movies', 'theater', 'theatre', 'acting', 'dance', 'design', 'photography', 'journalism', 'painting', 'drawing', 'orchestra', 'band', 'jazz', 'creative', 'podcast'],
  Civics: ['civics', 'government', 'politics', 'political', 'law', 'lawyer', 'legal', 'debate', 'leadership', 'leader', 'history', 'policy', 'congress', 'senate', 'model un', 'mun', 'diplomacy', 'international', 'elections', 'voting', 'military'],
  Humanitarian: ['volunteer', 'volunteering', 'service', 'community service', 'community', 'humanitarian', 'environment', 'environmental', 'climate', 'sustainability', 'nonprofit', 'charity', 'activism', 'service hours'],
  Scholarships: ['scholarship', 'scholarships', 'pay for college', 'paying for college', 'college money', 'tuition', 'financial aid', 'fafsa', 'grant', 'grants', 'college access'],
};

const TYPE_WORDS = [
  ['Internship', ['internship', 'internships', 'intern', 'job', 'jobs', 'work experience']],
  ['Research', ['research', 'lab', 'labs', 'laboratory', 'mentor research']],
  ['Summer Program', ['summer program', 'summer programs', 'summer camp', 'camp', 'camps', 'pre college', 'precollege', 'summer']],
  ['Competition', ['competition', 'competitions', 'contest', 'contests', 'olympiad', 'challenge', 'challenges', 'compete', 'hackathon', 'fair']],
  ['Scholarship', ['scholarship', 'scholarships']],
  ['Club / Organization', ['club', 'clubs', 'organization', 'organizations', 'chapter']],
  ['Volunteering', ['volunteer', 'volunteering', 'service hours']],
  ['Exchange / Travel', ['abroad', 'exchange', 'travel', 'study abroad', 'overseas']],
  ['Resource', ['course', 'courses', 'class', 'classes', 'learn online', 'tutorial', 'tutorials', 'self paced']],
];

const SYNONYMS = {
  coding: ['programming', 'computer', 'code', 'software'],
  code: ['coding', 'programming'],
  programming: ['coding', 'computer'],
  computer: ['coding', 'computer science'],
  ai: ['ai', 'machine', 'data'],
  doctor: ['medicine', 'medical', 'health'],
  premed: ['medicine', 'medical'],
  space: ['nasa', 'aerospace', 'astrophysics', 'space'],
  robot: ['robotics'],
  environment: ['climate', 'sustainability', 'environment', 'ocean'],
  climate: ['environment', 'sustainability'],
  writing: ['writer', 'poetry', 'essay', 'journalism', 'creative writing'],
  law: ['legal', 'mock trial', 'court', 'law'],
  music: ['orchestra', 'jazz', 'band', 'music'],
  art: ['visual art', 'design', 'painting', 'illustration'],
  money: ['scholarship', 'award', 'stipend'],
  volunteer: ['service', 'volunteering'],
  politics: ['government', 'policy', 'congress'],
  biology: ['biology', 'genetics', 'biomedical', 'life sciences'],
  film: ['film', 'video', 'documentary'],
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

const TYPE_TERMS = new Set(TYPE_WORDS.flatMap(([, words]) => words.filter((w) => !w.includes(' ')).map(stem)));
// Broad area names: they set the cluster filter, so don't echo them as keywords.
const GENERIC_TOPIC_WORDS = new Set(['stem', 'science', 'sciences', 'tech', 'technology', 'health', 'business', 'art', 'arts', 'civics',
  'service', 'stuff', 'things', 'scholarship', 'scholarships', 'opportunities', 'programs']);
// Place names shouldn't make a program "mentioned" (e.g. "New York" vs. New York Times).
const PLACE_WORDS = new Set(['new', 'york', 'washington', 'boston', 'california', 'carolina', 'texas', 'jersey', 'chicago', 'seattle',
  'america', 'national', 'state', 'city', 'dc', 'massachusett', 'pittsburgh', 'philadelphia', 'san', 'francisco']);

const has = (text, phrase) => new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text);

// Words that only steer filters and should not count as search keywords.
const FILTER_WORDS = new Set(['free', 'paid', 'cheap', 'online', 'virtual', 'remote', 'person', 'soon', 'upcoming', 'deadline', 'deadlines', 'due',
  'grade', 'grader', 'graders', 'freshman', 'freshmen', 'sophomore', 'sophomores', 'junior', 'juniors', 'senior', 'seniors', 'th', '9th', '10th', '11th', '12th',
  'cost', 'costs', 'money', 'stipend', 'only', 'near', 'eligible', 'qualify', 'apply', 'applying', 'application', 'afford', 'affordable',
  'month', 'week', 'list', 'recommend', 'recommendation', 'suggest', 'suggestion', 'top', 'cheaper', 'nearby', 'local', 'home', 'without', 'earn',
  ...MONTHS, ...Object.keys(STATES).flatMap((s) => s.split(' '))]);

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

export function extractEntities(message) {
  const text = normalize(message);
  const e = {};

  // Grade
  const gradeMatch = text.match(/\b(9|10|11|12)(th)?( grade| grader|graders)?\b/);
  if (/\bfreshm[ae]n\b/.test(text)) e.grade = 9;
  else if (/\bsophomores?\b/.test(text)) e.grade = 10;
  else if (/\bjuniors?\b/.test(text) && !/junior (state|achievement|science|statesmen)/.test(text)) e.grade = 11;
  else if (/\bseniors?\b/.test(text) && !/senate|senior year of college/.test(text)) e.grade = 12;
  else if (gradeMatch && (gradeMatch[2] || gradeMatch[3] || /grade|grader/.test(text))) e.grade = Number(gradeMatch[1]);

  // Interest area: count keyword hits per cluster
  let best = null;
  for (const [cluster, words] of Object.entries(CLUSTER_WORDS)) {
    const hits = words.filter((w) => has(text, w)).length;
    if (hits && (!best || hits > best.hits)) best = { cluster, hits };
  }
  if (best) e.cluster = best.cluster;

  // Type
  for (const [type, words] of TYPE_WORDS) {
    if (words.some((w) => has(text, w))) {
      // "summer" alone shouldn't override a more specific type mentioned later
      if (type === 'Summer Program' && e.type) continue;
      e.type = type;
      if (type !== 'Summer Program') break;
    }
  }
  if (e.type === 'Scholarship') e.cluster ??= 'Scholarships';
  if (e.type === 'Volunteering' && e.cluster === 'Humanitarian') delete e.type;

  // Cost
  if (/\b(free|no cost|for free|without paying|zero cost)\b/.test(text)) e.cost = 'Free';
  if (/\b(paid|get paid|pays|stipend|earn money|make money|paying job)\b/.test(text) && !/\b(paid for|pay for college)\b/.test(text)) e.cost = 'Stipend';
  if (/\b(cheap|afford|affordable|low income|low-income|financial need|cant afford|can t afford|not expensive|budget)\b/.test(text)) e.affordable = true;

  // Format
  if (/\b(online|virtual|virtually|remote|remotely|from home|at home)\b/.test(text)) e.format = 'Virtual';
  else if (/\b(in person|on campus|in-person|residential)\b/.test(text)) e.format = 'In-person';

  // Timing
  if (/\b(soon|upcoming|coming up|this month|next month|deadline|deadlines|due)\b/.test(text)) e.soon = true;
  const month = MONTHS.findIndex((m) => has(text, m));
  if (month !== -1) e.month = month + 1;

  // Location
  for (const [name, abbr] of Object.entries(STATES)) {
    if (has(text, name) && !(name === 'washington' && has(text, 'washington dc'))) { e.state = { name, abbr }; break; }
  }

  // Keywords for relevance ranking (filter-only words removed)
  e.terms = contentTerms(message).filter((t) => !FILTER_WORDS.has(t) && !TYPE_TERMS.has(t));
  e.rawTerms = tokens(message).filter((w) => w.length > 1 && !STOPWORDS.has(w) && !FILTER_WORDS.has(stem(w)) && !FILTER_WORDS.has(w)
    && !TYPE_TERMS.has(stem(w)) && !GENERIC_TOPIC_WORDS.has(w));
  return e;
}

// ---------------------------------------------------------------------------
// Search index (BM25 over weighted fields)
// ---------------------------------------------------------------------------

function buildIndex(opportunities) {
  const docs = opportunities.map((o) => {
    const tf = new Map();
    const add = (text, weight) => {
      for (const t of contentTerms(text)) tf.set(t, (tf.get(t) ?? 0) + weight);
    };
    add(o.title, 3);
    add(o.tags.join(' '), 2);
    add(o.organization, 1.5);
    add(`${o.type} ${o.cluster}`, 1);
    add(o.description, 1);
    add(o.location, 0.5);
    let len = 0;
    for (const v of tf.values()) len += v;
    return { o, tf, len };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  const idf = (t) => Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const vocab = [...df.keys()];

  // Distinctive title words help recognize when a student names a program.
  const titleDf = new Map();
  const titleWords = opportunities.map((o) => {
    const words = [...new Set(contentTerms(o.title.replace(/\(.*?\)/g, ' ')))].filter((w) => w.length > 2);
    for (const w of words) titleDf.set(w, (titleDf.get(w) ?? 0) + 1);
    return words;
  });
  const acronyms = opportunities.map((o) => {
    const m = o.title.match(/\(([A-Za-z0-9-]{2,10})\)/);
    return m ? normalize(m[1]).replace(/\s/g, '') : null;
  });

  return { docs, idf, avgLen, vocab, df, titleWords, titleDf, acronyms };
}

function expandTerms(terms, index) {
  const out = new Map();
  const addTerm = (t, w) => out.set(t, Math.max(out.get(t) ?? 0, w));
  for (const t of terms) {
    if (index.df.has(t)) addTerm(t, 1);
    else if (t.length >= 5) {
      // typo tolerance: closest vocabulary word within edit distance 1-2
      const maxD = t.length >= 8 ? 2 : 1;
      let bestWord = null;
      let bestD = maxD + 1;
      for (const v of index.vocab) {
        const d = levenshtein(t, v, maxD);
        if (d < bestD) { bestD = d; bestWord = v; }
      }
      if (bestWord) addTerm(bestWord, 0.9);
    }
    for (const syn of SYNONYMS[t] ?? []) for (const s of contentTerms(syn)) if (index.df.has(s)) addTerm(s, 0.6);
  }
  return out;
}

function bm25(doc, terms, index) {
  const k1 = 1.4;
  const b = 0.7;
  let score = 0;
  for (const [t, w] of terms) {
    const f = doc.tf.get(t);
    if (!f) continue;
    score += w * index.idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / index.avgLen)));
  }
  return score;
}

// ---------------------------------------------------------------------------
// Advice library (personalized by grade and interests)
// ---------------------------------------------------------------------------

const GRADE_PLANS = {
  9: [
    'Try **two or three activities** that genuinely interest you. Depth comes later; right now it\'s about discovering what you enjoy.',
    'Build strong study habits. Your 9th grade grades count toward your GPA.',
    'Look for **free summer options**, like online courses or a local volunteer role, to explore an interest.',
    'Start a simple running list of your activities, awards, and hours. You\'ll thank yourself in 12th grade.',
  ],
  10: [
    'Go deeper in one or two activities and look for a small leadership role.',
    'Apply to a **summer program or competition**. Many selective programs open to 10th graders have deadlines between January and March.',
    'Take a practice PSAT so the real one in 11th grade feels familiar (it can qualify you for National Merit).',
    'Start building relationships with teachers whose classes you enjoy. They may write your recommendations later.',
  ],
  11: [
    'Take the **PSAT/NMSQT in October**. It\'s the entry point for National Merit Scholarships.',
    'Junior year is prime time for **research programs and internships**. Many are due December through March.',
    'Plan your SAT/ACT timeline and use free official practice.',
    'In spring, ask two teachers for recommendation letters and start a college list.',
    'Look for leadership or impact projects you can describe in applications.',
  ],
  12: [
    '**FAFSA opens October 1.** File early, since some aid is first-come, first-served.',
    'Early college deadlines are usually **November 1 or 15**. Give your teachers at least a month\'s notice for letters.',
    'Apply to **scholarships** in the fall; big national ones (Coca-Cola, Gates, QuestBridge) close in September to November.',
    'Keep your grades up. Colleges see your senior-year transcript.',
  ],
};

// Words worth correcting when misspelled before matching advice topics.
const ADVICE_VOCAB = ['recommendation', 'recommendations', 'letter', 'essay', 'essays', 'statement', 'interview', 'interviews', 'resume',
  'extracurricular', 'extracurriculars', 'scholarship', 'scholarships', 'financial', 'professor', 'research', 'mentor', 'deadline',
  'deadlines', 'application', 'applications', 'privacy', 'competitive', 'activities', 'organize'];

function correctSpelling(text) {
  return text.split(' ').map((w) => {
    if (w.length < 5 || ADVICE_VOCAB.includes(w)) return w;
    const max = w.length >= 9 ? 2 : 1;
    let best = w;
    let bestD = max + 1;
    for (const v of ADVICE_VOCAB) {
      const d = levenshtein(w, v, max);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }).join(' ');
}

const ADVICE = [
  {
    id: 'recommendation',
    patterns: [/recommendation letter|letters? of rec|rec letter|ask (a )?teachers? for|recommender/],
    answer: () => `**Getting a strong recommendation letter**

1. **Pick the right teacher**: someone who taught you recently, in a class where you participated, and ideally in a subject related to what you're applying for.
2. **Ask early and in person**: at least **3–4 weeks** before the deadline (longer in the fall of senior year, when teachers get many requests).
3. **Make it easy**: share a short "brag sheet" with the program name, deadline, how to submit, and 3–4 specific moments from their class you're proud of.
4. **Follow up politely** a week before the deadline, and always send a thank-you note.`,
    suggestions: ['How do I write a strong application essay?', 'What should I do this year?'],
  },
  {
    id: 'essay',
    patterns: [/essay|personal statement|short answer|writing prompt|supplement/],
    answer: () => `**Writing a strong application essay**

- **Start with a story, not a résumé.** Pick one specific moment that shows how you think or what you care about.
- **Answer the actual question.** Underline what the prompt asks and check every paragraph serves it.
- **Show, then reflect.** Describe what happened, then explain what it changed in you.
- **Be specific about the program.** Name what you'd do there and why it fits your goals.
- **Revise in rounds.** Write a messy draft, then cut anything generic, then read it out loud.

Your essay should sound like you. Get feedback from a teacher or counselor, but keep the words your own.`,
    suggestions: ['How do I ask for a recommendation letter?', 'How do I stand out?'],
  },
  {
    id: 'resume',
    patterns: [/resume|résumé|activit(y|ies) list|brag sheet|\bcv\b/],
    answer: () => `**Building a student résumé**

- Put **education** first (school, grade, GPA if strong, relevant courses).
- List **activities** with your role, the years, hours per week, and one line on impact ("organized a food drive that collected 400 lbs").
- Add **awards, skills** (languages, coding, tools), and **work or volunteer experience**.
- Use action verbs and numbers. Keep it to **one page**.

Tip: save every opportunity you join in **My Pathway** so your list is ready when applications open.`,
    suggestions: ['How do I write a strong application essay?', 'Show me volunteer opportunities'],
  },
  {
    id: 'interview',
    patterns: [/interview/],
    answer: () => `**Preparing for a program interview**

- Re-read your application and the program's website. Be ready to explain **why this program**.
- Prepare 2–3 short stories (a challenge, something you're proud of, something you're curious about).
- Practice out loud with a friend or family member.
- Have **one or two thoughtful questions** ready to ask them.
- Test your tech for virtual interviews, and send a short thank-you email afterward.`,
    suggestions: ['How do I stand out?', 'Find research programs'],
  },
  {
    id: 'fafsa',
    patterns: [/fafsa|financial aid|federal aid|pell|css profile|pay for college|paying for college|afford college/],
    answer: () => `**Paying for college**

- **FAFSA** opens October 1 of senior year and unlocks Pell Grants, work-study, and most state and college aid. It's always free; never pay to file.
- Some private colleges also require the **CSS Profile**.
- Apply for **scholarships** early: national ones close in the fall of senior year, local ones often in spring.
- Programs like **QuestBridge** and **Posse** can cover full tuition at partner colleges.

I can show you scholarships that fit you. Just ask for "scholarships for me".`,
    picks: { ids: ['fafsa', 'questbridge-national-college-match', 'careeronestop-scholarship-finder'] },
    suggestions: ['Scholarships for me', 'What is QuestBridge?'],
  },
  {
    id: 'testing',
    patterns: [/\b(sat|act|psat|nmsqt|test prep|standardized test|ap exam)/],
    answer: () => `**Test prep without spending money**

- The **PSAT/NMSQT** in October of 11th grade can qualify you for National Merit Scholarships.
- Use **free official practice**: full digital SAT practice tests in College Board's Bluebook app and personalized practice on Khan Academy.
- Fee waivers are available for eligible students for the SAT, ACT, and many college applications. Ask your counselor.
- Many colleges are test-optional, so check each school's policy before deciding how much to prepare.`,
    picks: { ids: ['official-sat-practice-khan', 'national-merit-scholarship', 'khan-academy'] },
    suggestions: ['What should I do this year?', 'Scholarships for me'],
  },
  {
    id: 'research-mentor',
    patterns: [/(find|get) (a )?(research|mentor|professor)|email (a )?professor|cold email|independent research|do research/],
    answer: () => `**Getting into research as a high school student**

1. **Apply to structured programs first.** They come with mentors built in.
2. **Or reach out to local professors**: read 1–2 of their recent papers, then send a short, specific email explaining what interested you and asking if they have a small project or reading suggestions. Expect to send many emails; that's normal.
3. **Start a small independent project** you can enter in a science fair (Regeneron ISEF, JSHS) or write up for a journal like The Concord Review.`,
    picks: { search: { type: 'Research' } },
    suggestions: ['Free research programs', 'Paid internships'],
  },
  {
    id: 'stand-out',
    patterns: [/stand out|impress|competitive|get (in|accepted)|chances|selective|what do (they|colleges|programs) look for/],
    answer: () => `**How to stand out**

- **Depth beats a long list.** Two activities you've grown in say more than ten you joined once.
- **Show impact.** Started something, taught someone, fixed a problem? That's what readers remember.
- **Connect your story.** Let your activities, essays, and recommendations point in the same direction.
- **Apply widely.** Mix a couple of reach programs with several accessible ones; selective programs admit a small fraction of applicants.`,
    suggestions: ['What should I do this year?', 'How do I write a strong application essay?'],
  },
  {
    id: 'extracurricular',
    patterns: [/extracurricular|activities should|what (club|activity)|start (a )?club|join (a )?club/],
    answer: () => `**Choosing extracurriculars**

- Start with what you'd do even if nobody was watching. Genuine interest is easier to sustain and to write about.
- Join an established organization (like Key Club, HOSA, FBLA, or Science Olympiad) to learn the ropes, then take on responsibility.
- Can't find the right club? **Start one** with a teacher sponsor. Founding something shows initiative.`,
    picks: { search: { type: 'Club / Organization' } },
    suggestions: ['Show me clubs for my interests', 'Volunteer opportunities'],
  },
  {
    id: 'deadlines',
    patterns: [/(track|keep track|organize|manage).*(deadline|application)|stay organized|calendar/],
    answer: () => `**Staying on top of deadlines**

- Save opportunities in **My Pathway**. The **Deadlines** tab orders them by typical due month.
- Put each deadline in a calendar **two weeks early**, plus a reminder a month out to request letters.
- Keep one doc with reusable pieces: your activity list, a short bio, and a few essay drafts.`,
    suggestions: ['What is due soon?', 'What should I do this year?'],
  },
  {
    id: 'matching',
    patterns: [/match (score|percent|percentage)|how (does|do) (the )?(match|matching|score)|what does .*% match/],
    answer: () => `**How match scores work**

Each opportunity is scored against your Pathway profile:
- **Interest area** you picked (biggest factor)
- **Career directions** that connect to its topics
- **Type** you're looking for (internship, competition, …)
- **Cost**, if you said cost matters (free and paid programs rise)
- **Format** (online or in person) and **GPA minimums**

If your grade isn't eligible or you're under a GPA minimum, the card shows **Check eligibility** instead. Open any card to see the exact reasons.`,
    suggestions: ['Edit my profile', 'Show my top matches'],
  },
  {
    id: 'privacy',
    patterns: [/privacy|my data|store my|track me|safe to use|who can see/],
    answer: () => `**Your privacy**

Zeus runs **entirely in your browser**: your messages and profile never leave your device. Student Atlas has no accounts, ads, or trackers. You can download or delete everything from **My Pathway → Data & privacy**.`,
    suggestions: ['What can you do?'],
  },
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createEngine({ opportunities, clusters = {}, rng = Math.random, now = () => new Date() }) {
  const index = buildIndex(opportunities);
  const byId = new Map(opportunities.map((o) => [o.id, o]));
  const clusterLabel = (k) => clusters[k]?.label ?? k;
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];

  // ---- recognizing a named opportunity -------------------------------------
  function findMentions(message) {
    const text = normalize(message);
    const compact = text.replace(/\s/g, '');
    const idMatch = message.match(/\bid:\s*([a-z0-9-]+)/i);
    if (idMatch && byId.has(idMatch[1])) return [{ o: byId.get(idMatch[1]), score: 10 }];

    const terms = new Set(contentTerms(message));
    const found = [];
    opportunities.forEach((o, i) => {
      const title = normalize(o.title.replace(/\(.*?\)/g, ' '));
      let score = 0;
      if (title.length >= 3 && new RegExp(`(^| )${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text)) score = 5;
      const acr = index.acronyms[i];
      if (acr && acr.length >= 3 && new RegExp(`(^| )${acr}( |$)`).test(text.replace(/[^a-z0-9 ]/g, ''))) score = Math.max(score, 4);
      if (!score) {
        const distinctive = index.titleWords[i].filter((w) => index.titleDf.get(w) <= 3 && !GENERIC_TITLE_WORDS.has(w) && !PLACE_WORDS.has(w));
        if (distinctive.length) {
          const matched = distinctive.filter((w) => terms.has(w));
          const unique = matched.filter((w) => index.titleDf.get(w) === 1);
          const ratio = matched.length / distinctive.length;
          // Place words count toward a match only alongside a non-place word.
          const named = index.titleWords[i].filter((w) => index.titleDf.get(w) <= 5 && !GENERIC_TITLE_WORDS.has(w));
          const namedHits = named.filter((w) => terms.has(w));
          const namedRatio = named.length ? namedHits.length / named.length : 0;
          if ((matched.length >= 2 && ratio >= 0.5) || (unique.length && ratio >= 0.5) || (unique.some((w) => w.length >= 5) && compact.length < 40)
            || (matched.length >= 1 && namedHits.length >= 3 && namedRatio >= 0.5)) {
            score = 1 + Math.max(ratio, namedRatio) + unique.length * 0.5;
          }
        }
      }
      if (score) found.push({ o, score });
    });
    return found.sort((a, b) => b.score - a.score);
  }

  // ---- searching ------------------------------------------------------------
  function search(f, ctx, { exclude = new Set(), limit = 5 } = {}) {
    const profile = ctx.profile;
    const terms = expandTerms(f.terms ?? [], index);
    const grade = f.grade ?? ctx.grade;
    const date = now();
    const rows = [];
    for (const d of index.docs) {
      const o = d.o;
      if (exclude.has(o.id)) continue;
      if (f.cluster && o.cluster !== f.cluster) continue;
      if (f.type && o.type !== f.type) continue;
      if (grade && !o.grades.includes(grade)) continue;
      if (f.cost && o.cost !== f.cost) continue;
      if (f.affordable && !(o.cost === 'Free' || o.cost === 'Stipend' || o.cost === 'Award' || o.needBased || o.financialAid)) continue;
      if (f.format && !(o.format === f.format || o.format === 'Hybrid' || o.format === 'Varies')) continue;
      if (f.soon) { const m = monthsUntilDeadline(o, date); if (m === null || m > 3 || isExpired(o, date)) continue; }
      if (f.month && o.deadlineMonth !== f.month) continue;
      const rel = terms.size ? bm25(d, terms, index) : 0;
      if (terms.size && rel <= 0 && !(f.cluster || f.type)) continue;
      const match = profile ? scoreOpportunity(o, profile) : null;
      if (profile && match && !match.eligible && !f.grade) continue;
      let score = rel * 12 + (match ? match.score * 0.35 : 0) + (o.featured ? 3 : 0);
      if (f.state && o.location.includes(`, ${f.state.abbr}`)) score += 15;
      if (ctx.financialNeed && (o.cost === 'Free' || o.cost === 'Stipend' || o.needBased)) score += 6;
      if (ctx.interests?.includes(o.cluster)) score += 5;
      rows.push({ o, score, rel, match });
    }
    rows.sort((a, b) => b.score - a.score || a.o.title.localeCompare(b.o.title));
    const relevant = terms.size ? rows.filter((r) => r.rel > 0) : rows;
    const final = relevant.length ? relevant : rows;
    return { rows: final, total: final.length, page: final.slice(0, limit) };
  }

  // Loosen filters one at a time until something matches.
  function searchWithRelaxation(f, ctx) {
    let result = search(f, ctx);
    if (result.total) return { result, filters: f, relaxed: [] };
    const relaxed = [];
    let current = { ...f };
    for (const key of ['month', 'soon', 'format', 'cost', 'affordable', 'type', 'terms', 'grade']) {
      if (current[key] === undefined || (Array.isArray(current[key]) && !current[key].length)) continue;
      current = { ...current, [key]: key === 'terms' ? [] : undefined };
      relaxed.push(key);
      result = search(current, ctx);
      if (result.total) return { result, filters: current, relaxed };
    }
    return { result, filters: current, relaxed };
  }

  // ---- describing things ----------------------------------------------------
  const TYPE_PLURAL = {
    Internship: 'internships', Research: 'research programs', 'Summer Program': 'summer programs', Competition: 'competitions',
    Scholarship: 'scholarships', Fellowship: 'fellowships', 'Club / Organization': 'clubs and organizations', Volunteering: 'volunteer opportunities',
    'Exchange / Travel': 'exchange and travel programs', 'College Access': 'college access programs', Resource: 'free learning resources',
  };

  function describeFilters(f, ctx) {
    const parts = [];
    if (f.cost === 'Free') parts.push('free');
    if (f.cost === 'Stipend') parts.push('paid');
    if (f.affordable && !f.cost) parts.push('affordable');
    if (f.format === 'Virtual') parts.push('online');
    if (f.format === 'In-person') parts.push('in-person');
    if (f.cluster && !(f.cluster === 'Scholarships' && f.type === 'Scholarship')) parts.push(clusterLabel(f.cluster));
    parts.push(f.type ? TYPE_PLURAL[f.type] : 'opportunities');
    let phrase = parts.join(' ');
    const words = f.rawTerms ?? [];
    if (words.length) phrase += ` about ${words.slice(0, 3).join(' ')}`;
    const grade = f.grade ?? ctx.grade;
    if (grade) phrase += ` open to ${ordinal(grade)} graders`;
    if (f.state) phrase += ` (with ${f.state.name.split(' ').map(cap).join(' ')} options first)`;
    if (f.soon) phrase += ' with deadlines in the next few months';
    if (f.month) phrase += ` usually due in ${cap(MONTHS[f.month - 1])}`;
    return phrase;
  }

  function shortCost(o) {
    if (o.cost === 'Award') return o.type === 'Scholarship' ? 'scholarship money' : 'prizes';
    return { Free: 'free', Stipend: 'paid', Fee: 'small fee', Tuition: o.financialAid ? 'tuition, aid available' : 'tuition' }[o.cost];
  }

  function deadlineText(o) {
    const m = monthsUntilDeadline(o, now());
    if (m === 0) return `due **this month** (${o.deadline})`;
    if (m === 1) return `due **next month** (${o.deadline})`;
    return `deadline: ${o.deadline}`;
  }

  const TYPE_NOUN = {
    Research: 'research program', Resource: 'free learning resource', 'Club / Organization': 'student organization',
    'Exchange / Travel': 'exchange program', 'College Access': 'college access program', Volunteering: 'volunteer opportunity',
  };
  const typeNoun = (o) => TYPE_NOUN[o.type] ?? o.type.toLowerCase();

  function whyLine(row, f) {
    if (row.match?.reasons?.length) {
      const r = row.match.reasons.find((x) => !/^(Open to|Free to participate|Pays participants|Awards money)/.test(x));
      if (r) return r.charAt(0).toLowerCase() + r.slice(1);
    }
    const tag = row.o.tags.find((t) => (f.terms ?? []).some((term) => t.includes(term)));
    if (tag) return `focused on ${tag}`;
    return row.o.tags[0] ? `focused on ${row.o.tags[0]}` : typeNoun(row.o);
  }

  function bulletFor(row, f) {
    const o = row.o;
    return `- **[${o.title}](opp:${o.id})**: ${whyLine(row, f)} · ${shortCost(o)} · ${deadlineText(o)}`;
  }

  // ---- intents ---------------------------------------------------------------
  function answerSearch(f, ctx, state, { intro } = {}) {
    const { result, filters, relaxed } = searchWithRelaxation(f, ctx);
    state.lastFilters = filters;
    state.lastResults = result.rows.map((r) => r.o.id);
    state.offset = result.page.length;
    if (!result.total) {
      state.lastResults = [];
      return {
        text: pick([
          'I couldn\'t find anything in the directory that matches that yet.',
          'Nothing in the directory matches that right now.',
        ]) + ' Try a broader topic, or browse by interest area.',
        suggestions: ['Show me STEM opportunities', 'Free summer programs', 'Scholarships for me'],
      };
    }
    const name = ctx.firstName ? `, ${ctx.firstName}` : '';
    const phrase = describeFilters(filters, ctx);
    const relaxNote = relaxed.length
      ? `I couldn't find an exact match, so I loosened the ${list(relaxed.map((k) => ({ terms: 'keywords', soon: 'deadline', month: 'month', affordable: 'cost', cost: 'cost', format: 'online/in-person', type: 'type', grade: 'grade' }[k])))} filter. `
      : '';
    const lead = intro ?? pick([
      `Here are the best ${phrase} I found${name}:`,
      `Good question${name}! Top ${phrase}:`,
      `These ${phrase} stand out${name}:`,
    ]);
    const lines = result.page.map((r) => bulletFor(r, filters));
    const grade = filters.grade ?? ctx.grade;
    const scholarshipNote = (filters.type === 'Scholarship' || filters.cluster === 'Scholarships') && grade && grade < 12
      ? `\n\nMost big scholarships open in **12th grade**. These are ones you can work toward now.` : '';
    const more = result.total > result.page.length ? `\n\nThere ${result.total - result.page.length === 1 ? 'is' : 'are'} **${result.total - result.page.length} more**. Say "show more", or narrow it down.` : '';
    const tip = pick([
      '\n\nTap a name for full details, or ask me about any of them.',
      '\n\nAsk "tell me about the first one" to dig in.',
      '\n\nWant me to narrow these down? Try "only free ones" or "online only".',
    ]);
    return {
      text: `${relaxNote}${lead}\n\n${lines.join('\n')}${scholarshipNote}${more}${tip}`,
      suggestions: refineSuggestions(filters, result),
    };
  }

  function refineSuggestions(f, result) {
    const s = [];
    if (result.total > result.page.length) s.push('Show more');
    if (f.cost !== 'Free') s.push('Only free ones');
    if (f.format !== 'Virtual') s.push('Online only');
    if (!f.soon) s.push('Which are due soon?');
    if (result.page.length) s.push('Tell me about the first one');
    return s.slice(0, 4);
  }

  function answerMore(ctx, state) {
    const ids = state.lastResults ?? [];
    const start = state.offset ?? 0;
    if (!ids.length) return { text: 'Ask me for something first, like "free STEM summer programs", and then I can show more.', suggestions: ['Free summer programs', 'Paid internships'] };
    const next = ids.slice(start, start + 5).map((id) => byId.get(id)).filter(Boolean);
    if (!next.length) return { text: 'That\'s everything that matched. Want to try a different search?', suggestions: ['Show me something different', 'What should I do this year?'] };
    state.offset = start + next.length;
    const rows = next.map((o) => ({ o, match: ctx.profile ? scoreOpportunity(o, ctx.profile) : null }));
    const remaining = ids.length - state.offset;
    return {
      text: `${pick(['Here are more:', 'More options:', 'Next up:'])}\n\n${rows.map((r) => bulletFor(r, state.lastFilters ?? {})).join('\n')}${remaining > 0 ? `\n\n**${remaining}** more after these.` : '\n\nThat\'s the full list.'}`,
      suggestions: remaining > 0 ? ['Show more', 'Only free ones'] : ['Online only', 'Which are due soon?'],
    };
  }

  function answerDetails(o, ctx, state, focus) {
    state.lastOpp = o.id;
    const match = ctx.profile ? scoreOpportunity(o, ctx.profile) : null;
    const grade = ctx.grade;
    const eligible = grade ? o.grades.includes(grade) : null;
    const lines = [];

    if (focus === 'deadline') {
      lines.push(`**[${o.title}](opp:${o.id})** is ${deadlineText(o)}. Dates shift each year, so confirm on the official site and plan to finish your application **two weeks early**.`);
    } else if (focus === 'cost') {
      lines.push(`**Cost for [${o.title}](opp:${o.id}):** ${o.costNote}.${o.financialAid || o.needBased ? ' Financial aid or need-based support is available.' : ''}`);
    } else if (focus === 'eligibility') {
      if (eligible === true && (!o.minGPA || !ctx.profile?.gpa || ctx.profile.gpa >= o.minGPA)) lines.push(`**Yes, it looks like you can apply** to [${o.title}](opp:${o.id}) as a ${ordinal(grade)} grader.`);
      else if (eligible === false) lines.push(`**Not right now:** [${o.title}](opp:${o.id}) is open to ${gradeLabel(o.grades).toLowerCase()}. Bookmark it for later!`);
      else lines.push(`[${o.title}](opp:${o.id}) is open to ${gradeLabel(o.grades).toLowerCase()}${o.minGPA ? ` with a ${o.minGPA.toFixed(1)}+ GPA` : ''}.`);
    } else {
      lines.push(`**[${o.title}](opp:${o.id})** is ${/^[aeiou]/i.test(typeNoun(o)) ? 'an' : 'a'} ${typeNoun(o)} run by ${o.organization}. ${o.description}`);
    }

    lines.push('');
    lines.push(`- **Who:** ${gradeLabel(o.grades)}${o.minGPA ? ` · ${o.minGPA.toFixed(1)}+ GPA` : ''}`);
    lines.push(`- **Cost:** ${o.costNote}`);
    lines.push(`- **Where:** ${o.format} · ${o.location}`);
    lines.push(`- **When:** ${o.season} · ${cap(deadlineText(o))}`);

    if (match) {
      const fit = [...match.reasons.slice(0, 3).map((r) => `✓ ${r}`), ...match.warnings.slice(0, 2).map((w) => `⚠ ${w}`)];
      if (fit.length) lines.push('', `**For you (${match.eligible ? `${match.score}% match` : 'check eligibility'}):** ${fit.join(' · ')}`);
    }
    lines.push('', pick([
      'Next step: open the official site to confirm this year\'s details, then save it so the deadline shows up in My Pathway.',
      'Tip: save it to track the deadline, and start gathering what the application needs a few weeks early.',
    ]));
    return {
      text: lines.join('\n'),
      suggestions: ['Show similar programs', focus === 'eligibility' ? 'When is it due?' : 'Am I eligible?', 'How do I stand out?'],
    };
  }

  function answerSimilar(o, ctx, state) {
    const f = { cluster: o.cluster, terms: o.tags.slice(0, 4).flatMap((t) => contentTerms(t)) };
    const { result } = searchWithRelaxation(f, ctx);
    const rows = result.rows.filter((r) => r.o.id !== o.id);
    state.lastResults = rows.map((r) => r.o.id);
    state.offset = Math.min(5, rows.length);
    state.lastFilters = f;
    if (!rows.length) return { text: `I couldn't find anything close to ${o.title} yet.`, suggestions: ['Show me something different'] };
    return {
      text: `If you like **${o.title}**, also look at:\n\n${rows.slice(0, 5).map((r) => bulletFor(r, f)).join('\n')}`,
      suggestions: ['Show more', 'Only free ones', 'Compare the first two'],
    };
  }

  function answerCompare(a, b) {
    const row = (label, fa, fb) => `- **${label}:** ${fa} vs. ${fb}`;
    return {
      text: `**[${a.title}](opp:${a.id})** vs. **[${b.title}](opp:${b.id})**\n\n${[
        row('Type', a.type, b.type),
        row('Cost', shortCost(a), shortCost(b)),
        row('Grades', gradeLabel(a.grades), gradeLabel(b.grades)),
        row('Format', a.format, b.format),
        row('Deadline', a.deadline, b.deadline),
      ].join('\n')}\n\nBoth can be worth it. Apply to both if you're eligible and the timing works!`,
      suggestions: [`Tell me about ${a.title}`, `Tell me about ${b.title}`],
    };
  }

  function answerPlan(ctx, state) {
    const grade = ctx.grade;
    const name = ctx.firstName ? `, ${ctx.firstName}` : '';
    const steps = grade ? GRADE_PLANS[grade] : null;
    const f = { cluster: ctx.interests?.length === 1 ? ctx.interests[0] : undefined, terms: [] };
    const { result } = searchWithRelaxation(f, ctx);
    state.lastResults = result.rows.map((r) => r.o.id);
    state.offset = Math.min(3, result.rows.length);
    state.lastFilters = f;
    const soon = result.rows.filter((r) => { const m = monthsUntilDeadline(r.o, now()); return m !== null && m <= 2; }).slice(0, 2);
    const parts = [];
    parts.push(grade
      ? `Here's a plan for ${ordinal(grade)} grade${name}.`
      : `Here's a starting plan${name}. Tell me your grade (for example "I'm a sophomore") and I'll tailor it.`);
    if (steps) parts.push(`\n**This year**\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    if (result.rows.length) parts.push(`\n**Top picks for you right now**\n${result.rows.slice(0, 3).map((r) => bulletFor(r, f)).join('\n')}`);
    if (soon.length) parts.push(`\n**Coming up soon:** ${soon.map((r) => `[${r.o.title}](opp:${r.o.id})`).join(' and ')} ${soon.length > 1 ? 'are' : 'is'} usually due within two months.`);
    if (!ctx.profile) parts.push('\nFor sharper picks, build your profile with the **Pathway Wizard** (the "Find my pathway" button).');
    return { text: parts.join('\n'), suggestions: ['Show more', 'Which are due soon?', 'How do I stand out?'] };
  }

  function answerAdvice(topic, ctx, state) {
    let text = topic.answer(ctx);
    if (topic.picks) {
      let picks = [];
      if (topic.picks.ids) picks = topic.picks.ids.map((id) => byId.get(id)).filter(Boolean);
      else {
        const { result } = searchWithRelaxation({ ...topic.picks.search, cluster: ctx.interests?.[0], terms: [] }, ctx);
        picks = result.page.slice(0, 3).map((r) => r.o);
        state.lastResults = result.rows.map((r) => r.o.id);
        state.offset = picks.length;
        state.lastFilters = topic.picks.search;
      }
      if (picks.length) text += `\n\n**Worth a look:** ${picks.map((o) => `[${o.title}](opp:${o.id})`).join(' · ')}`;
    }
    return { text, suggestions: topic.suggestions ?? [] };
  }

  function greeting(ctx) {
    const name = ctx.firstName ? ` ${ctx.firstName}` : '';
    const hour = now().getHours();
    const time = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return {
      text: `${pick([`${time}${name}!`, `Hey${name}!`, `Hi${name}!`])} I'm Zeus. I can find programs, internships, competitions, and scholarships that fit you, compare options, and help you plan. What are you interested in?`,
      suggestions: ctx.profile ? ['Show my top matches', 'What should I do this year?', 'What is due soon?'] : ['Free summer programs', 'Paid internships', 'Scholarships for seniors'],
    };
  }

  // ---- conversation memory -----------------------------------------------------
  function rememberFacts(message, e, state) {
    const text = normalize(message);
    if (/\b(i m|im|i am)\b/.test(text) && e.grade) state.grade = e.grade;
    if (/\b(i like|i love|i m into|im into|interested in|i enjoy|passionate about|want to be|want to study|i want to)\b/.test(text) && e.cluster) {
      state.interests = [...new Set([e.cluster, ...(state.interests ?? [])])].slice(0, 3);
    }
    if (/\b(cant afford|can t afford|low income|money is tight|financial need|need money|tight budget)\b/.test(text)) state.financialNeed = true;
  }

  function context(profile, state) {
    return {
      profile: profile ?? null,
      firstName: profile?.firstName,
      grade: state.grade ?? profile?.grade,
      interests: state.interests?.length ? state.interests : profile?.interests,
      financialNeed: state.financialNeed ?? profile?.financialNeed,
    };
  }

  // ---- main entry --------------------------------------------------------------
  function reply(message, { profile = null, state: prevState = {} } = {}) {
    const state = structuredClone(prevState ?? {});
    const text = normalize(message);
    const e = extractEntities(message);
    rememberFacts(message, e, state);
    const ctx = context(profile, state);
    const done = (out) => ({ ...out, state });

    // 1. Safety first
    if (/\b(kill myself|suicid\w*|self harm|hurt myself|want to die|end my life|cutting myself|being abused|abuse me|unsafe at home)\b/.test(text)) {
      return done({
        text: `I'm really glad you said something. You don't have to handle this alone.\n\n- **Call or text 988** (Suicide & Crisis Lifeline, 24/7, free and confidential)\n- **Text HOME to 741741** (Crisis Text Line)\n- If you're in immediate danger, **call 911**\n\nPlease also tell a trusted adult, like a parent, teacher, or school counselor.`,
        suggestions: [],
      });
    }
    if (/\b(fuck\w*|shit\w*|bitch\w*|porn\w*|nude\w*|sex)\b/.test(text)) {
      return done({ text: 'Let\'s keep things school-friendly. I\'m here to help you find opportunities and plan your next steps. What are you interested in?', suggestions: ['Free summer programs', 'What should I do this year?'] });
    }
    if (/\b\d{3}[ .-]?\d{3}[ .-]?\d{4}\b/.test(message) || /\S+@\S+\.\S+/.test(message)) {
      return done({ text: 'Quick tip: you never need to share contact info like phone numbers or emails with me. Everything stays on your device anyway. What can I help you find?', suggestions: ['Free summer programs', 'Scholarships for me'] });
    }

    // 2. Small talk
    if (/^(hi|hello|hey|yo|sup|hiya|howdy|good (morning|afternoon|evening)|whats up)( zeus)?$/.test(text)) return done(greeting(ctx));
    if (/^(thanks|thank you|thx|ty|appreciate it|awesome|great|cool|perfect)( so much| zeus)?$/.test(text)) {
      return done({ text: pick(['Happy to help! Anything else you want to explore?', 'Anytime! Want to look at something else?', 'Glad that helped. Good luck with your applications!']), suggestions: ['What should I do this year?', 'What is due soon?'] });
    }
    if (/^(bye|goodbye|see you|later|cya)\b/.test(text)) return done({ text: 'Good luck! Your saved opportunities will be waiting in My Pathway.', suggestions: [] });
    if (/\b(who are you|what are you|are you (an? )?(ai|bot|robot|human|real)|what can you do|how do you work|help me use|what do you do)\b/.test(text) || text === 'help') {
      return done({
        text: `I'm **Zeus**, Student Atlas's built-in guide. I'm not connected to an AI service: I read what you ask, figure out what you're looking for (interest, grade, cost, online or in person, deadlines), and search our directory of ${opportunities.length} real opportunities to find the best fits for you.\n\nTry things like:\n- "free coding competitions for sophomores"\n- "paid internships in health"\n- "tell me about RSI"\n- "compare Coca-Cola Scholars and Gates Scholarship"\n- "how do I ask for a recommendation letter?"`,
        suggestions: ['Free summer programs', 'What should I do this year?', 'Show my top matches'],
      });
    }

    // 3. Follow-ups that depend on conversation state
    if (/^(show |give me |any )?(more|next|more please|show more|keep going|others|what else)( options| ones| results)?$/.test(text)) return done(answerMore(ctx, state));

    const ordinalMatch = text.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|#\s?[1-5]|number [1-5])\b/);
    const last = state.lastResults ?? [];
    if (ordinalMatch && last.length && /\b(one|about|tell|details|more|that|is|the|#|number)\b/.test(text)) {
      const word = ordinalMatch[1].replace('#', '').replace('number ', '').trim();
      const idx = { first: 0, '1st': 0, 1: 0, second: 1, '2nd': 1, 2: 1, third: 2, '3rd': 2, 3: 2, fourth: 3, '4th': 3, 4: 3, fifth: 4, '5th': 4, 5: 4, last: Math.min(last.length, state.offset ?? last.length) - 1 }[word];
      const o = byId.get(last[idx]);
      if (/\bcompare\b/.test(text) && last.length >= 2) return done(answerCompare(byId.get(last[0]), byId.get(last[1])));
      if (o) return done(answerDetails(o, ctx, state, focusOf(text)));
    }
    if (/\bcompare (the )?(first|top) (two|2)\b/.test(text) && last.length >= 2) return done(answerCompare(byId.get(last[0]), byId.get(last[1])));

    // 4. Named opportunities (details, compare, similar)
    const mentions = findMentions(message);
    if (mentions.length >= 2 && /\b(compare|vs|versus|or|difference|better)\b/.test(text) && mentions[0].o.id !== mentions[1].o.id) {
      return done(answerCompare(mentions[0].o, mentions[1].o));
    }
    const lastOpp = state.lastOpp ? byId.get(state.lastOpp) : null;
    if (/\b(similar|like (this|that|it)|more like)\b/.test(text) && (mentions[0]?.o || lastOpp)) return done(answerSimilar(mentions[0]?.o ?? lastOpp, ctx, state));
    if (mentions.length && mentions[0].score >= 1.5) return done(answerDetails(mentions[0].o, ctx, state, focusOf(text)));

    // Questions about "it" after viewing details
    if (lastOpp && /\b(it|this|that|this one|that one)\b/.test(text) && /\b(eligible|qualify|can i|due|deadline|when|cost|free|price|pay|how much|apply)\b/.test(text)) {
      return done(answerDetails(lastOpp, ctx, state, focusOf(text)));
    }

    // 5. Planning
    if (/\b(plan|roadmap|where (do|should) i start|what should i (do|be doing)|next steps?|just finished the pathway wizard|top matches|my matches|best for me|for me right now)\b/.test(text) && !e.type && !e.cost && !e.format) {
      return done(answerPlan(ctx, state));
    }

    // 6. Advice library
    const corrected = correctSpelling(text);
    const topic = ADVICE.find((t) => t.patterns.some((p) => p.test(text) || p.test(corrected)));
    const looksLikeSearch = e.type || e.cost || e.format || e.soon || e.month || /\b(find|show|list|recommend|suggest|any|options|programs|opportunities|internships|competitions|camps)\b/.test(text);
    if (topic && !(looksLikeSearch && !/\b(how|what|why|should)\b/.test(text))) return done(answerAdvice(topic, ctx, state));

    // 7. Refinements of the previous search ("only free ones", "what about online?")
    const shortFollowUp = text.split(' ').length <= 8;
    const isRefinement = state.lastFilters && (/^(only|just|what about|how about|and|but|any|which (are|ones)|ones that are|now|is it|are they|are any)\b|\b(ones|instead|too)\b/.test(text)
      || (shortFollowUp && e.state && /\b(in|near|around)\b/.test(text)));
    const hasNewFilters = e.cluster || e.type || e.cost || e.affordable || e.format || e.soon || e.month || e.state || e.grade;
    // "online only", "free", "due soon": filter words with no new topic narrow the last search.
    const filterOnly = state.lastFilters && hasNewFilters && !e.cluster && !e.type && !e.terms.length && shortFollowUp;
    if ((isRefinement || filterOnly) && hasNewFilters) {
      const merged = { ...state.lastFilters };
      const newTopic = (e.cluster && e.cluster !== merged.cluster) || (e.terms.length && !e.cluster && !e.type);
      if (newTopic) { delete merged.type; merged.terms = e.terms; merged.rawTerms = e.rawTerms; }
      for (const k of ['cluster', 'type', 'cost', 'affordable', 'format', 'soon', 'month', 'state', 'grade']) if (e[k] !== undefined) merged[k] = e[k];
      return done(answerSearch(merged, ctx, state));
    }

    // 8. Search
    const f = { ...e };
    if (!f.cluster && !e.terms.length && ctx.interests?.length === 1 && !f.type) f.cluster = ctx.interests[0];
    const knownKeywords = expandTerms(e.terms, index).size > 0;
    if (hasNewFilters || knownKeywords || (f.cluster && e.terms.length)) return done(answerSearch(f, ctx, state));

    // 9. Nothing recognized
    return done({
      text: pick([
        'I\'m not sure I caught that. Could you tell me what kind of opportunity you\'re looking for, or a topic you\'re into?',
        'Hmm, I didn\'t quite get that. Try a topic (like "robotics" or "writing"), a type (internship, competition), or a question like "how do I write an essay?"',
      ]),
      suggestions: ['Free summer programs', 'Paid internships', 'What should I do this year?', 'What can you do?'],
    });
  }

  function focusOf(text) {
    if (/\b(eligible|qualify|can i (apply|do|join)|am i able|old enough|requirements?)\b/.test(text)) return 'eligibility';
    if (/\b(deadline|due|when)\b/.test(text)) return 'deadline';
    if (/\b(cost|price|how much|free|pay|paid|expensive|tuition)\b/.test(text)) return 'cost';
    return null;
  }

  // ---- predictive suggestions while typing ---------------------------------------
  function templates(ctx) {
    const g = ctx.grade ? `${ordinal(ctx.grade)} graders` : 'sophomores';
    const area = ctx.interests?.[0] ? clusterLabel(ctx.interests[0]) : 'STEM';
    return [
      `Free summer programs for ${g}`,
      `Paid internships for ${g}`,
      `Online ${area} competitions`,
      `${area} research programs`,
      'Scholarships for seniors',
      'Scholarships for me',
      'What is due soon?',
      'What should I do this year?',
      'Show my top matches',
      'How do I ask for a recommendation letter?',
      'How do I write a strong application essay?',
      'How do I stand out?',
      'How do I find a research mentor?',
      'How does FAFSA work?',
      'How do match scores work?',
      'Free online coding courses',
      'Volunteer opportunities near me',
      'Clubs I can join',
      'Study abroad scholarships',
      'Compare RSI and MITES Summer',
    ];
  }

  function predict(partial, { profile = null, state = {}, limit = 5 } = {}) {
    const typed = normalize(partial);
    if (typed.length < 2) return [];
    const words = typed.split(' ');
    const lastWord = words.at(-1);
    const head = words.slice(0, -1);
    const ctx = context(profile, state);
    const candidates = [
      ...templates(ctx).map((t) => ({ text: t, boost: 2 })),
      ...opportunities.map((o) => ({ text: `Tell me about ${o.title}`, boost: o.featured ? 1 : 0, title: normalize(o.title) })),
    ];
    const scored = [];
    for (const c of candidates) {
      const ct = normalize(c.text);
      const cw = ct.split(' ');
      // every completed word must appear; the word being typed must prefix a word
      if (!head.every((w) => cw.includes(w) || (c.title && cw.some((x) => x.startsWith(w))))) continue;
      if (!cw.some((w) => w.startsWith(lastWord))) continue;
      let score = c.boost;
      if (ct.startsWith(typed)) score += 6;
      if (c.title && c.title.includes(typed)) score += 3;
      score -= ct.length / 100;
      scored.push({ text: c.text, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    return scored.filter((s) => (seen.has(s.text) ? false : seen.add(s.text))).slice(0, limit).map((s) => s.text);
  }

  return { reply, predict, search, extractEntities, findMentions };
}

const GENERIC_TITLE_WORDS = new Set(['program', 'summer', 'scholarship', 'scholar', 'competition', 'challenge', 'national', 'international',
  'research', 'institute', 'youth', 'student', 'high', 'school', 'award', 'foundation', 'university', 'college', 'pre', 'camp', 'club',
  'internship', 'fellowship', 'science', 'leadership', 'america', 'american', 'usa', 'academy', 'center', 'society', 'workshop', 'workshops',
  'free', 'online', 'opportunity', 'and', 'the', 'for', 'of']);
