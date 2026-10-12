// The two things OpenAI asks of a brand-new identity, both answered from this
// account's own Gmail mailbox: accepting the ChatGPT workspace invitation, and
// finishing the e-mail verification.
//
// Neither step reads a second credential and neither involves a phone number:
// the session is already signed in as the very account both messages were sent
// to. Both are bounded and run once per run.
import { humanClick, humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { navEval } from './page_controls.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';

// The hosts OpenAI sends its invitation and verification links from. Gmail's
// search already narrowed the mailbox to OpenAI's own mail, so the first
// result is the message and its link is the one on these hosts.
const OPENAI_LINK_HOSTS = ['chatgpt.com', 'chat.openai.com', 'auth.openai.com'];

/** Opens the first message of the current Gmail search; false when there is none. */
async function openFirstResult(page) {
  const row = await navEval(
    page,
    () => {
      const first = Array.from(
        document.querySelectorAll('tr.zA, div[role="listitem"]'),
      ).find((element) => element.getClientRects().length);
      if (!first) return null;
      const box = first.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },
    null,
  );
  if (!row) return false;
  await humanClick(page, Math.round(row.x), Math.round(row.y));
  return true;
}

/** The first link of the open message that points at an OpenAI host. */
function openaiLink(page) {
  return navEval(
    page,
    (hosts) => {
      for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
        if (
          URL.canParse(anchor.href) &&
          hosts.includes(new URL(anchor.href).hostname)
        )
          return anchor.href;
      }
      return null;
    },
    null,
    OPENAI_LINK_HOSTS,
  );
}

/**
 * The code in `mail` as long as `field` takes: the verification form's own
 * maxlength says how many digits OpenAI's code has.
 */
async function codeFor(field, mail) {
  const length = await field.getAttribute('maxlength');
  if (!length)
    throw new Error(
      "OpenAI's verification code field states no maxlength, so the code in the mail cannot be told from other numbers",
    );
  const found = mail.match(new RegExp(`\\b\\d{${length}}\\b`));
  if (!found)
    throw new Error(
      `the OpenAI verification mail holds no ${length}-digit code and no link`,
    );
  return found.shift();
}

// Accept the ChatGPT workspace invitation waiting in this account's own mailbox.
//
// A Google identity with no ChatGPT account is pushed into personal signup, and
// personal signup asks for a phone number. An invited seat does not need one:
// its account is created by accepting the invitation, and that invitation is in
// the mailbox of the very account this session is already signed in as, so no
// second credential is read and no phone number is involved.
//
// Bounded, once per run. The link is followed by href rather than by clicking
// through a new tab, because a background tab is a second page to track for no
// gain. Returns the URL the flow ended at, or null when there is no invitation.
export async function acceptPendingWorkspaceInvite(page, login, mark) {
  mark('workspace_invite_lookup');
  const query = encodeURIComponent(
    'from:openai.com (invite OR invitation OR workspace)',
  );
  await page.goto(`https://mail.google.com/mail/u/0/#search/${query}`, {
    waitUntil: 'commit',
  });
  await pageSettled(page);
  if (!(await openFirstResult(page))) {
    console.log(
      `[google_sso] no ChatGPT invitation in the mailbox of ${login.email}`,
    );
    return null;
  }
  mark('workspace_invite_opened');
  await pageSettled(page);
  const target = await openaiLink(page);
  if (!target) {
    console.log(
      '[google_sso] the invitation mail carries no workspace acceptance link',
    );
    return null;
  }
  await page.goto(target, { waitUntil: 'commit' });
  await pageSettled(page);
  await clickDescribed(
    page,
    'the button that accepts the ChatGPT workspace invitation and joins the workspace',
  );
  mark('workspace_invite_control_clicked');
  await pageSettled(page);
  const landed = await navEval(page, () => location.href, '?');
  console.log(`[google_sso] the workspace invitation flow ended at ${landed}`);
  return landed;
}

// Finish OpenAI's email verification from the same mailbox.
//
// Accepting a workspace invitation can leave the account one step short: OpenAI
// mails a verification link (or a six-digit code) and parks on
// /email-verification until it is used. The mail arrives in the account this
// session is already signed in as, so the step needs no phone, no second
// credential and no operator. Bounded and once per run.
export async function completeEmailVerification(page, login, mark) {
  mark('email_verification_lookup');
  const query = encodeURIComponent(
    'from:openai.com (verify OR verification OR code)',
  );
  await page.goto(`https://mail.google.com/mail/u/0/#search/${query}`, {
    waitUntil: 'commit',
  });
  await pageSettled(page);
  if (!(await openFirstResult(page))) {
    console.log(
      `[google_sso] no OpenAI verification mail in the mailbox of ${login.email} yet`,
    );
    return null;
  }
  await pageSettled(page);
  mark('email_verification_opened');
  const link = await openaiLink(page);
  if (link) {
    await page.goto(link, { waitUntil: 'commit' });
    await pageSettled(page);
    mark('email_verification_link_used');
  } else {
    const mail = await navEval(page, () => document.body.innerText, null);
    await page.goBack({ waitUntil: 'commit' });
    const field = page
      .locator(
        'input[autocomplete="one-time-code"], input[name="code"], input[type="tel"], input[type="text"]',
      )
      .filter({ visible: true })
      .first();
    await field.waitFor({ state: 'visible' });
    const code = await codeFor(field, mail);
    await humanClickLocator(page, field);
    await humanFill(page, field, code);
    mark('email_verification_code_entered');
    await clickDescribed(
      page,
      'the button that submits the entered verification code',
    );
    mark('email_verification_submit_clicked');
    await pageSettled(page);
  }
  const landed = await navEval(page, () => location.href, '?');
  console.log(`[google_sso] email verification ended at ${landed}`);
  return landed;
}
