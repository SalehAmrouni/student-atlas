// Celebrates an application moving into Applied (store.js fires the event).

import { toast } from './dom.js';
import { confetti } from './confetti.js';

let wired = false;
export function confettiOnApplied() {
  if (wired) return;
  wired = true;
  window.addEventListener('atlas:applied', (e) => {
    confetti();
    toast(`Submitted! 🎉 Nice work on ${e.detail?.title ?? 'your application'}.`, 'success');
  });
}
