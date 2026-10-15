// "My Story" portfolio and milestone checklist: the expanded profile a student
// fills in over time, how Zeus tailors it to the student's path, and the
// checklist nudges Zeus shows in the College Lab. Pure (no DOM or storage),
// so it runs in the browser, on the server (counselor summaries), and in tests.

import { effectiveFinancialNeed } from './finance.js';

export const GOALS = [
  { id: 'four-year', label: '4-year college' },
  { id: 'two-year', label: '2-year college' },
  { id: 'trade', label: 'Trade or technical school' },
  { id: 'military', label: 'Military' },
  { id: 'workforce', label: 'Workforce' },
];
export const GOAL_IDS = GOALS.map((g) => g.id);
export const goalLabel = (id) => GOALS.find((g) => g.id === id)?.label;

export const PATHS = [
  { id: 'earlyGrad', label: 'Wants to graduate early' },
  { id: 'dualEnrollment', label: 'Enrolled in dual enrollment' },
  { id: 'firstGen', label: 'First-generation college student' },
];

export const KHAN_SAT_URL = 'https://www.khanacademy.org/digital-sat';
export const FAFSA_URL = 'https://studentaid.gov/h/apply-for-aid/fafsa';

/**
 * Milestones by grade. `goals` limits a milestone to some paths; `paths`
 * limits it to students who checked a special path.
 */
export const MILESTONES = [
  { id: 'meet-counselor', grade: 9, text: 'Met my school counselor' },
  { id: 'four-year-plan', grade: 9, text: 'Made a four-year course plan' },
  { id: 'join-activity', grade: 9, text: 'Joined at least one club, team, or activity' },
  { id: 'log-service', grade: 9, text: 'Started logging volunteer hours' },
  { id: 'early-grad-plan', grade: 9, paths: ['earlyGrad'], text: 'Checked my credits with my counselor for a graduate-early plan' },
  { id: 'psat-10', grade: 10, text: 'Took the PSAT 10 or a practice test', goals: ['four-year', 'two-year'] },
  { id: 'bigger-role', grade: 10, text: 'Took on a bigger role in an activity' },
  { id: 'summer-plan', grade: 10, text: 'Applied to a summer program, job, or internship' },
  { id: 'career-chat', grade: 10, text: 'Shadowed or interviewed someone in a career I like' },
  { id: 'dual-credit', grade: 10, text: 'Looked into dual-enrollment or community college classes', goals: ['two-year', 'four-year', 'trade'] },
  { id: 'psat-nmsqt', grade: 11, text: 'Took the PSAT/NMSQT in the fall', goals: ['four-year'] },
  { id: 'khan-sat', grade: 11, text: 'Started free SAT practice on Khan Academy', goals: ['four-year'], link: KHAN_SAT_URL },
  { id: 'sat-act', grade: 11, text: 'Took the SAT or ACT', goals: ['four-year'] },
  { id: 'asvab', grade: 11, text: 'Took the ASVAB', goals: ['military'] },
  { id: 'recruiter', grade: 11, text: 'Talked with a recruiter, with a parent or counselor', goals: ['military'] },
  { id: 'trade-visit', grade: 11, text: 'Toured a trade school or apprenticeship program', goals: ['trade'] },
  { id: 'cert-plan', grade: 11, text: 'Picked a certification to work toward', goals: ['trade', 'workforce'] },
  { id: 'resume', grade: 11, text: 'Wrote a resume', goals: ['workforce', 'trade', 'military'] },
  { id: 'college-list', grade: 11, text: 'Started a college list', goals: ['four-year', 'two-year'] },
  { id: 'campus-visit', grade: 11, text: 'Visited a campus, in person or virtually', goals: ['four-year', 'two-year', 'trade'] },
  { id: 'rec-ask', grade: 11, text: 'Asked two teachers about recommendation letters', goals: ['four-year'] },
  { id: 'essay-draft', grade: 11, text: 'Drafted a personal essay', goals: ['four-year'] },
  { id: 'fafsa', grade: 12, text: 'Filled out the FAFSA', goals: ['four-year', 'two-year', 'trade'], link: FAFSA_URL },
  { id: 'css-profile', grade: 12, text: 'Filled out the CSS Profile, if my colleges need it', goals: ['four-year'] },
  { id: 'fee-waivers', grade: 12, text: 'Asked about application fee waivers', goals: ['four-year', 'two-year'] },
  { id: 'apps-submitted', grade: 12, text: 'Submitted my applications', goals: ['four-year', 'two-year', 'trade'] },
  { id: 'scholarships', grade: 12, text: 'Applied to at least three scholarships', goals: ['four-year', 'two-year', 'trade'] },
  { id: 'job-apps', grade: 12, text: 'Applied to jobs or apprenticeships', goals: ['workforce', 'trade'] },
  { id: 'meps', grade: 12, text: 'Scheduled my enlistment physical (MEPS)', goals: ['military'] },
  { id: 'compare-aid', grade: 12, text: 'Compared financial aid offers', goals: ['four-year', 'two-year', 'trade'] },
  { id: 'decide', grade: 12, text: 'Made my decision for after graduation' },
];
const MILESTONE_IDS = new Set(MILESTONES.map((m) => m.id));

