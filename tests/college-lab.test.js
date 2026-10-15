import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const E = await import('../public/js/lib/lab-engine.js');

const TRANSCRIPT = `Lincoln High School
Student Name: Jordan Lee
Grade 9  2023-2024
English 9 Honors    A   A-   1.0
Algebra I           B+  B    1.0
Biology             A        1.0
Art I               P        0.5
Grade 10  2024-2025
ENG201 English 10 Honors   A  1.0
Geometry, B+, 1.0
AP World History\tA-\t1.0
Chemistry Honors | B+ | 1.0
Cumulative GPA: 3.71
11th grade
AP Calculus AB        88
US History (Dual Enrollment)   A`;

const ESSAY = `The smell of burnt toast filled the kitchen at 5:30 a.m. when my grandmother, Rosa, handed me her old notebook. "Read it," she said. Inside were forty years of recipes written in Spanish, each one stained with oil.

I didn't understand why she gave it to me until that winter, when she moved into Sunrise Care Center. Every Sunday I cooked one recipe and brought it to her. Ever since I was young, I have always been passionate about cooking.

Looking back, I realized the notebook was never about food. It was about how my family remembers. Now I write down the stories behind each dish, and I have interviewed twelve relatives so far.`;

describe('transcript parsing', () => {
  const { courses } = E.parseTranscript(TRANSCRIPT);
  const byName = (n) => courses.find((c) => c.name === n);

  test('reads tab, comma, pipe, and space separated rows and skips headers', () => {
    assert.equal(courses.length, 10);
    assert.ok(!courses.some((c) => /gpa|lincoln|jordan/i.test(c.name)));
    assert.equal(byName('English 10 Honors')?.grade, 'A', 'course codes are stripped');
    assert.equal(byName('Geometry')?.grade, 'B+');
    assert.equal(byName('Chemistry Honors')?.level, 'Honors');
  });

  test('detects years, levels, subjects, credits, and semester grades', () => {
    assert.equal(byName('Algebra I').year, 'Grade 9');
    assert.equal(byName('AP Calculus AB').year, 'Grade 11');
    assert.equal(byName('AP Calculus AB').points, 3.3, '88 maps to B+');
    assert.equal(byName('US History (Dual Enrollment)').level, 'Dual Enrollment');
    assert.equal(byName('English 9 Honors').points, 3.85, 'two semester grades are averaged');
    assert.equal(byName('Art I').credits, 0.5);
    assert.equal(byName('Art I').points, null, 'pass/fail is excluded from GPA');
    assert.equal(byName('Biology').subject, 'Science');
  });

  test('computes unweighted, weighted, and per-year GPA', () => {
    const g = E.computeGpa(courses);
    assert.ok(g.unweighted > 3.4 && g.unweighted < 3.8, String(g.unweighted));
    assert.ok(g.weighted > g.unweighted);
    assert.deepEqual(g.byYear.map((y) => y.year), ['Grade 9', 'Grade 10', 'Grade 11']);
    assert.deepEqual(g.rigor, { ap: 2, ib: 0, honors: 3, dual: 1 });
  });

  test('grade points cover letters, percentages, and 4.0 scale', () => {
    assert.equal(E.gradePoints('A-'), 3.7);
    assert.equal(E.gradePoints('95'), 4);
    assert.equal(E.gradePoints('3.3'), 3.3);
    assert.equal(E.gradePoints('P'), null);
  });
});

