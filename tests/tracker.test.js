import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { sanitizeTracker, calendarItems, nextMonthKey, daysUntil, isValidDate, itemFromOpportunity } = await import('../public/js/lib/applications.js');
const { buildICS, foldLine, escapeText } = await import('../public/js/lib/ics.js');
const { financeTier, effectiveFinancialNeed, povertyLine, isIncomeTargeted } = await import('../public/js/lib/finance.js');
const { scoreOpportunity } = await import('../public/js/lib/match.js');
const { loadOpportunities } = await import('../server/opportunities.js');

const opportunities = loadOpportunities();
const byId = new Map(opportunities.map((o) => [o.id, o]));
const now = new Date(2026, 9, 15); // Oct 15, 2026

// ---------------------------------------------------------------------------
describe('application tracker model', () => {
  test('keeps valid entries and drops malformed ones', () => {
    const clean = sanitizeTracker({
      fafsa: { title: 'FAFSA', oppId: 'fafsa', status: 'submitted', deadline: '2026-11-01', events: [{ title: 'Interview', date: '2026-11-03', time: '16:30' }, { title: 'Bad', date: '2026-02-30' }], tasks: [{ text: 'Essay', done: true }, { text: '' }] },
      'custom-abc': { title: '  Local robotics camp  ', url: 'javascript:alert(1)', status: 'nope', deadline: '11/02/2026' },
      'Bad Id': { title: 'x' },
      untitled: { status: 'accepted' },
    });
    assert.deepEqual(Object.keys(clean), ['fafsa', 'custom-abc']);
    assert.equal(clean.fafsa.events.length, 1);
    assert.equal(clean.fafsa.events[0].time, '16:30');
    assert.equal(clean.fafsa.tasks.length, 1);
    const custom = clean['custom-abc'];
    assert.equal(custom.title, 'Local robotics camp');
    assert.equal(custom.url, undefined, 'non-http links are dropped');
    assert.equal(custom.status, 'interested');
    assert.equal(custom.deadline, undefined);
    assert.deepEqual(sanitizeTracker(null), {});
    assert.deepEqual(sanitizeTracker([1, 2]), {});
  });

  test('date helpers', () => {
    assert.ok(isValidDate('2028-02-29'));
    assert.ok(!isValidDate('2026-02-29'));
    assert.equal(daysUntil('2026-10-20', now), 5);
    assert.equal(daysUntil('2026-10-14', now), -1);
    assert.equal(nextMonthKey(12, now), '2026-12');
    assert.equal(nextMonthKey(3, now), '2027-03');
    assert.equal(nextMonthKey(10, now), '2026-10');
  });

  test('calendar shows exact dates for tracked items and estimates for bookmarks', () => {
    const opp = opportunities.find((o) => o.deadlineMonth);
    const saved = opportunities.filter((o) => o.deadlineMonth && o.id !== opp.id).slice(0, 2);
    const tracked = { ...itemFromOpportunity(opp, 'submitted'), deadline: '2026-11-01', decisionOn: '2027-01-15', events: [{ id: 'e1', title: 'Interview', date: '2026-11-03' }] };
    const planning = { ...itemFromOpportunity(saved[1], 'preparing') };
    const tracker = sanitizeTracker({ [opp.id]: tracked, [saved[1].id]: planning });
    const { dated, estimates } = calendarItems({ tracker, saved: [opp.id, ...saved.map((o) => o.id)], byId, now });

    assert.deepEqual(dated.map((d) => d.kind), ['deadline', 'event', 'decision']);
    assert.ok(dated.every((d) => d.source === 'applied'));
    // The tracked-and-saved opportunity isn't duplicated as an estimate.
    assert.ok(!estimates.some((e) => e.oppId === opp.id));
    const fromSaved = estimates.find((e) => e.oppId === saved[0].id);
    assert.equal(fromSaved.source, 'saved');
    assert.equal(fromSaved.month, nextMonthKey(saved[0].deadlineMonth, now));
    assert.equal(estimates.find((e) => e.oppId === saved[1].id).source, 'planning');
  });

  test('uses the exact deadline the weekly checker found, once it is known', () => {
    const opp = { ...opportunities.find((o) => o.deadlineMonth), nextDeadline: '2026-11-20' };
    const map = new Map([[opp.id, opp]]);
    const { dated, estimates } = calendarItems({ saved: [opp.id], byId: map, now });
    assert.equal(estimates.length, 0);
    assert.equal(dated[0].date, '2026-11-20');
    assert.equal(itemFromOpportunity(opp).deadline, '2026-11-20');
    const past = new Map([[opp.id, { ...opp, nextDeadline: '2026-01-05' }]]);
    assert.equal(calendarItems({ saved: [opp.id], byId: past, now }).dated.length, 0, 'a passed deadline falls back to the typical month');
  });
});

