// Where OpenAI's half of the handoff ends, and the one page it puts in front of
// that end.
//
// auth.openai.com is an intermediate host, so "done" is a small named set of
// URLs rather than "left Google". The Codex consent page is the one screen the
// CLI cannot get past on its own, and a workspace that has device-code
// authorization switched off says so by rendering its Continue button disabled —
// a settings problem with its own error code, not something to wait out.
import { navEval } from './page_controls.mjs';
import { humanClickLocator } from '../../../../dist/human/mouse.js';

/** The consent page's own submit control. */
const CONSENT_SUBMIT = 'form button[type="submit"], form input[type="submit"]';

export function isTerminalHost(host, href) {
  // auth.openai.com is an intermediate redirect (login / callback); the real
  // end-state is platform.openai.com or chatgpt.com where Codex CLI receives
  // the token via callback.
  if (/^platform\.openai\.com$/i.test(host)) return true;
  if (/^chatgpt\.com$/i.test(host)) return true;
  // A very small set of auth.openai.com callback URLs mean we are done.
  if (
    /^auth\.openai\.com$/i.test(host) &&
    /(?:\/codex\/device\/(?:callback|success)|\/deviceauth\/callback)/i.test(
      href || '',
    )
  )
    return true;
  // The non-device browser flow redirects to a local server started by
  // `codex login` (no --device-auth). Recognize that as terminal as well.
  if (
    /^localhost(:\d+)?$/i.test(host) &&
    /(?:\/auth\/callback|\/success)/i.test(href || '')
  )
    return true;
  return false;
}

function isCodexConsentPage(host, pathname) {
  return (
    host === 'auth.openai.com' &&
    pathname === '/sign-in-with-chatgpt/codex/consent'
  );
}

export async function handleCodexConsentPage(page, mark) {
  const url = new URL(page.url());
  if (!isCodexConsentPage(url.host, url.pathname)) return false;
  mark('codex_consent_page');
  const state = await navEval(
    page,
    (selector) => {
      const btn = document.querySelector(selector);
      if (!btn) return { found: false };
      return {
        found: true,
        disabled: btn.matches(':disabled, [aria-disabled="true"]'),
        text: (btn.innerText || btn.value).trim(),
      };
    },
    { found: false },
    CONSENT_SUBMIT,
  );
  if (!state.found) return false;
  if (state.disabled) {
    const e = new Error(
      'CODEX_DEVICE_AUTH_DISABLED: ChatGPT Security Settings require enabling "Device code authorization for Codex" before Codex CLI can sign in',
    );
    e.code = 'CODEX_DEVICE_AUTH_DISABLED';
    throw e;
  }
  await humanClickLocator(page, page.locator(CONSENT_SUBMIT).first());
  mark('codex_consent_clicked');
  // The non-device flow redirects to a local server; the device flow
  // redirects back to auth.openai.com. Wait for either terminal URL, for as
  // long as Playwright's own navigation default allows.
  const current = page.url();
  const cur = URL.canParse(current) ? new URL(current) : null;
  if (cur && isTerminalHost(cur.host, cur.href)) return true;
  try {
    await page.waitForURL((url) => isTerminalHost(url.host, url.href));
    return true;
  } catch (e) {
    const final = page.url();
    throw new Error(`post-consent: no terminal redirect (final=${final})`, {
      cause: e,
    });
  }
}
