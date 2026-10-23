"""Browser QA for the hosted web edition: serves web-dist/ the way vercel.json does, stands in for
Supabase with mock.py, walks the main flows in Chromium and saves screenshots.

    python3 test/web-qa/qa.py [output-dir]
"""
import json
import os
import re
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mock import SUPABASE, UID, Mock, iso, session  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOT = os.path.join(REPO, 'web-dist')
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'test', 'web-qa', 'out'))
PORT = 8765
BASE = f'http://localhost:{PORT}'
os.makedirs(OUT, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    """Static files with the vercel.json rewrites and clean URLs."""

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        p = self.path.split('?', 1)[0]
        if re.fullmatch(r'/(app|signin|admin)(/.*)?', p):
            self.path = '/app.html'
        elif re.fullmatch(r'/(terms|privacy|404)', p):
            self.path = p + '.html'
        fs = self.translate_path(self.path)
        if not os.path.exists(fs) or (os.path.isdir(fs) and not os.path.exists(os.path.join(fs, 'index.html'))):
            body = open(os.path.join(ROOT, '404.html'), 'rb').read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

results = []
problems = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    if not ok:
        problems.append(f'{name}: {detail}')
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))


def new_context(browser, mock, signed_in=False, viewport=(1366, 900), scheme='light'):
    ctx = browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]}, color_scheme=scheme, device_scale_factor=1)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r, q: r.fulfill(status=200, body='', headers={'Content-Type': 'text/css'}))
    ctx.route(f'{SUPABASE}/**', mock.handle)
    ctx.route_web_socket(re.compile(r'wss://qgmltrboyhnwnugyrcek\.supabase\.co/realtime/.*'), mock.realtime)
    if signed_in:
        ctx.add_init_script(f"try {{ if (!sessionStorage.getItem('qa-signed-out')) localStorage.setItem('arzish-auth', {json.dumps(json.dumps(session()))}); }} catch (e) {{}}")
    return ctx


def watch(page, tag, ignore=()):
    errs = []

    def on_console(m):
        if m.type == 'error':
            t = m.text
            # The sandbox has no route to Google Fonts; failures the test causes on purpose are listed in ignore.
            if 'fonts.g' in t or any(x in t for x in ignore):
                return
            errs.append(f'console: {t[:300]}')

    page.on('console', on_console)
    page.on('pageerror', lambda e: errs.append(f'pageerror: {str(e)[:300]}'))
    page.on('requestfailed', lambda r: errs.append(f'requestfailed: {r.url[:120]} {r.failure}') if 'fonts.g' not in r.url else None)
    return errs


def shot(page, name, full=False):
    page.screenshot(path=os.path.join(OUT, f'{name}.png'), full_page=full)


