// Reading one live page of the GIS handoff, and clicking the one thing that read
// tagged.
//
// The read is a single evaluate so the facts cannot disagree with each other,
// and the click re-finds the tagged element after scrolling it into view rather
// than trusting a coordinate from an earlier poll.
import { humanClick } from '../../../../../dist/human/mouse.js';
import { navEval } from '../../../_shared/page/navigation/read.mjs';
import { GOOGLE_ACCOUNTS_HOST } from '../../../_shared/profile/google_session.mjs';

// A rendered control is one the browser draws: it has an area and is not
// hidden by display, visibility or opacity. Titles, identifiers and the body
// are read whole.

// One read of one page: everything the state machine decides on, collected in a
// single evaluate so the facts cannot disagree with each other. Element centres
// come back as points because every click goes through humanClick.
//
// Exported as a standalone function of its argument (no closure over module
// state) so a recorded DOM snapshot can be replayed through the exact code the
// live run uses — this surface is diagnosed from recorded DOM, so the reading of
// that DOM must not be a second implementation.
export const readGisState = (arg) => {
  const rect = (el) => el.getBoundingClientRect();
  const shown = (el) => {
    const r = rect(el);
    return (
      Boolean(r.width && r.height) &&
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    );
  };
  const live = (el) =>
    !(
      el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('disabled') !== null
    );
  const label = (el) => el.innerText.replace(/\s+/g, ' ').trim();
  const mean = (...values) => values.reduce((sum, value) => sum + value) / values.length;
  // Tag the element the state machine will act on, so the click re-finds exactly
  // this element (after scrolling it into view) instead of trusting a coordinate
  // read one poll earlier. Tags from the previous poll are cleared first.
  for (const stale of Array.from(document.querySelectorAll('[data-weles-gis]')))
    stale.removeAttribute('data-weles-gis');
  const point = (el, kind) => {
    el.setAttribute('data-weles-gis', kind);
    const r = rect(el);
    return { x: mean(r.left, r.right), y: mean(r.top, r.bottom) };
  };
  const pick = (selector, kind, re) => {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!shown(el) || !live(el)) continue;
      if (re && !re.test(label(el))) continue;
      return point(el, kind);
    }
    return null;
  };

  // Selectable account rows carry data-identifier. Text mentioning the address
  // can instead be an account-switch action and must not count as a row.
  const rows = Array.from(
    document.querySelectorAll('[data-identifier]'),
  ).filter((el) => el.getAttribute('data-identifier').trim() && shown(el));
  const wanted = arg.email ? arg.email.trim().toLowerCase() : null;
  const mine = wanted
    ? rows.find(
        (el) =>
          el.getAttribute('data-identifier').trim().toLowerCase() === wanted,
      )
    : null;
  // A different account is not a substitute, even when it is the only row.
  // "Use another account" is a separate control, never another identity's row:
  // the chooser's list entry that carries no account identifier.
  const [firstRow] = rows;
  const chooserList = firstRow ? firstRow.closest('ul') : null;
  const otherAccount = chooserList
    ? Array.from(chooserList.querySelectorAll(':scope > li')).find(
        (item) => !item.querySelector('[data-identifier]') && shown(item),
      )
    : null;

  // Google's affirmative control. #submit_approve_access is Google's own id on
  // the older scope screen and [data-primary-action-label] marks the primary
  // action elsewhere; on the confirm screen, where "Continue" and "Cancel" are
  // identical buttons, Google's action row puts the affirmative one last, at
  // the bottom right, so the bottom-right live button is it.
  const affirmativeButton = () => {
    const structural = pick(
      '#submit_approve_access button, #submit_approve_access, [data-primary-action-label] button',
      'primary',
    );
    if (structural) return structural;
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"]'),
    ).filter((el) => shown(el) && live(el));
    const [last] = buttons.sort(
      (a, b) =>
        rect(b).bottom - rect(a).bottom || rect(b).right - rect(a).right,
    );
    return last ? point(last, 'primary') : null;
  };
  // claude.ai's grant screen is its /oauth/authorize route; it renders its
  // buttons disabled while it loads the authorize data, and the grant itself is
  // found by the vision model when clicked.
  const claudeHost = ['claude.ai', 'claude.com'].some(
    (domain) =>
      location.hostname === domain || location.hostname.endsWith(`.${domain}`),
  );
  const grantScreen =
    claudeHost && location.pathname.startsWith('/oauth/authorize');
  const grantButtons = grantScreen
    ? Array.from(document.querySelectorAll('button,[role="button"]')).filter(
        shown,
      )
    : [];
  // The sign-in-with-Google control carries Google's brand name in every
  // language ("Continue with Google", "Kontynuuj z Google").
  const googleButtons = Array.from(
    document.querySelectorAll('button,[role="button"]'),
  ).filter((el) => shown(el) && /google/i.test(label(el)));

  const state = {
    ok: true,
    url: location.href,
    host: location.host,
    pathname: location.pathname,
    title: document.title,
    rowCount: rows.length,
    rowIdentifiers: rows.map((el) => el.getAttribute('data-identifier')),
    accountRow: mine ? point(mine, 'account_row') : null,
    accountRowMatchedBy: mine ? 'data_identifier' : null,
    otherAccountRow: otherAccount ? point(otherAccount, 'other_account') : null,
    consent: grantButtons.some(live),
    // The grant screen renders Authorize and Decline disabled while it loads
    // its authorize data: a run read the screen moments after
    // /v1/oauth/<org>/authorize was requested, both buttons disabled="".
    consentPending: Boolean(grantButtons.length) && !grantButtons.some(live),
    gisButton: (() => {
      const ready = googleButtons.find(live);
      return ready ? point(ready, 'gis_button') : null;
    })(),
    // claude.ai renders its "Continue with Google" button disabled until its
    // Google library is ready: a run failed on that page as 'unknown'
    // moments after the authorize URL loaded.
    gisButtonPending: googleButtons.some((el) => !live(el)),
    // claude.ai serves its authorize page as an app shell that renders later:
    // one run recorded claude.ai/oauth/authorize titled "Claude" with an
    // empty #root under [data-page-loading] and no control at all, and another
    // the same page with #root rendered around a [role=status]
    // [data-page-loading] spinner. Either is the app still loading: a state
    // of its own, waited out, not a failure. A rendered control outranks it,
    // because the consent, gate and app checks are classified first.
    appLoading: document.querySelector('[data-page-loading]') !== null,
    // Only a visible challenge blocks the handoff; providers retain hidden frames after acceptance.
    captchaChallenge: Array.from(
      document.querySelectorAll(
        'iframe[src*="hcaptcha.com"][src*="frame=challenge"], iframe[src*="recaptcha"][src*="bframe"], iframe[src*="arkoselabs"], iframe[src*="challenges.cloudflare.com"]',
      ),
    ).some((frame) => frame.checkVisibility()),
    identifierField: Array.from(
      document.querySelectorAll(
        'input[type="text"][autocomplete*="username"], input#identifierId, input[name="identifier"], input[type="email"]',
      ),
    ).some(shown),
    passwordField: Array.from(
      document.querySelectorAll('input[type="password"]'),
    ).some(shown),
    bodyText: document.body.innerText.replace(/\s+/g, ' '),
  };
  // Only look for the affirmative button once no row is waiting to be picked
  // (picking the account always precedes confirming it), and only on Google's
  // confirm screens: the account chooser and the OAuth scope routes.
  const confirmScreen =
    location.hostname === arg.googleHost &&
    ['/signin/accountchooser', '/signin/oauth', '/o/oauth2'].some((route) =>
      location.pathname.includes(route),
    );
  state.googlePrimary =
    state.accountRow || !confirmScreen ? null : affirmativeButton();
  return state;
};

