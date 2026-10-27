// Signing in to the Supabase dashboard with the Weles Supabase dashboard
// login from Skarbiec: its email and password typed into the sign-in form,
// submitted from the password field. Supabase answers by routing to a
// dashboard page, or with its own alert, whose text is the refusal.
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { humanFill } from '../../../dist/human/keyboard.js';
import { pageSettled, submitAnswered } from '../_shared/page/settled.mjs';

export const SIGNIN = new URL('https://supabase.com/dashboard/sign-in');
const ALERT = '[role="alert"], [data-error="true"], p[class*="error" i]';

/** Whether `url` is a dashboard page the sign-in route hands over to. */
export function signedIn(url) {
  const at = new URL(url);
  return (
    at.origin === SIGNIN.origin &&
    at.pathname.startsWith('/dashboard/') &&
    !at.pathname.startsWith(SIGNIN.pathname)
  );
}

/** Signs `s` in to the Supabase dashboard; answers the dashboard address it landed on. */
export async function signInToSupabase(s) {
  const login = readScopedLogin('supabaseDashboard');
  console.log(`[supabase] signing in as ${login.email}`);
  await s.goto(SIGNIN.href);
  await pageSettled(s.page);
  if (signedIn(s.page.url())) return s.page.url();
  const field = (selector, what) => {
    const found = s.page.locator(selector).filter({ visible: true }).first();
    return found.isVisible().then((shown) => {
      if (!shown)
        throw new Error(
          `SUPABASE_SIGN_IN_FORM: the sign-in page shows no ${what} field (the account may sign in through GitHub only)`,
        );
      return found;
    });
  };
  await humanFill(
    s.page,
    await field('input[name="email"], input[type="email"]', 'email'),
    login.email,
  );
  await humanFill(
    s.page,
    await field('input[name="password"], input[type="password"]', 'password'),
    login.password,
  );
  await s.page.keyboard.press('Enter');
  const alert = s.page.locator(ALERT).filter({ hasText: /\S/ }).first();
  await submitAnswered(
    s.page,
    (url) => new URL(url).pathname.startsWith(SIGNIN.pathname),
    alert,
  );
  if (!signedIn(s.page.url()))
    throw new Error(
      `SUPABASE_SIGN_IN_REFUSED: still at ${s.page.url()}${(await alert.count()) ? `: ${(await alert.innerText()).trim()}` : ''}`,
    );
  return s.page.url();
}
