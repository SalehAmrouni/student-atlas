// "Track application" button and the editor dialog for one tracked
// application: status, dates, steps, events, and notes.

import { h, icon, openModal, modalHeader, toast, refreshIcons } from './dom.js';
import { getTracker, saveTrackerItem } from './store.js';
import { STATUSES, COMMON_TASKS, statusInfo, itemFromOpportunity, newId, isValidDate } from './applications.js';

export function statusBadge(status) {
  const s = statusInfo(status);
  return h('span', { class: `badge status-badge status-${s.group}` }, icon(s.icon), s.label);
}

export function statusSelect(value, { id, label, onChange } = {}) {
  return h('select', { class: 'select', id, 'aria-label': label, onchange: (e) => onChange?.(e.target.value) },
    STATUSES.map((s) => h('option', { value: s.id, selected: s.id === value || undefined }, s.label)));
}

/** Button that starts tracking an opportunity, or edits it if already tracked. */
export function trackButton(opp, { onChange } = {}) {
  const btn = h('button', { type: 'button', class: 'btn btn-outline' });
  const paint = () => {
    const item = getTracker()[opp.id];
    // Hidden context goes after the visible text so the name still starts with it (WCAG 2.5.3).
    btn.replaceChildren(icon(item ? 'list-checks' : 'list-plus'), item ? `Tracking: ${statusInfo(item.status).label}` : 'Track application',
      h('span', { class: 'visually-hidden', text: item ? `, edit your application for ${opp.title}` : ` for ${opp.title}` }));
    refreshIcons();
  };
  btn.addEventListener('click', () => openTrackEditor({ opp, onSaved: () => { paint(); onChange?.(); } }));
  paint();
  return btn;
}

/**
 * Opens the editor. Pass `opp` for a directory opportunity, `item` to edit an
 * existing entry, or neither to add an opportunity that isn't in the directory.
 */