const MAX_CUSTOM = 20;
const MAX_EXPERIENCES = 10;

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function emptyPortfolio() {
  return { goal: undefined, paths: {}, experiences: [], certifications: undefined, insight: { words: [], share: false }, milestones: { done: [], custom: [] } };
}

/** Validates everything read back from storage or the network. */
export function sanitizePortfolio(raw) {
  const p = isObj(raw) ? raw : {};
  const insight = isObj(p.insight) ? p.insight : {};
  const ms = isObj(p.milestones) ? p.milestones : {};
  return {
    goal: GOAL_IDS.includes(p.goal) ? p.goal : undefined,
    paths: {
      earlyGrad: p.paths?.earlyGrad === true || undefined,
      dualEnrollment: p.paths?.dualEnrollment === true || undefined,
    },
    experiences: (Array.isArray(p.experiences) ? p.experiences : []).filter(isObj).slice(0, MAX_EXPERIENCES).map((e) => ({
      org: str(e.org, 100),
      role: str(e.role, 80),
      hours: str(e.hours, 40),
      accomplishment: str(e.accomplishment, 400),
    })),
    certifications: str(p.certifications, 300),
    insight: {
      words: (Array.isArray(insight.words) ? insight.words : []).slice(0, 3).map((w) => str(w, 30) ?? ''),
      proudest: str(insight.proudest, 600),
      obstacles: str(insight.obstacles, 1500),
      aidFocus: insight.aidFocus === true || undefined,
      // Section 4 is only visible to a teacher when the student turns this on.
      share: insight.share === true,
    },
    milestones: {
      done: [...new Set((Array.isArray(ms.done) ? ms.done : []).filter((id) => MILESTONE_IDS.has(id)))],
      custom: (Array.isArray(ms.custom) ? ms.custom : []).filter((c) => isObj(c) && str(c.text, 120)).slice(0, MAX_CUSTOM)
        .map((c) => ({ id: str(c.id, 40) ?? `c-${Math.random().toString(36).slice(2, 9)}`, text: str(c.text, 120), done: c.done === true })),
    },
  };
}

/** Lab activities (shared with the College Lab) with the extra My Story fields. */
export function sanitizeActivities(list) {
  return (Array.isArray(list) ? list : []).filter(isObj).slice(0, 10).map((a) => ({
    ...a,
    name: str(a.name, 80) ?? '',
    role: str(a.role, 80),
    description: str(a.description, 300),
    years: (Array.isArray(a.years) ? a.years : []).filter((y) => [9, 10, 11, 12].includes(y)),
  }));
}

/** Milestones that apply to this student, current grade and earlier. */
export function milestonesFor({ grade, goal, paths = {} } = {}) {
  const g = num(grade, 9, 12) ?? 9;
  return MILESTONES.filter((m) => m.grade <= g
    && (!m.goals || !goal || m.goals.includes(goal))
    && (!m.paths || m.paths.some((p) => paths[p])));
}

export function milestoneProgress(portfolio, { grade, firstGen } = {}) {
  const p = sanitizePortfolio(portfolio);
  const list = milestonesFor({ grade, goal: p.goal, paths: { ...p.paths, firstGen } });
  const done = new Set(p.milestones.done);
  const customDone = p.milestones.custom.filter((c) => c.done).length;
  return {
    list,
    done: list.filter((m) => done.has(m.id)).length + customDone,
    total: list.length + p.milestones.custom.length,
    gradeDone: list.filter((m) => m.grade === grade && done.has(m.id)).length,
    gradeTotal: list.filter((m) => m.grade === grade).length,
    has: (id) => done.has(id),
  };
}

