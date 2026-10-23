"""A small in-memory stand-in for Arzish's Supabase project (REST, RPC, auth, edge functions and
realtime), used by the browser QA script. Not a full PostgREST: it understands the filters and
headers the web app actually sends."""
import base64
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
SUPABASE = 'https://qgmltrboyhnwnugyrcek.supabase.co'
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.isoformat().replace('+00:00', 'Z')


def day(d):
    return (NOW + timedelta(days=d)).date().isoformat()


def fixture(name):
    with open(os.path.join(HERE, 'fixtures', name)) as f:
        return json.load(f)


UID = '7d0c6a4e-1b2f-4c3d-9e8f-0a1b2c3d4e5f'
EMAIL = 'sana.test@example.com'

FREE_LIMITS = {'goals': 2, 'alerts': 3, 'import': False, 'ai_month': 5, 'holdings': 25, 'portfolios': 1, 'pro_screens': False, 'ai_usd_month': 0.5, 'email_alerts': False}
PRO_LIMITS = {'goals': 50, 'alerts': 50, 'import': True, 'ai_month': 100, 'holdings': 1000, 'portfolios': 20, 'pro_screens': True, 'ai_usd_month': 5, 'email_alerts': True}

PLANS = [
    {'id': 'free', 'name': 'Free', 'sort': 0, 'limits': FREE_LIMITS, 'public': True,
     'features': ['1 portfolio and 25 holdings', 'Daily PSX prices and fund NAVs', 'Forecasts and 2 goals', 'Risk overview', 'In-app alerts, with 3 price alerts of your own', 'The weekly digest by email', '5 AI questions a month'],
     'price_pkr_year': 0, 'price_usd_year': 0, 'price_pkr_month': 0, 'price_usd_month': 0, 'safepay_plan_year': None, 'safepay_plan_month': None},
    {'id': 'pro', 'name': 'Pro', 'sort': 10, 'limits': PRO_LIMITS, 'public': True,
     'features': ['20 portfolios and 1,000 holdings', 'Stress tests, optimizer, tax and zakat', '50 price alerts, and every alert by email', 'Performance tracking', '100 AI questions a month', 'AI statement import'],
     'price_pkr_year': 9999, 'price_usd_year': 49, 'price_pkr_month': 999, 'price_usd_month': 4.99, 'safepay_plan_year': None, 'safepay_plan_month': None},
    {'id': 'family', 'name': 'Family', 'sort': 20, 'limits': {**PRO_LIMITS, 'members': 4, 'ai_month': 200}, 'public': False, 'features': ['Pro for up to 4 people', 'Household view'],
     'price_pkr_year': 19999, 'price_usd_year': 99, 'price_pkr_month': 1999, 'price_usd_month': 9.99, 'safepay_plan_year': None, 'safepay_plan_month': None},
]

SETTINGS = [
    {'key': 'ai_enabled', 'value': True, 'public': True},
    {'key': 'app_url', 'value': 'https://arzish.vercel.app', 'public': True},
    {'key': 'payments_enabled', 'value': False, 'public': True},
    {'key': 'referral_reward_days', 'value': 30, 'public': True},
    {'key': 'support_email', 'value': '', 'public': True},
    {'key': 'trial_days', 'value': 14, 'public': True},
    {'key': 'admin_emails', 'value': ['admin@example.com'], 'public': False},
    {'key': 'ai_model', 'value': 'claude-opus-5-5', 'public': False},
    {'key': 'ai_model_quick', 'value': 'claude-opus-5-5', 'public': False},
    {'key': 'email_from', 'value': 'Arzish <onboarding@resend.dev>', 'public': False},
    {'key': 'safepay_env', 'value': 'sandbox', 'public': False},
]


def b64(o):
    return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')


