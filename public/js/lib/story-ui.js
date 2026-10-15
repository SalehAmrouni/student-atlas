// My Story (the expanded profile Zeus tailors) and the milestone checklist,
// shown as tabs in My Pathway. Academics and activities are shared with the
// College Lab, so both places always show the same numbers.

import { h, icon, refreshIcons, debounce, externalLink, toast } from './dom.js';
import { getProfile, saveProfile, getPortfolio, updatePortfolio, getTracker } from './store.js';
import { getLab, saveLab } from './lab-store.js';
import { GOALS, PATHS, tailorPortfolio, milestonesFor, milestoneProgress, checklistNudges, sanitizeActivities } from './portfolio.js';

let seq = 0;
const fid = (name) => `story-${name}-${++seq}`;

function labeled(label, control, hint) {
  const id = control.id || fid('f');
  control.id = id;
  if (hint) control.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), control, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

function statInput(key, { min, max, step = '1', placeholder }) {
  const lab = getLab();
  const input = h('input', { class: 'input', type: 'number', inputmode: step === '1' ? 'numeric' : 'decimal', min, max, step, placeholder, value: lab.stats[key] ?? '' });
  input.addEventListener('input', () => {
    const v = input.value === '' ? null : Number(input.value);
    const ok = v === null || (Number.isFinite(v) && v >= Number(min) && v <= Number(max));
    input.setAttribute('aria-invalid', String(!ok));
    if (ok) saveLab((l) => { l.stats[key] = v; }, 'stats');
  });
  return input;
}

/** "Zeus noticed" nudges from the checklist (also used in the College Lab). */
export function zeusNudges({ compact = false } = {}) {
  const lab = getLab();
  const nudges = checklistNudges({ portfolio: getPortfolio(), profile: getProfile() ?? {}, stats: lab.stats, tracker: getTracker() });
  if (!nudges.length) return null;
  return h('section', { class: `card zeus-nudges${compact ? ' compact' : ''}`, 'aria-labelledby': 'nudges-h' },
    h('div', { class: 'row zeus-nudges-head' },
      h('div', { class: 'zeus-avatar', 'aria-hidden': 'true' }, icon('sparkles')),
      h('h2', { id: 'nudges-h', class: 'h3 mb-0' }, 'Zeus noticed')),
    h('ul', { class: 'zeus-nudge-list' }, nudges.map((n) => h('li', {},
      h('p', { class: 'mb-0', text: n.text }),
      n.action ? (n.action.external
        ? externalLink(n.action.href, [icon('external-link'), n.action.label], 'btn btn-outline btn-sm')
        : h('a', { class: 'btn btn-outline btn-sm', href: n.action.href }, n.action.label, icon('arrow-right'))) : null))));
}

// ---- My Story -----------------------------------------------------------------
export function renderStory(root) {
  const draw = (focusGoal = false) => {
    const profile = getProfile() ?? {};
    const portfolio = getPortfolio();
    const lab = getLab();
    const t = tailorPortfolio({ portfolio, profile, stats: lab.stats });
    root.replaceChildren(
      h('div', { class: 'zeus-tailor', role: 'note' },
        h('div', { class: 'zeus-avatar', 'aria-hidden': 'true' }, icon('sparkles')),
        h('div', {}, h('strong', {}, 'Zeus tailored these sections for you. '), h('span', { text: t.note }))),
      h('p', { class: 'small muted' }, icon('eye'), ' Saved to your account automatically. If you join a school room, your teacher or counselor can see this page, except your Overcoming obstacles answer unless you choose to share it.'),
      academics(t, portfolio, profile, lab, () => draw(true)),
      activitiesSection(t),
      experienceSection(t),
      insightSection(t));
    refreshIcons();
    if (focusGoal) root.querySelector('#story-goal')?.focus();
  };
  draw();
}

function section(id, title, iconName, intro, ...children) {
  return h('section', { class: 'card card-flat stack story-section', 'aria-labelledby': id },
    h('h3', { id, class: 'mb-0' }, icon(iconName), title),
    intro ? h('p', { class: 'small muted mb-0', text: intro }) : null,
    ...children);
}

