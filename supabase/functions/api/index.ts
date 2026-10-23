// Arzish web API: sign-in codes, the AI proxy, billing, account actions, unsubscribe links and the
// back office. Each route checks its own caller (signed-in user, admin, or Safepay signature).
import { CORS, fail, json } from '../_shared/shared.ts';
import { authCode } from './auth.ts';
import { ai } from './ai.ts';
import { cancel, checkout, redeem, webhook } from './billing.ts';
import { claimReferral, deleteAccount, feedback, unsubscribe } from './account.ts';
import { adminAction } from './admin.ts';

const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  'auth-code': authCode,
  ai,
  feedback,
  'account/delete': deleteAccount,
  'account/referral': claimReferral,
  'billing/checkout': checkout,
  'billing/cancel': cancel,
  'billing/redeem': redeem,
  'billing/webhook': webhook,
  unsubscribe,
  admin: adminAction,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const at = parts.indexOf('api');
  const route = parts.slice(at + 1).join('/');
  if (route === 'health') return json({ ok: true, at: new Date().toISOString() });
  const handler = ROUTES[route];
  if (!handler) return fail(404, 'not_found', `No route ${route}`);
  if (req.method !== 'POST' && route !== 'unsubscribe') return fail(405, 'method_not_allowed');
  try {
    return await handler(req);
  } catch (e) {
    console.error(route, e);
    return fail(500, 'server_error', 'Something went wrong. Try again.');
  }
});
