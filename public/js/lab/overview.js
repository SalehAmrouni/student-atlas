// Overview: the student's stats, activities, awards, and college list, plus a
// live snapshot of strengths and next steps.

import { h, icon, refreshIcons, debounce, toast } from '../lib/dom.js';
import { getLab, saveLab } from '../lib/lab-store.js';
import { assessProfile, computeGpa } from '../lib/lab-engine.js';
import { getProfile } from '../lib/store.js';
import { field, scoreMeter, barRow, mergedStats } from './common.js';

const LIST_DEFS = {
  activities: {
    title: 'Activities', icon: 'trophy', noun: 'activity', max: 10,
    hint: 'Clubs, sports, jobs, family responsibilities, and independent projects all count. The Common App has room for 10.',
    fields: [
      { name: 'name', label: 'Activity', type: 'text', max: 80, wide: true, placeholder: 'e.g. Robotics team' },
      { name: 'role', label: 'Your role', type: 'text', max: 80, placeholder: 'e.g. Build lead' },
      { name: 'hoursPerWeek', label: 'Hours per week', type: 'number', min: 0, max: 80 },
      { name: 'weeksPerYear', label: 'Weeks per year', type: 'number', min: 0, max: 52 },
      { name: 'leadership', label: 'Leadership role', type: 'checkbox' },
    ],
  },
  awards: {
    title: 'Honors & awards', icon: 'award', noun: 'award', max: 5,
    hint: 'The Common App lists up to 5 honors.',
    fields: [
      { name: 'name', label: 'Award', type: 'text', max: 100, wide: true, placeholder: 'e.g. AP Scholar' },
      { name: 'level', label: 'Level', type: 'select', options: ['School', 'Regional', 'State', 'National', 'International'] },
    ],
  },
  colleges: {
    title: 'College list', icon: 'school', noun: 'college', max: 25,
    hint: 'Label each school honestly: reach, target, or likely. Add deadlines to see them on your timeline.',
    fields: [
      { name: 'name', label: 'College', type: 'text', max: 100, wide: true, placeholder: 'e.g. University of Michigan' },
      { name: 'category', label: 'Category', type: 'select', options: ['Reach', 'Target', 'Likely'] },
      { name: 'plan', label: 'Plan', type: 'select', options: ['RD', 'EA', 'ED', 'ED II', 'REA', 'Rolling'] },
      { name: 'deadline', label: 'Deadline', type: 'date' },
    ],
  },
};