describe('essay feedback', () => {
  test('scores every rubric area and flags clichés with exact quotes', () => {
    const r = E.analyzeEssay(ESSAY, { promptId: 'ca1' });
    assert.equal(r.source, 'local');
    assert.equal(r.rubric.length, E.RUBRIC.length);
    assert.ok(r.rubric.every((x) => x.score >= 1 && x.score <= 5));
    assert.ok(r.comments.some((c) => c.kind === 'cliche'));
    for (const c of r.comments) assert.ok(ESSAY.includes(c.quote) || c.quote === ' i ', c.quote);
    assert.ok(r.revisions.some((x) => /space/i.test(x.title)), 'a short essay is told to use more of the limit');
    assert.ok(r.overall < 75, 'a 120-word personal essay is not "ready"');
  });

  test('flags going over the limit', () => {
    const r = E.analyzeEssay(ESSAY, { promptId: 'activity' });
    assert.equal(r.limit, 150);
    const long = E.analyzeEssay(`${ESSAY}\n\n${ESSAY}`, { promptId: 'activity' });
    assert.match(long.revisions[0].title, /trim/i);
  });

  test('asks for more text when the draft is tiny', () => {
    assert.equal(E.analyzeEssay('Too short.').overall, 0);
  });

  test('AI reviews are normalized and invented quotes are dropped', () => {
    const r = E.normalizeEssayReview({
      overall: 140, summary: 'Good.', strengths: ['x'], revisions: [{ title: 'Do this', detail: 'Because' }],
      rubric: [{ id: 'voice', score: 9, comment: 'c' }, { id: 'bogus', score: 3, comment: 'c' }],
      comments: [{ quote: 'burnt toast filled the kitchen', note: 'nice' }, { quote: 'not in the essay at all', note: 'x' }],
    }, ESSAY);
    assert.equal(r.overall, 100);
    assert.equal(r.rubric.find((x) => x.id === 'voice').score, 5);
    assert.equal(r.rubric.length, E.RUBRIC.length);
    assert.deepEqual(r.comments.map((c) => c.quote), ['burnt toast filled the kitchen']);
  });
});

describe('mentor and assessment', () => {
  const stats = { grade: 11, gpa: 3.6, activities: [{ name: 'Robotics', hoursPerWeek: 6, weeksPerYear: 30, leadership: true }], colleges: [{ name: 'A', category: 'Reach' }, { name: 'B', category: 'Reach' }] };

  test('assessment scores areas and flags an unbalanced college list', () => {
    const a = E.assessProfile({ stats });
    assert.equal(a.areas.find((x) => x.id === 'academics').score, 80);
    assert.ok(a.collegeNotes.some((n) => /likely/i.test(n)));
  });

  test('answers from the student’s own data', () => {
    const { courses } = E.parseTranscript(TRANSCRIPT);
    const r = E.mentorReply('break down my transcript', { stats, transcript: { courses } });
    assert.match(r.reply, /unweighted/);
    assert.match(E.mentorReply('is my college list balanced?', { stats }).reply, /2 reach/);
    assert.match(E.mentorReply('what should I do this year', { stats, now: new Date('2026-10-15') }).reply, /PSAT/);
    assert.ok(E.mentorReply('how do I pay for college').reply.includes('FAFSA'));
  });

  test('responds to crisis language with crisis resources', () => {
    assert.match(E.mentorReply('i want to kill myself').reply, /988/);
  });
});

// ---------------------------------------------------------------------------
describe('College Lab API', () => {
  let app;
  let mock;
  let base;
  let lastRequest;
  const env = { ...process.env };

  before(async () => {
    // A stand-in for the Claude API so the full request path runs without a key or network.
    mock = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(body) };
        const result = { reply: 'Hi! Here is your plan.', suggestions: ['Next?'] };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify(result) }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }));
      });
    }).listen(0);
    await new Promise((r) => mock.once('listening', r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
    const { createApp } = await import('../server/index.js');
    app = createApp().listen(0);
    await new Promise((r) => app.once('listening', r));
    base = `http://127.0.0.1:${app.address().port}/api/college-lab`;
  });
  after(() => {
    app.close();
    mock.close();
    process.env = env;
  });

  const post = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  test('reports AI as unavailable and refuses work without an API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await fetch(base);
    assert.deepEqual(await res.json(), { ai: false });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await post({ task: 'mentor', messages: [{ role: 'user', content: 'hi' }] })).status, 503);
  });

  test('validates requests and blocks other origins', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    assert.equal((await post({ task: 'essay', essay: 'too short', prompt: 'x', wordLimit: 650 })).status, 400);
    assert.equal((await post({ task: 'nope' })).status, 400);
    assert.equal((await post({ task: 'mentor', messages: [{ role: 'user', content: 'hi' }] }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(base, { method: 'DELETE' })).status, 405);
  });

  test('calls Claude with structured output and server-side fallbacks', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    assert.deepEqual(await (await fetch(base)).json(), { ai: true });
    const res = await post({ task: 'mentor', messages: [{ role: 'user', content: 'What should I do?' }], stats: { grade: 11, gpa: 3.6 } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.reply, 'Hi! Here is your plan.');
    assert.equal(lastRequest.body.model, 'claude-opus-5-5');
    assert.equal(lastRequest.body.fallbacks, 'default');
    assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(lastRequest.body.output_config.format.type, 'json_schema');
    assert.match(lastRequest.body.messages[0].content, /<student_stats>/);
  });
});
