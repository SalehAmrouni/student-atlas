import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { loadOpportunities, CLUSTERS } = await import('../server/opportunities.js');
const { createEngine, extractEntities } = await import('../public/js/lib/zeus-engine.js');

const opportunities = loadOpportunities();
const byId = new Map(opportunities.map((o) => [o.id, o]));
const make = () => createEngine({ opportunities, clusters: CLUSTERS, rng: () => 0, now: () => new Date('2026-10-14T15:00:00') });

const linkedIds = (text) => [...text.matchAll(/\(opp:([a-z0-9-]+)\)/g)].map((m) => m[1]);

/** Runs a conversation and returns every reply. */
function converse(messages, profile = null) {
  const engine = make();
  let state = {};
  return messages.map((m) => {
    const r = engine.reply(m, { profile, state });
    state = r.state;
    return r;
  });
}

const sophomore = { firstName: 'Alex', grade: 10, interests: ['STEM'], careerGoals: ['Engineering'], lookingFor: [], financialNeed: true, formatPreference: 'any' };

describe('entity extraction', () => {
  test('understands grades, costs, formats, types, and interests', () => {
    const e = extractEntities('free online coding competitions for sophomores');
    assert.equal(e.grade, 10);
    assert.equal(e.cost, 'Free');
    assert.equal(e.format, 'Virtual');
    assert.equal(e.type, 'Competition');
    assert.equal(e.cluster, 'STEM');
    assert.ok(e.terms.includes('cod'), 'keeps the topic keyword');

    assert.equal(extractEntities("I'm in 11th grade").grade, 11);
    assert.equal(extractEntities('paid internships').cost, 'Stipend');
    assert.equal(extractEntities('research labs in new york').state.abbr, 'NY');
    assert.equal(extractEntities('what is due soon').soon, true);
    assert.equal(extractEntities('Junior State of America').grade, undefined, 'organization names are not grades');
  });
});

describe('search answers', () => {
  test('only links to real opportunities that satisfy the filters', () => {
    const [r] = converse(['free online summer programs for 10th graders']);
    const ids = linkedIds(r.text);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      const o = byId.get(id);
      assert.ok(o, `unknown id ${id}`);
      assert.equal(o.cost, 'Free');
      assert.ok(o.grades.includes(10));
      assert.ok(['Virtual', 'Hybrid', 'Varies'].includes(o.format));
    }
  });

  test('ranks keyword matches first and tolerates typos', () => {
    const [r] = converse(['robotcs competitions']);
    const first = byId.get(linkedIds(r.text)[0]);
    assert.match(first.title, /robotic/i);
  });

  test('uses the profile: grade eligibility and personalization', () => {
    const [r] = converse(['research programs'], sophomore);
    assert.match(r.text, /Alex/);
    for (const id of linkedIds(r.text)) assert.ok(byId.get(id).grades.includes(10), `${id} should be open to 10th graders`);
  });

  test('loosens filters and says so when nothing matches exactly', () => {
    const [r] = converse(['paid online scholarships in health for freshmen due in july']);
    assert.match(r.text, /loosened/);
    assert.ok(linkedIds(r.text).length > 0);
  });
});

describe('conversation memory', () => {
  test('refines, pages, and resolves "the first one"', () => {
    const [first, refined, , detail] = converse(['STEM summer programs', 'only free ones', 'show more', 'tell me about the first one']);
    const refinedIds = linkedIds(refined.text);
    assert.ok(refinedIds.every((id) => byId.get(id).cost === 'Free'));
    assert.ok(linkedIds(first.text).length > 0);
    assert.equal(linkedIds(detail.text)[0], refinedIds[0]);
    assert.match(detail.text, /\*\*Who:\*\*/);
  });

  test('filter-only follow-ups narrow the previous search', () => {
    const [, r] = converse(['free summer programs', 'Online only']);
    const ids = linkedIds(r.text);
    assert.ok(ids.length);
    for (const id of ids) {
      const o = byId.get(id);
      assert.equal(o.cost, 'Free');
      assert.equal(o.type, 'Summer Program');
      assert.ok(['Virtual', 'Hybrid', 'Varies'].includes(o.format));
    }
  });

  test('remembers facts the student shares', () => {
    const replies = converse(["I'm a junior and I love writing", 'competitions']);
    for (const id of linkedIds(replies[1].text)) assert.ok(byId.get(id).grades.includes(11));
    assert.equal(replies[1].state.grade, 11);
  });

  test('answers follow-up questions about the last program', () => {
    const replies = converse(['tell me about RSI', 'am I eligible for it?'], sophomore);
    assert.match(replies[0].text, /Research Science Institute/);
    assert.match(replies[1].text, /Not right now/);
  });

  test('switching topics drops the previous type filter', () => {
    const replies = converse(['scholarships', 'what about environment stuff'], sophomore);
    const ids = linkedIds(replies[1].text);
    assert.ok(ids.length);
    assert.ok(ids.every((id) => byId.get(id).cluster === 'Humanitarian'));
  });
});

