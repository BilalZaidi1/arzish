// Back-office actions. Every change is checked against the caller's admin role and written to the audit log.
import { addNotification, admin, audit, fail, getSecret, getUser, isAdminUser, json, readJson, SUPABASE_URL } from '../_shared/shared.ts';
import { appUrl, esc, layout, sendEmail } from '../_shared/email.ts';
import { wants, type Prefs } from '../_shared/kinds.ts';

type Json = Record<string, any>;
const DAY = 864e5;

const PLAN_FIELDS = ['name', 'price_pkr_month', 'price_pkr_year', 'price_usd_month', 'price_usd_year', 'limits', 'features', 'safepay_plan_month', 'safepay_plan_year', 'public', 'sort'];
const SUB_FIELDS = ['status', 'current_period_end', 'cancel_at_period_end', 'note', 'plan_id'];

async function extendFrom(userId: string, planId: string): Promise<number> {
  const { data } = await admin.from('subscriptions').select('current_period_end').eq('user_id', userId).eq('plan_id', planId).in('status', ['trialing', 'active']).order('current_period_end', { ascending: false }).limit(1);
  return Math.max(Date.now(), data?.[0]?.current_period_end ? Date.parse(data[0].current_period_end) : 0);
}

async function emailUser(userId: string, subject: string, title: string, bodyText: string, kind: string): Promise<boolean> {
  const { data: p } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
  if (!p?.email) return false;
  const open = await appUrl('/app');
  const html = layout({ title, body: `<p style="white-space:pre-wrap">${esc(bodyText)}</p>`, cta: open.startsWith('http') ? { label: 'Open Arzish', url: open } : undefined });
  return (await sendEmail({ to: p.email, subject, html, text: bodyText, kind, userId })).ok;
}

