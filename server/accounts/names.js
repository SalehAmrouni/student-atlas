// Random, friendly Atlas usernames like "🪐 CosmicZeus42". They say nothing
// about the student, which is the point.

import crypto from 'node:crypto';

const EMOJI = ['🪐', '🚀', '🌟', '🦉', '🦊', '🐢', '🌊', '🔭', '🧭', '⚡', '🌱', '🎨', '🧪', '📚', '🦋', '🐬', '🌙', '☄️', '🍀', '🎯', '🐝', '🌋', '🛰️', '🧩'];
const ADJECTIVES = ['Cosmic', 'Brave', 'Swift', 'Bright', 'Clever', 'Lunar', 'Solar', 'Stellar', 'Quiet', 'Bold', 'Curious', 'Mighty', 'Nimble', 'Radiant', 'Steady', 'Vivid', 'Witty', 'Calm', 'Daring', 'Golden', 'Happy', 'Keen', 'Lucky', 'Noble', 'Rapid', 'Sunny', 'Wise', 'Cheerful', 'Electric', 'Gentle'];
const NOUNS = ['Zeus', 'Comet', 'Falcon', 'Otter', 'Panda', 'Nova', 'Atlas', 'Orbit', 'Phoenix', 'Tiger', 'Maple', 'River', 'Summit', 'Voyager', 'Pixel', 'Rocket', 'Sparrow', 'Harbor', 'Canyon', 'Meteor', 'Lynx', 'Koala', 'Quasar', 'Galaxy', 'Willow', 'Badger', 'Dolphin', 'Heron', 'Raven', 'Fox'];

const pick = (list) => list[crypto.randomInt(list.length)];

/** A random username; `digits` grows if names start colliding. */
export function randomUsername(digits = 2) {
  const n = crypto.randomInt(10 ** (digits - 1), 10 ** digits);
  return { emoji: pick(EMOJI), username: `${pick(ADJECTIVES)}${pick(NOUNS)}${n}` };
}

/** Lowercase letters and digits only, so "🪐 CosmicZeus42" and "cosmiczeus42" match. */
export function normalizeUsername(input) {
  const s = String(input ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return s.length >= 4 && s.length <= 40 ? s : null;
}

// Sign-in codes: 10 characters from an alphabet without look-alikes, shown as XXXXX-XXXXX.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function randomSignInCode() {
  let s = '';
  for (let i = 0; i < 10; i += 1) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
export function normalizeSignInCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 10 ? s : null;
}

// Room codes: teachers can pick one (CAREER2026) or get a random one.
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function randomRoomCode() {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
  return s;
}
export function normalizeRoomCode(input) {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 6 && s.length <= 16 ? s : null;
}