const GRADE_NAMES = { 9: 'freshman', 10: 'sophomore', 11: 'junior', 12: 'senior' };

/**
 * How Zeus tailors My Story to the student: which fields show, what they're
 * called, and a short note explaining why. Returns plain data for the UI.
 */
export function tailorPortfolio({ portfolio, profile = {}, stats = {} } = {}) {
  const p = sanitizePortfolio(portfolio);
  const goal = p.goal;
  const grade = num(profile?.grade, 9, 12);
  const aidLikely = effectiveFinancialNeed(profile) === true || p.insight.aidFocus;
  const notes = [];

  const tests = { show: true, note: 'Optional. Many colleges are test-optional, but a strong score can still help with merit scholarships.' };
  let asvab = false;
  let certifications = null;
  let experienceTitle = 'Work, internships & volunteering';
  let activitiesHint = 'Clubs, sports, jobs, family responsibilities, and independent projects all count.';

  if (goal === 'military') {
    asvab = true;
    tests.note = 'Optional for enlisting. Service academies and ROTC scholarships do look at the SAT or ACT.';
    experienceTitle = 'Work, service & JROTC';
    activitiesHint = 'JROTC, sports, and anything that shows leadership and fitness count a lot here.';
    notes.push('I added an ASVAB score and put leadership and fitness up front for your military path.');
  } else if (goal === 'trade') {
    tests.show = false;
    certifications = { label: 'Certifications & shop classes', placeholder: 'e.g. OSHA 10, CTE welding I and II' };
    experienceTitle = 'Hands-on work, apprenticeships & volunteering';
    notes.push('Trade programs care about hands-on skills, so I swapped test scores for certifications.');
  } else if (goal === 'workforce') {
    tests.show = false;
    certifications = { label: 'Skills & certifications', placeholder: 'e.g. ServSafe, Microsoft Office Specialist, CPR' };
    experienceTitle = 'Jobs, internships & volunteering';
    notes.push('Employers look at skills and work history, so those come first and test scores are hidden.');
  } else if (goal === 'two-year') {
    tests.note = 'Most community colleges don’t require these, but they can help you skip placement tests.';
    notes.push('Community colleges rarely need test scores, so I marked them optional and highlighted dual enrollment.');
  } else if (goal === 'four-year') {
    notes.push('Four-year colleges read your activities and personal insight closely, so take your time on those sections.');
  } else {
    notes.push('Pick a post–high school goal and I’ll tailor these sections to it.');
  }

  if (grade && grade <= 10) notes.push(`As a ${GRADE_NAMES[grade]}, fill in what you have so far. This grows with you.`);
  if (aidLikely && !p.insight.aidFocus) notes.push('You said cost matters, so consider checking “Financial aid focus” in Personal insight.');
  if (profile?.firstGen) notes.push('As a first-generation student, your story and obstacles section can help a counselor advocate for you.');

  return {
    note: notes.join(' '),
    academics: {
      tests,
      asvab,
      certifications,
      majorsLabel: goal === 'military' ? 'Top 3 career fields or jobs (MOS)' : goal === 'trade' || goal === 'workforce' ? 'Top 3 careers or trades' : 'Top 3 intended majors or careers',
      majorsPlaceholder: goal === 'trade' ? 'e.g. Electrician' : goal === 'military' ? 'e.g. Aviation mechanic' : 'e.g. Biology',
      dualEnrollmentFirst: goal === 'two-year',
    },
    activities: { hint: activitiesHint },
    experience: { title: experienceTitle },
    insight: {
      proudestLabel: grade && grade <= 10 ? 'Proudest high school achievement so far' : 'Proudest high school achievement',
      suggestAidFocus: Boolean(aidLikely),
    },
    hasStats: Boolean(stats?.gpa || stats?.sat || stats?.act),
  };
}

const daysBetween = (a, b) => Math.round((a - b) / 86_400_000);

/**
 * Short, friendly checklist nudges Zeus shows in the College Lab. Looks at the
 * milestone checklist, profile, and tracker and returns up to `max` nudges.
 */