export async function adminAction(req: Request): Promise<Response> {
  const me = await getUser(req);
  if (!me || !(await isAdminUser(me.id))) return fail(403, 'forbidden', 'Admins only.');
  const b = await readJson<Json>(req);
  const action = String(b.action ?? '');
  const now = new Date().toISOString();

  switch (action) {
    // ---------------------------------------------------------------- service status (no secret values)
    case 'status':
      return json({
        anthropic: !!Deno.env.get('ANTHROPIC_API_KEY'),
        safepay: !!Deno.env.get('SAFEPAY_SECRET_KEY'),
        safepayWebhook: !!Deno.env.get('SAFEPAY_WEBHOOK_SECRET'),
        resend: !!(await getSecret('resend_api_key')),
        webhookUrl: `${SUPABASE_URL}/functions/v1/api/billing/webhook`,
      });

    // ---------------------------------------------------------------- users
    case 'user.grant': {
      const plan = String(b.plan ?? 'pro');
      const days = Math.max(1, Math.min(3660, Math.round(Number(b.days) || 30)));
      const end = new Date((await extendFrom(b.userId, plan)) + days * DAY).toISOString();
      const { data, error } = await admin.from('subscriptions').insert({ user_id: b.userId, plan_id: plan, status: 'active', source: 'admin', current_period_start: now, current_period_end: end, note: String(b.note ?? 'Granted by admin').slice(0, 200) }).select('*').single();
      if (error) return fail(400, 'grant_failed', error.message);
      await audit(me.id, action, 'user', b.userId, null, { plan, days, until: end });
      if (b.notify !== false) await addNotification(b.userId, { kind: 'billing', title: `You have ${plan === 'pro' ? 'Pro' : plan} until ${end.slice(0, 10)}`, body: String(b.message ?? 'Enjoy the extra features.').slice(0, 300), link: '#billing' });
      return json({ ok: true, subscription: data });
    }
    case 'subscription.update': {
      const { data: before } = await admin.from('subscriptions').select('*').eq('id', b.id).maybeSingle();
      if (!before) return fail(404, 'not_found');
      const patch: Json = { updated_at: now };
      for (const k of SUB_FIELDS) if (k in (b.patch ?? {})) patch[k] = b.patch[k];
      const { error } = await admin.from('subscriptions').update(patch).eq('id', b.id);
      if (error) return fail(400, 'update_failed', error.message);
      await audit(me.id, action, 'subscription', String(b.id), before, patch);
      return json({ ok: true });
    }
    case 'user.reset_ai': {
      await admin.from('profiles').update({ ai_reset_at: now }).eq('id', b.userId);
      await audit(me.id, action, 'user', b.userId, null, { ai_reset_at: now });
      return json({ ok: true });
    }
    case 'user.disable': {
      const disabled = !!b.disabled;
      if (b.userId === me.id && disabled) return fail(400, 'self', 'You cannot disable your own account.');
      await admin.from('profiles').update({ disabled }).eq('id', b.userId);
      await admin.auth.admin.updateUserById(b.userId, { ban_duration: disabled ? '876000h' : 'none' });
      await audit(me.id, action, 'user', b.userId, null, { disabled });
      return json({ ok: true });
    }
    case 'user.role': {
      const role = b.role === 'admin' ? 'admin' : 'user';
      if (b.userId === me.id && role !== 'admin') return fail(400, 'self', 'You cannot remove your own admin role.');
      await admin.from('profiles').update({ role }).eq('id', b.userId);
      await audit(me.id, action, 'user', b.userId, null, { role });
      return json({ ok: true });
    }
    case 'user.notify': {
      const title = String(b.title ?? '').trim().slice(0, 140);
      if (!title) return fail(400, 'title_required', 'Add a title.');
      const text = String(b.body ?? '').slice(0, 1000);
      await addNotification(b.userId, { kind: 'announcement', title, body: text, link: b.link ? String(b.link).slice(0, 200) : undefined });
      const emailed = b.email ? await emailUser(b.userId, title, title, text, 'admin-message') : false;
      await audit(me.id, action, 'user', b.userId, null, { title, emailed });
      return json({ ok: true, emailed });
    }
    case 'user.delete': {
      if (b.userId === me.id) return fail(400, 'self', 'Delete your own account from Account settings.');
      const { error } = await admin.auth.admin.deleteUser(b.userId);
      if (error) return fail(400, 'delete_failed', error.message);
      await audit(me.id, action, 'user', b.userId, null, null);
      return json({ ok: true });
    }
    case 'payment.record': {
      // A payment taken outside the card gateway (bank transfer, wallet): record it and grant the plan.
      const plan = String(b.plan ?? 'pro');
      const interval = b.interval === 'year' ? 'year' : 'month';
      const days = Math.round(Number(b.days) || (interval === 'year' ? 365 : 30));
      const end = new Date((await extendFrom(b.userId, plan)) + days * DAY).toISOString();
      const { data: sub, error } = await admin.from('subscriptions').insert({ user_id: b.userId, plan_id: plan, status: 'active', interval, source: 'admin', current_period_start: now, current_period_end: end, note: String(b.note ?? 'Manual payment').slice(0, 200) }).select('id').single();
      if (error) return fail(400, 'record_failed', error.message);
      await admin.from('payments').insert({ user_id: b.userId, subscription_id: sub.id, plan_id: plan, interval, amount: Number(b.amount) || null, currency: String(b.currency ?? 'PKR'), provider: 'manual', provider_ref: b.ref ? String(b.ref).slice(0, 100) : null, status: 'paid', raw: { note: b.note ?? null, by: me.email } });
      await audit(me.id, action, 'user', b.userId, null, { plan, interval, days, amount: b.amount, currency: b.currency });
      await addNotification(b.userId, { kind: 'billing', title: `Payment received: ${plan === 'pro' ? 'Pro' : plan} until ${end.slice(0, 10)}`, body: 'Thank you. Your plan is active.', link: '#billing' });
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- plans and coupons
    case 'plan.update': {
      const { data: before } = await admin.from('plans').select('*').eq('id', b.id).maybeSingle();
      if (!before) return fail(404, 'not_found');
      const patch: Json = {};
      for (const k of PLAN_FIELDS) if (k in (b.patch ?? {})) patch[k] = b.patch[k];
      const { error } = await admin.from('plans').update(patch).eq('id', b.id);
      if (error) return fail(400, 'update_failed', error.message);
      await audit(me.id, action, 'plan', b.id, before, patch);
      return json({ ok: true });
    }
    case 'coupon.create': {
      const code = String(b.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (code.length < 4) return fail(400, 'bad_code', 'Codes need at least 4 letters or digits.');
      const row = { code, kind: 'pro_days', value: Math.max(1, Math.min(3660, Math.round(Number(b.value) || 30))), max_redemptions: b.max_redemptions ? Math.round(Number(b.max_redemptions)) : null, expires_at: b.expires_at || null, note: b.note ? String(b.note).slice(0, 200) : null };
      const { error } = await admin.from('coupons').insert(row);
      if (error) return fail(400, 'create_failed', /duplicate/i.test(error.message) ? 'That code already exists.' : error.message);
      await audit(me.id, action, 'coupon', code, null, row);
      return json({ ok: true });
    }
    case 'coupon.update': {
      const patch: Json = {};
      if ('active' in b) patch.active = !!b.active;
      if ('max_redemptions' in b) patch.max_redemptions = b.max_redemptions ? Math.round(Number(b.max_redemptions)) : null;
      if ('expires_at' in b) patch.expires_at = b.expires_at || null;
      await admin.from('coupons').update(patch).eq('code', b.code);
      await audit(me.id, action, 'coupon', b.code, null, patch);
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- messages
    case 'announcement.save': {
      const row: Json = {
        title: String(b.title ?? '').trim().slice(0, 140), body: b.body ? String(b.body).slice(0, 2000) : null, link: b.link ? String(b.link).slice(0, 300) : null,
        audience: ['all', 'free', 'paid'].includes(b.audience) ? b.audience : 'all', starts_at: b.starts_at || now, ends_at: b.ends_at || null,
      };
      if (!row.title) return fail(400, 'title_required', 'Add a title.');
      let id = b.id;
      if (id) await admin.from('announcements').update(row).eq('id', id);
      else id = (await admin.from('announcements').insert({ ...row, created_by: me.id }).select('id').single()).data?.id;
      await audit(me.id, action, 'announcement', String(id), null, row);
      return json({ ok: true, id });
    }
    case 'announcement.delete': {
      await admin.from('announcements').delete().eq('id', b.id);
      await audit(me.id, action, 'announcement', String(b.id), null, null);
      return json({ ok: true });
    }
    case 'announcement.email': {
      const { data: a } = await admin.from('announcements').select('*').eq('id', b.id).maybeSingle();
      if (!a) return fail(404, 'not_found');
      if (a.emailed_at && !b.force) return fail(400, 'already_sent', 'This announcement was already emailed.');
      const { data: profiles } = await admin.from('profiles').select('id, email, marketing_opt_in, disabled').eq('disabled', false);
      const { data: prefRows } = await admin.from('notification_prefs').select('user_id, prefs');
      const prefsBy = new Map<string, Prefs>((prefRows ?? []).map((r: Json) => [r.user_id, r.prefs ?? {}]));
      let sent = 0, skipped = 0;
      const open = await appUrl('/app');
      for (const p of profiles ?? []) {
        if (!p.email || !(p.marketing_opt_in || wants(prefsBy.get(p.id), 'announcement', 'email'))) { skipped++; continue; }
        if (a.audience !== 'all') {
          const { data: plan } = await admin.rpc('plan_for', { uid: p.id });
          const paid = plan && plan.plan !== 'free' && plan.status !== 'trialing';
          if ((a.audience === 'paid') !== !!paid) { skipped++; continue; }
        }
        const html = layout({ title: a.title, body: a.body ? `<p style="white-space:pre-wrap">${esc(a.body)}</p>` : '', cta: a.link ? { label: 'Read more', url: a.link } : open.startsWith('http') ? { label: 'Open Arzish', url: open } : undefined });
        const r = await sendEmail({ to: p.email, subject: a.title, html, text: `${a.title}\n\n${a.body ?? ''}`, kind: 'announcement', userId: p.id, idempotencyKey: `ann-${a.id}-${p.id}` });
        if (r.ok) sent++;
        else skipped++;
      }
      await admin.from('announcements').update({ emailed_at: now }).eq('id', a.id);
      await audit(me.id, action, 'announcement', String(a.id), null, { sent, skipped });
      return json({ ok: true, sent, skipped });
    }
    case 'feedback.reply': {
      const { data: f } = await admin.from('feedback').select('*').eq('id', b.id).maybeSingle();
      if (!f) return fail(404, 'not_found');
      const reply = String(b.reply ?? '').trim().slice(0, 4000);
      if (!reply) return fail(400, 'reply_required', 'Write a reply.');
      await admin.from('feedback').update({ reply, status: 'answered', replied_at: now }).eq('id', f.id);
      let emailed = false;
      if (f.user_id) {
        await addNotification(f.user_id, { kind: 'feedback_reply', title: 'We replied to your message', body: reply.slice(0, 300), link: '#feedback' });
        emailed = await emailUser(f.user_id, 'Re: your message to Arzish', 'We replied to your message', `${reply}\n\n— You wrote: ${String(f.message).slice(0, 600)}`, 'feedback-reply');
      }
      await audit(me.id, action, 'feedback', String(f.id), { status: f.status }, { status: 'answered', emailed });
      return json({ ok: true, emailed });
    }
    case 'feedback.status': {
      const status = ['open', 'answered', 'closed'].includes(b.status) ? b.status : 'closed';
      await admin.from('feedback').update({ status }).eq('id', b.id);
      await audit(me.id, action, 'feedback', String(b.id), null, { status });
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- settings and data
    case 'setting.set': {
      const key = String(b.key ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 60);
      if (!key) return fail(400, 'bad_key');
      const { data: before } = await admin.from('app_settings').select('value, public').eq('key', key).maybeSingle();
      const row = { key, value: b.value ?? null, public: typeof b.public === 'boolean' ? b.public : before?.public ?? false, updated_at: now };
      const { error } = await admin.from('app_settings').upsert(row);
      if (error) return fail(400, 'save_failed', error.message);
      await audit(me.id, action, 'setting', key, before?.value ?? null, row.value);
      return json({ ok: true });
    }
    case 'market.patch': {
      const patch = b.patch && typeof b.patch === 'object' ? b.patch : null;
      if (!patch) return fail(400, 'bad_patch', 'Nothing to change.');
      const { data, error } = await admin.from('market_patches').insert({ source: 'admin', patch, note: b.note ? String(b.note).slice(0, 300) : `By ${me.email}` }).select('id').single();
      if (error) return fail(400, 'save_failed', error.message);
      await audit(me.id, action, 'market_patch', String(data.id), null, patch);
      return json({ ok: true, id: data.id });
    }
    case 'email.test': {
      const html = layout({ title: 'Test email from Arzish', intro: 'If you can read this, sending works.', note: `Sent from the back office at ${now}.` });
      const r = await sendEmail({ to: me.email, subject: 'Arzish test email', html, text: 'If you can read this, sending works.', kind: 'test', userId: me.id });
      await audit(me.id, action, 'email', me.email, null, r);
      return r.ok ? json({ ok: true }) : fail(502, 'send_failed', r.error ?? 'Send failed');
    }
    default:
      return fail(400, 'unknown_action', `Unknown action ${action}`);
  }
}
