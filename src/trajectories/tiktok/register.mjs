import { pageSettled, responseAfterAction } from '../_shared/page/settled.mjs';
import { WSession } from '../../../dist/session/wsession.js';
import { generatePersona } from '../../../dist/browser/persona.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { humanType } from '../../../dist/human/keyboard.js';
import { generateIdentity } from '../../../dist/utils/identity/identity.js';
import { registrationPassword } from '../../../dist/utils/identity/password.js';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import {
  syncReactInputValue,
  installNetworkLogger,
  runUsernameStep,
} from '../lib/tiktok-register-helpers.mjs';
import { screenshotIfPossible } from '../_shared/runner/evidence.mjs';
import { probeButton, recordedClicks } from './register/button_probe.mjs';
import { dumpStuckState } from './register/stuck_diagnostics.mjs';
import { statedCount } from '../_shared/inputs/stated.mjs';

const SIGNUP_URL = 'https://www.tiktok.com/signup';
// TikTok's own calls: the code request and the sign-up verification.
const SEND_CODE = /\/passport\/web\/email\/send_code\/?$/;
const REGISTER_VERIFY = /\/register_verify_login\/?$/;
// TikTok's captcha widget, as the page renders it.
const CAPTCHA_SHOWN = `Boolean(document.querySelector('.captcha-verify-container, .captcha_verify_container, [class*="captcha-"], iframe[src*="captcha"]'))`;

const pathOf = (request) => new URL(request.url()).pathname;

/**
 * TikTok's answer to the request `action` sends to `path`, or the captcha it
 * shows instead: a captcha widget holds the request back until it is solved.
 */
async function answerOrCaptcha(page, path, action) {
  let decided = false;
  const captcha = (async () => {
    while (!decided) {
      await pageSettled(page);
      if (await page.evaluate(CAPTCHA_SHOWN)) return { captcha: true };
    }
    return { captcha: false };
  })();
  const answered = responseAfterAction(
    page,
    (request) => path.test(pathOf(request)),
    action,
  ).then((response) => ({ response }));
  const first = await Promise.race([answered, captcha]);
  decided = true;
  return first;
}

/** A TikTok JSON answer, or why it could not be read. */
async function answerBody(response) {
  try {
    return { body: await response.json() };
  } catch (error) {
    return {
      unreadable: `${response.status()} ${response.url()} is not JSON: ${error.message}`,
    };
  }
}