describe('named programs', () => {
  test('recognizes programs by name, acronym, or partial name', () => {
    for (const [q, id] of [['tell me about RSI', 'research-science-institute'], ['tell me about brain bee', 'usa-brain-bee'], ['usaco', 'usaco'], ['Tell me about NYO2', 'nyo2']]) {
      const [r] = converse([q]);
      assert.equal(linkedIds(r.text)[0], id, q);
    }
  });

  test('does not mistake place names for program names', () => {
    const [, r] = converse(['research programs', 'any in new york?']);
    assert.doesNotMatch(r.text, /New York Times/);
  });

  test('compares two programs', () => {
    const [r] = converse(['compare Coca-Cola Scholars and the Gates Scholarship']);
    assert.match(r.text, /vs\./);
    assert.deepEqual(linkedIds(r.text).slice(0, 2).sort(), ['coca-cola-scholars', 'gates-scholarship']);
  });

  test('every opportunity can be found by its full title', () => {
    const engine = make();
    for (const o of opportunities) {
      const r = engine.reply(`Tell me about ${o.title}`, { state: {} });
      assert.equal(linkedIds(r.text)[0], o.id, o.title);
    }
  });
});

describe('advice, planning, and safety', () => {
  test('gives advice even with typos', () => {
    const [r] = converse(['how do i ask for a recomendation letter']);
    assert.match(r.text, /recommendation letter/i);
  });

  test('builds a grade-specific plan with real picks', () => {
    const [r] = converse(['I just finished the Pathway Wizard. What should my plan be?'], sophomore);
    assert.match(r.text, /10th grade/);
    assert.match(r.text, /PSAT/);
    assert.ok(linkedIds(r.text).length > 0);
  });

  test('responds to crisis language with real resources', () => {
    const [r] = converse(['i want to die']);
    assert.match(r.text, /988/);
    assert.equal(linkedIds(r.text).length, 0);
  });

  test('redirects inappropriate messages and discourages sharing contact info', () => {
    assert.match(converse(['shit'])[0].text, /school-friendly/);
    assert.match(converse(['my number is 555-123-4567'])[0].text, /never need to share/);
  });

  test('asks for clarification instead of guessing on gibberish', () => {
    const [r] = converse(['asdfgh qwerty']);
    assert.equal(linkedIds(r.text).length, 0);
    assert.ok(r.suggestions.length > 0);
  });

  test('always offers next steps', () => {
    for (const r of converse(['hi', 'free stem programs', 'tell me about the first one', 'how do I stand out?'])) {
      assert.ok(r.suggestions.length > 0, r.text.slice(0, 60));
    }
  });
});

describe('predictive suggestions', () => {
  test('completes partial input with questions and program names', () => {
    const engine = make();
    assert.ok(engine.predict('free sum').some((s) => /free summer programs/i.test(s)));
    assert.ok(engine.predict('brain').includes('Tell me about USA Brain Bee'));
    assert.ok(engine.predict('how do i ask').some((s) => /recommendation/.test(s)));
    assert.deepEqual(engine.predict('z'), []);
  });

  test('personalizes suggestions with the profile', () => {
    const engine = make();
    assert.ok(engine.predict('paid intern', { profile: sophomore }).some((s) => /10th graders/.test(s)));
  });
});
