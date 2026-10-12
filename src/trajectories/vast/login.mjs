import { WSession } from '../../../dist/session/wsession.js';
import { SessionStore } from '../../../dist/session/store.js';
import { humanIdlePause } from '../../../dist/human/mouse.js';
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { googleSso } from '../_shared/services/google_sso.mjs';
import { switchToTeam, vastTeamName } from './team_context.mjs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';

const LABEL = 'vast';
const VAST_LOGIN = readScopedLogin('vastDashboard');
const TEAM_NAME = vastTeamName();

const ws = await WSession.start({ label: LABEL, headless: false });
const store = new SessionStore();
// Grant clipboard read/write so the Copy button round-trips through JS.
await ws.ctx
  .grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://cloud.vast.ai',
  })
  .catch(() => {});

// Vast's own account endpoint answers the signed-in user for this browser's
// session and refuses any other; its answer, not words in the page header
// (or the team's name in the page), says whether the session is signed in.
const CURRENT_USER = 'https://cloud.vast.ai/api/v0/users/current/';

async function loggedIn() {
  const answer = await ws.ctx.request.get(CURRENT_USER);
  return answer.ok();
}

try {
  await ws.goto('https://cloud.vast.ai/');
  await humanIdlePause('deliberate');

  if (!(await loggedIn())) {
    console.log('[vast] not logged in; running OAuth');
    await ws.click('Login');
    await humanIdlePause('deliberate');
    const popupP = ws.ctx.waitForEvent('page');
    await ws.click('Continue with Google');
    const popup = await popupP;
    await popup.waitForLoadState('domcontentloaded');
    // Google's own sign-in steps, through the shared driver every Google SSO
    // trajectory uses.
    const signedIn = await googleSso(ws, VAST_LOGIN, {
      page: popup,
      originHost: 'cloud.vast.ai',
    });
    if (!signedIn || !(await loggedIn()))
      throw new Error(
        `VAST_SIGN_IN_FAILED: Google sign-in did not leave a Vast session (${CURRENT_USER} still refuses this browser)`,
      );
    const saved = await store.capturePlaywright(ws.ctx, LABEL);
    console.log(`[vast] login flow captured ${saved.length} cookies`);
  } else {
    console.log('[vast] session restored from SessionStore');
  }

  await switchToTeam(ws.page, TEAM_NAME);

  await ws.goto('https://cloud.vast.ai/host/machines/');
  await humanIdlePause('long');
  await store.capturePlaywright(ws.ctx, LABEL);

  await ws.page
    .goto('https://cloud.vast.ai/host/setup/', {
      waitUntil: 'domcontentloaded',
    })
    .catch(() => {});
  await humanIdlePause('long');

  // Find the <pre>/<code> block containing the real install command, scroll
  // to it, then click the Copy button that sits nearest to it. Capture the
  // FULL text of that block and the clipboard contents.
  const result = await ws.page.evaluate(`(async () => {
    function tidy(t) { return (t || '').replace(/\\s+/g, ' ').trim(); }
    // Find all code-like blocks whose text matches the install pattern.
    var blocks = Array.from(document.querySelectorAll('code, pre, [class*="ode"], input, textarea'))
      .filter(el => el.offsetParent !== null)
      .filter(el => {
        var t = el.innerText || el.value || el.textContent || '';
        return /wget/i.test(t) && /install/i.test(t) && /python3/i.test(t);
      });
    if (blocks.length === 0) return { ok: false, reason: 'no install block' };
    // Prefer the block with the longest text (the real personalized command
    // should be longer than any docs example blurb).
    blocks.sort((a, b) => (b.innerText || b.textContent || '').length - (a.innerText || a.textContent || '').length);
    var target = blocks[0];
    target.scrollIntoView({ block: 'center' });
    var raw = (target.innerText || target.value || target.textContent || '').trim();
    // Look for a Copy button within ~400px of the block.
    var rect = target.getBoundingClientRect();
    var allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(b => b.offsetParent !== null);
    var copyBtn = allBtns
      .filter(b => /^copy\\b/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()))
      .map(b => ({ b, r: b.getBoundingClientRect() }))
      .map(x => ({ b: x.b, d: Math.hypot((x.r.left + x.r.right)/2 - (rect.left + rect.right)/2, (x.r.top + x.r.bottom)/2 - (rect.top + rect.bottom)/2) }))
      .sort((a, b) => a.d - b.d)[0];
    // Don't click the copy button — raw text is already extracted via
    // .innerText. Clicking via evaluate fires isTrusted=false (lint flagged
    // this); clipboard.readText below is best-effort and not load-bearing.
    var clip = '';
    try { clip = await navigator.clipboard.readText(); } catch (e) { clip = 'ERR ' + e.message; }
    return { ok: true, raw, raw_len: raw.length, btn_label: copyBtn ? tidy(copyBtn.b.innerText || copyBtn.b.getAttribute('aria-label') || '') : null, btn_dist: copyBtn ? copyBtn.d : null, clipboard: clip };
  })()`);
  console.log('[vast] install block result ->', JSON.stringify(result));
  // The run exists to read the host install command; a page without one is a
  // failed run, not a finished one.
  if (!result.ok)
    throw new Error(
      `the Vast host setup page shows no install command: ${result.reason}`,
    );

  const shots = runRecordingsDir('vast_login');
  await ws.page.screenshot({
    path: join(shots, 'install_cmd.png'),
    fullPage: true,
  });
  console.log(`[vast] screenshot -> ${join(shots, 'install_cmd.png')}`);
  await humanIdlePause('long');

  const afterState = await ws.page.evaluate(() => ({
    toast:
      document.body.innerText.match(
        /[^\n]*(listed|success|error|fail|invalid|unauth)[^\n]*/i,
      )?.[0] ?? null,
    url: location.href,
  }));
  console.log('[vast] after state ->', JSON.stringify(afterState));
  console.log('PASS: Vast install command read');
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  process.exitCode = exitStatusFor(e);
} finally {
  await ws.ctx.close?.().catch(() => {});
}
