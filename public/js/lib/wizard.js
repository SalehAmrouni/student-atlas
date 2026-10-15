// Pathway Wizard: a short, multi-step intake that builds the student profile.
// Every answer except grade and interests is optional.

import { h, icon, openModal, modalHeader, refreshIcons, toast } from './dom.js';
import { getProfile, saveProfile, CLUSTER_KEYS } from './store.js';
import { CAREER_GOALS, US_STATES } from './data.js';
import { INCOME_BANDS, HOUSEHOLD_SIZES, TIER_LABELS, financeTier } from './finance.js';

const CLUSTER_INFO = {
  STEM: ['STEM', 'Science, tech, engineering, math & coding'],
  Health: ['Health & Medicine', 'Biomedical research & health careers'],
  Business: ['Business', 'Startups, finance & economics'],
  Arts: ['Arts & Media', 'Art, writing, music, theater & film'],
  Civics: ['Civics & Leadership', 'Government, law, debate & global affairs'],
  Humanitarian: ['Service & Environment', 'Volunteering, community & climate'],
  Scholarships: ['Scholarships', 'Paying for college & college prep'],
};

const LOOKING_FOR = ['Summer Program', 'Internship', 'Research', 'Competition', 'Scholarship', 'Club / Organization', 'Volunteering', 'Exchange / Travel', 'College Access'];

const STEPS = ['About you', 'Interests', 'Goals', 'Details', 'Family finances', 'Finish'];
export const FINANCE_STEP = STEPS.indexOf('Family finances');

