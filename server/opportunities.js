// Opportunities database: loads every JSON file in data/opportunities/,
// validates each record, and exposes search helpers used by the REST API
// and by Zeus's tools.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '..', 'data', 'opportunities');
const STATUS_FILE = path.resolve(here, '..', 'data', 'status.json');

export const CLUSTERS = {
  STEM: { label: 'STEM', description: 'Science, technology, engineering, math, and computing' },
  Health: { label: 'Health & Medicine', description: 'Biomedical research, health careers, and wellness' },
  Business: { label: 'Business & Entrepreneurship', description: 'Startups, finance, economics, and career organizations' },
  Arts: { label: 'Arts & Media', description: 'Visual art, writing, music, theater, film, and journalism' },
  Civics: { label: 'Civics & Leadership', description: 'Government, law, debate, public service, and global affairs' },
  Humanitarian: { label: 'Service & Environment', description: 'Volunteering, community impact, and sustainability' },
  Scholarships: { label: 'Scholarships & College Access', description: 'Money for college and free college-prep support' },
};

export const TYPES = [
  'Internship', 'Research', 'Summer Program', 'Competition', 'Scholarship',
  'Fellowship', 'Club / Organization', 'Volunteering', 'Exchange / Travel',
  'College Access', 'Resource',
];

export const COST_TYPES = ['Free', 'Stipend', 'Award', 'Fee', 'Tuition'];
export const FORMATS = ['In-person', 'Virtual', 'Hybrid', 'Varies'];
export const SEASONS = ['Summer', 'School year', 'Year-round'];

const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), 'URL must use https');

export const OpportunitySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(3).max(120),
  organization: z.string().min(2).max(120),
  cluster: z.enum(Object.keys(CLUSTERS)),
  type: z.enum(TYPES),
  format: z.enum(FORMATS),
  location: z.string().min(2).max(120),
  cost: z.enum(COST_TYPES),
  costNote: z.string().max(200),
  financialAid: z.boolean(),
  grades: z.array(z.number().int().min(9).max(12)).min(1),
  minGPA: z.number().min(0).max(4).nullable(),
  deadline: z.string().max(80),
  deadlineMonth: z.number().int().min(1).max(12).nullable(),
  season: z.enum(SEASONS),
  description: z.string().min(40).max(600),
  url: httpsUrl,
  tags: z.array(z.string().min(2).max(40)).max(12),
  needBased: z.boolean(),
  featured: z.boolean().optional().default(false),
}).strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

// What the weekly checker (scripts/check-opportunities.js) last saw on each opportunity's official
// site. Kept apart from the curated data so automated updates never touch hand-written fields.
export const LINK_STATUSES = ['ok', 'broken', 'error', 'blocked'];
export const StatusEntrySchema = z.object({
  lastChecked: isoDate,
  linkStatus: z.enum(LINK_STATUSES),
  httpStatus: z.number().int().nullable(),
  // This cycle's exact deadline, when the official page states one with a year.
  nextDeadline: isoDate.nullable(),
  deadlineEvidence: z.string().max(240).nullable(),
  // The page says applications are closed or the program has ended.
  applicationsClosed: z.boolean(),
  closedEvidence: z.string().max(240).nullable(),
}).strict();
export const StatusFileSchema = z.record(z.string(), StatusEntrySchema);

/** Checker results keyed by opportunity id ({} when the file doesn't exist yet). */
export function loadStatus(file = STATUS_FILE) {
  if (!fs.existsSync(file)) return {};
  const result = StatusFileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!result.success) {
    const issues = result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; ');
    throw new Error(`status.json: ${issues}`);
  }
  return result.data;
}

/** Adds each opportunity's checker results (nextDeadline, applicationsClosed, ...) to the record. */
export function withStatus(opportunities, status) {
  return opportunities.map((o) => {
    const s = status[o.id];
    if (!s) return o;
    return { ...o, lastChecked: s.lastChecked, linkStatus: s.linkStatus, nextDeadline: s.nextDeadline, applicationsClosed: s.applicationsClosed };
  });
}

export function loadOpportunities(dir = DATA_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const all = [];
  const ids = new Set();

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!Array.isArray(raw)) throw new Error(`${file}: expected a JSON array`);
    raw.forEach((entry, i) => {
      const result = OpportunitySchema.safeParse(entry);
      if (!result.success) {
        const issues = result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; ');
        throw new Error(`${file}[${i}] (${entry?.id ?? 'no id'}): ${issues}`);
      }
      if (ids.has(result.data.id)) throw new Error(`${file}: duplicate id "${result.data.id}"`);
      ids.add(result.data.id);
      all.push(Object.freeze({ ...result.data, grades: [...result.data.grades].sort((a, b) => a - b) }));
    });
  }

  return Object.freeze(all);
}

const normalize = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, ' ');

function searchableText(opp) {
  return normalize([opp.title, opp.organization, opp.description, opp.type, opp.cluster, opp.location, ...opp.tags].join(' '));
}

/**
 * Filter + rank opportunities. Every filter is optional.
 * `query` is matched word-by-word against title, org, description, and tags;
 * results are ranked by how many query words they contain (title hits count double).
 */
export function searchOpportunities(opportunities, filters = {}) {
  const { query, cluster, type, grade, cost, format, needBased, maxGPA, limit } = filters;
  const words = query ? normalize(query).split(/\s+/).filter((w) => w.length > 1) : [];

  const scored = [];
  for (const opp of opportunities) {
    if (cluster && opp.cluster !== cluster) continue;
    if (type && opp.type !== type) continue;
    if (grade && !opp.grades.includes(grade)) continue;
    if (cost && opp.cost !== cost) continue;
    if (format && opp.format !== format) continue;
    if (needBased && !(opp.needBased || opp.financialAid || opp.cost === 'Free' || opp.cost === 'Stipend')) continue;
    if (typeof maxGPA === 'number' && opp.minGPA !== null && opp.minGPA > maxGPA) continue;

    let score = 1;
    if (words.length) {
      const text = searchableText(opp);
      const title = normalize(opp.title);
      score = 0;
      for (const w of words) {
        if (text.includes(w)) score += 1;
        if (title.includes(w)) score += 1;
      }
      if (score === 0) continue;
    }
    scored.push({ opp, score });
  }

  scored.sort((a, b) => b.score - a.score || Number(b.opp.featured) - Number(a.opp.featured) || a.opp.title.localeCompare(b.opp.title));
  const results = scored.map((s) => s.opp);
  return typeof limit === 'number' ? results.slice(0, limit) : results;
}
