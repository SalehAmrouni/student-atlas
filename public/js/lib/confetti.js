// The "Submitted!" confetti engine: a short full-screen burst when an
// application moves into Applied. Decorative only (aria-hidden, no pointer
// events). With reduced motion on, it skips the animation and the toast
// still celebrates.

import { getSettings } from './store.js';

const COLORS = ['#047857', '#31c48d', '#6d5bd0', '#1c64f2', '#d61f69', '#faca15', '#f98080'];
const DURATION = 2600;

export function prefersReducedMotion() {
  return getSettings().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let running = false;
export function confetti() {
  if (running || prefersReducedMotion()) return;
  running = true;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const w = window.innerWidth;
  const h = window.innerHeight;
  const count = Math.min(180, Math.round(w / 6));
  const pieces = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -10 : w + 10,
      y: h * (0.55 + Math.random() * 0.35),
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 7),
      vy: -(9 + Math.random() * 9),
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: COLORS[i % COLORS.length],
      shape: i % 3,
    };
  });

  const start = performance.now();
  function frame(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - DURATION * 0.65) / (DURATION * 0.35));
    for (const p of pieces) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(0, -p.size / 2); ctx.lineTo(p.size / 2, p.size / 2); ctx.lineTo(-p.size / 2, p.size / 2); ctx.fill(); }
      ctx.restore();
    }
    if (elapsed < DURATION) requestAnimationFrame(frame);
    else {
      canvas.remove();
      running = false;
    }
  }
  requestAnimationFrame(frame);
}