export function openTrackEditor({ opp = null, item = null, onSaved } = {}) {
  const existing = item ?? (opp ? getTracker()[opp.id] : null);
  const isCustom = !opp && !existing?.oppId;
  const draft = structuredClone(existing ?? (opp ? itemFromOpportunity(opp) : { id: newId('custom'), title: '', status: 'interested', tasks: [], events: [] }));
  const titleId = 'track-title';
  const errors = h('div', { class: 'field-error', role: 'alert' });

  const field = (id, labelText, control, hint) => h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, labelText), control, hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null);
  const textInput = (id, key, attrs = {}) => h('input', { id, class: 'input', value: draft[key] ?? '', oninput: (e) => { draft[key] = e.target.value; }, ...attrs });
  const dateInput = (id, key) => h('input', { id, class: 'input', type: 'date', value: draft[key] ?? '', onchange: (e) => { draft[key] = e.target.value || undefined; } });

  // ---- steps (checklist) ----
  const taskList = h('ul', { class: 'task-list' });
  const paintTasks = () => {
    taskList.replaceChildren(...draft.tasks.map((t) => h('li', {},
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: t.done || undefined, onchange: (e) => { t.done = e.target.checked; } }),
        h('span', { text: t.text })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Remove step: ${t.text}`, onclick: () => { draft.tasks = draft.tasks.filter((x) => x !== t); paintTasks(); } }, icon('x')))));
    if (!draft.tasks.length) taskList.append(h('li', { class: 'muted small' }, 'No steps yet.'));
    refreshIcons();
  };
  const newTask = h('input', { id: 'track-new-task', class: 'input', maxlength: '140', placeholder: 'e.g. Ask Ms. Lee for a recommendation' });
  const addTask = () => {
    const text = newTask.value.trim();
    if (!text) return newTask.focus();
    draft.tasks.push({ id: newId('t'), text, done: false });
    newTask.value = '';
    paintTasks();
    newTask.focus();
  };
  newTask.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });

  // ---- events ----
  const eventList = h('ul', { class: 'task-list' });
  const paintEvents = () => {
    const sorted = [...draft.events].sort((a, b) => a.date.localeCompare(b.date));
    eventList.replaceChildren(...sorted.map((ev) => h('li', {},
      h('span', {}, icon('calendar'), h('strong', { text: ev.title }), h('span', { class: 'muted small', text: ` ${ev.date}${ev.time ? ` at ${ev.time}` : ''}` })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Remove event: ${ev.title}`, onclick: () => { draft.events = draft.events.filter((x) => x !== ev); paintEvents(); } }, icon('x')))));
    if (!draft.events.length) eventList.append(h('li', { class: 'muted small' }, 'No events yet. Add interviews, info sessions, or program start dates.'));
    refreshIcons();
  };
  const evTitle = h('input', { id: 'track-ev-title', class: 'input', maxlength: '120', placeholder: 'e.g. Interview' });
  const evDate = h('input', { id: 'track-ev-date', class: 'input', type: 'date' });
  const evTime = h('input', { id: 'track-ev-time', class: 'input', type: 'time' });
  const addEvent = () => {
    if (!evTitle.value.trim()) { toast('Give the event a name.', 'error'); return evTitle.focus(); }
    if (!isValidDate(evDate.value)) { toast('Pick a date for the event.', 'error'); return evDate.focus(); }
    draft.events.push({ id: newId('e'), title: evTitle.value.trim(), date: evDate.value, time: evTime.value || undefined });
    evTitle.value = '';
    evTime.value = '';
    paintEvents();
    evTitle.focus();
  };

  openModal({
    labelledBy: titleId,
    wide: true,
    build: (close) => {
      const save = () => {
        if (!draft.title?.trim()) {
          errors.textContent = 'Add the name of the opportunity.';
          document.getElementById('track-name')?.focus();
          return;
        }
        if (draft.url && !/^https?:\/\//i.test(draft.url.trim())) {
          errors.textContent = 'The website should start with https://';
          document.getElementById('track-url')?.focus();
          return;
        }
        const saved = saveTrackerItem(draft.id, draft);
        close();
        // A move into Applied gets its own celebration (celebrate.js).
        if (draft.status !== 'submitted' || existing?.status === 'submitted') toast(existing ? 'Application updated' : `Tracking ${saved.title}`, 'success');
        onSaved?.(saved);
      };
      const remove = () => {
        if (!confirm(`Stop tracking ${draft.title}? Your dates, steps, and notes for it will be deleted.`)) return;
        saveTrackerItem(draft.id, null);
        close();
        toast('Removed from your tracker');
        onSaved?.(null);
      };
      paintTasks();
      paintEvents();
      return [
        modalHeader(titleId, existing ? 'Edit application' : isCustom ? 'Add an opportunity' : 'Track this application', isCustom ? 'For anything that isn’t in the directory yet.' : draft.title, close),
        h('div', { class: 'modal-body' },
          isCustom ? h('div', { class: 'form-grid' },
            field('track-name', 'Name *', textInput('track-name', 'title', { maxlength: '140', required: true, autocomplete: 'off' })),
            field('track-org', 'Organization', textInput('track-org', 'organization', { maxlength: '120', autocomplete: 'off' })),
            field('track-url', 'Website', textInput('track-url', 'url', { type: 'url', maxlength: '400', placeholder: 'https://', inputmode: 'url' }))) : null,
          h('div', { class: `form-grid${isCustom ? ' mt-2' : ''}` },
            field('track-status', 'Status', statusSelect(draft.status, { id: 'track-status', onChange: (v) => { draft.status = v; } })),
            field('track-deadline', 'Deadline', dateInput('track-deadline', 'deadline'), opp ? `Usually: ${opp.deadline}. Check the official site for this year’s date.` : null),
            field('track-submitted', 'Date I applied', dateInput('track-submitted', 'submittedOn')),
            field('track-decision', 'Decision expected', dateInput('track-decision', 'decisionOn'))),
          h('fieldset', { class: 'fieldset mt-3' },
            h('legend', {}, 'Steps to finish'),
            taskList,
            h('div', { class: 'inline-add' },
              h('label', { class: 'visually-hidden', for: 'track-new-task' }, 'New step'),
              newTask,
              h('button', { type: 'button', class: 'btn btn-outline', onclick: addTask }, icon('plus'), 'Add step')),
            h('button', {
              type: 'button', class: 'btn btn-ghost btn-sm mt-1',
              onclick: () => {
                const have = new Set(draft.tasks.map((t) => t.text));
                for (const text of COMMON_TASKS) if (!have.has(text)) draft.tasks.push({ id: newId('t'), text, done: false });
                paintTasks();
              },
            }, icon('list-plus'), 'Add the usual steps')),
          h('fieldset', { class: 'fieldset mt-3' },
            h('legend', {}, 'Events'),
            eventList,
            h('div', { class: 'event-add' },
              h('div', { class: 'field' }, h('label', { class: 'label', for: 'track-ev-title' }, 'Event'), evTitle),
              h('div', { class: 'field' }, h('label', { class: 'label', for: 'track-ev-date' }, 'Date'), evDate),
              h('div', { class: 'field' }, h('label', { class: 'label', for: 'track-ev-time' }, 'Time ', h('span', { class: 'faint' }, '(optional)')), evTime),
              h('button', { type: 'button', class: 'btn btn-outline', onclick: addEvent }, icon('calendar-plus'), 'Add event'))),
          h('div', { class: 'field mt-3' },
            h('label', { class: 'label', for: 'track-notes' }, 'Notes'),
            h('textarea', { id: 'track-notes', class: 'textarea', maxlength: '2000', placeholder: 'Essay prompts, who you asked for letters, login reminders (never passwords)…', oninput: (e) => { draft.notes = e.target.value; } }, draft.notes ?? '')),
          errors),
        h('div', { class: 'modal-footer' },
          existing ? h('button', { type: 'button', class: 'btn btn-danger me-auto', onclick: remove }, icon('trash-2'), 'Stop tracking') : null,
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, icon('check'), existing ? 'Save changes' : 'Start tracking')),
      ];
    },
  });
}
