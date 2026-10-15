// Validation and content checks for opportunity reviews. Pure functions, so
// the same rules run in the Vercel function, the local server, and tests.

export const LIMITS = {
  titleMax: 80,
  bodyMin: 20,
  bodyMax: 1000,
  nameMax: 40,
  reasonMax: 200,
  requestBytes: 4096,
};

export const ROLES = ['Student', 'Parent or guardian', 'Teacher or counselor', 'Other'];
export const EXPERIENCES = ['Participated', 'Applied', 'Researched it'];
export const REPORT_REASONS = ['Spam or advertising', 'Rude or hateful', 'Personal information', 'False or misleading', 'Other'];

const OPP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVIEW_ID = /^[a-z0-9]{8,32}$/;

// Students are minors: contact details and links are refused outright so
// nobody can use reviews to reach them or advertise.
const CONTACT_PATTERNS = [
  { re: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, message: 'Please remove the email address. Reviews are public.' },
  { re: /(?:\+?\d[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/, message: 'Please remove the phone number. Reviews are public.' },
  { re: /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|gg|xyz|info|biz)\b/i, message: 'Links aren’t allowed in reviews.' },
  { re: /(?:^|\s)@[a-z0-9_.]{3,}/i, message: 'Please remove social media handles. Reviews are public.' },
];

// Words that send a review to moderation instead of publishing it right away.
// Deliberately short: moderators make the final call.
const HOLD_WORDS = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard', 'slut', 'whore',
  'retard', 'fag', 'nigger', 'nigga', 'kike', 'spic', 'chink', 'tranny',
  'kill yourself', 'kys', 'scam', 'onlyfans', 'telegram', 'whatsapp', 'snapchat', 'discord', 'venmo', 'cashapp', 'crypto',
];
const HOLD_RE = new RegExp(`\\b(?:${HOLD_WORDS.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})`, 'i');

const clean = (value) => (typeof value === 'string'
  ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  : '');

export const isOpportunityId = (id) => typeof id === 'string' && id.length <= 100 && OPP_ID.test(id);
export const isReviewId = (id) => typeof id === 'string' && REVIEW_ID.test(id);

/**
 * Validates a new review. Returns { errors } (field -> message) or
 * { review, flags } where flags lists reasons to hold it for moderation.
 */
export function validateReview(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  const rating = Number(src.rating);
  const title = clean(src.title);
  const body = clean(src.body);
  const name = clean(src.name).replace(/\n/g, ' ');
  const role = ROLES.includes(src.role) ? src.role : null;
  const experience = EXPERIENCES.includes(src.experience) ? src.experience : null;

  if (!isOpportunityId(src.opportunityId)) errors.opportunityId = 'Unknown opportunity.';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'Choose a rating from 1 to 5 stars.';
  if (title.length > LIMITS.titleMax) errors.title = `Keep the headline under ${LIMITS.titleMax} characters.`;
  if (body.length < LIMITS.bodyMin) errors.body = `Please write at least ${LIMITS.bodyMin} characters.`;
  else if (body.length > LIMITS.bodyMax) errors.body = `Please keep your review under ${LIMITS.bodyMax} characters.`;
  if (name.length > LIMITS.nameMax) errors.name = `Keep the name under ${LIMITS.nameMax} characters.`;
  if (!role) errors.role = 'Tell us how you know this opportunity.';
  if (!experience) errors.experience = 'Tell us about your experience with it.';
  if (src.agree !== true) errors.agree = 'Please confirm your review follows the guidelines.';

  for (const [field, text] of [['title', title], ['body', body], ['name', name]]) {
    if (errors[field]) continue;
    const hit = CONTACT_PATTERNS.find((p) => p.re.test(text));
    if (hit) errors[field] = hit.message;
  }
  if (Object.keys(errors).length) return { errors };

  const flags = [];
  const all = `${title}\n${body}\n${name}`;
  if (HOLD_RE.test(all)) flags.push('language');
  const letters = body.replace(/[^a-z]/gi, '');
  if (letters.length >= 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) flags.push('shouting');
  if (/(.)\1{7,}/.test(all)) flags.push('repetition');

  return {
    review: { opportunityId: src.opportunityId, rating, title, body, name: name || 'Anonymous', role, experience },
    flags,
  };
}

export function validateReport(input) {
  const src = input && typeof input === 'object' ? input : {};
  if (!isReviewId(src.reviewId)) return { error: 'Unknown review.' };
  const reason = REPORT_REASONS.includes(src.reason) ? src.reason : 'Other';
  return { reviewId: src.reviewId, reason };
}

/** The fields of a stored review that are safe to show publicly. */
export function publicReview(r) {
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    name: r.name,
    role: r.role,
    experience: r.experience,
    createdAt: r.createdAt,
  };
}
