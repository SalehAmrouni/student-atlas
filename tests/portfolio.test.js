import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../public/js/lib/portfolio.js');
const { counselorInsights, counselorReply } = await import('../public/js/lib/insights.js');
const C = await import('../public/js/lib/room-crypto.js');

const OCT = new Date('2026-10-15T12:00:00');

describe('My Story portfolio', () => {
  test('sanitizes unknown or oversized input', () => {
    const p = P.sanitizePortfolio({ goal: 'astronaut', milestones: { done: ['fafsa', 'nope', 'fafsa'] }, insight: { words: ['a', 'b', 'c', 'd'], obstacles: 'x'.repeat(5000), share: 'yes' }, experiences: [{ org: 'Hospital', hours: 50 }] });
    assert.equal(p.goal, undefined);
    assert.deepEqual(p.milestones.done, ['fafsa']);
    assert.equal(p.insight.words.length, 3);
    assert.equal(p.insight.obstacles.length, 1500);
    assert.equal(p.insight.share, false);
    assert.equal(p.experiences[0].hours, undefined);
  });

  test('Zeus tailors sections to the student’s path', () => {
    const military = P.tailorPortfolio({ portfolio: { goal: 'military' }, profile: { grade: 11 } });
    assert.equal(military.academics.asvab, true);
    assert.match(military.note, /ASVAB/);
    const trade = P.tailorPortfolio({ portfolio: { goal: 'trade' } });
    assert.equal(trade.academics.tests.show, false);
    assert.match(trade.academics.certifications.label, /Certifications/);
    const freshman = P.tailorPortfolio({ portfolio: { goal: 'four-year' }, profile: { grade: 9, financialNeed: true } });
    assert.match(freshman.insight.proudestLabel, /so far/);
    assert.equal(freshman.insight.suggestAidFocus, true);
  });

  test('milestones depend on grade, goal, and special paths', () => {
    const junior = P.milestonesFor({ grade: 11, goal: 'four-year' }).map((m) => m.id);
    assert.ok(junior.includes('khan-sat'));
    assert.ok(!junior.includes('fafsa'));
    assert.ok(!junior.includes('asvab'));
    assert.ok(P.milestonesFor({ grade: 11, goal: 'military' }).some((m) => m.id === 'asvab'));
    assert.ok(P.milestonesFor({ grade: 9, paths: { earlyGrad: true } }).some((m) => m.id === 'early-grad-plan'));
  });

  test('Zeus notices a junior who has done milestones but not SAT practice', () => {
    const nudges = P.checklistNudges({
      portfolio: { goal: 'four-year', milestones: { done: ['college-list', 'campus-visit', 'rec-ask'] } },
      profile: { grade: 11 }, now: OCT,
    });
    assert.equal(nudges[0].id, 'khan-sat');
    assert.match(nudges[0].text, /3 junior year milestones checked off, but you haven’t opened Khan Academy/);
    assert.equal(nudges[0].action.href, P.KHAN_SAT_URL);
  });

  test('Zeus nudges seniors about the FAFSA and fee waivers', () => {
    const ids = P.checklistNudges({ portfolio: { goal: 'four-year' }, profile: { grade: 12, financialNeed: true }, now: OCT }).map((n) => n.id);
    assert.ok(ids.includes('fafsa'));
    assert.ok(ids.includes('fee-waivers'));
    const done = P.checklistNudges({ portfolio: { goal: 'four-year', milestones: { done: ['fafsa'] } }, profile: { grade: 12 }, now: OCT }).map((n) => n.id);
    assert.ok(!done.includes('fafsa'));
  });
});

