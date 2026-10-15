// Zeus Counselor Insights: a 10-second read on how a student is doing and what
// support they need, plus on-device strategy answers for the counselor chat.
// Pure (no DOM or storage): the server uses it for roster summaries and the
// teacher dashboard uses it for the full panel. It only ever sees what the
// student shares with their room (see sharedView in server/accounts).

import { milestoneProgress, sanitizePortfolio, goalLabel } from './portfolio.js';
import { financeTier, effectiveFinancialNeed } from './finance.js';

const APPLIED = ['submitted', 'interview', 'waitlisted', 'accepted', 'rejected'];
const PLANNING = ['interested', 'preparing'];
const FREE_COSTS = ['Free', 'Stipend', 'Award'];
const DAY = 86_400_000;

export const SUPPORTS = {
  'financial-aid': { label: 'Financial aid & fee waivers', tone: 'warn' },
  fafsa: { label: 'FAFSA not done', tone: 'warn' },
  overdue: { label: 'Missed a deadline', tone: 'danger' },
  'due-soon': { label: 'Deadline within 2 weeks', tone: 'warn' },
  'no-apps': { label: 'No applications yet', tone: 'info' },
  'first-gen': { label: 'First-generation', tone: 'info' },
  hardship: { label: 'Shared a hardship', tone: 'info' },
  'early-grad': { label: 'Graduating early', tone: 'info' },
  'test-prep': { label: 'No test prep yet', tone: 'info' },
  'no-activities': { label: 'No activities listed', tone: 'info' },
  inactive: { label: 'Inactive 30+ days', tone: 'warn' },
  'no-goal': { label: 'No post–high school goal', tone: 'info' },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const grades = { 9: '9th', 10: '10th', 11: '11th', 12: '12th' };

/**
 * @param {object} shared  { profile, saved, tracker, portfolio, stats, lastActive }
 * @param {{ byId?: Map<string, object>, now?: Date }} [opts]
 */
export function counselorInsights(shared, { byId = new Map(), now = new Date() } = {}) {
  const profile = isObj(shared?.profile) ? shared.profile : {};
  const stats = isObj(shared?.stats) ? shared.stats : {};
  const portfolio = sanitizePortfolio(shared?.portfolio);
  const saved = Array.isArray(shared?.saved) ? shared.saved.filter((x) => typeof x === 'string') : [];
  const tracker = isObj(shared?.tracker) ? Object.values(shared.tracker).filter(isObj) : [];
  const grade = [9, 10, 11, 12].includes(profile.grade) ? profile.grade : ([9, 10, 11, 12].includes(stats.grade) ? stats.grade : null);
  const firstGen = profile.firstGen === true;
  const progress = milestoneProgress(portfolio, { grade, firstGen });
  const activities = (Array.isArray(stats.activities) ? stats.activities : []).filter((a) => isObj(a) && a.name);

  const applied = tracker.filter((i) => APPLIED.includes(i.status));
  const accepted = tracker.filter((i) => i.status === 'accepted');
  const planning = tracker.filter((i) => PLANNING.includes(i.status));
  const dated = planning.filter((i) => typeof i.deadline === 'string')
    .map((i) => ({ i, days: Math.round((new Date(`${i.deadline}T12:00:00`) - now) / DAY) }));
  const overdue = dated.filter((d) => d.days < 0);
  const dueSoon = dated.filter((d) => d.days >= 0 && d.days <= 14).sort((a, b) => a.days - b.days);

  // A student who mostly saves free, paid, or award programs is telling us cost matters.
  const savedOpps = saved.map((id) => byId.get(id)).filter(Boolean);
  const freeShare = savedOpps.length ? savedOpps.filter((o) => FREE_COSTS.includes(o.cost) || o.needBased).length / savedOpps.length : 0;
  const tier = financeTier(profile);
  const aidSignals = [
    effectiveFinancialNeed(profile) === true && 'said cost is a big factor',
    portfolio.insight.aidFocus && 'is prioritizing financial aid',
    (tier === 'low' || tier === 'maybe') && 'family finances suggest need-based aid',
    savedOpps.length >= 3 && freeShare >= 0.6 && `${Math.round(freeShare * 100)}% of saved programs are free or paid`,
  ].filter(Boolean);

  const lastActive = Number(shared?.lastActive) || null;
  const idleDays = lastActive ? Math.floor((now - lastActive) / DAY) : null;

  const flags = [];
  const detail = {};
  const flag = (id, text) => { flags.push(id); detail[id] = text; };
  if (overdue.length) flag('overdue', `${overdue.length} planned application${overdue.length === 1 ? '' : 's'} past the deadline (${overdue.map((d) => d.i.title).slice(0, 2).join(', ')}).`);
  if (dueSoon.length) flag('due-soon', `${dueSoon[0].i.title} is due in ${dueSoon[0].days} day${dueSoon[0].days === 1 ? '' : 's'}${dueSoon.length > 1 ? `, plus ${dueSoon.length - 1} more soon` : ''}.`);
  if (aidSignals.length) flag('financial-aid', `Likely needs financial aid or fee-waiver guidance: ${aidSignals.join('; ')}.`);
  if (grade === 12 && !progress.has('fafsa') && !['military', 'workforce'].includes(portfolio.goal)) flag('fafsa', 'Hasn’t checked off the FAFSA.');
  if (grade >= 11 && !applied.length && tracker.length < 2) flag('no-apps', 'Hasn’t submitted any tracked applications yet.');
  if (firstGen) flag('first-gen', 'First in their family to go to college: walk through each step explicitly.');
  if (portfolio.insight.share && portfolio.insight.obstacles) flag('hardship', 'Shared a hardship in their profile that could support an advocacy note.');
  if (portfolio.paths.earlyGrad) flag('early-grad', 'Wants to graduate early: confirm their credit plan.');
  if (grade === 11 && (!portfolio.goal || portfolio.goal === 'four-year') && !progress.has('khan-sat') && !progress.has('sat-act') && !stats.sat && !stats.act) flag('test-prep', 'No SAT/ACT prep or scores yet.');
  if (!activities.length && grade && grade >= 10) flag('no-activities', 'No extracurriculars listed.');
  if (idleDays !== null && idleDays >= 30) flag('inactive', `Last active ${idleDays} days ago.`);
  if (!portfolio.goal && grade && grade >= 10) flag('no-goal', 'Hasn’t picked a post–high school goal.');

  // Progress score: milestones, applications, activities, and a filled-in profile.
  const milestonePart = progress.total ? progress.done / progress.total : 0;
  const appPart = grade >= 11 ? Math.min(1, (applied.length + planning.length * 0.4) / 4) : Math.min(1, (saved.length + tracker.length) / 5);
  const activityPart = Math.min(1, activities.length / 3);
  const profilePart = [profile.interests?.length, portfolio.goal, stats.gpa ?? profile.gpa, activities.length].filter(Boolean).length / 4;
  let score = Math.round(100 * (0.4 * milestonePart + 0.3 * appPart + 0.15 * activityPart + 0.15 * profilePart));
  if (overdue.length) score = Math.max(0, score - 10);
  const status = flags.includes('overdue') || flags.includes('inactive') || (score < 35 && grade >= 11) ? 'needs-support'
    : score >= 65 ? 'on-track' : 'getting-started';

  const strengths = [
    accepted.length && `${accepted.length} acceptance${accepted.length === 1 ? '' : 's'}`,
    applied.length && `${applied.length} application${applied.length === 1 ? '' : 's'} sent`,
    progress.done && `${progress.done} of ${progress.total} milestones done`,
    activities.some((a) => a.leadership || a.role) && 'holds a leadership role',
    (stats.gpa ?? profile.gpa) >= 3.5 && `GPA ${Number(stats.gpa ?? profile.gpa).toFixed(2)}`,
    experienceHours(portfolio) >= 50 && 'substantial work or volunteer hours',
  ].filter(Boolean);

  const statusWord = { 'on-track': 'on track', 'getting-started': 'getting started', 'needs-support': 'needs support' }[status];
  const top = flags.filter((f) => ['overdue', 'due-soon', 'financial-aid', 'fafsa', 'no-apps', 'inactive'].includes(f))[0] ?? flags[0];
  const summary = [
    `${grade ? `${grades[grade]} grader` : 'Student'}${portfolio.goal ? ` aiming for ${goalLabel(portfolio.goal).toLowerCase()}` : ''}, ${statusWord}.`,
    `${progress.done}/${progress.total} milestones, ${saved.length} saved, ${tracker.length} tracked, ${applied.length} applied.`,
    top ? `Main need: ${SUPPORTS[top].label.toLowerCase()}.` : 'No urgent needs flagged.',
  ].join(' ');

  return {
    score,
    status,
    summary,
    flags,
    detail,
    strengths,
    counts: { saved: saved.length, tracked: tracker.length, applied: applied.length, accepted: accepted.length, milestonesDone: progress.done, milestonesTotal: progress.total, activities: activities.length },
    grade,
    goal: portfolio.goal ?? null,
    nextDeadline: dueSoon[0] ? { title: dueSoon[0].i.title, days: dueSoon[0].days } : null,
  };
}

function experienceHours(portfolio) {
  return portfolio.experiences.reduce((sum, e) => sum + (Number.parseInt(String(e.hours ?? '').replace(/[^\d]/g, ''), 10) || 0), 0);
}

// ---- Counselor strategy chat (on-device fallback) -------------------------------
const STRATEGIES = {
  'financial-aid': [
    'Walk through the **net price calculator** for two of their colleges together, so the sticker price stops being scary.',
    'Check fee-waiver eligibility (free/reduced lunch qualifies for the College Board and NACAC waivers) and request them before the first deadline.',
    'Point them to **QuestBridge**, Pell-eligible scholarships, and fully funded summer programs; filter Student Atlas for free and paid programs.',
  ],
  fafsa: [
    'Book a 45-minute FAFSA session with the student and a parent or guardian; have them create StudentAid.gov accounts beforehand.',
    'If the family has a complicated situation (independent student, unusual income), connect them with your financial aid office or a FAFSA night.',
  ],
  overdue: [
    'Ask whether the program accepts late applications or has a second round; many do if you email the coordinator.',
    'Pick one similar program with a later deadline from their saved list and set a date to submit it.',
  ],
  'due-soon': [
    'Break the next application into its remaining steps and schedule the hardest one (essay or recommendation) first.',
    'Offer to read their short answers in a 10-minute check-in before the deadline.',
  ],
  'no-apps': [
    'Help them choose two low-barrier applications (a local program and a scholarship) to build momentum.',
    'Set a mini-deadline a week ahead of the real one and check in that day.',
  ],
  'first-gen': [
    'Explain the jargon (EA/ED, CSS, award letters) in plain words and give them a one-page timeline.',
    'Invite a family member to a short meeting so the household knows what is coming and why it matters.',
    'Look at programs built for first-gen students (QuestBridge, first-gen summer bridges, TRIO Upward Bound).',
  ],
  hardship: [
    'Ask (privately) whether they want you to mention their circumstances in your counselor letter, and how they want it described.',
    'Check whether the Common App’s additional-information section or a fee waiver applies.',
  ],
  'early-grad': [
    'Audit their transcript against graduation requirements and map the remaining credits by term.',
    'Discuss timing for college or job applications, since they will apply a year earlier than classmates.',
  ],
  'test-prep': [
    'Set them up with free Khan Academy SAT practice linked to their PSAT scores; 20 minutes, 3 times a week is plenty to start.',
    'Remind them many colleges are test-optional, so the test should support their plan, not stall it.',
  ],
  'no-activities': [
    'Help them see what already counts: jobs, caring for siblings, faith groups, and independent projects are all activities.',
    'Suggest one club or service opportunity tied to their interests and a first step this week.',
  ],
  inactive: [
    'A short, friendly check-in usually works better than a reminder email; ask what is getting in the way.',
    'Give them one 10-minute task to restart momentum, like updating their milestone checklist.',
  ],
  'no-goal': [
    'Ask what a good day at work looks like to them and map it to two or three paths (college, trade, military, workforce).',
    'Have them take the Pathway Wizard again and pick a goal in My Story so Student Atlas can tailor their plan.',
  ],
};

const TOPICS = [
  { re: /\b(aid|money|afford|cost|fee|waiver|scholarship|pay|financ)/i, flags: ['financial-aid', 'fafsa'] },
  { re: /\bfafsa|css\b/i, flags: ['fafsa', 'financial-aid'] },
  { re: /\b(first[- ]?gen|parent|family)/i, flags: ['first-gen'] },
  { re: /\b(deadline|late|behind|missed|overdue|due)/i, flags: ['overdue', 'due-soon', 'no-apps'] },
  { re: /\b(motivat|engag|stress|overwhelm|disengag|inactive|checked out)/i, flags: ['inactive', 'no-apps'] },
  { re: /\b(sat|act|test|psat|score)/i, flags: ['test-prep'] },
  { re: /\b(extracurricular|activit|club|resume|involv)/i, flags: ['no-activities'] },
  { re: /\b(letter|recommend|advocat|hardship)/i, flags: ['hardship', 'first-gen'] },
  { re: /\b(early|graduat)/i, flags: ['early-grad'] },
  { re: /\b(goal|career|path|direction|major)/i, flags: ['no-goal'] },
];

/**
 * Strategy ideas for a counselor's question about one student, from the
 * student's insights. Returns { reply (Markdown), suggestions }.
 */
export function counselorReply(question, insights) {
  const q = String(question ?? '');
  const own = new Set(insights?.flags ?? []);
  const topic = TOPICS.find((t) => t.re.test(q));
  let picks = topic ? topic.flags : [...own];
  if (/\b(meeting|1-on-1|one on one|walk in|brief|prep|summary)\b/i.test(q) || !picks.length) picks = [...own];
  picks = picks.filter((f) => STRATEGIES[f]).slice(0, 3);

  const lines = [];
  if (/\b(meeting|1-on-1|one on one|walk in|brief|prep|summary)\b/i.test(q) || !topic) {
    lines.push(`**Quick brief:** ${insights?.summary ?? 'No profile details shared yet.'}`);
    if (insights?.strengths?.length) lines.push(`**Going well:** ${insights.strengths.join(', ')}.`);
  }
  if (!picks.length) {
    lines.push('Nothing urgent stands out. Good next moves: celebrate recent progress, confirm their goal for after high school, and pick the next milestone together.');
  } else {
    for (const f of picks) {
      const relevant = own.has(f);
      lines.push(`**${SUPPORTS[f].label}**${relevant && insights?.detail?.[f] ? ` (${insights.detail[f]})` : relevant ? '' : ' (general idea)'}`);
      for (const s of STRATEGIES[f].slice(0, relevant ? 3 : 2)) lines.push(`- ${s}`);
    }
  }
  lines.push('', '_On-device suggestions based on what this student shared. Use your professional judgment._');
  return {
    reply: lines.join('\n'),
    suggestions: ['How do I prep for a surprise 1-on-1?', 'What financial aid help fits them?', 'How can I re-engage this student?'],
  };
}
