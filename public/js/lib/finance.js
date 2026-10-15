// Optional family finance details, used only to match students with
// programs that have income limits (low-income scholarships, TRIO, QuestBridge,
// Pell-based aid). Everything here is pure, so it runs in the browser and in
// tests. Answers are banded on purpose: we never ask for an exact income.

export const INCOME_BANDS = [
  { id: 'lt30', label: 'Under $30,000', min: 0, max: 30000 },
  { id: '30-50', label: '$30,000 to $50,000', min: 30000, max: 50000 },
  { id: '50-75', label: '$50,000 to $75,000', min: 50000, max: 75000 },
  { id: '75-100', label: '$75,000 to $100,000', min: 75000, max: 100000 },
  { id: '100-150', label: '$100,000 to $150,000', min: 100000, max: 150000 },
  { id: '150+', label: 'More than $150,000', min: 150000, max: Infinity },
];
export const INCOME_BAND_IDS = INCOME_BANDS.map((b) => b.id);

export const HOUSEHOLD_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

// 2025 HHS poverty guidelines: base for one person plus each extra person.
const POVERTY_GUIDELINES = {
  default: [15650, 5500],
  Alaska: [19550, 6880],
  Hawaii: [17990, 6330],
};

export function povertyLine(householdSize, state) {
  const [base, step] = POVERTY_GUIDELINES[state] ?? POVERTY_GUIDELINES.default;
  return base + step * (Math.max(1, householdSize) - 1);
}

export const TIER_LABELS = {
  low: 'Likely qualifies for low-income programs',
  maybe: 'May qualify for some low-income programs',
  middle: 'Middle income',
  higher: 'Higher income',
};

/**
 * Estimates where a family sits relative to the income limits most need-based
 * programs use (about 200% of the poverty line for "low income", 400% for the
 * upper edge of most aid). Returns null when the student shared nothing.
 */
export function financeTier(profile) {
  if (!profile) return null;
  if (profile.benefits === true) return 'low';
  const band = INCOME_BANDS.find((b) => b.id === profile.incomeBand);
  if (!band) return null;
  const line = povertyLine(profile.householdSize ?? 4, profile.state);
  if (band.max <= 2 * line) return 'low';
  if (band.min < 2 * line) return 'maybe';
  if (band.min < 4 * line) return 'middle';
  return 'higher';
}

/** True when cost should weigh heavily: the student said so, or their family details suggest it. */
export function effectiveFinancialNeed(profile) {
  if (!profile) return undefined;
  if (typeof profile.financialNeed === 'boolean') return profile.financialNeed;
  const tier = financeTier(profile);
  return tier === 'low' || tier === 'maybe' ? true : undefined;
}

const INCOME_TAGS = ['low-income', 'pell-eligible', 'pell grant'];
/** Programs that are designed for (or limited to) students from lower-income families. */
export function isIncomeTargeted(opp) {
  return Boolean(opp.needBased) || opp.tags.some((t) => INCOME_TAGS.includes(t));
}
export function isFirstGenTargeted(opp) {
  return opp.tags.includes('first-generation');
}

export function financeSummary(profile) {
  if (!profile) return null;
  const parts = [];
  const band = INCOME_BANDS.find((b) => b.id === profile.incomeBand);
  if (band) parts.push(band.label);
  if (profile.householdSize) parts.push(`household of ${profile.householdSize}${profile.householdSize >= 8 ? '+' : ''}`);
  if (profile.benefits === true) parts.push('receives assistance');
  if (profile.firstGen === true) parts.push('first-generation');
  return parts.length ? parts.join(', ') : null;
}
