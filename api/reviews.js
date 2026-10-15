// Vercel function: GET/POST /api/reviews. See server/reviews/handler.js.

import { reviewHandlersFromEnv } from '../server/reviews/index.js';

const { reviews } = reviewHandlersFromEnv();

export const GET = (request) => reviews(request);
export const POST = (request) => reviews(request);
