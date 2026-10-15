/**
 * Reddit signup with direct Playwright steps (no LLM agent loop):
 *   1. /register: the email, submitted from its own field; Reddit's answer to
 *      register_email_verify_initialize says whether it sent the code
 *   2. the code Reddit mailed (shared mailed-code reader, at the length the
 *      code field states), submitted from its field
 *   3. the chosen username (Reddit's suggestion cleared first) and password
 *   4. the account recorded in Skarbiec with the session, its character bound
 *   5. PASS only once the record exists and holds Reddit's session cookie
 */
import { WSession } from '../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { humanType } from '../../../dist/human/keyboard.js';
import { humanMove, humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled, responseAfterAction } from '../_shared/page/settled.mjs';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import { findAccount } from '../_shared/skarbiec/accounts.mjs';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { fieldCodeLength, mailedCode } from '../_shared/inputs/mailed_code.mjs';

const SIGNUP_URL = 'https://www.reddit.com/register';
const VERIFY_INITIALIZE = /register_email_verify_initialize/i;
// Reddit's own session cookies for a signed-in account, by exact name.
const REDDIT_SESSION = { reddit_session: true, token_v2: true };

const s = await WSession.start({
  label: 'reddit_register',
  proxy: statedProxy('the Reddit signup'),
  targetHost: 'www.reddit.com',
  platform: 'reddit',
});
const id = {
  username: s.identity.username,
  email: s.identity.email,
  password: s.identity.password,
  name: `${s.identity.firstName} ${s.identity.lastName}`,
};
console.log(`[register] identity: ${id.username} ${id.email}`);

// Reddit's signup-time classifier reads the behaviour trace, so the pointer
// wanders over the page between steps as a person's does.
async function wander() {
  const viewport = s.page.viewportSize();
  if (!viewport) return;
  await humanMove(s.page, Math.random() * viewport.width, Math.random() * viewport.height);
}

/** The first visible field of `selector`, once the page shows it. */
async function shownField(selector) {
  const field = s.page.locator(selector).filter({ visible: true }).first();
  await field.waitFor({ state: 'visible' });
  return field;
}

/** Types `text` into `field` as a person would, then lets the page settle. */
async function typeInto(field, text) {
  await humanClickLocator(s.page, field);
  await pageSettled(s.page);
  await humanType(s.page, text);
  await pageSettled(s.page);
  await wander();
}

/** Submits the email; Reddit's answer to its verify-initialize call says whether the code was sent. */
async function submitEmail() {
  const email = await shownField('input[type="email"], input[name="email"], input[autocomplete="email"]');
  await typeInto(email, id.email);
  // Each step is submitted by its own form, from the field just typed into.
  const answer = await responseAfterAction(
    s.page,
    (request) => VERIFY_INITIALIZE.test(request.url()),
    () => s.page.keyboard.press('Enter'),
  );
  if (!answer.ok())
    throw new Error(
      `REDDIT_VERIFY_INIT_REJECTED: HTTP ${answer.status()}: ${await answer.text()} (a recaptcha_token INVALID there is Reddit scoring the exit, and no code is sent)`,
    );
  console.log(`[register] Reddit sent the code (HTTP ${answer.status()})`);
  await pageSettled(s.page);
}

async function submitCode() {
  const field = await shownField('input[autocomplete="one-time-code"], input[name="code"]');
  const code = await mailedCode(id.email, 'reddit', await fieldCodeLength(field));
  await typeInto(field, code);
  await s.page.keyboard.press('Enter');
  console.log('[register] submitted code');
  await pageSettled(s.page);
}

/**
 * Reddit fills a suggested username into its React-controlled field, and an
 * account under that suggestion is treated as a low-effort signup. The field
 * is cleared through Playwright's React-aware fill before the chosen name is
 * typed, and a field that then holds anything else is refused.
 */
async function submitUsernameAndPassword() {
  const username = await shownField('input[name="username"], input[autocomplete="username"]');
  const suggested = await username.inputValue();
  if (suggested) console.log(`[register] clearing suggested username "${suggested}"`);
  await humanClickLocator(s.page, username);
  await username.fill(''); // lint-allow: bare-fill
  await pageSettled(s.page);
  await humanType(s.page, id.username);
  const typed = await username.inputValue();
  if (typed !== id.username)
    throw new Error(`REDDIT_USERNAME_NOT_SET: the field holds "${typed}" instead of "${id.username}"`);
  await pageSettled(s.page);
  await wander();
  const password = await shownField('input[type="password"], input[autocomplete="new-password"]');
  await typeInto(password, id.password);
  await s.page.keyboard.press('Enter');
  console.log('[register] submitted username and password');
  await pageSettled(s.page);
  console.log(`[register] post-signup url=${s.page.url()}`);
}

/** Records the account and binds its character, then proves the record holds Reddit's session. */
async function recordAccount() {
  console.log(`[register] ${await s.saveAccount('reddit', id)}`);
  console.log(`[bind] ${JSON.stringify(await autoBindCharacter(id.username, 'reddit'))}`);
  const saved = findAccount('reddit', id.username);
  if (!saved) throw new Error(`REDDIT_ACCOUNT_NOT_RECORDED: no Skarbiec item for ${id.username} after saving it`);
  const cookies = Array.isArray(saved.metadata?.cookies) ? saved.metadata.cookies : [];
  if (!cookies.some((c) => typeof c?.name === 'string' && Object.hasOwn(REDDIT_SESSION, c.name)))
    throw new Error(`REDDIT_NOT_SIGNED_IN: item ${saved.id} holds no Reddit session cookie, so the signup did not authenticate`);
  return saved;
}

try {
  await s.page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  await wander();
  await submitEmail();
  await submitCode();
  await submitUsernameAndPassword();
  const saved = await recordAccount();
  console.log(`PASS: ${id.username} (skarbiec_item=${saved.id})`);
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