function academics(t, portfolio, profile, lab, redraw) {
  const goal = h('select', { id: 'story-goal', class: 'select' },
    h('option', { value: '' }, 'Choose a goal'),
    GOALS.map((g) => h('option', { value: g.id, selected: portfolio.goal === g.id || undefined }, g.label)));
  goal.addEventListener('change', () => {
    updatePortfolio((p) => { p.goal = goal.value || undefined; });
    redraw();
  });

  const majors = (lab.stats.majors ?? '').split(',').map((s) => s.trim());
  const majorInputs = [0, 1, 2].map((i) => h('input', { class: 'input', type: 'text', maxlength: '60', value: majors[i] ?? '', placeholder: i === 0 ? t.academics.majorsPlaceholder : '', 'aria-label': `${t.academics.majorsLabel}, choice ${i + 1}` }));
  const saveMajors = debounce(() => saveLab((l) => { l.stats.majors = majorInputs.map((m) => m.value.replace(/,/g, ' ').trim()).filter(Boolean).join(', '); }, 'stats'), 300);
  majorInputs.forEach((m) => m.addEventListener('input', saveMajors));

  const tests = h('div', { class: 'form-grid' },
    labeled('SAT total', statInput('sat', { min: '400', max: '1600', step: '10', placeholder: '1350' }), '400–1600'),
    labeled('SAT Reading & Writing', statInput('satRW', { min: '200', max: '800', step: '10', placeholder: '670' })),
    labeled('SAT Math', statInput('satMath', { min: '200', max: '800', step: '10', placeholder: '680' })),
    labeled('ACT composite', statInput('act', { min: '1', max: '36', placeholder: '29' }), '1–36'));
  let testsBlock;
  if (t.academics.tests.show) {
    testsBlock = h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, 'Test scores (optional)'), h('p', { class: 'small muted', text: t.academics.tests.note }), tests);
  } else {
    tests.hidden = true;
    const reveal = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-expanded': 'false' }, icon('plus'), 'Add SAT or ACT scores anyway');
    reveal.addEventListener('click', () => { tests.hidden = false; reveal.setAttribute('aria-expanded', 'true'); reveal.hidden = true; tests.querySelector('input')?.focus(); });
    testsBlock = h('div', {}, reveal, tests);
  }

  const certs = t.academics.certifications
    ? (() => {
      const ta = h('textarea', { class: 'textarea', rows: '2', maxlength: '300', placeholder: t.academics.certifications.placeholder }, portfolio.certifications ?? '');
      ta.addEventListener('input', debounce(() => updatePortfolio((p) => { p.certifications = ta.value; }), 300));
      return labeled(t.academics.certifications.label, ta);
    })()
    : null;

  const pathBoxes = PATHS.map((path) => {
    const id = `story-path-${path.id}`;
    const checked = path.id === 'firstGen' ? profile.firstGen === true : portfolio.paths[path.id] === true;
    const cb = h('input', { type: 'checkbox', id, checked: checked || undefined });
    cb.addEventListener('change', () => {
      if (path.id === 'firstGen') {
        const p = getProfile();
        if (p) saveProfile({ ...p, firstGen: cb.checked ? true : undefined });
        else toast('Build your pathway first, then you can set this.', 'error');
      } else {
        updatePortfolio((p) => { p.paths[path.id] = cb.checked || undefined; });
      }
    });
    return h('label', { class: 'check', for: id }, cb, h('span', { text: path.label }));
  });
  if (t.academics.dualEnrollmentFirst) pathBoxes.unshift(pathBoxes.splice(1, 1)[0]);

  return section('story-academics', 'Academics & goals', 'graduation-cap', null,
    labeled('Post–high school goal', goal, 'Zeus uses this to tailor the rest of My Story and your checklist.'),
    h('div', { class: 'form-grid' },
      labeled('Unweighted GPA', statInput('gpa', { min: '0', max: '4', step: '0.01', placeholder: profile.gpa ? String(profile.gpa) : '3.60' }), '4.0 scale'),
      labeled('Weighted GPA', statInput('weightedGpa', { min: '0', max: '6', step: '0.01', placeholder: '4.10' }), 'If your school reports one')),
    t.academics.asvab ? labeled('ASVAB score (AFQT)', statInput('asvab', { min: '1', max: '99', placeholder: '65' }), '1–99, if you’ve taken it') : null,
    testsBlock,
    certs,
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, t.academics.majorsLabel), h('div', { class: 'form-grid three' }, majorInputs)),
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, 'Special path'), h('div', { class: 'stack-sm' }, pathBoxes)));
}