// Click the element the last probe tagged: scroll it into the middle of the
// viewport, re-read its box there, refuse when something else owns that point,
// and only then move the pointer onto it. The coordinate a probe read before a
// scroll or a re-render is not where the affordance is now.
export async function clickGisTarget(page, kind) {
  const spot = await navEval(
    page,
    (k) => {
      const el = document.querySelector(`[data-weles-gis="${k}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (!(r.width && r.height)) return null;
      const mean = (...values) => values.reduce((sum, value) => sum + value) / values.length;
      const x = mean(r.left, r.right);
      const y = mean(r.top, r.bottom);
      const hit = document.elementFromPoint(x, y);
      const reachable =
        Boolean(hit) && (hit === el || el.contains(hit) || hit.contains(el));
      return {
        x,
        y,
        reachable,
        hit: hit ? [hit.tagName, ...hit.classList].join('.') : null,
      };
    },
    null,
    kind,
  );
  if (!spot) return { clicked: false, reason: `no element tagged ${kind}` };
  if (!spot.reachable)
    return { clicked: false, reason: `${kind} covered by ${spot.hit}` };
  await humanClick(page, Math.round(spot.x), Math.round(spot.y));
  return { clicked: true, reason: null };
}

// Read one live page through that probe. A navigation mid-read means "not ready,
// look again", which navEval already turns into the null default.
export async function observeGisPage(p, email) {
  return navEval(p, readGisState, null, { email, googleHost: GOOGLE_ACCOUNTS_HOST });
}