export function renderOverview(root, { go }) {
  const lab = getLab();
  const profile = getProfile();
  const snapshot = h('div', { class: 'stack' });
  const refresh = debounce(() => drawSnapshot(), 250);

  const setStat = (key, value) => {
    saveLab((l) => { l.stats[key] = value; }, 'stats');
    refresh();
  };
  const numInput = (key, { min, max, step, placeholder }) => {
    const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min, max, step, placeholder, value: lab.stats[key] ?? '' });
    input.addEventListener('input', () => {
      const v = input.value === '' ? null : Number(input.value);
      const valid = v === null || (v >= Number(min) && v <= Number(max));
      input.setAttribute('aria-invalid', String(!valid));
      if (valid) setStat(key, v);
    });
    return input;
  };

  const gradeSelect = h('select', { class: 'select' },
    h('option', { value: '' }, 'Choose…'),
    [9, 10, 11, 12].map((g) => h('option', { value: String(g), selected: (lab.stats.grade ?? profile?.grade) === g || undefined }, `${g}th grade`)));
  gradeSelect.addEventListener('change', () => setStat('grade', gradeSelect.value ? Number(gradeSelect.value) : null));
  const majors = h('input', { class: 'input', type: 'text', maxlength: '200', placeholder: 'e.g. Biology, Public health', value: lab.stats.majors ?? '' });
  majors.addEventListener('input', () => setStat('majors', majors.value.trim()));

  const gpaInput = numInput('gpa', { min: '0', max: '4', step: '0.01', placeholder: profile?.gpa ? String(profile.gpa) : '3.60' });
  const tg = lab.transcript?.courses?.length ? computeGpa(lab.transcript.courses) : null;
  const useTranscript = tg?.unweighted
    ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
      gpaInput.value = tg.unweighted.toFixed(2);
      wInput.value = tg.weighted?.toFixed(2) ?? '';
      saveLab((l) => { l.stats.gpa = tg.unweighted; l.stats.weightedGpa = tg.weighted; }, 'stats');
      refresh();
      toast('GPA updated from your transcript', 'success');
    } }, icon('file-text'), `Use transcript GPA (${tg.unweighted.toFixed(2)})`)
    : null;
  const wInput = numInput('weightedGpa', { min: '0', max: '6', step: '0.01', placeholder: '4.10' });

  const statsCard = h('section', { class: 'card stack', 'aria-labelledby': 'stats-h' },
    h('h2', { id: 'stats-h', class: 'h3' }, icon('gauge'), 'Your stats'),
    h('p', { class: 'small muted mb-0' }, 'Saved automatically in this browser. Leave anything blank that you don’t know yet.'),
    h('div', { class: 'form-grid' },
      field('Grade', gradeSelect),
      field('Intended major(s)', majors),
      field('Unweighted GPA', gpaInput, '4.0 scale'),
      field('Weighted GPA', wInput, 'If your school reports one'),
      field('SAT total', numInput('sat', { min: '400', max: '1600', step: '10', placeholder: '1350' }), 'Optional, 400–1600'),
      field('ACT composite', numInput('act', { min: '1', max: '36', step: '1', placeholder: '29' }), 'Optional, 1–36')),
    useTranscript);

  const lists = Object.entries(LIST_DEFS).map(([key, def]) => listEditor(key, def, refresh));

  function drawSnapshot() {
    const l = getLab();
    const a = assessProfile({ stats: mergedStats(), transcript: l.transcript, essays: l.essays, profile: getProfile() });
    const deadlines = (l.stats.colleges ?? [])
      .filter((c) => c.name && c.deadline)
      .map((c) => ({ ...c, days: Math.ceil((new Date(`${c.deadline}T23:59:00`) - new Date()) / 86400000) }))
      .filter((c) => Number.isFinite(c.days) && c.days >= -7)
      .sort((x, y) => x.days - y.days)
      .slice(0, 6);
    const stepTab = { essays: 'essays', academics: 'transcript', rigor: 'transcript' };

    snapshot.replaceChildren(
      h('section', { class: 'card lab-snapshot', 'aria-labelledby': 'snap-h' },
        h('div', { class: 'row-between' },
          h('div', {},
            h('h2', { id: 'snap-h', class: 'h3 mb-0' }, 'Application snapshot'),
            h('p', { class: 'small muted mb-0' }, 'A coaching aid based on what you entered, not an admissions prediction.')),
          scoreMeter(a.overall, 'Overall snapshot')),
        h('div', { class: 'lab-bars mt-3' }, a.areas.map((ar) => barRow(ar.label, ar.score, 100, ar.detail)))),
      h('section', { class: 'card', 'aria-labelledby': 'steps-h' },
        h('h2', { id: 'steps-h', class: 'h3' }, icon('list-checks'), 'Your next steps'),
        a.steps.length
          ? h('ol', { class: 'lab-steps' }, a.steps.map((s) => h('li', {},
            h('span', { text: s.text }),
            stepTab[s.area] ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => go(stepTab[s.area]) }, 'Open', icon('arrow-right')) : null)))
          : h('p', { class: 'muted mb-0' }, 'Nice work. Ask the mentor what to focus on next.'),
        h('button', { type: 'button', class: 'btn btn-outline btn-sm mt-2', onclick: () => go('mentor') }, icon('messages-square'), 'Talk it through with the mentor')),
      (l.stats.colleges ?? []).length
        ? h('section', { class: 'card', 'aria-labelledby': 'bal-h' },
          h('h2', { id: 'bal-h', class: 'h3' }, icon('scale'), 'College list balance'),
          h('div', { class: 'lab-balance' },
            ['Reach', 'Target', 'Likely'].map((c) => h('div', { class: `lab-balance-cell ${c.toLowerCase()}` }, h('strong', { text: String(a.collegeBalance[c]) }), h('span', { text: c })))),
          h('ul', { class: 'small mb-0 mt-2' }, a.collegeNotes.map((n) => h('li', { text: n }))))
        : null,
      deadlines.length
        ? h('section', { class: 'card', 'aria-labelledby': 'dl-h' },
          h('h2', { id: 'dl-h', class: 'h3' }, icon('calendar-clock'), 'Application deadlines'),
          h('ul', { class: 'lab-deadlines' }, deadlines.map((c) => h('li', {},
            h('div', {}, h('strong', { text: c.name }), h('span', { class: 'small muted', text: ` · ${c.plan || 'RD'} · ${new Date(`${c.deadline}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` })),
            h('span', { class: `badge ${c.days < 0 ? 'badge-danger' : c.days <= 14 ? 'badge-warning' : 'badge-info'}`, text: c.days < 0 ? 'Passed' : c.days === 0 ? 'Today' : `${c.days} day${c.days === 1 ? '' : 's'}` })))))
        : null,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm lab-print', onclick: () => window.print() }, icon('printer'), 'Print a summary for your counselor'));
    refreshIcons();
  }

  root.append(h('div', { class: 'lab-overview' },
    h('div', { class: 'stack' }, statsCard, ...lists),
    h('div', { class: 'lab-overview-side' }, snapshot)));
  drawSnapshot();
}

function listEditor(key, def, onChange) {
  const list = h('div', { class: 'lab-list' });
  const addBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, icon('plus'), `Add ${def.noun}`);
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const items = () => getLab().stats[key] ?? [];
  const save = (mutate) => {
    saveLab((l) => { l.stats[key] = l.stats[key] ?? []; mutate(l.stats[key]); }, 'stats');
    onChange();
  };

  function draw(focusIndex) {
    const rows = items();
    list.replaceChildren(...rows.map((item, i) => row(item, i)));
    addBtn.disabled = rows.length >= def.max;
    if (!rows.length) list.append(h('p', { class: 'small muted mb-0', text: `No ${def.title.toLowerCase()} added yet.` }));
    refreshIcons();
    if (focusIndex !== undefined) list.querySelectorAll('fieldset')[focusIndex]?.querySelector('input, select')?.focus();
  }

  function row(item, i) {
    const n = i + 1;
    const controls = def.fields.map((f) => {
      const id = `lab-${key}-${i}-${f.name}`;
      if (f.type === 'checkbox') {
        const cb = h('input', { type: 'checkbox', id, checked: item[f.name] || undefined });
        cb.addEventListener('change', () => save((arr) => { arr[i][f.name] = cb.checked; }));
        return h('label', { class: 'check lab-check', for: id }, cb, h('span', { text: f.label }));
      }
      let control;
      if (f.type === 'select') {
        control = h('select', { class: 'select', id }, h('option', { value: '' }, 'Choose…'), f.options.map((o) => h('option', { value: o, selected: item[f.name] === o || undefined }, o)));
        control.addEventListener('change', () => save((arr) => { arr[i][f.name] = control.value || undefined; }));
      } else {
        control = h('input', {
          class: 'input', id, type: f.type, value: item[f.name] ?? '', placeholder: f.placeholder, maxlength: f.max ? String(f.max) : undefined,
          min: f.min, max: f.type === 'number' ? f.max : undefined, inputmode: f.type === 'number' ? 'numeric' : undefined,
        });
        control.addEventListener('input', () => save((arr) => {
          arr[i][f.name] = f.type === 'number' ? (control.value === '' ? null : Number(control.value)) : control.value;
        }));
      }
      return h('div', { class: `field${f.wide ? ' wide' : ''}` }, h('label', { class: 'label', for: id }, f.label), control);
    });
    const label = item.name ? `${def.noun} ${n}, ${item.name}` : `${def.noun} ${n}`;
    return h('fieldset', { class: 'lab-item' },
      h('legend', { class: 'small faint', text: `${def.noun[0].toUpperCase()}${def.noun.slice(1)} ${n}` }),
      h('div', { class: 'lab-item-grid' }, controls),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-icon btn-sm lab-item-remove', 'aria-label': `Remove ${label}`,
        onclick: () => {
          save((arr) => arr.splice(i, 1));
          status.textContent = `Removed ${label}.`;
          draw();
          addBtn.focus();
        },
      }, icon('trash-2')));
  }

  addBtn.addEventListener('click', () => {
    if (items().length >= def.max) return;
    save((arr) => arr.push({}));
    draw(items().length - 1);
  });

  draw();
  const hid = `lab-${key}-h`;
  return h('section', { class: 'card stack', 'aria-labelledby': hid },
    h('div', { class: 'row-between' },
      h('h2', { id: hid, class: 'h3 mb-0' }, icon(def.icon), def.title),
      h('span', { class: 'small faint', text: `Up to ${def.max}` })),
    h('p', { class: 'small muted mb-0', text: def.hint }),
    list, addBtn, status);
}