/** A small list editor (add, edit, remove) used by the activity and experience sections. */
function listEditor({ noun, max, items, save, fields }) {
  const list = h('div', { class: 'story-list' });
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const add = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, icon('plus'), `Add ${noun}`);

  const draw = (focusIndex) => {
    const rows = items();
    list.replaceChildren(...rows.map((item, i) => {
      const n = i + 1;
      const label = item.name || item.org ? `${noun} ${n}, ${item.name || item.org}` : `${noun} ${n}`;
      return h('fieldset', { class: 'lab-item' },
        h('legend', { class: 'small faint', text: `${noun[0].toUpperCase()}${noun.slice(1)} ${n}` }),
        h('div', { class: 'lab-item-grid' }, fields.map((f) => f.render(item, i, (patch) => save((arr) => Object.assign(arr[i], patch))))),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-sm lab-item-remove', 'aria-label': `Remove ${label}`,
          onclick: () => { save((arr) => arr.splice(i, 1)); status.textContent = `Removed ${label}.`; draw(); add.focus(); },
        }, icon('trash-2')));
    }));
    if (!rows.length) list.append(h('p', { class: 'small muted mb-0', text: `No ${noun === 'activity' ? 'activities' : `${noun}s`} added yet.` }));
    add.disabled = rows.length >= max;
    refreshIcons();
    if (focusIndex !== undefined) list.querySelectorAll('fieldset')[focusIndex]?.querySelector('input, textarea')?.focus();
  };
  add.addEventListener('click', () => {
    if (items().length >= max) return;
    save((arr) => arr.push({}));
    draw(items().length - 1);
  });
  draw();
  return [list, add, status];
}

const textInput = (key, label, { max = 80, placeholder, wide = false, area = false } = {}) => ({
  render: (item, i, patch) => {
    const control = area
      ? h('textarea', { class: 'textarea', rows: '2', maxlength: String(max), placeholder }, item[key] ?? '')
      : h('input', { class: 'input', type: 'text', maxlength: String(max), placeholder, value: item[key] ?? '' });
    control.addEventListener('input', debounce(() => patch({ [key]: control.value }), 250));
    const f = labeled(label, control);
    if (wide) f.classList.add('wide');
    return f;
  },
});

function activitiesSection(t) {
  const items = () => sanitizeActivities(getLab().stats.activities);
  const save = (mutate) => saveLab((l) => { l.stats.activities = sanitizeActivities(l.stats.activities); mutate(l.stats.activities); }, 'stats');
  const years = {
    render: (item, i, patch) => h('fieldset', { class: 'field wide years' },
      h('legend', { class: 'label' }, 'Years involved'),
      h('div', { class: 'row' }, [9, 10, 11, 12].map((y) => {
        const id = fid(`y${y}`);
        const cb = h('input', { type: 'checkbox', id, checked: (item.years ?? []).includes(y) || undefined });
        cb.addEventListener('change', () => {
          const set = new Set(sanitizeActivities([getLab().stats.activities?.[i] ?? {}])[0].years);
          if (cb.checked) set.add(y); else set.delete(y);
          patch({ years: [...set].sort((a, b) => a - b) });
        });
        return h('label', { class: 'check', for: id }, cb, h('span', { text: `${y}th` }));
      }))),
  };
  return section('story-activities', 'Extracurriculars & leadership', 'trophy', t.activities.hint,
    ...listEditor({
      noun: 'activity', max: 10, items, save,
      fields: [
        textInput('name', 'Activity name', { placeholder: 'e.g. Robotics Club', wide: true }),
        years,
        textInput('role', 'Leadership positions held', { placeholder: 'e.g. Team Captain, Lead Programmer', wide: true }),
        textInput('description', 'What you did or achieved', { max: 300, area: true, wide: true, placeholder: 'One or two sentences. Numbers help: “Led 12 members to the state finals.”' }),
      ],
    }));
}

