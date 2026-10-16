// A real Postgres (PGlite) with the Supabase migrations applied, shared by a
// test file and emptied between tests.
import { localDatabase } from '../../server/db/local.js';

let started;
export async function freshDatabase() {
  started ??= localDatabase();
  const { rpc, db } = await started;
  await db.exec('truncate atlas.accounts, atlas.sessions, atlas.login_links, atlas.rooms, atlas.room_members, atlas.rate_limits, atlas.reviews, atlas.review_reporters, atlas.review_once cascade');
  return { rpc, db };
}