{
  // Single deterministic path — phone-or-email → email tab → fill DOB+email+
  // password → send code → poll the inbox → verify code → land on /foryou.
  // MAX_RETRIES attempts, each with a fresh identity, if browser/page dies
  // during early setup; how many is the caller's and is required.
  let id = null,
    password = null,
    s = null,
    success = false;

  /** A key press the page refuses is logged; the step decides what it means. */
  async function press(key) {
    try {
      await s.page.keyboard.press(key);
    } catch (e) {
      console.log(`[test] key ${key} not delivered: ${e.message}`);
    }
  }

  const maxRetries = statedCount(
    'MAX_RETRIES',
    'how many fresh identities this registration may try',
  );
  // retry-allowed: every attempt registers a different identity through a
  // different sticky proxy exit; a dead page or a TTP2-routed exit is not a
  // verdict on the flow, and MAX_RETRIES is the operator's own bound.
  for (let retry = 0; retry < maxRetries; retry++) {
    if (s) {
      await s.close().catch((e) => console.log(`[test] close: ${e.message}`));
      s = null;
    }

    try {
      // Fresh identity per retry — don't reuse emails across failed runs
      id = await generateIdentity('tiktok');
      // One character of every class at the vault policy's length, no fixed
      // prefix (TikTok decodes the body; a recurring prefix is a counter key).
      password = registrationPassword();
      console.log(
        `[test] attempt ${retry + 1}: identity=${id.username} <${id.email}> bday=${id.birthMonth}/${id.birthDay}/${id.birthYear}`,
      );

      // Pin chromium — humanMove uses CDP-routed Page.dispatchMouseEvent
      // which is Chromium-only. Firefox crashes with "synthesizeMouseEvent
      // is not a function" on the first click.
      s = await WSession.start({
        label: 'tiktok_register',
        proxy: process.env.PROXY_URL || 'residential brightdata',
        targetHost: 'www.tiktok.com',
        persona: generatePersona({
          country: 'US',
          browser: process.env.FORCE_BROWSER || 'chromium',
        }),
      });
      const net = installNetworkLogger(s);

      for (const u of [
        'https://www.tiktok.com/',
        'https://www.tiktok.com/explore',
      ]) {
        await s.page
          .goto(u, { waitUntil: 'domcontentloaded' })
          .catch((e) => console.log(`[test] warm-up ${u}: ${e.message}`));
        await pageSettled(s.page);
      }
      await s.goto(SIGNUP_URL);
      await pageSettled(s.page);

      // Verify page is alive
      const alive = await s.page
        .evaluate('document.querySelector("body") !== null')
        .catch(() => false);
      if (!alive) {
        console.log(`[test] attempt ${retry + 1}: page died after goto`);
        continue;
      }
      // Browser-time vregion check. HTTP preflight verifies the FIRST exit
      // IP; BrightData rotates exits within a sticky. SIGI_STATE pins mssdk
      // routing — TTP2 = click handler bails. Abort + reroll.
      const vregion = await s.page
        .evaluate(
          `(() => { const m = (document.body.innerHTML || '').match(/"vregion":"([A-Z0-9-]{1,20})"/); return m ? m[1] : false; })()`,
        )
        .catch(() => false);
      console.log(
        `[test] attempt ${retry + 1}: browser-time vregion=${vregion}`,
      );
      if (vregion && /-TTP2$/i.test(vregion)) {
        console.log(
          `[test] attempt ${retry + 1}: vregion=${vregion} — aborting + rerolling sticky`,
        );
        continue;
      }

      // Dismiss cookie banner if EU/UK proxy
      for (const sel of [
        'button:has-text("Decline optional cookies")',
        'button:has-text("Accept all")',
        'button:has-text("Allow all")',
      ]) {
        try {
          const btn = s.page.locator(sel).first();
          if (await btn.isVisible().catch(() => false)) {
            await humanClickLocator(s.page, btn);
            console.log(`[test] Dismissed cookie banner`);
            break;
          }
        } catch {}
      }

      // Click "Use phone or email" until the page is on /phone-or-email, then
      // "Sign up with email" until it is on the email tab; the page's own URL
      // ends each, not a count of clicks.
      while (!(s.page.url?.() ?? '').includes('/phone-or-email')) {
        await s.click('Use phone or email');
        await pageSettled(s.page);
      }
      while (!(s.page.url?.() ?? '').includes('/email')) {
        await s.click('Sign up with email');
        await pageSettled(s.page);
      }

      // Select birthday
      await s.select('month', id.birthMonth);
      await s.select('day', id.birthDay);
      await s.select('year', id.birthYear);
      await pageSettled(s.page);

      // Email — humanFill via s.fill works for plain text inputs.
      await s.fill('Email', id.email);
      // Password — TikTok's input has a show/hide eye toggle inside the
      // bounding box (~52px from the right). humanClickLocator's randomized
      // in-element offset can hit the toggle, leaving the focused element
      // detached. So: focus() the input directly (no pointer click), then
      // dispatch keystrokes via humanType.
      const pwLoc = s.page
        .locator('input[placeholder="Password"], input[type="password"]')
        .first();
      if (await pwLoc.count()) {
        await pwLoc.focus();
        await pageSettled(s.page);
        await press('ControlOrMeta+A');
        await press('Delete');
        await humanType(s.page, password);
      }
      await pageSettled(s.page);
      // Tab out of password — fires React onBlur, dismisses error banner
      await press('Tab');
      await pageSettled(s.page);
      const verify = await s.page
        .evaluate(`(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const email = inputs.find(i => (i.placeholder || '').toLowerCase().includes('email'));
        const pw = inputs.find(i => (i.placeholder || '').toLowerCase().includes('password'));
        const sendBtn = document.querySelector('[data-e2e="send-code-button"]');
        const errors = Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [class*="tip"], [class*="Tip"]'))
          .map(e => e.textContent.trim()).filter(t => t);
        const pageText = document.body.innerText;
        return { emailLen: email?.value?.length, pwLen: pw?.value?.length, sendDisabled: sendBtn?.disabled, sendAriaDisabled: sendBtn?.getAttribute('aria-disabled'), errors, bodyText: pageText };
      })()`)
        .catch((e) => ({ error: e.message }));
      console.log(`[test] fill verify: ${JSON.stringify(verify)}`);
      await pageSettled(s.page);

      // Capture Send code button rect + install click listener
      const sendInfo = await probeButton(s.page, 'send-code');
      console.log(`[test] send button: ${JSON.stringify(sendInfo)}`);
      if (sendInfo.disabled !== false) {
        console.log('[test] Send button disabled — skipping');
        continue;
      }
      // TikTok answers the code request itself; its captcha widget, when it
      // shows, holds that request back. Either is the answer, not page words.
      const sendCode = await answerOrCaptcha(s.page, SEND_CODE, () =>
        s.click('Send code'),
      );
      await screenshotIfPossible(s, `after_send_code_r${retry}`);
      if (sendCode.captcha) {
        console.log('FAIL: TikTok showed its captcha before sending the code');
        break;
      }
      const sent = await answerBody(sendCode.response);
      if (sent.unreadable) {
        console.log(
          `[test] attempt ${retry + 1}: TikTok's send_code answer could not be read: ${sent.unreadable}`,
        );
        await dumpStuckState(s, 'send_code_unreadable');
        continue;
      }
      if (sent.body?.message !== 'success') {
        // TikTok refused this session; its own answer says why (a rate
        // limit among them), and another identity on it would be refused too.
        console.log(
          `FAIL: TikTok refused to send the code: ${JSON.stringify(sent.body)}`,
        );
        break;
      }

      // Poll the inbox for the verification code
      console.log(`[test] Polling email for ${id.email}...`);
      const code = await s.checkEmail(id.email, 'tiktok');
      if (!code || code === 'no code received' || !/^\d{4,8}$/.test(code)) {
        console.log(`[test] attempt ${retry + 1}: no code (${code})`);
        continue;
      }
      console.log(`[test] Got code: ${code}`);

      // Type code char-by-char w/ variable delays
      const codeLoc = s.page
        .locator('input[placeholder*="digit" i], input[name="code"]')
        .first();
      await humanClickLocator(s.page, codeLoc).catch((e) =>
        console.log(`[test] code input click: ${e.message}`),
      );
      await humanType(s.page, code);
      // Reconcile React state only after send_code has succeeded.
      if (await pwLoc.count().catch(() => false))
        await syncReactInputValue(pwLoc, password);
      await syncReactInputValue(codeLoc, code);
      await press('Tab');
      await pageSettled(s.page);

      const nextInfo = await probeButton(s.page, 'next');
      console.log(`[test] Next button: ${JSON.stringify(nextInfo)}`);

      if (nextInfo.disabled !== false) {
        console.log('[test] Next disabled, cannot submit');
        continue;
      }
      // TikTok verifies the code and creates the account in one call; its
      // answer, or its captcha, says what Next did.
      const verifyCall = await answerOrCaptcha(s.page, REGISTER_VERIFY, () =>
        s.click('Next'),
      );
      console.log(`[test] clicks received: ${await recordedClicks(s.page)}`);
      await screenshotIfPossible(s, `after_next_r${retry}`);
      if (verifyCall.captcha) {
        console.log(
          `[test] attempt ${retry + 1}: TikTok showed its captcha on Next`,
        );
        await dumpStuckState(s, 'next_captcha');
        continue;
      }
      const verified = await answerBody(verifyCall.response);
      if (verified.unreadable) {
        console.log(
          `[test] attempt ${retry + 1}: TikTok's register_verify_login answer could not be read: ${verified.unreadable}`,
        );
        await dumpStuckState(s, 'next_unreadable');
        continue;
      }
      if (verified.body?.message !== 'success') {
        console.log(
          `[test] attempt ${retry + 1}: TikTok did not create the account: ${JSON.stringify(verified.body)}`,
        );
        await dumpStuckState(s, 'next_no_account');
        continue;
      }
      await pageSettled(s.page);

      // TikTok sends a new account to its username step by URL.
      if (/\/signup\/create-username/.test(new URL(s.page.url()).pathname)) {
        id.username = await runUsernameStep(s, id, humanClickLocator);
      }

      // Signed in is TikTok's own session cookie on the context: it is
      // HttpOnly, so the page's document.cookie never showed it, and a
      // /foryou or /@ URL is shown to signed-out visitors too.
      const finalUrl = s.page.url();
      const hasSessionId = (await s.ctx.cookies('https://www.tiktok.com')).some(
        (cookie) => cookie.name === 'sessionid' && cookie.value,
      );
      const signedIn = hasSessionId;
      if (signedIn) {
        await s.saveAccount('tiktok', {
          username: id.username,
          email: id.email,
          password,
        });
        await autoBindCharacter(id.username, 'tiktok')
          .then((r) => console.log(`[bind] ${JSON.stringify(r)}`))
          .catch((e) => console.log(`[bind] err: ${e.message}`));
        console.log(
          `PASS: ${id.username} (final url ${finalUrl}, sessionid=${hasSessionId})`,
        );
        success = true;
        break;
      }
      console.log(
        `[test] attempt ${retry + 1}: didn't reach logged-in state. finalUrl=${finalUrl} sessionid=${hasSessionId}`,
      );
    } catch (e) {
      console.log(`[test] attempt ${retry + 1} crashed: ${e.message}`);
    }
  }

  if (s)
    await s.close().catch((e) => console.log(`[test] close: ${e.message}`));
  if (!success) {
    console.log('FAIL: exhausted retries');
    process.exitCode = 1;
  }
}