// ---------------------------------------------------------------------------
describe('calendar export (.ics)', () => {
  test('builds a valid calendar with all-day and timed events', () => {
    const ics = buildICS([
      { uid: 'a-deadline', date: '2026-12-31', title: 'Scholarship, round 1; final', remindDaysBefore: 3, url: 'https://example.org/apply' },
      { uid: 'b-event', date: '2026-11-03', time: '23:30', title: 'Interview' },
    ], { now: new Date(Date.UTC(2026, 9, 15, 12)) });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
    assert.ok(!/[^\r]\n/.test(ics), 'every line ends with CRLF');
    assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
    assert.match(ics, /SUMMARY:Scholarship\\, round 1\\; final/);
    assert.match(ics, /TRIGGER:-P3D/);
    assert.match(ics, /DTSTART:20261103T233000\r\nDTEND:20261103T235900/);
    assert.match(ics, /DTSTAMP:20261015T120000Z/);
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  });

  test('escapes text and folds long lines without splitting characters', () => {
    assert.equal(escapeText('a\\b\nc'), 'a\\\\b\\nc');
    const long = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(long);
    const encoder = new TextEncoder();
    for (const line of folded.split('\r\n')) assert.ok(encoder.encode(line).length <= 75);
    assert.equal(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long);
  });
});

// ---------------------------------------------------------------------------
describe('family finances and matching', () => {
  test('estimates the income tier from banded answers', () => {
    assert.equal(financeTier({}), null);
    assert.equal(financeTier({ incomeBand: 'lt30', householdSize: 4 }), 'low');
    assert.equal(financeTier({ incomeBand: '50-75', householdSize: 4 }), 'maybe');
    assert.equal(financeTier({ incomeBand: '75-100', householdSize: 4 }), 'middle');
    assert.equal(financeTier({ incomeBand: '150+', householdSize: 3 }), 'higher');
    assert.equal(financeTier({ incomeBand: '150+', benefits: true }), 'low', 'assistance programs signal low income');
    assert.ok(povertyLine(4, 'Alaska') > povertyLine(4, 'Texas'));
  });

  test('derives financial need unless the student answered it directly', () => {
    assert.equal(effectiveFinancialNeed({ incomeBand: 'lt30', householdSize: 3 }), true);
    assert.equal(effectiveFinancialNeed({ incomeBand: 'lt30', financialNeed: false }), false);
    assert.equal(effectiveFinancialNeed({ incomeBand: '150+' }), undefined);
  });

  test('income-limited programs rank higher for lower-income students', () => {
    const targeted = opportunities.find((o) => isIncomeTargeted(o) && o.grades.includes(11));
    assert.ok(targeted, 'the directory has income-targeted programs');
    const base = { grade: 11, interests: [targeted.cluster], householdSize: 4 };
    const low = scoreOpportunity(targeted, { ...base, incomeBand: 'lt30' });
    const high = scoreOpportunity(targeted, { ...base, incomeBand: '150+' });
    assert.ok(low.score > high.score);
    assert.ok(low.reasons.some((r) => /lower-income/.test(r)));
    assert.ok(high.warnings.some((w) => /lower-income/.test(w)));
  });
});
