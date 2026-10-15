// Vercel function: GET/POST /api/rooms (classroom rooms and the teacher
// dashboard). See server/accounts/handler.js.

import { accountHandlersFromEnv } from '../server/accounts/index.js';

const { rooms } = accountHandlersFromEnv();

export const GET = (request) => rooms(request);
export const POST = (request) => rooms(request);
