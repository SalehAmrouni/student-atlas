// Vercel function: GET/POST /api/account (anonymous accounts and cloud sync).
// See server/accounts/handler.js.

import { accountHandlersFromEnv } from '../server/accounts/index.js';

const { account } = accountHandlersFromEnv();

export const GET = (request) => account(request);
export const POST = (request) => account(request);
