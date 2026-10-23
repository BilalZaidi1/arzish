// Nightly housekeeping: expired sign-in codes, old notifications, logs and abandoned checkouts.
import { admin, logJob } from '../_shared/shared.ts';

const ago = (days: number): string => new Date(Date.now() - days * 864e5).toISOString();

export async function runCleanup(): Promise<Record<string, unknown>> {
  const info: Record<string, unknown> = {};
  const steps: [string, () => PromiseLike<{ error: { message: string } | null; count?: number | null }>][] = [
    ['authCodes', () => admin.from('auth_codes').delete({ count: 'exact' }).lt('expires_at', ago(1))],
    ['notifications', () => admin.from('notifications').delete({ count: 'exact' }).lt('created_at', ago(180))],
    ['jobRuns', () => admin.from('job_runs').delete({ count: 'exact' }).lt('ran_at', ago(90))],
    ['checkouts', () => admin.from('checkout_sessions').delete({ count: 'exact' }).is('completed_at', null).lt('created_at', ago(30))],
    ['billingEvents', () => admin.from('billing_events').delete({ count: 'exact' }).lt('received_at', ago(365))],
  ];
  let ok = true;
  for (const [name, run] of steps) {
    const { error, count } = await run();
    info[name] = error ? `error: ${error.message}` : count ?? 0;
    if (error) ok = false;
  }
  await logJob('cleanup', ok, info);
  return { ok, ...info };
}
