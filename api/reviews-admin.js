// Vercel function: GET/POST /api/reviews-admin (moderation, needs REVIEWS_ADMIN_TOKEN).

import { reviewHandlersFromEnv } from '../server/reviews/index.js';

const { admin } = reviewHandlersFromEnv();

export const GET = (request) => admin(request);
export const POST = (request) => admin(request);
