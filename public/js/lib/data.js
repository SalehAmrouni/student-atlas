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

/** Months until the next typical deadline (0 = this month), or null if rolling. */
export function monthsUntilDeadline(opp, now = new Date()) {
  if (!opp.deadlineMonth) return null;
  const current = now.getMonth() + 1;
  return (opp.deadlineMonth - current + 12) % 12;
}

export function deadlineHint(opp, now = new Date()) {
  const m = monthsUntilDeadline(opp, now);
  if (m === null) return null;
  if (m === 0) return 'Usually due this month';
  if (m === 1) return 'Usually due next month';
  if (m <= 3) return `Usually due in ~${m} months`;
  return null;
}
