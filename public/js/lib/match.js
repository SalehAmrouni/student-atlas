// Explainable match scoring between a student profile and an opportunity.
// Returns a 0-100 score plus the human-readable reasons behind it, so the UI
// can show students *why* something is (or isn't) a fit.

import { financeTier, effectiveFinancialNeed, isIncomeTargeted, isFirstGenTargeted } from './finance.js';

const CAREER_KEYWORDS = {
  'Engineering': ['engineering', 'robotics', 'aerospace', 'drones', 'trades'],
  'Computer Science': ['coding', 'computer science', 'cybersecurity', 'ai', 'apps', 'algorithms', 'web development', 'data science'],
  'Medicine & Health': ['medicine', 'medical', 'biomedical', 'health', 'nursing', 'public health', 'mental health', 'pre-med'],
  'Scientific Research': ['research', 'lab', 'science fair', 'genetics', 'genomics', 'physics', 'chemistry', 'biology', 'astrophysics'],
  'Business & Finance': ['business', 'entrepreneurship', 'finance', 'investing', 'economics', 'startup', 'marketing'],
  'Law & Government': ['law', 'government', 'politics', 'policy', 'constitution', 'debate', 'elections', 'congress'],
  'Visual Arts & Design': ['visual art', 'design', 'illustration', 'painting', 'photography', 'architecture', 'portfolio', 'animation'],
  'Writing & Journalism': ['writing', 'poetry', 'journalism', 'essay', 'fiction', 'podcast', 'creative writing'],
  'Music & Performing Arts': ['music', 'orchestra', 'jazz', 'theater', 'dance', 'acting', 'performance', 'film'],
  'Education': ['teaching', 'education', 'tutoring', 'mentorship'],
  'Environment & Climate': ['environment', 'climate', 'sustainability', 'oceans', 'water', 'agriculture'],
  'Public Service': ['service', 'volunteering', 'leadership', 'military', 'national service', 'civic engagement'],
};

function keywordHits(opp, profile) {
  const haystack = `${opp.title} ${opp.description} ${opp.tags.join(' ')}`.toLowerCase();
  const hits = new Set();
  for (const goal of profile.careerGoals ?? []) {
    for (const kw of CAREER_KEYWORDS[goal] ?? []) {
      if (haystack.includes(kw)) { hits.add(goal); break; }
    }
  }
  return [...hits];
}

export function scoreOpportunity(opp, profile) {
  if (!profile) return null;
  const reasons = [];
  const warnings = [];
  let eligible = true;
  let score = 0;

  // Grade eligibility is a hard requirement.
  if (profile.grade) {
    if (opp.grades.includes(profile.grade)) reasons.push(`Open to ${profile.grade}th graders`);
    else { eligible = false; warnings.push(`Not open to ${profile.grade}th graders right now (grades ${opp.grades.join(', ')})`); }
  }

  // Interests (up to 40)
  const interests = profile.interests ?? [];
  const hits = keywordHits(opp, profile);
  if (interests.includes(opp.cluster)) {
    score += 40;
    reasons.push('Matches an interest area you picked');
  } else if (hits.length) {
    score += 26;
  } else if (!interests.length) {
    score += 18;
  } else {
    score += 6;
  }

  // Career goal keywords (up to 15)
  if (hits.length) {
    score += Math.min(15, 8 + hits.length * 4);
    reasons.push(`Connects to your goal: ${hits.slice(0, 2).join(', ')}`);
  } else if (!(profile.careerGoals ?? []).length) {
    score += 6;
  }

  // What they're looking for (up to 15)
  const lookingFor = profile.lookingFor ?? [];
  if (!lookingFor.length) score += 9;
  else if (lookingFor.includes(opp.type)) { score += 15; reasons.push(`It's a ${opp.type.toLowerCase()}, which you're looking for`); }
  else score += 2;

  // Cost vs. financial need (up to 15)
  const tier = financeTier(profile);
  if (effectiveFinancialNeed(profile)) {
    const freeOrPaid = opp.cost === 'Free' || opp.cost === 'Stipend' || opp.cost === 'Award';
    if (freeOrPaid || opp.needBased) {
      score += 15;
      reasons.push(opp.cost === 'Stipend' ? 'Pays participants' : opp.cost === 'Free' ? 'Free to participate' : opp.cost === 'Award' ? 'Awards money to winners' : 'Designed for students with financial need');
    } else if (opp.financialAid) {
      score += 9;
      reasons.push('Financial aid available');
    } else if (opp.cost === 'Fee') score += 7;
    else warnings.push('Tuition-based with no aid listed');
  } else {
    score += opp.cost === 'Stipend' || opp.cost === 'Award' ? 15 : 11;
  }

  // Income limits and first-generation focus (optional family details)
  if (isIncomeTargeted(opp)) {
    if (tier === 'low') reasons.push('Built for students from lower-income families, which matches what you shared');
    else if (tier === 'maybe') reasons.push('Built for lower-income families; you may qualify, so check the income limit');
    else if (tier === 'middle') { score -= 6; warnings.push('Usually has an income limit; check whether your family qualifies'); }
    else if (tier === 'higher') { score -= 12; warnings.push('Usually limited to lower-income families'); }
  }
  if (isFirstGenTargeted(opp)) {
    if (profile.firstGen === true) { score += 5; reasons.push('Supports first-generation college students'); }
    else if (profile.firstGen === false) warnings.push('Focused on first-generation college students');
  }

  // Format preference (up to 10)
  const fmt = profile.formatPreference ?? 'any';
  if (fmt === 'any' || opp.format === fmt || opp.format === 'Hybrid' || opp.format === 'Varies') {
    score += 10;
    if (fmt === 'Virtual' && opp.format !== 'In-person') reasons.push('Can be done online');
  } else {
    warnings.push(opp.format === 'In-person' ? 'In-person only' : 'Online only');
  }

  // GPA (up to 5); a stated minimum above the student's GPA is a hard miss.
  if (opp.minGPA === null || opp.minGPA === undefined) score += 5;
  else if (typeof profile.gpa === 'number') {
    if (profile.gpa >= opp.minGPA) { score += 5; reasons.push(`Meets the ${opp.minGPA.toFixed(1)} GPA minimum`); }
    else { eligible = false; warnings.push(`Requires a ${opp.minGPA.toFixed(1)}+ GPA`); }
  } else {
    score += 3;
    warnings.push(`Requires a ${opp.minGPA.toFixed(1)}+ GPA`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!eligible) score = Math.min(score, 35);
  return { score, eligible, reasons, warnings };
}

export function matchClass(score) {
  if (score >= 75) return 'match-high';
  if (score >= 55) return 'match-mid';
  return 'match-low';
}

/** Rank interests for the profile summary: average score per cluster. */
export function clusterAffinity(opportunities, profile) {
  const totals = {};
  for (const opp of opportunities) {
    const m = scoreOpportunity(opp, profile);
    if (!m) continue;
    totals[opp.cluster] ??= { sum: 0, n: 0, eligible: 0 };
    totals[opp.cluster].sum += m.score;
    totals[opp.cluster].n += 1;
    if (m.eligible) totals[opp.cluster].eligible += 1;
  }
  return Object.entries(totals)
    .map(([cluster, t]) => ({ cluster, average: Math.round(t.sum / t.n), eligible: t.eligible, total: t.n }))
    .sort((a, b) => b.average - a.average);
}