export function openWizard({ onComplete, startStep = 0 } = {}) {
  const existing = getProfile();
  const draft = {
    firstName: existing?.firstName ?? '',
    grade: existing?.grade,
    state: existing?.state ?? '',
    interests: [...(existing?.interests ?? [])],
    careerGoals: [...(existing?.careerGoals ?? [])],
    lookingFor: [...(existing?.lookingFor ?? [])],
    gpa: existing?.gpa,
    serviceHours: existing?.serviceHours,
    formatPreference: existing?.formatPreference ?? 'any',
    financialNeed: existing?.financialNeed,
    householdSize: existing?.householdSize,
    incomeBand: existing?.incomeBand,
    benefits: existing?.benefits,
    firstGen: existing?.firstGen,
    goals: existing?.goals ?? '',
  };
  // Jumping straight to a later step only makes sense once the required answers exist.
  let step = existing?.grade && existing.interests?.length ? Math.min(Math.max(0, startStep), STEPS.length - 1) : 0;

  const body = h('div', { class: 'modal-body' });
  const progress = h('div', { class: 'wizard-progress', 'aria-hidden': 'true' }, STEPS.map(() => h('span')));
  const stepLabel = h('p', { class: 'muted small mb-0 mt-1' });
  const backBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('arrow-left'), 'Back');
  const nextBtn = h('button', { type: 'button', class: 'btn btn-primary' });

  // ---- reusable controls ----------------------------------------------------
  const toggleList = (list, value) => {
    const i = list.indexOf(value);
    if (i === -1) list.push(value);
    else list.splice(i, 1);
  };

  const multiChips = (values, list, labelFor = (v) => v) => h('div', { class: 'chip-group', role: 'group' },
    values.map((v) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(list.includes(v)),
      onclick: (e) => { toggleList(list, v); e.currentTarget.setAttribute('aria-pressed', String(list.includes(v))); },
    }, labelFor(v))));

  const singleChips = (label, options, current, onPick) => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    options.map(([value, text]) => h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(current === value),
      onclick: (e) => {
        onPick(value);
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
      },
    }, text)));

  // ---- steps -------------------------------------------------------------------
  const renderers = [
    () => [
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'wz-name' }, 'First name or nickname ', h('span', { class: 'faint' }, '(optional)')),
        h('input', { id: 'wz-name', class: 'input', maxlength: '40', autocomplete: 'given-name', value: draft.firstName, oninput: (e) => { draft.firstName = e.target.value; } }),
        h('span', { class: 'hint' }, 'Only stored in this browser. Never enter your full name.')),
      h('div', { class: 'field' },
        h('span', { class: 'label', id: 'wz-grade' }, 'What grade are you in? *'),
        singleChips('Grade', [[9, '9th'], [10, '10th'], [11, '11th'], [12, '12th']], draft.grade, (v) => { draft.grade = v; })),
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'wz-state' }, 'Where do you live? ', h('span', { class: 'faint' }, '(optional, helps with regional programs)')),
        h('select', { id: 'wz-state', class: 'select', onchange: (e) => { draft.state = e.target.value; } },
          h('option', { value: '' }, 'Prefer not to say'),
          US_STATES.map((s) => h('option', { value: s, selected: draft.state === s || undefined }, s)))),
    ],
    () => [
      h('p', { class: 'muted' }, 'Pick every area you might be interested in. You can change this anytime.'),
      h('div', { class: 'option-grid', role: 'group', 'aria-label': 'Interest areas' },
        CLUSTER_KEYS.map((key) => h('button', {
          type: 'button', class: 'option', dataset: { cluster: key }, 'aria-pressed': String(draft.interests.includes(key)),
          onclick: (e) => { toggleList(draft.interests, key); e.currentTarget.setAttribute('aria-pressed', String(draft.interests.includes(key))); },
        }, h('span', { class: 'dot' }), h('span', {}, h('strong', { text: CLUSTER_INFO[key][0] }), h('small', { text: CLUSTER_INFO[key][1] }))))),
    ],
    () => [
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'Career directions you are curious about'),
        multiChips(CAREER_GOALS, draft.careerGoals)),
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'What kinds of opportunities are you looking for?'),
        multiChips(LOOKING_FOR, draft.lookingFor)),
    ],
    () => [
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' },
          h('label', { class: 'label', for: 'wz-gpa' }, 'GPA ', h('span', { class: 'faint' }, '(optional)')),
          h('input', { id: 'wz-gpa', class: 'input', type: 'number', min: '0', max: '5', step: '0.01', inputmode: 'decimal', placeholder: 'e.g. 3.6', value: draft.gpa ?? '',
            oninput: (e) => { const v = parseFloat(e.target.value); draft.gpa = Number.isFinite(v) && v >= 0 && v <= 5 ? v : undefined; } }),
          h('span', { class: 'hint' }, 'Most programs care more about curiosity than GPA.')),
        h('div', { class: 'field' },
          h('label', { class: 'label', for: 'wz-hours' }, 'Volunteer hours ', h('span', { class: 'faint' }, '(optional)')),
          h('input', { id: 'wz-hours', class: 'input', type: 'number', min: '0', max: '5000', step: '1', inputmode: 'numeric', placeholder: 'e.g. 40', value: draft.serviceHours ?? '',
            oninput: (e) => { const v = parseInt(e.target.value, 10); draft.serviceHours = Number.isFinite(v) && v >= 0 && v <= 5000 ? v : undefined; } }))),
      h('div', { class: 'field mt-2' },
        h('span', { class: 'label' }, 'Online or in person?'),
        singleChips('Format preference', [['any', 'Either'], ['In-person', 'In person'], ['Virtual', 'Online']], draft.formatPreference, (v) => { draft.formatPreference = v; })),
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'Is cost a big factor for you?'),
        singleChips('Financial need', [[true, 'Yes, show free & paid options first'], [false, 'Not really'], [undefined, 'Prefer not to say']], draft.financialNeed, (v) => { draft.financialNeed = v; })),
    ],
    () => {
      const tierNote = h('p', { class: 'small muted mb-0 mt-2', 'aria-live': 'polite' });
      const paintTier = () => {
        const tier = financeTier(draft);
        tierNote.textContent = tier ? `Based on this: ${TIER_LABELS[tier].toLowerCase()}. We'll point out programs with income limits.` : '';
      };
      paintTier();
      const pick = (key) => (v) => { draft[key] = v; paintTier(); };
      return [
        h('div', { class: 'callout' }, icon('shield-check'),
          h('span', {}, h('strong', {}, 'Every question here is optional. '),
            'Some scholarships and programs are only for students from lower-income families or first-generation college students. Your answers are saved only in this browser, are never sent anywhere, and you can delete them anytime.')),
        h('div', { class: 'form-grid mt-2' },
          h('div', { class: 'field' },
            h('label', { class: 'label', for: 'wz-household' }, 'People in your household'),
            h('select', { id: 'wz-household', class: 'select', 'aria-describedby': 'wz-household-hint', onchange: (e) => pick('householdSize')(e.target.value ? Number(e.target.value) : undefined) },
              h('option', { value: '' }, 'Prefer not to say'),
              HOUSEHOLD_SIZES.map((n) => h('option', { value: String(n), selected: draft.householdSize === n || undefined }, n === 8 ? '8 or more' : String(n)))),
            h('span', { class: 'hint', id: 'wz-household-hint' }, 'You, your parents or guardians, and anyone they support.')),
          h('div', { class: 'field' },
            h('label', { class: 'label', for: 'wz-income' }, 'Yearly household income'),
            h('select', { id: 'wz-income', class: 'select', 'aria-describedby': 'wz-income-hint', onchange: (e) => pick('incomeBand')(e.target.value || undefined) },
              h('option', { value: '' }, 'Prefer not to say'),
              INCOME_BANDS.map((b) => h('option', { value: b.id, selected: draft.incomeBand === b.id || undefined }, b.label))),
            h('span', { class: 'hint', id: 'wz-income-hint' }, 'Before taxes. A rough range is fine; ask a parent or guardian if you’re not sure.'))),
        h('div', { class: 'field mt-2' },
          h('span', { class: 'label', id: 'wz-benefits' }, 'Does your family get free or reduced-price school lunch, SNAP, Medicaid, or similar help?'),
          singleChips('Family receives free or reduced-price lunch, SNAP, Medicaid, or similar help', [[true, 'Yes'], [false, 'No'], [undefined, 'Prefer not to say']], draft.benefits, pick('benefits'))),
        h('div', { class: 'field' },
          h('span', { class: 'label', id: 'wz-firstgen' }, 'Will you be the first in your family to get a four-year college degree?'),
          singleChips('First-generation college student', [[true, 'Yes'], [false, 'No'], [undefined, 'Not sure']], draft.firstGen, pick('firstGen'))),
        tierNote,
      ];
    },
    () => [
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'wz-goals' }, 'Anything else Zeus should know? ', h('span', { class: 'faint' }, '(optional)')),
        h('textarea', { id: 'wz-goals', class: 'textarea', maxlength: '400', placeholder: 'e.g. "I love building things and want to try research this summer, but I need something close to home."', oninput: (e) => { draft.goals = e.target.value; } }, draft.goals),
        h('span', { class: 'hint' }, 'Avoid personal details like your school, address, or phone number.')),
      h('div', { class: 'callout mt-2' }, icon('shield-check'),
        h('span', { text: 'Your profile is saved only in this browser. Zeus runs in your browser too, so nothing you enter here is sent to a server.' })),
    ],
  ];

  function validate() {
    if (step === 0 && !draft.grade) return 'Please choose your grade.';
    if (step === 1 && !draft.interests.length) return 'Pick at least one interest area.';
    return null;
  }

  function render() {
    body.replaceChildren(...renderers[step]());
    [...progress.children].forEach((bar, i) => bar.classList.toggle('done', i <= step));
    stepLabel.textContent = `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`;
    backBtn.hidden = step === 0;
    nextBtn.replaceChildren(...(step === STEPS.length - 1 ? [icon('sparkles'), 'Build my pathway'] : ['Continue', icon('arrow-right')]));
    refreshIcons();
    body.querySelector('input, button, select, textarea')?.focus();
  }

  const modal = openModal({
    labelledBy: 'wizard-title',
    wide: true,
    build: (close) => {
      backBtn.addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
      nextBtn.addEventListener('click', () => {
        const error = validate();
        if (error) return toast(error, 'error');
        if (step < STEPS.length - 1) { step += 1; render(); return; }
        const profile = saveProfile({ ...draft, grade: Number(draft.grade) });
        close();
        toast('Your pathway profile is ready!', 'success');
        onComplete?.(profile);
      });
      const header = modalHeader('wizard-title', 'Pathway Wizard', null, close);
      header.firstChild.append(stepLabel, progress);
      return [header, body, h('div', { class: 'modal-footer' }, backBtn, nextBtn)];
    },
  });
  render();
  return modal;
}