export function checklistNudges({ portfolio, profile = {}, stats = {}, tracker = {}, now = new Date(), max = 3 } = {}) {
  const p = sanitizePortfolio(portfolio);
  const grade = num(profile?.grade ?? stats?.grade, 9, 12);
  const firstGen = profile?.firstGen === true;
  const prog = milestoneProgress(p, { grade, firstGen });
  const has = prog.has;
  const month = now.getMonth() + 1;
  const items = Object.values(tracker ?? {});
  const out = [];
  const add = (priority, id, text, action) => out.push({ priority, id, text, action });

  if (!grade) {
    add(1, 'set-grade', 'Tell me your grade in My Pathway and I’ll build a milestone checklist for you.', { label: 'Open My Pathway', href: '/profile.html#milestones' });
    return out.slice(0, max);
  }

  const gradeWord = { 9: 'freshman', 10: 'sophomore', 11: 'junior', 12: 'senior' }[grade];
  if (grade === 11 && (!p.goal || p.goal === 'four-year') && !has('khan-sat') && !has('sat-act')) {
    const n = prog.gradeDone;
    add(n >= 3 ? 1 : 3, 'khan-sat',
      n >= 1
        ? `Hey, I noticed you have ${n} junior year milestone${n === 1 ? '' : 's'} checked off, but you haven’t opened Khan Academy yet. Want a quick link to a free SAT practice test?`
        : 'Junior year is a great time to start free SAT practice on Khan Academy. Want the link?',
      { label: 'Open free SAT practice', href: KHAN_SAT_URL, external: true });
  }
  if (grade === 12 && !has('fafsa') && p.goal !== 'military' && p.goal !== 'workforce' && (month >= 10 || month <= 6)) {
    add(1, 'fafsa', 'The FAFSA is open and some aid is first come, first served. It takes about an hour with a parent or guardian.', { label: 'Start the FAFSA', href: FAFSA_URL, external: true });
  }
  if (grade === 12 && (effectiveFinancialNeed(profile) || p.insight.aidFocus) && !has('fee-waivers') && (!p.goal || ['four-year', 'two-year'].includes(p.goal))) {
    add(2, 'fee-waivers', 'Since cost matters to you, ask your counselor for application fee waivers. Many students qualify and most colleges accept them.', null);
  }
  const dueSoon = items.filter((i) => ['interested', 'preparing'].includes(i.status) && i.deadline)
    .map((i) => ({ i, d: daysBetween(new Date(`${i.deadline}T12:00:00`), now) }))
    .filter(({ d }) => d >= 0 && d <= 14)
    .sort((a, b) => a.d - b.d);
  if (dueSoon.length) {
    const { i, d } = dueSoon[0];
    add(1, 'due-soon', `${i.title} is due ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}. Want to knock out one step from its checklist now?`, { label: 'Open my applications', href: '/tracker.html' });
  }
  if (p.paths.earlyGrad && !has('early-grad-plan')) {
    add(2, 'early-grad', 'You want to graduate early. Book a quick meeting with your counselor to confirm your credits add up.', { label: 'See my milestones', href: '/profile.html#milestones' });
  }
  if (p.goal === 'military' && grade >= 11 && !has('asvab')) {
    add(2, 'asvab', 'Your school may offer the ASVAB for free. Ask your counselor when the next test date is.', null);
  }
  if (grade >= 11 && (!p.goal || ['four-year', 'two-year'].includes(p.goal)) && !has('college-list') && !(stats?.colleges ?? []).some((c) => c?.name)) {
    add(3, 'college-list', 'You haven’t started a college list yet. Add three schools (a reach, a target, and a likely) to get going.', { label: 'Add colleges', href: '/college-lab.html#overview' });
  }
  const submitted = items.filter((i) => ['submitted', 'interview', 'waitlisted', 'accepted'].includes(i.status)).length;
  if (submitted >= 1 && out.length < max) {
    add(4, 'cheer', `You’ve sent ${submitted} application${submitted === 1 ? '' : 's'}. That’s real progress, keep going!`, null);
  }
  if (!prog.done) {
    add(3, 'start', `Your ${gradeWord} checklist is ready. Check off anything you’ve already done to see what’s next.`, { label: 'Open my checklist', href: '/profile.html#milestones' });
  }
  return out.sort((a, b) => a.priority - b.priority).slice(0, max);
}
