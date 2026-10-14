// Community resource submissions: validated server-side and appended to a
// JSON Lines review queue (data/submissions/queue.jsonl, not committed).
// Nothing submitted here is published automatically.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CLUSTERS, TYPES } from './opportunities.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = process.env.SUBMISSIONS_DIR || path.resolve(here, '..', 'data', 'submissions');
const QUEUE_FILE = path.join(QUEUE_DIR, 'queue.jsonl');
const MAX_QUEUE_BYTES = 5 * 1024 * 1024;

const clean = (max) => z.string().trim().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));

export const SubmissionSchema = z.object({
  title: clean(120).pipe(z.string().min(3)),
  organization: clean(120).pipe(z.string().min(2)),
  url: z.string().trim().max(500).url().refine((u) => /^https?:\/\//i.test(u), 'Website must start with http:// or https://'),
  cluster: z.enum(Object.keys(CLUSTERS)),
  type: z.enum(TYPES),
  grades: z.array(z.number().int().min(9).max(12)).min(1).max(4),
  description: clean(1000).pipe(z.string().min(30, 'Please describe the opportunity in at least 30 characters')),
  cost: clean(80).optional().default(''),
  deadline: clean(80).optional().default(''),
  submitterRole: z.enum(['Student', 'Parent or guardian', 'Teacher or counselor', 'Organization staff', 'Program alumni', 'Community member']),
  contactEmail: z.union([z.literal(''), z.string().trim().max(200).email()]).optional().default(''),
  consent: z.literal(true, { message: 'Please confirm the information is accurate' }),
  // Honeypot: real users never see or fill this field.
  website2: z.string().max(500).optional().default(''),
}).strict();

export async function saveSubmission(data) {
  await fs.mkdir(QUEUE_DIR, { recursive: true });
  try {
    const { size } = await fs.stat(QUEUE_FILE);
    if (size > MAX_QUEUE_BYTES) throw Object.assign(new Error('Submission queue is full'), { status: 503 });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const { website2: _honeypot, consent: _consent, ...fields } = data;
  const record = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    status: 'pending-review',
    ...fields,
  };
  await fs.appendFile(QUEUE_FILE, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record.id;
}
