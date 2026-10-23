// Scheduled jobs: /jobs/load-market, /jobs/notify, /jobs/morning, /jobs/digest, /jobs/cleanup, /jobs/backfill-indices.
// Called by pg_cron with the cron secret, or by an admin from the back office.
import { CORS, fail, getUser, isAdminUser, isCron, json, readJson } from '../_shared/shared.ts';
import { backfillIndices, runLoad } from './load.ts';
import { runNotify } from './notify.ts';
import { runDigest } from './digest.ts';
import { runCleanup } from './cleanup.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  let allowed = await isCron(req);
  if (!allowed) {
    const user = await getUser(req);
    allowed = !!user && (await isAdminUser(user.id));
  }
  if (!allowed) return fail(401, 'unauthorized');
  const body = await readJson<{ force?: boolean }>(req);
  switch (route) {
    case 'load-market':
      return json(await runLoad());
    case 'notify':
      return json(await runNotify());
    case 'morning': {
      // Load first, then notify on fresh data.
      const load = await runLoad();
      const notify = await runNotify();
      return json({ load, notify });
    }
    case 'digest':
      return json(await runDigest(!!body.force));
    case 'backfill-indices':
      return json(await backfillIndices());
    case 'cleanup':
      return json(await runCleanup());
    default:
      return fail(404, 'unknown_job');
  }
});
