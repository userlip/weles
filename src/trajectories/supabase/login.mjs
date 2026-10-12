// Supabase dashboard login through the exact Weles Supabase dashboard item.
// Run: node src/trajectories/supabase/login.mjs
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { WSession } from '../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { pageSettled, submitAnswered } from '../_shared/page/settled.mjs';
import { humanFill } from '../../../dist/human/keyboard.js';

const SIGNIN = new URL('https://supabase.com/dashboard/sign-in');
// Signed in is any dashboard page the sign-in route hands over to.
const signedIn = (url) => {
  const at = new URL(url);
  return (
    at.origin === SIGNIN.origin &&
    at.pathname.startsWith('/dashboard/') &&
    !at.pathname.startsWith(SIGNIN.pathname)
  );
};

const login = readScopedLogin('supabaseDashboard');
console.log(
  `[trajectory] Using exact Supabase dashboard login: ${login.email}`,
);

const s = await WSession.start({
  label: 'supabase_login',
  browser: 'chromium',
});
try {
  await s.goto(SIGNIN.href);
  await pageSettled(s.page);

  const emailInput = s.page
    .locator('input[name="email"], input[type="email"], input#email')
    .filter({ visible: true })
    .first();
  const pwInput = s.page
    .locator('input[name="password"], input[type="password"], input#password')
    .filter({ visible: true })
    .first();
  if (!(await emailInput.isVisible()))
    throw new Error('email input not visible on sign-in page');
  if (!(await pwInput.isVisible()))
    throw new Error(
      'password input not visible (account may be GitHub-SSO-only)',
    );

  await humanFill(s.page, emailInput, login.email);
  await pageSettled(s.page);
  await humanFill(s.page, pwInput, login.password);
  await pageSettled(s.page);

  // The form is submitted by itself, from the password field just typed in.
  await s.page.keyboard.press('Enter');

  // Supabase answers by routing away from /sign-in or with its own alert.
  const ERROR_SELECTOR =
    '[role="alert"], .error, [data-error="true"], p[class*="error" i]';
  await submitAnswered(
    s.page,
    (url) => new URL(url).pathname.startsWith(SIGNIN.pathname),
    s.page.locator(ERROR_SELECTOR).filter({ hasText: /\S/ }).first(),
  );
  const url = s.page.url();
  if (!signedIn(url)) {
    const errText = await s.page.evaluate((selector) => {
      for (const sel of selector.split(', ')) {
        const el = document.querySelector(sel);
        if (el && el.textContent?.trim()) return el.textContent.trim();
      }
      return null;
    }, ERROR_SELECTOR);
    throw new Error(
      `supabase_login_refused at ${url}. error=${JSON.stringify(errText)}`,
    );
  }
  console.log(`PASS: landed on ${url}`);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