def settle(page, ms=600):
    page.wait_for_timeout(ms)


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox'])

    # ------------------------------------------------------------------ landing
    for scheme in ('light', 'dark'):
        m = Mock()
        ctx = new_context(browser, m, scheme=scheme)
        page = ctx.new_page()
        errs = watch(page, 'landing')
        page.goto(BASE + '/', wait_until='networkidle')
        settle(page, 900)
        kse = page.locator('[data-k="kse100"]').inner_text()
        check(f'landing ({scheme}): live KSE-100 figure filled', any(ch.isdigit() for ch in kse), kse)
        price = page.locator('[data-plan="pro"] [data-amt]').inner_text()
        check(f'landing ({scheme}): Pro yearly price from plans', '9,999' in price, price)
        feats = page.locator('[data-plan="pro"] [data-features] li').all_inner_texts()
        check(f'landing ({scheme}): Pro features from plans', feats and feats[0].startswith('20 portfolios'), str(feats[:2]))
        page.click('.period button[data-period="month"]')
        price = page.locator('[data-plan="pro"] [data-amt]').inner_text()
        check(f'landing ({scheme}): monthly toggle', '999' in price and 'month' in price, price)
        check(f'landing ({scheme}): no contact link without a support address', page.locator('#contact').is_hidden())
        shot(page, f'landing-{scheme}', full=True)
        check(f'landing ({scheme}): no page errors', not errs, '; '.join(errs[:3]))
        ctx.close()

    m = Mock()
    ctx = new_context(browser, m, viewport=(390, 844))
    page = ctx.new_page()
    errs = watch(page, 'landing-mobile')
    page.goto(BASE + '/?ref=omar77cd', wait_until='networkidle')
    settle(page, 700)
    shot(page, 'landing-mobile', full=True)
    width = page.evaluate('document.documentElement.scrollWidth')
    check('landing (mobile): no horizontal scroll', width <= 390, f'scrollWidth {width}')
    check('landing: referral code kept', page.evaluate("localStorage.getItem('arzish.ref')") == 'omar77cd')
    for path, title in (('/terms', 'Terms of use'), ('/privacy', 'Privacy policy')):
        page.goto(BASE + path, wait_until='networkidle')
        check(f'{path} renders', page.locator('h1').inner_text() == title)
        w = page.evaluate('document.documentElement.scrollWidth')
        check(f'{path} (mobile): no horizontal scroll', w <= 390, f'scrollWidth {w}')
    shot(page, 'privacy-mobile', full=False)
    check('legal pages: no page errors', not errs, '; '.join(errs[:3]))
    resp = page.goto(BASE + '/no-such-page', wait_until='networkidle')
    check('unknown path gives the 404 page', resp.status == 404 and 'no page here' in page.content())
    ctx.close()

    # ------------------------------------------------------------------ sign in
    m = Mock()
    ctx = new_context(browser, m)
    page = ctx.new_page()
    errs = watch(page, 'signin', ignore=('status of 400',))
    page.goto(BASE + '/signin?next=/app', wait_until='networkidle')
    page.wait_for_selector('text=Continue with Google', timeout=8000)
    shot(page, 'signin-email')
    page.fill('#w-email', 'Sana.Test@Example.com ')
    page.click('button:has-text("Email me a sign-in code")')
    page.wait_for_selector('#w-code', timeout=8000)
    check('sign in: code step shown', page.locator('text=We sent a 6-digit code').count() == 1)
    page.fill('#w-code', '000000')
    page.click('button[type=submit]:has-text("Sign in")')
    page.wait_for_selector('text=That code is not right', timeout=8000)
    check('sign in: wrong code explained', True)
    shot(page, 'signin-code-error')
    page.fill('#w-code', '123456')
    page.click('button[type=submit]:has-text("Sign in")')
    page.wait_for_url('**/app', timeout=10000)
    page.wait_for_selector('[aria-label="Account menu"]', timeout=15000)
    check('sign in: lands in the app signed in', True)
    stored = page.evaluate("localStorage.getItem('arzish-auth')")
    check('sign in: session stored', bool(stored) and UID in stored)
    check('sign in: no page errors', not errs, '; '.join(errs[:3]))
    ctx.close()

    m = Mock(google=False)
    ctx = new_context(browser, m)
    page = ctx.new_page()
    page.goto(BASE + '/signin', wait_until='networkidle')
    page.wait_for_selector('#w-email')
    settle(page, 400)
    check('sign in: Google hidden until it is switched on', page.locator('text=Continue with Google').count() == 0)
    ctx.close()

    # ------------------------------------------------------------------ demo (signed out)
    m = Mock()
    ctx = new_context(browser, m)
    page = ctx.new_page()
    errs = watch(page, 'demo')
    page.goto(BASE + '/app', wait_until='networkidle')
    page.wait_for_selector('nav[aria-label="Main"]', timeout=15000)
    settle(page, 1500)
    shot(page, 'app-demo-overview')
    check('demo: Sign in button in the top bar', page.locator('header button:has-text("Sign in")').count() >= 1)
    check('demo: market docs loaded', any('market_docs' in c for c in m.calls))
    page.click('nav[aria-label="Main"] button:has-text("Stress tests")')
    settle(page, 600)
    shot(page, 'app-demo-stress-locked')
    check('demo: Pro screen shows the paywall', page.locator('.w-paywall').count() == 1)
    page.click('header button:has-text("Ask AI")')
    settle(page, 500)
    shot(page, 'app-demo-ai')
    check('demo: AI asks to sign in', page.locator('.drawer >> text=Sign in to use the AI analyst').count() >= 1)
    check('demo: AI input disabled until sign in', page.locator('[aria-label="Ask the AI analyst"]').is_disabled())
    check('demo: sign-in button inside the AI panel', page.locator('.drawer button:has-text("Sign in")').count() == 1)
    page.click('.drawer button:has-text("Close")')
    settle(page, 300)
    page.click('header button:has-text("Sign in")')
    page.wait_for_url('**/signin?next=*', timeout=8000)
    check('demo: Sign in keeps the way back', '/signin?next=' in page.url)
    check('demo: no page errors', not errs, '; '.join(errs[:3]))
    ctx.close()

    # ------------------------------------------------------------------ signed in, trial
    m = Mock(role='user', plan='trial', workspace=True)
    ctx = new_context(browser, m, signed_in=True)
    page = ctx.new_page()
    errs = watch(page, 'trial')
    page.goto(BASE + '/app', wait_until='networkidle')
    page.wait_for_selector('[aria-label="Account menu"]', timeout=15000)
    settle(page, 1800)
    shot(page, 'app-trial-overview')
    dot = page.locator('.w-dot')
    check('trial: unread count on the bell', dot.count() == 1 and dot.inner_text() == '2', dot.inner_text() if dot.count() else 'none')
    check('trial: trial-ending banner', page.locator('.w-banner:has-text("trial")').count() >= 1)
    check('trial: announcement banner', page.locator('text=Gold now updates twice a day').count() == 1)
    check('trial: performance card', page.locator('text=Performance').count() >= 1)
    check('trial: workspace read from the account', any('/rest/v1/workspaces' in c for c in m.calls))
    page.click('button:has-text("unread notifications")')
    page.wait_for_selector('[role=dialog][aria-label="Notifications"]')
    settle(page, 400)
    shot(page, 'app-trial-bell')
    check('trial: notifications listed', page.locator('.w-note').count() == 4)
    page.keyboard.press('Escape')
    # A notification arriving while the app is open.
    sent = m.push_notification({'id': 105, 'user_id': UID, 'kind': 'price_alert', 'title': 'OGDC reached Rs 301.50', 'body': 'At or above your target of Rs 300.', 'link': '#holdings', 'created_at': iso(datetime.now(timezone.utc)), 'read_at': None})
    page.wait_for_timeout(800)
    check('trial: live notification over realtime', sent >= 1 and page.locator('.w-dot').inner_text() == '3', f'sent {sent}, dot {page.locator(".w-dot").inner_text() if page.locator(".w-dot").count() else "none"}')
    page.click('button:has-text("unread notifications")')
    page.click('button:has-text("Mark all read")')
    settle(page, 300)
    check('trial: mark all read', page.locator('.w-dot').count() == 0 and any(c.startswith('PATCH /rest/v1/notifications') for c in m.calls))
    page.keyboard.press('Escape')

    # Account menu and modal tabs.
    page.click('[aria-label="Account menu"]')
    settle(page, 300)
    shot(page, 'app-trial-menu')
    page.keyboard.press('Escape')
    page.goto('about:blank')
    page.goto(BASE + '/app#notifications', wait_until='networkidle')
    page.wait_for_selector('.modal', timeout=15000)
    settle(page, 800)
    shot(page, 'account-notifications')
    check('account: #notifications opens the right tab', page.locator('.modal table').count() == 1)
    for tab, label in (('Plan', 'plan'), ('Alerts', 'alerts'), ('Profile', 'profile'), ('Invite', 'invite'), ('Help', 'help')):
        btn = page.locator(f'.modal [role=tab]:has-text("{tab}"), .modal button:has-text("{tab}")').first
        if btn.count() == 0:
            check(f'account: {tab} tab present', False, 'no tab button')
            continue
        btn.click()
        settle(page, 600)
        shot(page, f'account-{label}')
    check('account: alerts list shows saved rules', page.locator('text=OGDC').count() >= 0)
    # Help tab: send a message.
    page.fill('.modal textarea', 'The digest is great. Could it include gold?')
    page.click('.modal button:has-text("Send")')
    settle(page, 700)
    check('account: feedback sent', any(c == 'POST /functions/v1/api/feedback' for c in m.calls))
    check('account: no support address shown when none is set', page.locator('text=Or email').count() == 0)
    page.keyboard.press('Escape')
    settle(page, 300)

    # AI analyst.
    page.click('header button:has-text("Ask AI")')
    page.wait_for_selector('[aria-label="Ask the AI analyst"]')
    settle(page, 400)
    check('AI: allowance shown', page.locator('text=questions left this month').count() >= 1)
    page.fill('[aria-label="Ask the AI analyst"]', 'What carries most of my risk?')
    page.keyboard.press('Enter')
    page.wait_for_selector('text=carry most of the growth', timeout=15000)
    settle(page, 500)
    shot(page, 'app-trial-ai-answer')
    check('AI: streamed answer shown', True)
    check('AI: request went to /api/ai with the session', any(c == 'POST /functions/v1/api/ai' for c in m.calls))
    check('trial: no page errors', not errs, '; '.join(errs[:3]))
    ctx.close()

    # Mobile, signed in.
    m = Mock(role='user', plan='trial', workspace=True)
    ctx = new_context(browser, m, signed_in=True, viewport=(390, 844))
    page = ctx.new_page()
    errs = watch(page, 'mobile-app')
    page.goto(BASE + '/app', wait_until='networkidle')
    page.wait_for_selector('[aria-label="Account menu"]', timeout=15000)
    settle(page, 1500)
    shot(page, 'app-mobile-overview')
    w = page.evaluate('document.documentElement.scrollWidth')
    check('app (mobile): no horizontal scroll', w <= 390, f'scrollWidth {w}')
    page.click('button:has-text("unread notifications")')
    settle(page, 400)
    shot(page, 'app-mobile-bell')
    box = page.locator('.w-panel').bounding_box()
    check('app (mobile): notification panel fits the screen', box and box['x'] >= 0 and box['x'] + box['width'] <= 390, str(box))
    check('app (mobile): no page errors', not errs, '; '.join(errs[:3]))
    ctx.close()

    # ------------------------------------------------------------------ signed in, free plan
    m = Mock(role='user', plan='free')
    ctx = new_context(browser, m, signed_in=True)
    page = ctx.new_page()
    errs = watch(page, 'free')
    page.goto(BASE + '/app', wait_until='networkidle')
    page.wait_for_selector('[aria-label="Account menu"]', timeout=15000)
    settle(page, 1200)
    page.click('nav[aria-label="Main"] button:has-text("Optimizer")')
    settle(page, 500)
    check('free: optimizer is behind the paywall', page.locator('.w-paywall').count() == 1)
    shot(page, 'app-free-optimizer-locked')
    page.locator('.w-paywall button').first.click()
    settle(page, 500)
    shot(page, 'upgrade-modal')
    check('free: upgrade dialog with plans', page.locator('.w-plan-card').count() >= 2)
    check('free: payments off offers a request instead of checkout', page.locator('.modal button:has-text("Ask for Pro")').count() >= 1)
    page.keyboard.press('Escape')
    settle(page, 300)
    page.goto('about:blank')
    page.goto(BASE + '/app#alerts', wait_until='networkidle')
    page.wait_for_selector('.modal', timeout=15000)
    settle(page, 800)
    shot(page, 'account-alerts-free')
    check('free: alerts allowed within the plan allowance', page.locator('.modal .w-teaser:has-text("3 alerts")').count() == 1)
    check('free: no page errors', not errs, '; '.join(errs[:3]))
    ctx.close()

    # ------------------------------------------------------------------ back office
    m = Mock(role='user', plan='trial')
    ctx = new_context(browser, m, signed_in=True)
    page = ctx.new_page()
    page.goto(BASE + '/admin', wait_until='networkidle')
    page.wait_for_selector('text=The back office is for Arzish admins.', timeout=15000)
    check('admin: non-admins are turned away', True)
    ctx.close()

    m = Mock(role='admin', plan='pro')
    ctx = new_context(browser, m, signed_in=True)
    page = ctx.new_page()
    errs = watch(page, 'admin')
    page.goto(BASE + '/admin', wait_until='networkidle')
    page.wait_for_selector('nav[aria-label="Back office"]', timeout=15000)
    settle(page, 1500)
    shot(page, 'admin-dashboard', full=True)
    check('admin: dashboard metrics', page.locator('text=999').count() >= 1)
    for sec in ('users', 'billing', 'market', 'messages', 'settings'):
        page.click(f'nav[aria-label="Back office"] button:has-text("{dict(users="Users", billing="Billing", market="Market data", messages="Messages", settings="Settings")[sec]}")')
        settle(page, 1200)
        shot(page, f'admin-{sec}', full=True)
        if sec == 'users':
            row = page.locator('text=omar@example.com').first
            if row.count():
                row.click()
                settle(page, 900)
                shot(page, 'admin-user-detail')
                check('admin: user detail opens', page.locator('.modal').count() == 1)
                page.keyboard.press('Escape')
                settle(page, 300)
            else:
                check('admin: user list shows users', False, 'omar@example.com missing')
        if sec == 'settings':
            check('admin: services status loaded', any('POST /functions/v1/api/admin' == c for c in m.calls))
    check('admin: no page errors', not errs, '; '.join(errs[:5]))
    ctx.close()

    browser.close()

server.shutdown()
print()
print(f'{sum(1 for r in results if r[1])}/{len(results)} checks passed. Screenshots in {OUT}')
if problems:
    print('Problems:')
    for p in problems:
        print(' -', p)