function experienceSection(t) {
  const items = () => getPortfolio().experiences;
  const save = (mutate) => updatePortfolio((p) => mutate(p.experiences));
  return section('story-experience', t.experience.title, 'briefcase', 'Jobs, internships, research, and volunteering all count, paid or not.',
    ...listEditor({
      noun: 'experience', max: 10, items, save,
      fields: [
        textInput('org', 'Organization or company', { max: 100, placeholder: 'e.g. Local hospital', wide: true }),
        textInput('role', 'Role or title', { placeholder: 'e.g. Volunteer coordinator' }),
        textInput('hours', 'Total hours', { max: 40, placeholder: 'e.g. 50 hours, 5 hours/week' }),
        textInput('accomplishment', 'Key accomplishment', { max: 400, area: true, wide: true, placeholder: 'The number-one thing you accomplished or learned.' }),
      ],
    }));
}

function insightSection(t) {
  const p = getPortfolio();
  const save = (mutate) => updatePortfolio((x) => mutate(x.insight));
  const words = [0, 1, 2].map((i) => {
    const input = h('input', { class: 'input', type: 'text', maxlength: '30', value: p.insight.words[i] ?? '', placeholder: ['Resilient', 'Analytical', 'Creative'][i], 'aria-label': `Word ${i + 1} of 3 that describes you` });
    input.addEventListener('input', debounce(() => save((ins) => { ins.words[i] = input.value; }), 250));
    return input;
  });
  const proud = h('textarea', { class: 'textarea', rows: '3', maxlength: '600', placeholder: 'What single accomplishment are you most proud of?' }, p.insight.proudest ?? '');
  proud.addEventListener('input', debounce(() => save((ins) => { ins.proudest = proud.value; }), 250));
  const obstacles = h('textarea', { class: 'textarea', rows: '4', maxlength: '1500', placeholder: 'Optional. Share only what you’re comfortable with.' }, p.insight.obstacles ?? '');
  obstacles.addEventListener('input', debounce(() => save((ins) => { ins.obstacles = obstacles.value; }), 250));
  const shareId = fid('share');
  const share = h('input', { type: 'checkbox', id: shareId, checked: p.insight.share || undefined });
  share.addEventListener('change', () => save((ins) => { ins.share = share.checked; }));
  const aidId = fid('aid');
  const aid = h('input', { type: 'checkbox', id: aidId, checked: p.insight.aidFocus || undefined });
  aid.addEventListener('change', () => save((ins) => { ins.aidFocus = aid.checked || undefined; }));

  return section('story-insight', 'Personal insight', 'heart-handshake', 'For compelling recommendation letters. Everything here is optional.',
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, 'Three words that describe you'), h('div', { class: 'form-grid three' }, words)),
    labeled(t.insight.proudestLabel, proud),
    labeled('Overcoming obstacles', obstacles, 'Any personal, financial, or environmental hardships that affected your school or path. This helps a counselor advocate for you.'),
    h('label', { class: 'check', for: shareId }, share, h('span', {}, 'Share my Overcoming obstacles answer with my teacher or counselor', h('span', { class: 'hint' }, ' (off unless you turn it on)'))),
    h('label', { class: 'check', for: aidId }, aid, h('span', {}, h('strong', {}, 'Financial aid focus: '), 'my family will be heavily prioritizing financial aid, merit scholarships, and fully funded programs.')),
    t.insight.suggestAidFocus && !p.insight.aidFocus ? h('p', { class: 'small muted mb-0' }, icon('sparkles'), ' Zeus: you mentioned cost matters, so this might fit you.') : null);
}

// ---- Milestones -------------------------------------------------------------------
const GRADE_TITLES = { 9: '9th grade', 10: '10th grade', 11: '11th grade', 12: '12th grade' };