describe('Zeus Counselor Insights', () => {
  const byId = new Map([
    ['free-1', { id: 'free-1', cost: 'Free' }],
    ['free-2', { id: 'free-2', cost: 'Stipend' }],
    ['free-3', { id: 'free-3', cost: 'Award' }],
    ['paid', { id: 'paid', cost: 'Tuition' }],
  ]);

  test('flags a student who mostly saves free programs as needing aid guidance', () => {
    const ins = counselorInsights({ profile: { grade: 11 }, saved: ['free-1', 'free-2', 'free-3', 'paid'] }, { byId, now: OCT });
    assert.ok(ins.flags.includes('financial-aid'));
    assert.match(ins.detail['financial-aid'], /75% of saved programs/);
  });

  test('summarizes a senior who is behind in about ten seconds of reading', () => {
    const ins = counselorInsights({
      profile: { grade: 12, firstGen: true },
      tracker: { a: { title: 'State Scholarship', status: 'preparing', deadline: '2026-10-20' }, b: { title: 'Old Program', status: 'interested', deadline: '2026-09-01' } },
      portfolio: { goal: 'four-year' },
      lastActive: OCT.getTime() - 2 * 86_400_000,
    }, { now: OCT });
    for (const f of ['overdue', 'due-soon', 'fafsa', 'first-gen']) assert.ok(ins.flags.includes(f), f);
    assert.equal(ins.status, 'needs-support');
    assert.ok(ins.summary.split(/\s+/).length < 45, ins.summary);
    assert.match(ins.summary, /12th grader aiming for 4-year college/);
  });

  test('marks a student with real progress as on track', () => {
    const ins = counselorInsights({
      profile: { grade: 10, interests: ['STEM'], gpa: 3.8 },
      stats: { gpa: 3.8, activities: [{ name: 'Robotics', role: 'Captain' }, { name: 'Band' }, { name: 'Tutoring' }] },
      saved: ['paid'],
      tracker: { x: { title: 'Summer camp', status: 'submitted' } },
      portfolio: { goal: 'four-year', milestones: { done: ['meet-counselor', 'four-year-plan', 'join-activity', 'log-service', 'psat-10', 'bigger-role', 'summer-plan', 'career-chat', 'dual-credit'] } },
      lastActive: OCT.getTime(),
    }, { byId, now: OCT });
    assert.equal(ins.status, 'on-track');
    assert.deepEqual(ins.flags, []);
  });

  test('hardship text is only flagged when the student shared it', () => {
    assert.ok(!counselorInsights({ portfolio: { insight: { obstacles: 'x' } } }).flags.includes('hardship'));
    assert.ok(counselorInsights({ portfolio: { insight: { obstacles: 'x', share: true } } }).flags.includes('hardship'));
  });

  test('the on-device strategy chat answers from the student’s flags', () => {
    const ins = counselorInsights({ profile: { grade: 12, financialNeed: true }, portfolio: { goal: 'four-year' } }, { now: OCT });
    const aid = counselorReply('How do I help with financial aid?', ins);
    assert.match(aid.reply, /fee-waiver|fee waiver/i);
    const brief = counselorReply('Brief me for a surprise 1-on-1', ins);
    assert.match(brief.reply, /Quick brief/);
  });
});

describe('room encryption', () => {
  test('teacher keys round-trip and tolerate typing mistakes', () => {
    const key = C.generateTeacherKey();
    assert.match(key, /^([A-Z0-9]{4}-){7}[A-Z0-9]{4}$/);
    assert.equal(C.normalizeTeacherKey(key.toLowerCase().replace(/-/g, ' ')), key.replace(/-/g, ''));
    assert.equal(C.normalizeTeacherKey('too-short'), null);
  });

  test('names encrypt to the room and only the right key opens them', async () => {
    const key = C.generateTeacherKey();
    const room = await C.createRoomKeys(key);
    assert.equal(room.authToken, await C.roomAuthToken(key));
    const enc = await C.encryptName(room.publicKey, '  Zoë Martínez ');
    assert.ok(!enc.includes('Zo'));
    const opened = await C.openRoom(key, room);
    assert.equal(await opened.decryptName(enc), 'Zoë Martínez');
    await assert.rejects(C.openRoom(C.generateTeacherKey(), room), /doesn’t unlock/);
  });
});
