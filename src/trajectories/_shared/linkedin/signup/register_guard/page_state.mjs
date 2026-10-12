import { pageSettled } from '../../../page/settled.mjs';
// What the LinkedIn signup page shows: its form selectors, a summary of the page, the
// challenge it presents, and whether the session is authenticated.

export const LINKEDIN_SIGNUP_EMAIL_SELECTOR = [
  'form.join-form input[name="email-address"]',
  'form.join-form input#email-address',
  'form.join-form input[type="email"]',
  'input[name="email-address"]',
  'input#email-address',
].join(', ');

export const LINKEDIN_SIGNUP_PASSWORD_SELECTOR = [
  'form.join-form input[name="password"]',
  'form.join-form input#password',
  'form.join-form input[autocomplete="new-password"]',
  'form.join-form input[type="password"]',
  'input[name="password"]:not([name="session_password"])',
  'input#password',
].join(', ');

/** The first visible match on the settled page, or null when it shows none. */
export async function firstVisible(page, selector) {
  await pageSettled(page);
  const loc = page.locator(selector).filter({ visible: true }).first();
  return (await loc.isVisible()) ? loc : null;
}

export async function summarizeLinkedinPage(page) {
  const url = page.url?.() ?? '';
  return await page.evaluate((u) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none'
      );
    };
    return {
      url: u,
      title: document.title,
      pageKey: document.querySelector('meta[name="pageKey"]')?.content ?? '',
      inputs: Array.from(document.querySelectorAll('input')).map((i) => ({
        name: i.name,
        id: i.id,
        type: i.type,
        autocomplete: i.getAttribute('autocomplete') ?? '',
        visible: visible(i),
      })),
      buttons: Array.from(document.querySelectorAll('button,a'))
        .filter(visible)
        .map((b) => ({
          tag: b.tagName.toLowerCase(),
          text: (b.innerText || b.textContent || '')
            .trim()
            .replace(/\s+/g, ' '),
          href: b.getAttribute('href') ?? '',
        })),
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => ({
        id: f.id,
        name: f.name,
        title: f.title,
        src: f.src,
        visible: visible(f),
      })),
      bodyText: (document.body?.innerText ?? '').trim().replace(/\s+/g, ' '),
    };
  }, url);
}

// The hosts a captcha provider serves its challenge frame from.
export const CAPTCHA_FRAME_HOSTS = [
  'google.com/recaptcha',
  'recaptcha.net',
  'arkoselabs.com',
  'funcaptcha.com',
  'hcaptcha.com',
];

// The challenge the page presents, read from its structure: the checkpoint
// route, a visible captcha provider or challenge frame while the signup form
// is gone, and a checkpoint that does not ask for the emailed PIN.
export function getLinkedinChallengeSignal(summary = {}) {
  const isDormantInvisibleRecaptcha = (f = {}) => {
    try {
      const u = new URL(f.src ?? '');
      return (
        /(^|\.)google\.com$/.test(u.hostname) &&
        /\/recaptcha\/enterprise\/anchor/.test(u.pathname) &&
        u.searchParams.get('size') === 'invisible'
      );
    } catch {
      return false;
    }
  };
  const url = String(summary.url);
  const visibleInputs = Array.isArray(summary.inputs)
    ? summary.inputs.filter((input) => input.visible)
    : [];
  const hasVisibleSignupForm =
    visibleInputs.some(
      (input) => input.name === 'email-address' || input.type === 'email',
    ) && visibleInputs.some((input) => input.type === 'password');
  // The normal LinkedIn signup page embeds invisible reCAPTCHA Enterprise and
  // ProTechTS iframes while the form remains usable: risk instrumentation,
  // not a blocking challenge.
  const challengeFrames = (
    Array.isArray(summary.iframes) ? summary.iframes : []
  )
    .filter((frame) => frame.visible && !isDormantInvisibleRecaptcha(frame))
    .map((frame) => String(frame.src));
  if (
    !hasVisibleSignupForm &&
    (url.includes('/checkpoint/challenge') ||
      challengeFrames.some(
        (src) =>
          src.includes('challengeIframe') ||
          CAPTCHA_FRAME_HOSTS.some((host) => src.includes(host)),
      ))
  )
    return 'challenge_page';
  const asksForPin = visibleInputs.some(
    (input) =>
      input.autocomplete === 'one-time-code' ||
      [input.name, input.id].some((field) => String(field).includes('pin')),
  );
  if (url.includes('/checkpoint') && !asksForPin) return 'checkpoint_page';
  return '';
}

export async function assertNoLinkedinChallengePage(session, stage = '') {
  const summary = await summarizeLinkedinPage(session.page);
  const signal = getLinkedinChallengeSignal(summary);
  if (signal) {
    throw new Error(
      `DETECTION_TRIGGERED: ${signal} stage=${stage} summary=${JSON.stringify(summary)}`,
    );
  }
  return summary;
}

export async function getLinkedinAuthState(session) {
  const finalUrl = session.page.url?.() ?? '';
  const cookies = await session.ctx.cookies().catch(() => []);
  const linkedinCookies = cookies.filter((c) =>
    /linkedin\.com$/.test(c.domain ?? ''),
  );
  const liAt = linkedinCookies.find((c) => c.name === 'li_at' && c.value);
  return {
    final_url: finalUrl,
    linkedin_cookie_count: linkedinCookies.length,
    has_li_at: Boolean(liAt),
    li_at_domain: liAt?.domain ?? '',
    li_at_expires: liAt?.expires ?? null,
  };
}
