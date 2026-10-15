// College Lab engine: essay feedback, transcript parsing, profile assessment,
// and the mentor's on-device answers. Pure functions with no DOM access, so it
// runs in the browser (as the fallback when AI feedback is off or unavailable)
// and in Node for tests. Claude-powered results from /api/college-lab are
// normalized through the same shapes, so the UI renders both identically.

// ---- Shared helpers ---------------------------------------------------------
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const words = (text) => (String(text).match(/[A-Za-z0-9’']+(?:-[A-Za-z0-9’']+)*/g) ?? []);
const lower = (s) => String(s).toLowerCase();

export function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

export function splitParagraphs(text) {
  return String(text).replace(/\r\n?/g, '\n').split(/\n\s*\n|\n(?=\s{2,}|\t)/).map((p) => p.trim()).filter(Boolean);
}

function syllables(word) {
  const w = lower(word).replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Flesch-Kincaid grade level. */
export function readingGrade(text) {
  const ws = words(text);
  const ss = splitSentences(text);
  if (!ws.length || !ss.length) return 0;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return round(0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59, 1);
}

const STOPWORDS = new Set(('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just me more most my no not of on or our out she so some than that the their them then there these they this to too up us was we were what when which who will with would you your about after again all also am any because before being both each even ever few first get got go going him how into like made make many much must myself now off once only other over own same should since such take than through under until very way well while why within without yet one two').split(' '));

// ---- Essays -----------------------------------------------------------------
export const ESSAY_PROMPTS = [
  { id: 'ca1', label: 'Common App 1: Background, identity, interest, or talent', limit: 650, keywords: ['background', 'identity', 'culture', 'family', 'heritage', 'talent', 'who i am', 'community', 'grew up'] },
  { id: 'ca2', label: 'Common App 2: A challenge, setback, or failure', limit: 650, keywords: ['challenge', 'setback', 'fail', 'failure', 'obstacle', 'struggle', 'mistake', 'lost', 'difficult'] },
  { id: 'ca3', label: 'Common App 3: Questioning or challenging a belief', limit: 650, keywords: ['belief', 'believed', 'question', 'disagree', 'opinion', 'assumption', 'idea', 'challenged'] },
  { id: 'ca4', label: 'Common App 4: Gratitude for something someone did', limit: 650, keywords: ['grateful', 'gratitude', 'thank', 'kindness', 'surprised', 'gift', 'helped me'] },
  { id: 'ca5', label: 'Common App 5: An accomplishment or event that sparked growth', limit: 650, keywords: ['growth', 'grew', 'realized', 'understanding', 'accomplish', 'moment', 'mature', 'changed'] },
  { id: 'ca6', label: 'Common App 6: A topic that makes you lose track of time', limit: 650, keywords: ['curious', 'fascinat', 'hours', 'lose track', 'obsess', 'learn', 'question', 'explore'] },
  { id: 'ca7', label: 'Common App 7: Topic of your choice', limit: 650, keywords: [] },
  { id: 'why-us', label: 'Supplement: Why this college?', limit: 250, keywords: ['program', 'professor', 'course', 'campus', 'research', 'community', 'major', 'class'] },
  { id: 'why-major', label: 'Supplement: Why this major?', limit: 250, keywords: ['major', 'study', 'field', 'research', 'career', 'course', 'interest'] },
  { id: 'activity', label: 'Supplement: Describe an activity', limit: 150, keywords: ['team', 'club', 'role', 'lead', 'built', 'organized', 'hours'] },
  { id: 'community', label: 'Supplement: A community you belong to', limit: 300, keywords: ['community', 'belong', 'members', 'together', 'contribute', 'role'] },
  { id: 'scholarship', label: 'Scholarship essay', limit: 500, keywords: ['goal', 'future', 'financial', 'college', 'career', 'community', 'impact'] },
  { id: 'custom', label: 'Another prompt (type it in)', limit: 650, keywords: [] },
];

export const RUBRIC = [
  { id: 'insight', label: 'Insight & reflection', weight: 0.25 },
  { id: 'voice', label: 'Voice & authenticity', weight: 0.15 },
  { id: 'specificity', label: 'Specific details', weight: 0.2 },
  { id: 'structure', label: 'Structure & flow', weight: 0.15 },
  { id: 'prompt', label: 'Answers the prompt', weight: 0.1 },
  { id: 'mechanics', label: 'Clarity & mechanics', weight: 0.15 },
];

const CLICHES = [
  'ever since i was young', 'ever since i was little', 'since i was a child', 'ever since i can remember', 'i have always been passionate',
  'i have always wanted', 'my passion for', 'make a difference', 'changed my life', 'change the world', 'outside of my comfort zone',
  'outside my comfort zone', 'hard work pays off', 'taught me the value of', "in today's society", 'in today’s society', 'webster',
  'dictionary defines', 'at the end of the day', 'the rest is history', 'follow my dreams', 'follow your dreams', 'think outside the box',
  'give back to the community', 'touched my heart', 'a better person', 'everything happens for a reason', 'never give up',
  'i learned a lot', 'it was a life changing', 'life-changing experience', 'opened my eyes', 'from that day forward', 'from that day on',
];
const HEDGES = ['very', 'really', 'just', 'actually', 'basically', 'literally', 'a lot', 'things', 'stuff', 'kind of', 'sort of', 'i think', 'i believe', 'i feel like', 'somewhat', 'quite'];
const MISSPELLINGS = {
  alot: 'a lot', definately: 'definitely', definitly: 'definitely', recieve: 'receive', seperate: 'separate', untill: 'until', wich: 'which',
  thier: 'their', 'could of': 'could have', 'should of': 'should have', 'would of': 'would have', occured: 'occurred', begining: 'beginning',
  beleive: 'believe', truely: 'truly', goverment: 'government', enviroment: 'environment', tommorow: 'tomorrow', wierd: 'weird',
  acheive: 'achieve', arguement: 'argument', comittee: 'committee', existance: 'existence', independant: 'independent', occassion: 'occasion',
};
const REFLECTION = /\b(i (?:learned|realized|understand|understood|discovered|recognized|began to|started to|now see|now know|came to)|taught me|this (?:means|meant)|looking back|in hindsight|i(?:'|’)ve come to|that is why|which is why|because of this|now,? i|today,? i|i still|i want to|i hope to)\b/gi;
const SENSORY = /\b(smell\w*|scent|sound\w*|tast\w*|bitter|sweet|salty|cold|warm|hot|freezing|bright|dim|loud|quiet|silence|whisper\w*|rough|smooth|sticky|hum\w*|glow\w*|crack\w*|creak\w*|buzz\w*|sweat\w*|trembl\w*|shiver\w*)\b/gi;
const TRANSITIONS = /\b(however|but|yet|still|instead|meanwhile|later|eventually|finally|then|after|before|when|that (?:night|day|summer|year|morning)|years later|by the time|since then|now)\b/gi;

function countMatches(text, re) {
  return (String(text).match(re) ?? []).length;
}

function findPhrase(text, phrase) {
  const i = lower(text).indexOf(phrase);
  return i === -1 ? null : text.slice(i, i + phrase.length);
}

function scoreBand(value, bands) {
  // bands: [[threshold, score], ...] in ascending threshold order; returns the last score whose threshold <= value
  let s = bands[0][1];
  for (const [t, v] of bands) if (value >= t) s = v;
  return s;
}

export function essayLabel(score) {
  if (score >= 85) return 'Ready to polish';
  if (score >= 72) return 'Strong draft';
  if (score >= 58) return 'Promising draft';
  if (score >= 40) return 'Early draft';
  return 'Getting started';
}

/**
 * On-device essay feedback. Heuristic, transparent, and deliberately modest:
 * it measures what text statistics can measure and says so.
 */
export function analyzeEssay(text, { promptId = 'ca7', promptText = '', wordLimit } = {}) {
  const body = String(text ?? '').trim();
  const prompt = ESSAY_PROMPTS.find((p) => p.id === promptId) ?? ESSAY_PROMPTS.at(-1);
  const limit = Number(wordLimit) > 0 ? Number(wordLimit) : prompt.limit;
  const ws = words(body);
  const wordCount = ws.length;
  const sentences = splitSentences(body);
  const paragraphs = splitParagraphs(body);
  const lc = lower(body);

  if (wordCount < 40) {
    return {
      source: 'local', wordCount, limit, overall: 0, label: 'Getting started',
      summary: 'Write at least a paragraph (about 40 words) and Student Atlas can give you feedback.',
      rubric: RUBRIC.map((r) => ({ id: r.id, label: r.label, score: 0, comment: 'Not enough text yet.' })),
      strengths: [], revisions: [], comments: [], stats: { sentences: sentences.length, paragraphs: paragraphs.length },
    };
  }

  const sentLens = sentences.map((s) => words(s).length);
  const avgLen = sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
  const sd = Math.sqrt(sentLens.reduce((a, b) => a + (b - avgLen) ** 2, 0) / sentLens.length);
  const contentWords = ws.map(lower).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const freq = new Map();
  for (const w of contentWords) freq.set(w, (freq.get(w) ?? 0) + 1);
  const overused = [...freq].filter(([w, n]) => n >= Math.max(4, Math.round(wordCount / 110)) && !/^(college|school)$/.test(w))
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  const uniqueRatio = new Set(ws.map(lower)).size / wordCount;
  const grade = readingGrade(body);

  const comments = [];
  const cliches = CLICHES.map((c) => findPhrase(body, c)).filter(Boolean);
  for (const q of cliches.slice(0, 4)) comments.push({ quote: q, note: 'This phrase appears in thousands of essays. Replace it with the specific moment or detail it stands for.', kind: 'cliche' });

  const hedgeHits = HEDGES.map((hw) => [hw, countMatches(lc, new RegExp(`\\b${hw}\\b`, 'g'))]).filter(([, n]) => n > 0);
  const hedgeCount = hedgeHits.reduce((a, [, n]) => a + n, 0);
  const hedgeRate = hedgeCount / wordCount;
  if (hedgeRate > 0.015) {
    const worst = hedgeHits.sort((a, b) => b[1] - a[1])[0];
    comments.push({ quote: findPhrase(body, worst[0]) ?? worst[0], note: `Filler words like “${worst[0]}” appear ${hedgeCount} times. Cutting most of them makes your writing more confident.`, kind: 'style' });
  }

  const passive = body.match(/\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b(?!\s+(?:to|that))/gi) ?? [];
  if (passive.length >= 3) comments.push({ quote: passive[0], note: `Passive voice (${passive.length} times) hides who acted. Try “I ___” instead.`, kind: 'style' });

  const longSentences = sentences.filter((s) => words(s).length > 40);
  for (const s of longSentences.slice(0, 2)) comments.push({ quote: s.slice(0, 90), note: `This sentence runs ${words(s).length} words. Split it so each idea lands.`, kind: 'clarity' });

  const spelling = Object.entries(MISSPELLINGS).filter(([bad]) => new RegExp(`\\b${bad}\\b`, 'i').test(body));
  for (const [bad, good] of spelling.slice(0, 4)) comments.push({ quote: findPhrase(body, bad) ?? bad, note: `Spelling: “${good}”.`, kind: 'mechanics' });
  const loneI = body.match(/(?:^|\s)i(?=[\s,.!?'’])/g)?.length ?? 0;
  if (loneI) comments.push({ quote: ' i ', note: 'Capitalize “I”.', kind: 'mechanics' });
  const doubled = body.match(/\b(\w+)\s+\1\b/i);
  if (doubled && !/^(had|that)$/i.test(doubled[1])) comments.push({ quote: doubled[0], note: 'Repeated word.', kind: 'mechanics' });
  const exclaims = countMatches(body, /!/g);

  const firstSentence = sentences[0] ?? '';
  const weakOpen = /^(?:["“]|have you ever|imagine|webster|according to|the dictionary|throughout history|since the dawn|in today)/i.test(firstSentence);
  if (weakOpen) comments.push({ quote: firstSentence.slice(0, 80), note: 'Openings built on a quotation, a definition, or a rhetorical question are common. Try starting inside a real moment from your life.', kind: 'structure' });

  for (const [w, n] of overused) {
    const q = findPhrase(body, w);
    if (q) comments.push({ quote: q, note: `“${w}” appears ${n} times. Vary it or cut repeats.`, kind: 'style' });
  }

  // ---- Rubric ----
  const reflections = countMatches(body, REFLECTION);
  const reflectionRate = reflections / Math.max(1, wordCount / 100);
  const lastThird = body.slice(Math.floor(body.length * 0.6));
  const reflectsAtEnd = countMatches(lastThird, REFLECTION) > 0;
  let insight = scoreBand(reflectionRate, [[0, 1], [0.15, 2], [0.4, 3], [0.7, 4], [1, 5]]);
  if (!reflectsAtEnd) insight = Math.max(1, insight - 1);
  if (cliches.length >= 3) insight = Math.max(1, insight - 1);

  const firstPerson = countMatches(lc, /\b(i|me|my|mine|myself)\b/g) / wordCount;
  const contractions = countMatches(body, /\b\w+['’](?:m|re|s|ve|ll|d|t)\b/g);
  const dialogue = countMatches(body, /["“][^"”]{3,}["”]/g);
  let voice = scoreBand(firstPerson, [[0, 1], [0.015, 2], [0.03, 3], [0.045, 4]]);
  if (contractions > 0 || dialogue > 0) voice += 1;
  if (cliches.length >= 2) voice -= 1;
  if (hedgeRate > 0.025) voice -= 1;
  voice = clamp(voice, 1, 5);

  const numbers = countMatches(body, /\b\d[\d,.:]*\b/g);
  const properNouns = sentences.reduce((n, s) => n + (s.split(/\s+/).slice(1).filter((w) => /^[A-Z][a-z]{2,}/.test(w) && !/^I(?:'|’|$)/.test(w)).length), 0);
  const sensory = countMatches(body, SENSORY);
  const concreteRate = (numbers + properNouns + sensory * 1.5 + dialogue * 2) / Math.max(1, wordCount / 100);
  const specificity = scoreBand(concreteRate, [[0, 1], [1, 2], [2.2, 3], [3.6, 4], [5.2, 5]]);

  const idealParas = limit >= 400 ? [4, 8] : [1, 4];
  let structure = 3;
  if (paragraphs.length >= idealParas[0] && paragraphs.length <= idealParas[1]) structure += 1;
  else if (limit >= 400 && paragraphs.length <= 2) structure -= 2;
  const transitions = countMatches(body, TRANSITIONS) / Math.max(1, sentences.length);
  if (transitions > 0.18) structure += 1;
  if (sd < 4 && sentences.length > 6) structure -= 1; // monotone sentence rhythm
  if (weakOpen) structure -= 1;
  structure = clamp(structure, 1, 5);

  const kw = prompt.id === 'custom' && promptText
    ? [...new Set(words(promptText).map(lower).filter((w) => w.length > 4 && !STOPWORDS.has(w)))].slice(0, 10)
    : prompt.keywords;
  const kwHits = kw.filter((k) => lc.includes(k)).length;
  let promptScore = kw.length ? scoreBand(kwHits / kw.length, [[0, 2], [0.1, 3], [0.2, 4], [0.35, 5]]) : 4;
  const overLimit = wordCount > limit;
  const underUsed = wordCount < limit * 0.6;
  if (overLimit) promptScore = Math.max(1, promptScore - 1);

  const mechanicsIssues = spelling.length + (loneI ? 1 : 0) + (doubled ? 1 : 0) + longSentences.length + (exclaims > 2 ? 1 : 0);
  let mechanics = 5 - Math.min(3, mechanicsIssues);
  if (grade > 14 || avgLen > 28) mechanics -= 1;
  mechanics = clamp(mechanics, 1, 5);

  const scores = { insight, voice, specificity, structure, prompt: promptScore, mechanics };
  const rubricComments = {
    insight: insight >= 4 ? 'You explain what your experiences mean to you, not just what happened.'
      : reflectsAtEnd ? 'There is some reflection. Go one layer deeper: what do you now believe, do, or value differently?'
        : 'Most of the essay tells what happened. Add reflection near the end about what it changed in you.',
    voice: voice >= 4 ? 'It sounds like a real person talking, which is exactly what readers want.'
      : 'Write the way you would tell this story to a friend you respect. Cut stock phrases and filler words.',
    specificity: specificity >= 4 ? 'Concrete names, numbers, and sensory details make scenes vivid.'
      : 'Add specifics a reader could picture: a place, a time, a sound, what someone said, a number.',
    structure: structure >= 4 ? 'Paragraphs move clearly from one idea to the next.'
      : limit >= 400 && paragraphs.length <= 2 ? 'Break the essay into paragraphs (most 650-word essays use 4 to 7).'
        : 'Use transitions and vary sentence length so the essay has rhythm and momentum.',
    prompt: overLimit ? `You are ${wordCount - limit} words over the ${limit}-word limit.`
      : promptScore >= 4 ? 'The essay connects clearly to the prompt.'
        : 'Make sure a reader can tell which part of the prompt you are answering, especially in the first and last paragraphs.',
    mechanics: mechanics >= 4 ? 'Sentences are clear and mostly error-free.'
      : 'Fix the flagged spelling, capitalization, and run-on sentences before you submit.',
  };
  const rubric = RUBRIC.map((r) => ({ id: r.id, label: r.label, score: scores[r.id], comment: rubricComments[r.id] }));
  let overall = Math.round(RUBRIC.reduce((a, r) => a + scores[r.id] * r.weight, 0) * 20);
  if (underUsed) overall -= Math.round((0.6 - wordCount / limit) * 70);
  overall = clamp(overall, 0, 100);

  const strengths = rubric.filter((r) => r.score >= 4).map((r) => rubricComments[r.id]);
  if (dialogue) strengths.push('Dialogue brings the reader into the moment.');
  if (!strengths.length) strengths.push('You have a draft on the page, which is the hardest step.');

  const revisions = [];
  const add = (title, detail) => revisions.push({ title, detail });
  if (overLimit) add('Trim to the word limit', `Cut ${wordCount - limit} words. Start with filler words, repeated ideas, and sentences that summarize what you already showed.`);
  if (underUsed) add('Use more of your space', `You are using ${wordCount} of ${limit} words. Readers expect most of the space to be used to show who you are.`);
  if (insight <= 3) add('Deepen the reflection', 'For each key moment, answer “so what?” What did you realize, and how do you act differently now? Put the strongest insight near the end.');
  if (specificity <= 3) add('Show, don’t tell', 'Pick the one or two most important moments and slow them down with specific details: who, where, what you saw and heard.');
  if (cliches.length) add('Replace stock phrases', `Swap out phrases like “${cliches[0]}” for something only you could write.`);
  if (structure <= 3) add('Strengthen the structure', weakOpen ? 'Open in the middle of a moment, then zoom out to what it means.' : 'Give each paragraph one job, and connect them with transitions.');
  if (voice <= 3) add('Sound more like yourself', 'Read it aloud. Anywhere it sounds like a brochure, rewrite it in your own words.');
  if (mechanics <= 3) add('Clean up mechanics', 'Fix the flagged errors, split long sentences, and have someone proofread the final version.');

  const label = essayLabel(overall);
  const summary = `${label}: ${wordCount} words${overLimit ? ` (over the ${limit}-word limit)` : ` of ${limit}`}. `
    + (revisions.length ? `Your biggest opportunity is to ${revisions[0].title.toLowerCase()}.` : 'Focus on final polish and proofreading.');

  return {
    source: 'local', wordCount, limit, overall, label, summary, rubric,
    strengths: strengths.slice(0, 4), revisions: revisions.slice(0, 5), comments: comments.slice(0, 10),
    stats: {
      sentences: sentences.length, paragraphs: paragraphs.length, avgSentenceLength: round(avgLen, 1),
      sentenceVariety: round(sd, 1), readingGrade: grade, uniqueWordRatio: round(uniqueRatio, 2),
    },
  };
}

/**
 * Normalizes an AI essay review into the same shape analyzeEssay returns.
 * Comments whose quote isn't actually in the essay are dropped.
 */
export function normalizeEssayReview(ai, text, { wordLimit } = {}) {
  const body = String(text ?? '');
  const wordCount = words(body).length;
  const ids = new Set(RUBRIC.map((r) => r.id));
  const rubric = RUBRIC.map((r) => {
    const found = (ai?.rubric ?? []).find((x) => x?.id === r.id);
    return { id: r.id, label: r.label, score: clamp(Math.round(Number(found?.score) || 0), 0, 5), comment: String(found?.comment ?? '').slice(0, 600) };
  });
  const overall = clamp(Math.round(Number(ai?.overall) || 0), 0, 100);
  return {
    source: 'ai', wordCount, limit: Number(wordLimit) || 650, overall, label: essayLabel(overall),
    summary: String(ai?.summary ?? '').slice(0, 1200),
    rubric: rubric.filter((r) => ids.has(r.id)),
    strengths: (ai?.strengths ?? []).map(String).slice(0, 5),
    revisions: (ai?.revisions ?? []).filter((r) => r && r.title).map((r) => ({ title: String(r.title).slice(0, 120), detail: String(r.detail ?? '').slice(0, 800) })).slice(0, 6),
    comments: (ai?.comments ?? [])
      .filter((c) => c && typeof c.quote === 'string' && c.quote.trim().length >= 3 && body.includes(c.quote.trim()))
      .map((c) => ({ quote: c.quote.trim().slice(0, 300), note: String(c.note ?? '').slice(0, 500), kind: 'ai' }))
      .slice(0, 12),
    stats: { sentences: splitSentences(body).length, paragraphs: splitParagraphs(body).length, readingGrade: readingGrade(body) },
  };
}

// ---- Transcripts --------------------------------------------------------------
export const LEVELS = ['Standard', 'Honors', 'AP', 'IB', 'Dual Enrollment'];
const LEVEL_BONUS = { Standard: 0, Honors: 0.5, AP: 1, IB: 1, 'Dual Enrollment': 1 };
const LETTER_POINTS = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0, E: 0 };
const NON_GPA = /^(p|pass|cr|credit|nc|w|wp|wf|i|inc|ip|au|audit|ng|s|u|n\/a)$/i;

export const SUBJECTS = ['English', 'Math', 'Science', 'Social Studies', 'World Language', 'Arts', 'Other'];
const SUBJECT_RULES = [
  ['English', /\b(english|literature|lit\b|lang(?:uage)? (?:and|&) comp|composition|writing|rhetoric|journalism|creative writing|speech)\b/i],
  ['Math', /\b(math|algebra|geometry|trig|trigonometry|calculus|calc\b|statistics|stats?\b|precalc|pre-calc|pre-calculus|functions|discrete|integrated math|linear)\b/i],
  ['Science', /\b(biology|bio\b|chemistry|chem\b|physics|science|environmental|anatomy|physiology|earth|astronomy|geology|ecology|forensic|marine|zoology|engineering|apes\b)\b/i],
  ['Social Studies', /\b(history|government|gov\b|civics|economics|econ\b|psychology|psych\b|sociology|geography|world studies|politics|human geo|ethnic studies|law)\b/i],
  ['World Language', /\b(spanish|french|german|latin|chinese|mandarin|japanese|italian|arabic|korean|russian|portuguese|asl|sign language|hebrew|world language)\b/i],
  ['Arts', /\b(art|music|band|orchestra|choir|chorus|theat(?:er|re)|drama|dance|ceramics|photography|design|painting|drawing|film)\b/i],
];
const SKIP_LINE = /\b(gpa|grade point|cumulative|total credits|credits (?:earned|attempted)|class rank|rank\b|weighted|unweighted|student (?:name|id)|^name\b|date of birth|dob\b|address|counselor|principal|signature|page \d|transcript|school:|graduation date|attendance|test scores?|sat\b|act\b)/i;

export function gradePoints(grade) {
  const g = String(grade ?? '').trim().toUpperCase();
  if (!g) return null;
  if (g in LETTER_POINTS) return LETTER_POINTS[g];
  const n = Number(g.replace('%', ''));
  if (Number.isFinite(n)) {
    if (n > 4.5 && n <= 100) return n >= 93 ? 4 : n >= 90 ? 3.7 : n >= 87 ? 3.3 : n >= 83 ? 3 : n >= 80 ? 2.7 : n >= 77 ? 2.3 : n >= 73 ? 2 : n >= 70 ? 1.7 : n >= 67 ? 1.3 : n >= 65 ? 1 : 0;
    if (n >= 0 && n <= 4.5) return Math.min(4, n);
  }
  return null;
}

export function detectLevel(name) {
  const s = String(name);
  if (/\b(dual enrollment|dual credit|college credit|\bde\b|concurrent)\b/i.test(s) || /\b[A-Z]{2,4}\s?1\d{2}\b/.test(s) && /\bcollege|cc\b/i.test(s)) return 'Dual Enrollment';
  if (/\bIB\b|international baccalaureate|\b(?:HL|SL)\b/.test(s)) return 'IB';
  if (/\bAP\b|advanced placement/.test(s)) return 'AP';
  if (/\b(honors?|hon\.?|hnrs?|gifted|accelerated|pre-ap|pre ap|enriched|\(h\)|\bH\b)/i.test(s)) return 'Honors';
  return 'Standard';
}

export function detectSubject(name) {
  for (const [subject, re] of SUBJECT_RULES) if (re.test(name)) return subject;
  return 'Other';
}

function detectYear(line) {
  const m = line.match(/\b(9|10|11|12)(?:th)?\s*grade\b|\bgrade\s*(9|10|11|12)\b|\b(freshman|sophomore|junior|senior)\b/i);
  if (m) {
    const n = m[1] || m[2];
    if (n) return `Grade ${n}`;
    return { freshman: 'Grade 9', sophomore: 'Grade 10', junior: 'Grade 11', senior: 'Grade 12' }[m[3].toLowerCase()];
  }
  const y = line.match(/\b(20\d\d)\s*[-–/]\s*(?:20)?(\d\d)\b/);
  if (y) return `${y[1]}–${y[2].length === 2 ? `20${y[2]}` : y[2]}`;
  return null;
}

const GRADE_TOKEN = /^(?:[A-F][+-]?|E|\d{2,3}(?:\.\d+)?%?|[0-4]\.\d{1,2}|P|PASS|CR|NC|W|WP|WF|INC|IP)$/i;

/** Parses one course line, or returns null when the line isn't a course. */
export function parseCourseLine(line, year = null) {
  const raw = line.replace(/\s+$/, '');
  if (!raw.trim() || raw.trim().length < 3) return null;
  if (SKIP_LINE.test(raw)) return null;
  let cells = raw.includes('\t') || raw.includes('|') || raw.includes(',') ? raw.split(/\t|\||,/) : raw.split(/\s{2,}/);
  cells = cells.map((c) => c.trim()).filter(Boolean);
  if (cells.length === 1) cells = raw.trim().split(/\s+/);

  // Walk from the right: credits and grades are trailing tokens.
  const tokens = cells.length > 1 && cells.slice(1).every((c) => !/\s/.test(c)) ? cells : cells.flatMap((c, i) => (i === 0 ? [c] : c.split(/\s+/)));
  const grades = [];
  let credits = null;
  let end = tokens.length;
  const creditLike = (t) => /^(?:\d?\.\d{1,2}|[0-2])$/.test(t) && Number(t) > 0 && Number(t) <= 2;
  if (end > 2 && creditLike(tokens[end - 1]) && GRADE_TOKEN.test(tokens[end - 2])) { credits = Number(tokens[end - 1]); end -= 1; }
  while (end > 1 && GRADE_TOKEN.test(tokens[end - 1])) { grades.unshift(tokens[end - 1].toUpperCase()); end -= 1; }
  if (!grades.length) return null;
  let name = tokens.slice(0, end).join(' ')
    .replace(/^[A-Z]{2,5}[-\s]?\d{2,5}[A-Z]?\s+/, '') // course codes like MAT201
    .replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]{3,}/.test(name)) return null;
  if (name.length > 80) name = name.slice(0, 80);

  const pts = grades.map(gradePoints).filter((p) => p !== null);
  const passFail = grades.every((g) => NON_GPA.test(g));
  if (!pts.length && !passFail) return null;
  return {
    name,
    year: detectYear(raw) ?? year,
    level: detectLevel(name),
    subject: detectSubject(name),
    grade: grades.join(' / '),
    points: pts.length ? round(pts.reduce((a, b) => a + b, 0) / pts.length, 2) : null,
    credits: credits && credits > 0 && credits <= 3 ? credits : 1,
  };
}

/** Parses pasted transcript text (or CSV) into courses. */
export function parseTranscript(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').slice(0, 600);
  const courses = [];
  let year = null;
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const course = parseCourseLine(line, year);
    if (course) { courses.push(course); continue; }
    const y = detectYear(line);
    if (y && line.trim().length < 60) { year = y; continue; }
    skipped += 1;
  }
  return { courses: courses.slice(0, 120), skipped };
}

/** GPA math shared by on-device and AI-parsed transcripts. */
export function computeGpa(courses) {
  const graded = (courses ?? []).filter((c) => c && Number.isFinite(c.points));
  const sum = (list, fn) => list.reduce((a, c) => a + fn(c) * (c.credits || 1), 0);
  const credits = (list) => list.reduce((a, c) => a + (c.credits || 1), 0);
  const gpa = (list, weighted) => (list.length ? round(sum(list, (c) => (weighted ? Math.min(5, c.points + (c.points >= 1 ? LEVEL_BONUS[c.level] ?? 0 : 0)) : c.points)) / credits(list), 2) : null);
  const core = graded.filter((c) => ['English', 'Math', 'Science', 'Social Studies', 'World Language'].includes(c.subject));
  const years = [...new Set(graded.map((c) => c.year).filter(Boolean))]; // transcript order
  const bySubject = SUBJECTS.map((s) => {
    const list = graded.filter((c) => c.subject === s);
    return { subject: s, count: (courses ?? []).filter((c) => c.subject === s).length, gpa: gpa(list, false) };
  }).filter((s) => s.count);
  const count = (lvl) => (courses ?? []).filter((c) => c.level === lvl).length;
  return {
    unweighted: gpa(graded, false),
    weighted: gpa(graded, true),
    core: gpa(core, false),
    credits: round(credits(courses ?? []), 1),
    courseCount: (courses ?? []).length,
    byYear: years.map((y) => ({ year: y, gpa: gpa(graded.filter((c) => c.year === y), false), count: graded.filter((c) => c.year === y).length })),
    bySubject,
    rigor: { ap: count('AP'), ib: count('IB'), honors: count('Honors'), dual: count('Dual Enrollment') },
  };
}

/** Plain-language observations about a transcript. */
export function transcriptInsights(courses, { grade } = {}) {
  const g = computeGpa(courses);
  const strengths = [];
  const concerns = [];
  if (!g.courseCount) return { strengths, concerns: ['No courses found yet. Paste your transcript or add courses by hand.'] };

  if (g.unweighted >= 3.7) strengths.push(`An unweighted GPA of ${g.unweighted.toFixed(2)} is excellent.`);
  else if (g.unweighted >= 3.3) strengths.push(`A ${g.unweighted.toFixed(2)} unweighted GPA is solid and competitive for many colleges.`);
  else concerns.push(`Your unweighted GPA is ${g.unweighted?.toFixed(2) ?? 'not available'}. Strong grades in the coming terms will show an upward trend.`);

  const trend = g.byYear.filter((y) => y.gpa !== null);
  if (trend.length >= 2) {
    const first = trend[0].gpa;
    const last = trend.at(-1).gpa;
    if (last - first >= 0.2) strengths.push(`Your grades went up from ${first.toFixed(2)} (${trend[0].year}) to ${last.toFixed(2)} (${trend.at(-1).year}). Colleges love an upward trend.`);
    else if (first - last >= 0.2) concerns.push(`Your GPA dipped from ${first.toFixed(2)} to ${last.toFixed(2)}. If something outside school affected you, the Additional Information section is the place to explain briefly.`);
    else strengths.push('Your grades have been consistent year to year.');
  }

  const advanced = g.rigor.ap + g.rigor.ib + g.rigor.dual;
  if (advanced >= 5) strengths.push(`${advanced} AP, IB, or dual-enrollment courses shows strong rigor.`);
  else if (advanced + g.rigor.honors >= 3) strengths.push(`You have taken ${advanced + g.rigor.honors} honors or advanced courses.`);
  else if ((grade ?? 12) >= 10) concerns.push('Colleges look at whether you took the most challenging courses available to you. Consider an honors, AP, IB, or dual-enrollment class next year if your school offers them.');

  const subjects = new Map(g.bySubject.map((s) => [s.subject, s]));
  const bestSub = g.bySubject.filter((s) => s.gpa !== null && s.subject !== 'Other').sort((a, b) => b.gpa - a.gpa)[0];
  const worstSub = g.bySubject.filter((s) => s.gpa !== null && s.subject !== 'Other').sort((a, b) => a.gpa - b.gpa)[0];
  if (bestSub && worstSub && bestSub.subject !== worstSub.subject && bestSub.gpa - worstSub.gpa >= 0.5) {
    strengths.push(`${bestSub.subject} is your strongest area (${bestSub.gpa.toFixed(2)}).`);
    concerns.push(`${worstSub.subject} is your lowest area (${worstSub.gpa.toFixed(2)}). Office hours, tutoring, or a study group could help.`);
  }
  if (!subjects.has('World Language') && (grade ?? 12) >= 10) concerns.push('No world language courses found. Many selective colleges expect two to three years.');
  const lowGrades = (courses ?? []).filter((c) => Number.isFinite(c.points) && c.points < 2);
  if (lowGrades.length) concerns.push(`${lowGrades.length === 1 ? `“${lowGrades[0].name}” has` : `${lowGrades.length} courses have`} a grade below C. Ask your counselor whether a retake or credit recovery makes sense.`);
  return { strengths, concerns };
}

// ---- Profile assessment ----------------------------------------------------------
const AWARD_POINTS = { School: 1, Regional: 2, State: 3, National: 4, International: 5 };

/**
 * Scores the student's application across areas (0–100) and lists concrete next steps.
 * The numbers are a coaching aid, not an admissions prediction.
 */
export function assessProfile({ stats = {}, transcript = null, essays = [], profile = null } = {}) {
  const grade = Number(stats.grade ?? profile?.grade) || null;
  const g = transcript?.courses?.length ? computeGpa(transcript.courses) : null;
  const gpa = Number(stats.gpa) || g?.unweighted || Number(profile?.gpa) || null;
  const areas = [];
  const steps = [];

  // Academics
  const acad = gpa ? clamp(Math.round(((gpa - 2) / 2) * 100), 5, 100) : null;
  areas.push({ id: 'academics', label: 'Grades', score: acad, detail: gpa ? `${gpa.toFixed(2)} unweighted GPA` : 'Add your GPA or transcript' });
  if (!gpa) steps.push({ area: 'academics', text: 'Add your GPA, or paste your transcript in the Transcript tab, so the mentor can personalize advice.' });
  else if (gpa < 3.3) steps.push({ area: 'academics', text: 'Your grades this term matter most right now. Pick your toughest class and set up weekly help (office hours, tutoring, or a study group).' });

  // Rigor
  const rig = g?.rigor ?? { ap: Number(stats.apCount) || 0, ib: 0, honors: Number(stats.honorsCount) || 0, dual: 0 };
  const advanced = (rig.ap ?? 0) + (rig.ib ?? 0) + (rig.dual ?? 0) + (Number(stats.apCount) && g ? 0 : 0);
  const expected = grade ? { 9: 1, 10: 2, 11: 5, 12: 7 }[grade] ?? 5 : 5;
  const rigScore = clamp(Math.round(((advanced + (rig.honors ?? 0) * 0.5) / expected) * 80), 5, 100);
  areas.push({ id: 'rigor', label: 'Course rigor', score: g || stats.apCount ? rigScore : null, detail: `${advanced} AP/IB/dual, ${rig.honors ?? 0} honors` });
  if (rigScore < 60 && (grade ?? 11) <= 11) steps.push({ area: 'rigor', text: 'When you choose next year’s classes, add one more challenging course in a subject you are good at.' });

  // Testing (optional at many schools)
  const sat = Number(stats.sat) || null;
  const act = Number(stats.act) || null;
  let test = null;
  if (sat) test = clamp(Math.round(((sat - 900) / 700) * 100), 5, 100);
  if (act) test = Math.max(test ?? 0, clamp(Math.round(((act - 18) / 18) * 100), 5, 100));
  areas.push({ id: 'testing', label: 'Testing', score: test, detail: sat || act ? [sat && `SAT ${sat}`, act && `ACT ${act}`].filter(Boolean).join(' · ') : 'Optional at many colleges' });
  if (!sat && !act && (grade ?? 11) >= 11) steps.push({ area: 'testing', text: 'Take a free full-length SAT practice test on Bluebook or Khan Academy to see where you stand. Many colleges are test-optional, but some now require scores.' });

  // Activities
  const acts = Array.isArray(stats.activities) ? stats.activities : [];
  const hours = acts.reduce((a, x) => a + (Number(x.hoursPerWeek) || 0) * (Number(x.weeksPerYear) || 0), 0);
  const leaders = acts.filter((x) => x.leadership).length;
  const actScore = acts.length ? clamp(Math.round(Math.min(acts.length, 8) * 7 + Math.min(hours, 800) / 20 + leaders * 8), 5, 100) : null;
  areas.push({ id: 'activities', label: 'Activities', score: actScore, detail: acts.length ? `${acts.length} ${acts.length === 1 ? 'activity' : 'activities'} · ${Math.round(hours)} hrs/yr · ${leaders} leadership` : 'Add your activities' });
  if (!acts.length) steps.push({ area: 'activities', text: 'List your activities, including jobs, family responsibilities, and things you do on your own. They all count.' });
  else if (!leaders && (grade ?? 11) <= 11) steps.push({ area: 'activities', text: 'Go deeper in one activity you care about: take on a role, start a project, or teach others.' });

  // Essays
  const bestEssay = essays.reduce((m, e) => Math.max(m, e.lastScore ?? 0), 0);
  areas.push({ id: 'essays', label: 'Essays', score: essays.length ? bestEssay || null : null, detail: essays.length ? `${essays.length} draft${essays.length === 1 ? '' : 's'} · best ${bestEssay || '–'}` : 'Start a draft in the Essays tab' });
  if ((grade ?? 12) >= 11 && !essays.length) steps.push({ area: 'essays', text: 'Start your personal essay: brainstorm three moments that changed how you think, then free-write about one for 20 minutes.' });
  else if (essays.length && bestEssay && bestEssay < 70) steps.push({ area: 'essays', text: 'Revise your strongest essay using the feedback, then ask a teacher or counselor to read it.' });

  // Honors & awards
  const awards = Array.isArray(stats.awards) ? stats.awards : [];
  const awardScore = awards.length ? clamp(awards.reduce((a, x) => a + (AWARD_POINTS[x.level] ?? 1) * 12, 10), 5, 100) : null;
  areas.push({ id: 'awards', label: 'Honors & awards', score: awardScore, detail: awards.length ? `${awards.length} listed` : 'None listed yet' });

  // College list
  const colleges = Array.isArray(stats.colleges) ? stats.colleges : [];
  const balance = { Reach: 0, Target: 0, Likely: 0 };
  for (const c of colleges) if (c.category in balance) balance[c.category] += 1;
  const listNotes = [];
  if (colleges.length) {
    if (balance.Likely < 2) listNotes.push('Add at least two “likely” schools you would be happy to attend and can afford.');
    if (balance.Reach > balance.Target + balance.Likely) listNotes.push('Your list leans heavily on reach schools. Balance it with more targets.');
    if (colleges.length > 15) listNotes.push('More than 15 applications is a lot of essays. Quality usually beats quantity.');
    if (!listNotes.length) listNotes.push('Your list looks balanced across reach, target, and likely schools.');
  } else if ((grade ?? 12) >= 11) {
    steps.push({ area: 'colleges', text: 'Start a college list with a mix of reach, target, and likely schools. Use each college’s Net Price Calculator to check cost.' });
  }
  if (profile?.financialNeed || stats.financialNeed) {
    steps.push({ area: 'money', text: 'Because cost matters, look at QuestBridge, application fee waivers, and colleges that meet full financial need. File the FAFSA as soon as it opens (October 1 for most years).' });
  }

  const scored = areas.filter((a) => a.score !== null);
  const overall = scored.length ? Math.round(scored.reduce((a, x) => a + x.score, 0) / scored.length) : null;
  return { overall, areas, steps: steps.slice(0, 6), collegeBalance: balance, collegeNotes: listNotes, gpa, grade };
}

// ---- Mentor (on-device) -----------------------------------------------------------
export const CRISIS = /\b(kill myself|suicid\w*|self[- ]harm|hurt myself|want to die|end my life|cutting myself|being abused|abuse me|unsafe at home|no reason to live)\b/i;
export const CRISIS_REPLY = 'I’m really glad you told me. You don’t have to handle this alone.\n\n- **Call or text 988** (Suicide & Crisis Lifeline, 24/7, free and confidential)\n- **Text HOME to 741741** (Crisis Text Line)\n- If you are in immediate danger, **call 911**\n\nPlease also tell a trusted adult, like a parent, teacher, or school counselor. College can wait; you matter more.';

function fmtGpa(n) { return Number.isFinite(n) ? n.toFixed(2) : null; }

function timeline(grade, now) {
  const month = now.getMonth(); // 0 = Jan
  const fall = month >= 7 && month <= 10;
  switch (grade) {
    case 9: return ['Build strong study habits; freshman grades count.', 'Try two or three activities and keep the ones you love.', 'Read widely and start a list of things you are curious about.', 'Look for a free summer program or a summer job.'];
    case 10: return ['Take the PSAT for practice if your school offers it.', 'Step up course rigor in your strongest subjects.', 'Go deeper in one or two activities, ideally with a role or project.', 'Plan a summer that builds a skill: a program, job, research, or a self-started project.'];
    case 11: return fall
      ? ['Take the PSAT/NMSQT in October (it’s the National Merit qualifier).', 'Keep grades strong; junior year is the most important on your transcript.', 'Start a college list and attend virtual info sessions.', 'Plan when you will take the SAT or ACT (many students test in spring).']
      : ['Take the SAT or ACT in the spring, with a retake option in summer or fall.', 'Ask two teachers for recommendation letters before summer.', 'Visit or virtually tour a few colleges.', 'Brainstorm and start your personal essay over the summer.'];
    case 12: return fall
      ? ['Finish your personal essay and supplements, starting with the earliest deadlines.', 'Early Action and Early Decision deadlines are often November 1 or 15.', 'File the FAFSA (it opens October 1) and the CSS Profile if your colleges require it.', 'Send test scores and confirm teachers submitted recommendations.']
      : ['Watch for decisions and compare financial aid offers side by side.', 'Appeal a financial aid offer if your family’s situation changed or another college offered more.', 'Decide by May 1 (National College Decision Day) and send your deposit.', 'Keep your grades up; admission offers can be revoked.'];
    default: return ['Tell me your grade and I can build a step-by-step plan.'];
  }
}

const INTENTS = [
  ['greet', /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/i],
  ['thanks', /^(thanks|thank you|thx|ty)\b/i],
  ['essay', /\b(essay|personal statement|supplement|why us|common app prompt|writing|draft)\b/i],
  ['transcript', /\b(transcript|my courses|my classes|course load)\b/i],
  ['gpa', /\b(gpa|grades?|bad grade|failing|report card)\b/i],
  ['rigor', /\b(ap|ib|honors|dual enrollment|rigor|hard(er|est)? classes|course selection|which classes)\b/i],
  ['testing', /\b(sat|act|psat|test[- ]optional|test scores?|standardized)\b/i],
  ['activities', /\b(activit(y|ies)|extracurricular|ecs?\b|clubs?|leadership|volunteer|service hours|job|spike)\b/i],
  ['money', /\b(pay(?:ing)? for|financial aid|fafsa|css profile|scholarship|afford|cost|tuition|low[- ]income|fee waiver|questbridge|pell|net price|money|loan)\b/i],
  ['list', /\b(college list|reach|target|safety|likely|which colleges|where should i apply|chances?|get in|admit)\b/i],
  ['recs', /\b(recommendation|rec letter|letter of rec|recommender|ask a teacher)\b/i],
  ['early', /\b(early (decision|action)|\bed\b|\bea\b|rea\b|restrictive|binding)\b/i],
  ['summer', /\b(summer|break)\b/i],
  ['interview', /\binterview\b/i],
  ['major', /\b(major|what (should|do) i study|career|undecided)\b/i],
  ['plan', /\b(plan|timeline|what should i (do|focus)|next steps?|to do|roadmap|this year|stats|how am i doing|review my|strength)\b/i],
];

/**
 * Answers a mentor question from the student's own data.
 * Returns { reply: markdown, suggestions: string[] }.
 */
export function mentorReply(message, { stats = {}, transcript = null, essays = [], profile = null, now = new Date() } = {}) {
  const text = String(message ?? '').trim();
  if (CRISIS.test(text)) return { reply: CRISIS_REPLY, suggestions: [] };
  const a = assessProfile({ stats, transcript, essays, profile });
  const g = transcript?.courses?.length ? computeGpa(transcript.courses) : null;
  const name = profile?.firstName || stats.firstName;
  const grade = a.grade;
  const intent = INTENTS.find(([, re]) => re.test(text))?.[0] ?? 'fallback';
  const lines = [];
  let suggestions = ['Review my stats', 'What should I do this year?', 'How can I pay for college?'];

  switch (intent) {
    case 'greet':
      lines.push(`Hi${name ? ` ${name}` : ''}! I’m your College Lab mentor. I can review your stats, explain your transcript, help with essays, and build a plan for ${grade ? `${grade}th grade` : 'your year'}.`);
      break;
    case 'thanks':
      lines.push('Anytime. You’re doing the work, and it shows. What’s next on your list?');
      break;
    case 'essay': {
      const best = essays.filter((e) => e.lastScore).sort((x, y) => y.lastScore - x.lastScore)[0];
      if (best) lines.push(`Your strongest draft so far is **${best.title || 'Untitled'}** at **${best.lastScore}/100**. ${best.lastScore >= 75 ? 'Next, get a trusted reader’s reaction and polish line by line.' : 'Work through the top revision in its feedback first; that usually moves the score the most.'}`);
      else lines.push('You haven’t run feedback on an essay yet. Open the **Essays** tab, paste a draft, and press **Get feedback**.');
      lines.push('', '**What makes a strong college essay**', '- It’s about you, not the topic: the reader should learn how you think.', '- It zooms into a specific moment, then reflects on what it means.', '- It sounds like you talking, not like a brochure.', '- It uses most of the word limit and has no errors.');
      suggestions = ['How do I brainstorm a topic?', 'How long should my essay be?', 'Review my stats'];
      if (/brainstorm|topic|idea/i.test(text)) {
        lines.length = 0;
        lines.push('**Three quick brainstorms**', '1. List 10 objects in your room and the story behind each one.', '2. Write about a time you changed your mind about something important.', '3. Finish the sentence: “Most people don’t know that I…” five different ways.', '', 'Pick the story that only you could tell, and that shows how you think, not just what you did.');
      } else if (/how long|word|limit/i.test(text)) {
        lines.length = 0;
        lines.push('The Common App personal essay allows **650 words**; aim for 550 to 650. Supplements are usually 150 to 300 words. Using most of the limit gives you room to show depth.');
      }
      break;
    }
    case 'transcript':
    case 'gpa': {
      if (g) {
        lines.push(`From your transcript: **${fmtGpa(g.unweighted)} unweighted** and **${fmtGpa(g.weighted)} weighted** across ${g.courseCount} courses${g.core ? `, with a **${fmtGpa(g.core)} core GPA**` : ''}.`);
        const ins = transcriptInsights(transcript.courses, { grade });
        if (ins.strengths.length) lines.push('', '**Strengths**', ...ins.strengths.map((s) => `- ${s}`));
        if (ins.concerns.length) lines.push('', '**Worth working on**', ...ins.concerns.map((s) => `- ${s}`));
      } else if (a.gpa) {
        lines.push(`You told me your GPA is **${fmtGpa(a.gpa)}**. ${a.gpa >= 3.7 ? 'That’s excellent; keep it steady while you take on challenging classes.' : a.gpa >= 3.3 ? 'That’s solid. An upward trend over the next terms will help even more.' : 'The best thing you can do now is build an upward trend: one strong term at a time.'}`);
        lines.push('', 'Paste your transcript in the **Transcript** tab and I can break it down by year and subject.');
      } else {
        lines.push('I don’t have your grades yet. Add your GPA in **Overview**, or paste your transcript in the **Transcript** tab.');
      }
      if (/bad grade|failing|low/i.test(text)) lines.push('', 'One low grade rarely defines an application. Talk to the teacher now about how to recover, and if something outside school affected you, a short note in the Additional Information section can give context.');
      suggestions = ['Should I take more AP classes?', 'What should I do this year?', 'How do colleges read my transcript?'];
      break;
    }
    case 'rigor': {
      const r = g?.rigor;
      if (r) lines.push(`You have **${r.ap} AP**, **${r.ib} IB**, **${r.dual} dual-enrollment**, and **${r.honors} honors** courses on your transcript.`);
      lines.push('Colleges judge rigor **in the context of what your school offers**, so your counselor’s school profile matters. A good rule: take the hardest classes you can do well in, especially in subjects tied to your intended major. Trading an A in a standard class for a B+ in AP is usually worth it; taking so many that all your grades drop is not.');
      suggestions = ['Review my stats', 'How do colleges read my transcript?', 'What should I do this year?'];
      break;
    }
    case 'testing': {
      const sat = Number(stats.sat);
      const act = Number(stats.act);
      if (sat || act) lines.push(`Your scores: ${[sat && `SAT **${sat}**`, act && `ACT **${act}**`].filter(Boolean).join(', ')}.`);
      lines.push('Policies vary: many colleges are test-optional, some are test-required again, and a few are test-blind. Check each college’s admissions site.', '', '- Submit your score if it is at or above the college’s middle 50% range.', '- Free prep: Khan Academy (SAT) and the official Bluebook practice tests.', '- Ask your counselor about **fee waivers**; eligible students get free SAT/ACT registrations.');
      suggestions = ['When should I take the SAT?', 'What should I do this year?', 'How can I pay for college?'];
      break;
    }
    case 'activities': {
      const acts = stats.activities ?? [];
      if (acts.length) {
        const top = [...acts].sort((x, y) => (Number(y.hoursPerWeek) || 0) * (Number(y.weeksPerYear) || 0) - (Number(x.hoursPerWeek) || 0) * (Number(x.weeksPerYear) || 0))[0];
        lines.push(`You listed **${acts.length} activities**. Your biggest time investment is **${top.name}**${top.role ? ` (${top.role})` : ''}.`);
      }
      lines.push('Colleges care about **depth over breadth**: commitment, growth, and impact in a few activities beat a long list of one-time clubs. Jobs, caring for siblings, and independent projects all count, so list them.', '', '**Ways to go deeper**', '- Take on a role with responsibility.', '- Start something: a project, a fundraiser, a tutoring program.', '- Measure your impact with numbers (people served, money raised, hours taught).');
      suggestions = ['How do I write activity descriptions?', 'Find a summer opportunity', 'Review my stats'];
      if (/description|describe|write/i.test(text)) {
        lines.length = 0;
        lines.push('The Common App gives you **150 characters** per activity description. Lead with strong verbs, include numbers, and skip filler.', '', '- Weak: “I was a member of the tutoring club and helped students.”', '- Strong: “Tutored 12 ESL middle schoolers weekly in math; built a vocab app now used by 3 teachers.”');
      }
      break;
    }
    case 'money':
      lines.push('**Paying for college: the essentials**', '- **FAFSA** opens October 1 for most years at studentaid.gov. File early; some aid is first-come, first-served.', '- **CSS Profile** is required by some private colleges for their own aid.', '- Every college has a **Net Price Calculator**. The sticker price is rarely what families pay.', '- **Application fee waivers** are available through the Common App and your counselor if cost is a barrier.', '- **QuestBridge** matches high-achieving, low-income students with full scholarships at partner colleges (apply in the fall of senior year).', '- Some colleges **meet 100% of demonstrated need** and are often more affordable than state schools for lower-income families.');
      if (profile?.financialNeed || stats.financialNeed) lines.push('', 'Since cost matters for you, check the **Scholarships & College Access** area on Student Atlas for free programs.');
      suggestions = ['What is QuestBridge?', 'Find scholarships', 'What should I do this year?'];
      break;
    case 'list': {
      const cs = stats.colleges ?? [];
      if (cs.length) {
        lines.push(`Your list has **${cs.length} colleges**: ${a.collegeBalance.Reach} reach, ${a.collegeBalance.Target} target, ${a.collegeBalance.Likely} likely.`);
        lines.push(...a.collegeNotes.map((n) => `- ${n}`));
      } else {
        lines.push('You haven’t added colleges yet. Add them in **Overview** and label each one reach, target, or likely.');
      }
      lines.push('', 'I can’t predict admission chances, and nobody can reliably. A useful guide: a **target** school is one where your GPA and scores sit in the middle of its admitted students; a **reach** is above your range or admits under about 20% of applicants; a **likely** is where you are above the range and it admits most applicants.');
      suggestions = ['How many colleges should I apply to?', 'Should I apply early?', 'How can I pay for college?'];
      break;
    }
    case 'recs':
      lines.push('**Asking for recommendation letters**', '- Ask two teachers from junior year core classes who know you well, ideally in the spring before senior year.', '- Ask in person, then follow up with a short “brag sheet”: your goals, favorite moments in their class, and deadlines.', '- Give at least a month’s notice and send a thank-you note.');
      suggestions = ['What should I do this year?', 'Help with my essay', 'Review my stats'];
      break;
    case 'early':
      lines.push('- **Early Decision (ED)** is binding: if admitted, you must attend. Only apply ED if it is your clear first choice and you can compare aid only with that one offer.', '- **Early Action (EA)** is non-binding and lets you hear back sooner.', '- **Restrictive Early Action** is non-binding but limits other early applications.', '', 'Early deadlines are usually November 1 or 15. If cost matters, ED can be risky because you can’t compare financial aid offers.');
      suggestions = ['How can I pay for college?', 'Review my college list', 'What should I do this year?'];
      break;
    case 'summer':
      lines.push('Great summers build a skill or show initiative: a free program, a job, research, community work, or a project you start yourself. Paid jobs are valued by colleges too.', '', 'Browse the [Student Atlas directory](/dashboard.html) for free and paid summer programs that match your profile.');
      suggestions = ['What should I do this year?', 'Review my stats', 'How do I stand out?'];
      break;
    case 'interview':
      lines.push('College interviews are usually conversational and low-stakes. Prepare three stories about things you care about, know why you want that college, and bring two genuine questions. Send a thank-you email afterward.');
      break;
    case 'major':
      lines.push(`${stats.majors ? `You listed **${stats.majors}** as possible majors. ` : ''}It’s fine to be undecided; many students change majors. Choose colleges strong in a few areas you might like, and show your curiosity through classes and activities rather than a fixed label.`);
      suggestions = ['Find opportunities in my interests', 'What should I do this year?', 'Review my stats'];
      break;
    case 'plan':
    case 'fallback': {
      if (intent === 'fallback' && text.length > 3) lines.push('Here’s where things stand and what I’d focus on next.');
      if (a.overall !== null) {
        lines.push(`**Your snapshot** (a coaching aid, not an admissions prediction):`);
        for (const ar of a.areas) lines.push(`- **${ar.label}:** ${ar.score === null ? '–' : `${ar.score}/100`} · ${ar.detail}`);
      }
      if (a.steps.length) lines.push('', '**Your next steps**', ...a.steps.map((s, i) => `${i + 1}. ${s.text}`));
      if (grade) lines.push('', `**${grade}th grade checklist**`, ...timeline(grade, now).map((t) => `- ${t}`));
      else lines.push('', 'Tell me your grade (or add it in **Overview**) and I’ll build a grade-by-grade plan.');
      suggestions = ['Help with my essay', 'Break down my transcript', 'How can I pay for college?'];
      break;
    }
    default:
      break;
  }
  return { reply: lines.join('\n'), suggestions };
}
