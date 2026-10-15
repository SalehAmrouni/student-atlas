// Opportunities data access + shared formatting helpers.

let cache = null;

export async function loadData() {
  if (cache) return cache;
  cache = fetch('/data/opportunities.json', { headers: { Accept: 'application/json' } })
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load opportunities (${res.status})`);
      return res.json();
    })
    .then((data) => {
      const byId = new Map(data.opportunities.map((o) => [o.id, o]));
      return { ...data, byId };
    })
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}

export const COST_LABELS = {
  Free: 'Free',
  Stipend: 'Paid / stipend',
  Award: 'Award or prize money',
  Fee: 'Small fee',
  Tuition: 'Tuition',
};

export const CAREER_GOALS = [
  'Engineering', 'Computer Science', 'Medicine & Health', 'Scientific Research', 'Business & Finance',
  'Law & Government', 'Visual Arts & Design', 'Writing & Journalism', 'Music & Performing Arts',
  'Education', 'Environment & Climate', 'Public Service', 'Still exploring',
];

export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico', 'U.S. territory or abroad',
];

export function gradeLabel(grades) {
  if (!grades?.length) return 'All grades';
  const ord = (g) => `${g}th`;
  if (grades.length === 4) return 'Grades 9–12';
  const contiguous = grades.every((g, i) => i === 0 || g === grades[i - 1] + 1);
  if (contiguous && grades.length > 1) return `Grades ${grades[0]}–${grades.at(-1)}`;
  return grades.length === 1 ? `${ord(grades[0])} graders` : `Grades ${grades.join(', ')}`;
}

const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * What the weekly checker found on the official site for this cycle, or null when it found nothing:
 * { state: 'open', days, label } for an upcoming exact deadline, 'expired' once it has passed,
 * or 'closed' when the site says applications are closed.
 */
export function deadlineStatus(opp, now = new Date()) {
  if (opp.applicationsClosed) return { state: 'closed', label: 'Applications closed' };
  if (!opp.nextDeadline) return null;
  const today = localIso(now);
  if (opp.nextDeadline < today) return { state: 'expired', label: `Deadline passed (${formatDate(opp.nextDeadline)})` };
  const days = Math.round((Date.parse(opp.nextDeadline) - Date.parse(today)) / 86_400_000);
  const label = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due ${formatDate(opp.nextDeadline)}`;
  return { state: 'open', days, label };
}

/** True when this cycle's deadline has passed or the official site says applications are closed. */
export const isExpired = (opp, now = new Date()) => ['expired', 'closed'].includes(deadlineStatus(opp, now)?.state);

/**
 * Months until the next deadline (0 = this month), or null if rolling. Uses this cycle's exact
 * date when the checker found an upcoming one, otherwise the typical deadline month.
 */
export function monthsUntilDeadline(opp, now = new Date()) {
  const status = deadlineStatus(opp, now);
  if (status?.state === 'open') {
    const [y, m] = opp.nextDeadline.split('-').map(Number);
    return (y - now.getFullYear()) * 12 + (m - (now.getMonth() + 1));
  }
  if (!opp.deadlineMonth) return null;
  const current = now.getMonth() + 1;
  return (opp.deadlineMonth - current + 12) % 12;
}

export function deadlineHint(opp, now = new Date()) {
  const status = deadlineStatus(opp, now);
  if (status) return status.state === 'open' && status.days <= 120 ? status.label : null;
  const m = monthsUntilDeadline(opp, now);
  if (m === null) return null;
  if (m === 0) return 'Usually due this month';
  if (m === 1) return 'Usually due next month';
  if (m <= 3) return `Usually due in ~${m} months`;
  return null;
}