def session():
    t = int(time.time())
    user = {'id': UID, 'aud': 'authenticated', 'role': 'authenticated', 'email': EMAIL, 'email_confirmed_at': iso(NOW - timedelta(days=10)),
            'app_metadata': {'provider': 'email', 'providers': ['email']}, 'user_metadata': {}, 'created_at': iso(NOW - timedelta(days=10)), 'updated_at': iso(NOW)}
    token = f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': UID, 'email': EMAIL, 'role': 'authenticated', 'aud': 'authenticated', 'exp': t + 3600, 'iat': t})}.c2lnbmF0dXJl"
    return {'access_token': token, 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': t + 3600, 'refresh_token': 'refresh-qa', 'user': user}


class Mock:
    """State for one browser context. `role` is 'user' or 'admin'; `plan` is 'trial', 'free' or 'pro'."""

    def __init__(self, role='user', plan='trial', google=True, workspace=False):
        self.role = role
        self.google = google
        self.log = []
        self.calls = []
        self.ws_routes = []
        self.ai_used = 3
        latest = fixture('feed.json')
        if plan == 'trial':
            self.plan = {'plan': 'pro', 'name': 'Pro', 'status': 'trialing', 'source': 'trial', 'periodEnd': iso(NOW + timedelta(days=4)), 'cancelAtPeriodEnd': False, 'limits': PRO_LIMITS}
        elif plan == 'pro':
            self.plan = {'plan': 'pro', 'name': 'Pro', 'status': 'active', 'source': 'safepay', 'interval': 'year', 'periodEnd': iso(NOW + timedelta(days=200)), 'cancelAtPeriodEnd': False, 'limits': PRO_LIMITS}
        else:
            self.plan = {'plan': 'free', 'name': 'Free', 'status': 'free', 'limits': FREE_LIMITS}
        self.db = {
            'market_docs': [
                {'id': 'latest', 'doc': latest, 'updated_at': iso(NOW - timedelta(hours=3))},
                {'id': 'psx', 'doc': fixture('psx.json'), 'updated_at': iso(NOW - timedelta(hours=3))},
                {'id': 'funds', 'doc': fixture('funds.json'), 'updated_at': iso(NOW - timedelta(hours=3))},
            ],
            'plans': [dict(p) for p in PLANS],
            'app_settings': [dict(s) for s in SETTINGS],
            'profiles': [
                {'id': UID, 'email': EMAIL, 'full_name': 'Sana Test', 'role': role, 'referral_code': 'sana42ab', 'marketing_opt_in': False, 'disabled': False,
                 'created_at': iso(NOW - timedelta(days=10)), 'last_seen_at': iso(NOW - timedelta(hours=1))},
                {'id': '2b5e9a10-0000-4000-8000-000000000002', 'email': 'omar@example.com', 'full_name': 'Omar Example', 'role': 'user', 'referral_code': 'omar77cd', 'marketing_opt_in': True, 'disabled': False,
                 'created_at': iso(NOW - timedelta(days=3)), 'last_seen_at': iso(NOW - timedelta(days=1))},
            ],
            'notifications': [
                {'id': 104, 'user_id': UID, 'kind': 'maturity', 'title': 'Behbood Savings Certificates mature in 7 days', 'body': 'Rs 2,500,000 matures on 30 Oct 2026. Plan where the money goes next.', 'link': '#holdings', 'created_at': iso(NOW - timedelta(hours=2)), 'read_at': None},
                {'id': 103, 'user_id': UID, 'kind': 'policy_rate', 'title': 'SBP cut the policy rate to 11.5%', 'body': 'From 12%. Forecasts for T-bills, money market funds and deposits now start from the new rate.', 'link': '#markets', 'created_at': iso(NOW - timedelta(days=1)), 'read_at': None},
                {'id': 102, 'user_id': UID, 'kind': 'billing', 'title': 'Your Pro trial ends in 4 days', 'body': 'Keep stress tests, the optimizer and 100 AI questions a month with Pro.', 'link': '#billing', 'created_at': iso(NOW - timedelta(days=2)), 'read_at': iso(NOW - timedelta(days=1))},
                {'id': 101, 'user_id': UID, 'kind': 'ex_dividend', 'title': 'MEBL is trading ex-dividend', 'body': 'PSX lists it as MEBLXD. The price drop reflects the dividend.', 'link': '#holdings', 'created_at': iso(NOW - timedelta(days=6)), 'read_at': iso(NOW - timedelta(days=5))},
            ],
            'workspaces': [],
            'announcements': [
                {'id': 'a1', 'title': 'Gold now updates twice a day', 'body': 'Sarafa rates are checked each morning and evening.', 'link': None, 'audience': 'all', 'starts_at': iso(NOW - timedelta(days=1)), 'ends_at': None, 'created_at': iso(NOW - timedelta(days=1)), 'email_sent_at': None},
            ],
            'notification_prefs': [{'user_id': UID, 'prefs': {}, 'digest': 'weekly', 'zakat_date': None, 'updated_at': iso(NOW)}],
            'alert_rules': [
                {'id': 'r1', 'user_id': UID, 'kind': 'price_target', 'params': {'ticker': 'OGDC', 'above': 300}, 'active': True, 'last_fired_at': None, 'created_at': iso(NOW - timedelta(days=4))},
                {'id': 'r2', 'user_id': UID, 'kind': 'drawdown', 'params': {'pct': 10}, 'active': True, 'last_fired_at': iso(NOW - timedelta(days=20)), 'created_at': iso(NOW - timedelta(days=5))},
            ],
            'subscriptions': [
                {'id': 's1', 'user_id': UID, 'plan_id': 'pro', 'status': 'trialing', 'source': 'trial', 'interval': None, 'current_period_end': iso(NOW + timedelta(days=4)), 'cancel_at_period_end': False, 'created_at': iso(NOW - timedelta(days=10))},
                {'id': 's2', 'user_id': '2b5e9a10-0000-4000-8000-000000000002', 'plan_id': 'pro', 'status': 'active', 'source': 'admin', 'interval': 'month', 'current_period_end': iso(NOW + timedelta(days=27)), 'cancel_at_period_end': False, 'created_at': iso(NOW - timedelta(days=3))},
            ],
            'payments': [
                {'id': 'p1', 'user_id': '2b5e9a10-0000-4000-8000-000000000002', 'plan_id': 'pro', 'interval': 'month', 'amount': 999, 'currency': 'PKR', 'provider': 'bank', 'provider_ref': 'IBFT-2210', 'status': 'paid', 'created_at': iso(NOW - timedelta(days=3))},
            ],
            'feedback': [
                {'id': 'f1', 'user_id': UID, 'email': EMAIL, 'kind': 'idea', 'message': 'Could the digest include Naya Pakistan Certificate rates?', 'status': 'answered', 'reply': 'Yes, from next Sunday.', 'created_at': iso(NOW - timedelta(days=2)), 'replied_at': iso(NOW - timedelta(days=1))},
                {'id': 'f2', 'user_id': '2b5e9a10-0000-4000-8000-000000000002', 'email': 'omar@example.com', 'kind': 'bug', 'message': 'My Meezan fund shows yesterday’s NAV.', 'status': 'open', 'reply': None, 'created_at': iso(NOW - timedelta(hours=5)), 'replied_at': None},
            ],
            'portfolio_snapshots': [],
            'coupons': [{'id': 'LAUNCH30', 'plan_id': 'pro', 'days': 30, 'max_uses': 100, 'uses': 4, 'expires_at': iso(NOW + timedelta(days=60)), 'active': True, 'note': 'Launch week', 'created_at': iso(NOW - timedelta(days=2))}],
            'billing_events': [{'id': 1, 'provider': 'safepay', 'type': 'subscription.created', 'signature_ok': True, 'error': None, 'received_at': iso(NOW - timedelta(days=1)), 'payload': {'data': {'status': 'ACTIVE'}}}],
            'market_patches': [{'id': 1, 'created_at': iso(NOW - timedelta(days=1)), 'source': 'seed', 'note': 'Initial figures', 'patch': {'market': {'policyRate': 11.5}}}],
            'job_runs': [
                {'id': 3, 'job': 'notify', 'ran_at': iso(NOW - timedelta(hours=3)), 'ok': True, 'info': {'users': 2, 'notifications': 3, 'emails': 1, 'errors': []}},
                {'id': 2, 'job': 'load-market', 'ran_at': iso(NOW - timedelta(hours=3)), 'ok': True, 'info': {'latest': True, 'psx': True, 'funds': True}},
                {'id': 1, 'job': 'digest', 'ran_at': iso(NOW - timedelta(days=4)), 'ok': True, 'info': {'sent': 2}},
            ],
            'email_log': [
                {'id': 'e1', 'user_id': UID, 'to_email': EMAIL, 'kind': 'digest', 'subject': 'Your week: up 1.2%', 'status': 'delivered', 'error': None, 'created_at': iso(NOW - timedelta(days=4))},
                {'id': 'e2', 'user_id': None, 'to_email': 'omar@example.com', 'kind': 'auth-code', 'subject': 'Your Arzish sign-in code', 'status': 'failed', 'error': '403: You can only send testing emails to your own email address', 'created_at': iso(NOW - timedelta(days=3))},
            ],
            'audit_log': [{'id': 1, 'at': iso(NOW - timedelta(days=3)), 'actor': UID, 'action': 'user.grant', 'target_type': 'user', 'target_id': '2b5e9a10-0000-4000-8000-000000000002', 'before': None, 'after': {'plan': 'pro', 'days': 30}}],
        }
        if workspace:
            self.db['workspaces'] = [{'user_id': UID, 'ws': fixture('workspace.json'), 'updated_at': iso(NOW - timedelta(hours=1)), 'version': 1}]
        # A year of snapshots for the performance card.
        v = 4_200_000
        for i in range(120, -1, -1):
            v *= 1 + (0.0009 if i % 7 else -0.004)
            self.db['portfolio_snapshots'].append({'user_id': UID, 'portfolio_id': '*', 'd': day(-i), 'value_pkr': round(v), 'cost_pkr': 4_000_000})

    # ----------------------------------------------------------------- PostgREST
    PK = {'workspaces': 'user_id', 'notification_prefs': 'user_id', 'app_settings': 'key'}

    @staticmethod
    def _norm(v):
        if v is True:
            return 'true'
        if v is False:
            return 'false'
        if v is None:
            return 'null'
        return str(v)

    def _match(self, row, filters):
        for k, raw in filters:
            if k in ('or', 'and'):
                continue
            op, _, val = raw.partition('.')
            neg = False
            if op == 'not':
                neg = True
                op, _, val = val.partition('.')
            rv = row.get(k, None)
            if k == 'portfolio_id' and row.get(k) == '*':
                ok = True
            elif op == 'eq':
                ok = self._norm(rv).lower() == unquote(val).lower()
            elif op == 'neq':
                ok = self._norm(rv).lower() != unquote(val).lower()
            elif op == 'in':
                vals = [x.strip().strip('"') for x in unquote(val).strip('()').split(',')]
                ok = self._norm(rv) in vals
            elif op in ('gte', 'gt', 'lte', 'lt'):
                a, b = self._norm(rv), unquote(val)
                ok = {'gte': a >= b, 'gt': a > b, 'lte': a <= b, 'lt': a < b}[op]
            elif op == 'is':
                ok = self._norm(rv) == val
            elif op in ('ilike', 'like'):
                pat = re.escape(unquote(val)).replace('\\*', '.*').replace('%', '.*')
                ok = re.fullmatch(pat, self._norm(rv), re.I) is not None
            else:
                ok = True
            if neg:
                ok = not ok
            if not ok:
                return False
        return True

    def rest(self, table, method, q, body, headers):
        rows = self.db.setdefault(table, [])
        if table == 'app_settings' and self.role != 'admin':
            rows = [r for r in rows if r.get('public')]
        # Row-level security, roughly: people read their own rows; admins read everything.
        if self.role != 'admin' and method in ('GET', 'HEAD') and rows and 'user_id' in rows[0]:
            rows = [r for r in rows if r.get('user_id') == UID]
        filters = [(k, v[0]) for k, v in q.items() if k not in ('select', 'order', 'limit', 'offset', 'on_conflict', 'columns')]
        prefer = headers.get('prefer', '')
        accept = headers.get('accept', '')
        if method in ('GET', 'HEAD'):
            out = [r for r in rows if self._match(r, filters)]
            if 'order' in q:
                for part in reversed(q['order'][0].split(',')):
                    col, *mods = part.split('.')
                    out.sort(key=lambda r: self._norm(r.get(col)), reverse='desc' in mods)
            off = int(q.get('offset', ['0'])[0])
            if 'limit' in q:
                out = out[off:off + int(q['limit'][0])]
            hdrs = {'Content-Range': f'0-{max(0, len(out) - 1)}/{len(out)}'}
            if 'vnd.pgrst.object' in accept:
                if len(out) != 1:
                    return 406, {'code': 'PGRST116', 'message': 'JSON object requested, multiple (or no) rows returned'}, hdrs
                return 200, out[0], hdrs
            return 200, out, hdrs
        items = body if isinstance(body, list) else [body]
        if method == 'POST':
            pk = (q.get('on_conflict', [None])[0]) or self.PK.get(table, 'id')
            saved = []
            for it in items:
                it = dict(it)
                if pk == 'id' and 'id' not in it:
                    it['id'] = str(uuid.uuid4()) if table not in ('notifications',) else int(time.time() * 1000)
                it.setdefault('created_at', iso(datetime.now(timezone.utc)))
                existing = next((r for r in rows if all(r.get(c) == it.get(c) for c in pk.split(','))), None)
                if existing is not None and 'merge-duplicates' in prefer:
                    existing.update(it)
                    saved.append(existing)
                else:
                    rows.append(it)
                    saved.append(it)
            return (201, saved if 'return=representation' in prefer else None, {})
        if method == 'PATCH':
            hit = [r for r in rows if self._match(r, filters)]
            for r in hit:
                r.update(items[0])
            return (200, hit, {}) if 'return=representation' in prefer else (204, None, {})
        if method == 'DELETE':
            keep = [r for r in rows if not self._match(r, filters)]
            gone = len(rows) - len(keep)
            self.db[table] = keep
            return 204, None, {'X-Deleted': str(gone)}
        return 405, {'message': 'method'}, {}

    # ----------------------------------------------------------------- RPC
    def rpc(self, name, body):
        if name == 'my_plan':
            return self.plan
        if name == 'my_ai_used':
            return self.ai_used
        if self.role != 'admin' and name.startswith('admin_'):
            return {'__status': 403, 'code': '42501', 'message': 'forbidden'}
        if name == 'admin_metrics':
            return {
                'users': 2, 'disabled': 0, 'new7': 1, 'new30': 2, 'active1': 1, 'active7': 2, 'active30': 2, 'withPortfolio': 2,
                'trialing': 1, 'paying': 0, 'manual': 1, 'granted': 0, 'pastDue': 0, 'byPlan': {'pro': 2}, 'mrrPkr': 999,
                'revenue30': {'PKR': 999}, 'ai30': {'questions': 41, 'calls': 63, 'cost': 3.84, 'users': 2},
                'emails7': {'sent': 9, 'failed': 1, 'skipped': 0}, 'feedbackOpen': 1, 'notifications7': 12, 'billingErrors7': 0,
                'jobs': [{'job': j['job'], 'ranAt': j['ran_at'], 'ok': j['ok'], 'info': j['info']} for j in self.db['job_runs']],
                'market': {d['id']: {'updatedAt': d['updated_at'], 'builtAt': d['doc'].get('builtAt'), 'asOf': d['doc'].get('asOf') or d['doc'].get('market', {}).get('asOf'), 'review': d['doc'].get('review')} for d in self.db['market_docs']},
            }
        if name == 'admin_series':
            n = int((body or {}).get('days', 30))
            return [{'d': day(-i), 'signups': (i * 7) % 3, 'questions': (i * 5) % 9, 'aiCost': round(((i * 5) % 9) * 0.09, 3), 'emails': (i * 3) % 5} for i in range(n - 1, -1, -1)]
        if name == 'admin_users':
            rows = []
            for p in self.db['profiles']:
                plan = self.plan if p['id'] == UID else {'plan': 'pro', 'name': 'Pro', 'status': 'active', 'source': 'admin', 'interval': 'month', 'periodEnd': iso(NOW + timedelta(days=27)), 'limits': PRO_LIMITS}
                rows.append({'id': p['id'], 'email': p['email'], 'name': p['full_name'], 'role': p['role'], 'disabled': p['disabled'], 'createdAt': p['created_at'], 'lastSeenAt': p['last_seen_at'], 'plan': plan, 'aiMonth': 3 if p['id'] == UID else 12, 'hasWorkspace': True})
            q = str((body or {}).get('q', '')).lower()
            rows = [r for r in rows if not q or q in (r['email'] or '').lower() or q in (r['name'] or '').lower()]
            return {'total': len(rows), 'rows': rows}
        if name == 'admin_user_detail':
            uid = (body or {}).get('uid')
            p = next((x for x in self.db['profiles'] if x['id'] == uid), self.db['profiles'][0])
            prof = {k: v for k, v in p.items() if k != 'referral_code'}
            prof['referralCode'] = p['referral_code']
            return {
                'profile': prof, 'referrals': 1, 'plan': self.plan,
                'subscriptions': [s for s in self.db['subscriptions'] if s['user_id'] == p['id']],
                'payments': [x for x in self.db['payments'] if x['user_id'] == p['id']],
                'ai': {'month': 3, 'monthCost': 0.284, 'total': 19},
                'workspace': {'updatedAt': iso(NOW - timedelta(hours=1)), 'bytes': 18234, 'portfolios': 1, 'holdings': 9, 'goals': 2},
                'prefs': {'digest': 'weekly', 'zakatDate': None}, 'alerts': 2, 'unread': 2,
                'feedback': [f for f in self.db['feedback'] if f['user_id'] == p['id']],
                'emails': [{'at': e['created_at'], 'kind': e['kind'], 'subject': e['subject'], 'status': e['status'], 'error': e['error']} for e in self.db['email_log'] if e['user_id'] == p['id']],
                'audit': [{'at': a['at'], 'action': a['action'], 'actor': EMAIL, 'after': a['after']} for a in self.db['audit_log']],
            }
        return {'__status': 404, 'message': f'unknown rpc {name}'}

    # ----------------------------------------------------------------- edge functions
    def function(self, path, body):
        route = path.split('/functions/v1/', 1)[1]
        if route == 'api/auth-code':
            if body.get('code'):
                if body['code'] != '123456':
                    return 400, {'error': 'bad_code', 'message': 'That code is not right. Check the email and try again.'}
                return 200, {'token_hash': 'hash-qa', 'type': 'magiclink'}
            return 200, {'ok': True}
        if route == 'api/feedback':
            row = {'id': str(uuid.uuid4()), 'user_id': UID, 'email': EMAIL, 'kind': body.get('kind', 'idea'), 'message': body.get('message', ''), 'status': 'open', 'reply': None, 'created_at': iso(datetime.now(timezone.utc))}
            self.db['feedback'].insert(0, row)
            return 200, {'ok': True, 'id': row['id']}
        if route == 'api/admin':
            action = body.get('action')
            if action == 'status':
                return 200, {'anthropic': False, 'safepay': False, 'safepayWebhook': False, 'resend': True, 'webhookUrl': f'{SUPABASE}/functions/v1/api/billing/webhook'}
            return 200, {'ok': True}
        if route == 'api/billing/redeem':
            return 400, {'error': 'unknown_code', 'message': 'That code is not valid.'}
        if route.startswith('jobs/'):
            return 200, {'ok': True, 'users': 2, 'notifications': 0}
        return 200, {'ok': True}

    def ai_stream(self, body):
        """An Anthropic-style event stream with one short text answer."""
        self.ai_used += 1
        text = 'Your portfolio is about 38% PSX shares and 31% National Savings. At today’s rates the savings certificates carry most of the income; the shares carry most of the growth and most of the risk.'
        events = [
            {'type': 'message_start', 'message': {'id': 'msg_qa', 'model': 'claude-opus-5-5', 'role': 'assistant', 'content': [], 'usage': {'input_tokens': 900, 'output_tokens': 1}}},
            {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}},
        ]
        for i in range(0, len(text), 40):
            events.append({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text[i:i + 40]}})
        events += [
            {'type': 'content_block_stop', 'index': 0},
            {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}, 'usage': {'output_tokens': 60}},
            {'type': 'message_stop'},
        ]
        return ''.join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)

    # ----------------------------------------------------------------- router
    CORS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, range, x-supabase-api-version, x-retry-count',
        'Access-Control-Expose-Headers': 'Content-Range, X-Arzish-Model, X-Arzish-AI-Used, X-Arzish-AI-Limit',
    }

    def _send(self, route, status, body, extra=None, ctype='application/json'):
        headers = {**self.CORS, **(extra or {})}
        if body is None:
            route.fulfill(status=status, headers=headers, body='')
        else:
            headers['Content-Type'] = ctype
            route.fulfill(status=status, headers=headers, body=body if isinstance(body, str) else json.dumps(body))

    def handle(self, route, request):
        url = urlparse(request.url)
        path = url.path
        method = request.method
        q = parse_qs(url.query, keep_blank_values=True)
        hdr = {k.lower(): v for k, v in request.headers.items()}
        body = None
        if request.post_data:
            try:
                body = json.loads(request.post_data)
            except Exception:
                body = request.post_data
        self.calls.append(f'{method} {path}' + (f'?{url.query}' if url.query else ''))
        if method == 'OPTIONS':
            return self._send(route, 200, None)
        try:
            if path.startswith('/rest/v1/rpc/'):
                out = self.rpc(path.rsplit('/', 1)[1], body if isinstance(body, dict) else {})
                if isinstance(out, dict) and '__status' in out:
                    st = out.pop('__status')
                    return self._send(route, st, out)
                return self._send(route, 200, out)
            if path.startswith('/rest/v1/'):
                st, out, extra = self.rest(path.split('/rest/v1/', 1)[1], method, q, body, hdr)
                return self._send(route, st, out, extra)
            if path == '/auth/v1/settings':
                return self._send(route, 200, {'external': {'email': True, 'google': self.google}, 'disable_signup': False})
            if path == '/auth/v1/user':
                return self._send(route, 200, session()['user'])
            if path in ('/auth/v1/token', '/auth/v1/verify'):
                return self._send(route, 200, session())
            if path == '/auth/v1/logout':
                return self._send(route, 204, None)
            if path == '/functions/v1/api/ai':
                return self._send(route, 200, self.ai_stream(body), {'X-Arzish-Model': 'claude-opus-5-5', 'X-Arzish-AI-Used': str(self.ai_used + 1), 'X-Arzish-AI-Limit': str(self.plan['limits']['ai_month'])}, 'text/event-stream')
            if path.startswith('/functions/v1/'):
                st, out = self.function(path, body if isinstance(body, dict) else {})
                return self._send(route, st, out)
        except Exception as e:  # surface mock bugs in the QA output
            self.log.append(f'MOCK ERROR {method} {path}: {e!r}')
            return self._send(route, 500, {'message': str(e)})
        self.log.append(f'UNHANDLED {method} {path}')
        return self._send(route, 404, {'message': 'not mocked'})

    # ----------------------------------------------------------------- realtime
    def realtime(self, ws):
        """Answers joins and heartbeats; push() sends an INSERT to subscribed channels."""
        self.ws_routes.append(ws)
        state = {'topics': {}}
        ws._qa_state = state

        def reply(fmt, join_ref, ref, topic, payload):
            if fmt == 'array':
                ws.send(json.dumps([join_ref, ref, topic, 'phx_reply', payload]))
            else:
                ws.send(json.dumps({'topic': topic, 'event': 'phx_reply', 'payload': payload, 'ref': ref, 'join_ref': join_ref}))

        def on_message(message):
            if isinstance(message, bytes):
                return
            try:
                m = json.loads(message)
            except Exception:
                return
            if isinstance(m, list):
                fmt, (join_ref, ref, topic, event, payload) = 'array', m
            else:
                fmt, join_ref, ref, topic, event, payload = 'object', m.get('join_ref'), m.get('ref'), m.get('topic'), m.get('event'), m.get('payload')
            if event == 'phx_join':
                pcs = ((payload or {}).get('config') or {}).get('postgres_changes') or []
                bound = [{**pc, 'id': 1000 + i} for i, pc in enumerate(pcs)]
                state['topics'][topic] = {'fmt': fmt, 'join_ref': join_ref, 'ids': [b['id'] for b in bound]}
                reply(fmt, join_ref, ref, topic, {'status': 'ok', 'response': {'postgres_changes': bound}})
            elif event in ('heartbeat', 'access_token', 'phx_leave'):
                reply(fmt, join_ref, ref, topic, {'status': 'ok', 'response': {}})

        ws.on_message(on_message)

    def push_notification(self, record):
        cols = [{'name': n, 'type': t} for n, t in [('id', 'int8'), ('user_id', 'uuid'), ('kind', 'text'), ('title', 'text'), ('body', 'text'), ('link', 'text'), ('created_at', 'timestamptz'), ('read_at', 'timestamptz')]]
        self.db['notifications'].insert(0, record)
        sent = 0
        for ws in self.ws_routes:
            for topic, t in getattr(ws, '_qa_state', {}).get('topics', {}).items():
                if not t['ids']:
                    continue
                payload = {'ids': t['ids'], 'data': {'schema': 'public', 'table': 'notifications', 'commit_timestamp': iso(datetime.now(timezone.utc)), 'type': 'INSERT', 'columns': cols, 'record': record, 'errors': None}}
                if t['fmt'] == 'array':
                    ws.send(json.dumps([None, None, topic, 'postgres_changes', payload]))
                else:
                    ws.send(json.dumps({'topic': topic, 'event': 'postgres_changes', 'payload': payload, 'ref': None}))
                sent += 1
        return sent