export function renderMilestones(root) {
  const draw = (focusId) => {
    const profile = getProfile() ?? {};
    const portfolio = getPortfolio();
    const grade = profile.grade;
    if (!grade) {
      root.replaceChildren(h('div', { class: 'empty-state' }, icon('list-checks'), h('h3', { text: 'Tell us your grade first' }), h('p', { text: 'Build your pathway and your checklist appears here.' })));
      refreshIcons();
      return;
    }
    const prog = milestoneProgress(portfolio, { grade, firstGen: profile.firstGen });
    const list = milestonesFor({ grade, goal: portfolio.goal, paths: { ...portfolio.paths, firstGen: profile.firstGen } });
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    const fill = h('div', { class: 'bar-fill' });
    requestAnimationFrame(() => { fill.style.width = `${pct}%`; });

    const item = (m) => {
      const id = `ms-${m.id}`;
      const cb = h('input', { type: 'checkbox', id, checked: prog.has(m.id) || undefined });
      cb.addEventListener('change', () => {
        updatePortfolio((p) => {
          const done = new Set(p.milestones.done);
          if (cb.checked) done.add(m.id); else done.delete(m.id);
          p.milestones.done = [...done];
        });
        draw(id);
      });
      return h('li', { class: 'milestone' },
        h('label', { class: 'check', for: id }, cb, h('span', { text: m.text })),
        m.link ? externalLink(m.link, [icon('external-link'), 'Open'], 'btn btn-ghost btn-sm') : null);
    };

    const groups = [12, 11, 10, 9].filter((g) => g <= grade).map((g) => {
      const items = list.filter((m) => m.grade === g);
      if (!items.length) return null;
      const doneCount = items.filter((m) => prog.has(m.id)).length;
      return h('section', { class: 'milestone-group', 'aria-labelledby': `msg-${g}` },
        h('h3', { id: `msg-${g}`, class: 'h3' }, GRADE_TITLES[g], g < grade ? h('span', { class: 'small muted', text: ' · catch-up' }) : null,
          h('span', { class: 'badge badge-info ms-1', text: `${doneCount}/${items.length}` })),
        h('ul', { class: 'milestone-list' }, items.map(item)));
    });

    const addInput = h('input', { class: 'input', type: 'text', maxlength: '120', placeholder: 'e.g. Ask Ms. Lee about AP Bio', 'aria-label': 'New checklist item' });
    const addForm = h('form', { class: 'inline-add' }, addInput, h('button', { type: 'submit', class: 'btn btn-outline btn-sm' }, icon('plus'), 'Add'));
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = addInput.value.trim();
      if (!text) return addInput.focus();
      updatePortfolio((p) => { p.milestones.custom.push({ id: `c-${Date.now().toString(36)}`, text, done: false }); });
      draw('ms-add');
    });
    addInput.id = 'ms-add';

    const custom = portfolio.milestones.custom.map((c, i) => {
      const id = `ms-${c.id}`;
      const cb = h('input', { type: 'checkbox', id, checked: c.done || undefined });
      cb.addEventListener('change', () => { updatePortfolio((p) => { p.milestones.custom[i].done = cb.checked; }); draw(id); });
      return h('li', { class: 'milestone' },
        h('label', { class: 'check', for: id }, cb, h('span', { text: c.text })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Remove ${c.text}`, onclick: () => { updatePortfolio((p) => { p.milestones.custom.splice(i, 1); }); draw('ms-add'); } }, icon('x')));
    });

    root.replaceChildren(
      zeusNudges({ compact: true }) ?? '',
      h('div', { class: 'card card-flat stack' },
        h('div', { class: 'row-between' },
          h('h3', { class: 'mb-0' }, 'Your milestone checklist'),
          h('strong', { text: `${prog.done} of ${prog.total} done` })),
        h('div', { class: 'bar-track ms-progress', role: 'img', 'aria-label': `${prog.done} of ${prog.total} milestones done` }, fill),
        h('p', { class: 'small muted mb-0' }, `Built for a ${GRADE_TITLES[grade]} student${portfolio.goal ? ` on a ${GOALS.find((g) => g.id === portfolio.goal).label.toLowerCase()} path` : ''}. Set your goal in My Story to tailor it.`)),
      ...groups.filter(Boolean),
      h('section', { class: 'milestone-group', 'aria-labelledby': 'msg-custom' },
        h('h3', { id: 'msg-custom', class: 'h3' }, 'My own milestones'),
        custom.length ? h('ul', { class: 'milestone-list' }, custom) : h('p', { class: 'small muted', text: 'Add anything your counselor asked you to do.' }),
        addForm));
    refreshIcons();
    if (focusId) document.getElementById(focusId)?.focus();
  };
  draw();
}
