// Create a Google app password for one Skarbiec Google login and give it to
// Skrzynka, so the account's mailbox can be read over IMAP without anybody
// opening myaccount.google.com.
//
// Google refuses an account's ordinary password over IMAP when two-step
// verification is on ("Application-specific password required"), and offers
// no API that issues an app password: the only way is the account's own App
// passwords page in a signed-in browser. This trajectory signs the login in
// (password and authenticator seed from Skarbiec), creates a password named
// Skrzynka, reads it from the one dialog that shows it, and pipes it to
// `skrzynka account app-password --provider gmail --email <address>`, which proves it with an
// IMAP login, stores it in Skarbiec and declares the mailbox. The password is
// never written to a file, a log or this run's result.
//
// Input: WELES_LOGIN_ITEM, the Skarbiec Google login (username, password,
// totp_secret), SKRZYNKA_ORGANIZATION, the organization Skrzynka files the
// mailbox under, and WELES_EXPECTED_ACCOUNT, the mailbox the login must be.
// Output: one JSON result on stdout and in the run's output directory; every
// stop is named in it, and a run that stopped ends failed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOutputPath } from '#run-output';
import { WSession } from '../../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { accountProfileDir, loginMaterial, signIn } from '../../_shared/services/google_sso/sign_in/account.mjs';
import { createAppPassword, openAppPasswords, redactAppPasswords } from './page.mjs';
import { APP_NAME, SKRZYNKA_BIN_VARIABLE, SKRZYNKA_DEFAULT_BIN } from './constants.mjs';

const RUN = 'google-app-password';
const RESULT_DIR = runOutputPath(RUN);
const RESULT_FILE = join(RESULT_DIR, 'result.json');
const INDENT = '  ';

function report(result) {
  mkdirSync(RESULT_DIR, { recursive: true });
  const text = redactAppPasswords(JSON.stringify(result, null, INDENT));
  writeFileSync(RESULT_FILE, text);
  console.log(text);
  return result;
}

/** Report a stop and end the run as failed; the report names the stop. */
function refuse(row) {
  report({ ok: false, ...row });
  process.exitCode = exitStatusFor(new Error(row.blocked));
}

/**
 * Reach the App passwords page, signing in whenever Google asks, and create
 * the password. Google may ask for the password again between the page and
 * the dialog, so the whole step is repeated after each sign-in. It ends when
 * Google asks again at an address it already asked at after a sign-in:
 * signing in once more there cannot change its answer.
 */
async function issue(page, wait, login) {
  const asked = new Set();
  for (;;) {
    const opened = await openAppPasswords(page, wait);
    const step = opened.ok ? await createAppPassword(page, wait, APP_NAME) : opened;
    if (step.ok || step.blocked !== 'google_sign_in_required') return step;
    const at = page.url();
    if (asked.has(at)) return step;
    asked.add(at);
    const signed = await signIn(page, wait, login);
    if (!signed.ok) return signed;
  }
}

/** Hand the password to Skrzynka on stdin; its answer is the verdict. */
function giveToSkrzynka(organization, email, password) {
  const stated = process.env[SKRZYNKA_BIN_VARIABLE]?.trim();
  const binary = stated ? stated : SKRZYNKA_DEFAULT_BIN;
  const result = spawnSync(
    binary,
    ['--organization', organization, 'account', 'app-password', '--provider', 'gmail', '--email', email],
    { input: password, encoding: 'utf8' },
  );
  if (result.error) return { ok: false, blocked: 'skrzynka_unavailable', detail: `${binary}: ${result.error.message}` };
  // spawnSync with an encoding answers both streams as text.
  const output = redactAppPasswords(`${result.stdout}${result.stderr}`);
  if (result.signal || result.status)
    return {
      ok: false,
      blocked: 'skrzynka_refused_app_password',
      exit_status: result.status,
      signal: result.signal,
      detail: output,
    };
  return { ok: true, skrzynka: output };
}

async function main() {
  const loginItem = process.env.WELES_LOGIN_ITEM?.trim();
  if (!loginItem)
    return refuse({ blocked: 'login_item_required', detail: 'WELES_LOGIN_ITEM must name the Skarbiec Google login' });
  const organization = process.env.SKRZYNKA_ORGANIZATION?.trim();
  if (!organization)
    return refuse({
      blocked: 'organization_required',
      detail: 'SKRZYNKA_ORGANIZATION must name the Skrzynka organization the mailbox is declared in',
    });
  const expectedAccount = process.env.WELES_EXPECTED_ACCOUNT?.trim();
  if (!expectedAccount)
    return refuse({ blocked: 'expected_account_required', detail: 'WELES_EXPECTED_ACCOUNT must name the requested mailbox account' });
  const login = loginMaterial(loginItem);
  const named = { login_item: loginItem, expected_account: expectedAccount, email: login.email };
  if (login.email.trim().toLowerCase() !== expectedAccount.toLowerCase())
    return refuse({
      blocked: 'expected_account_mismatch',
      ...named,
      detail: 'The selected login does not belong to the requested mailbox account',
    });
  const session = await WSession.start({
    label: `${RUN}-${loginItem}`,
    browser: 'chromium',
    headless: false,
    userDataDir: accountProfileDir(login),
  });
  let issued;
  try {
    issued = await issue(session.page, () => pageSettled(session.page), login);
  } finally {
    await session.close();
  }
  if (!issued.ok) {
    const next = {};
    if (issued.blocked === 'google_push_approval_required') {
      const enrollment = JSON.stringify({
        action: 'google_authenticator_enrol',
        params: { login_item: loginItem, expected_account: expectedAccount },
        detached: true,
      });
      const resume = ['weles', 'app-password', '--provider', 'google', '--login-item', loginItem, '--organization', organization, '--account', expectedAccount]
        .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
        .join(' ');
      next.next_action = `POST /run ${enrollment} on this executor, then ${resume}`;
    }
    return refuse({ ...named, ...issued, ...next });
  }
  const handed = giveToSkrzynka(organization, login.email, issued.password);
  if (!handed.ok) return refuse({ ...named, app_password_created: true, ...handed });
  report({ ok: true, ...named, organization, app_name: APP_NAME, skrzynka: handed.skrzynka });
}

try {
  await main();
} catch (error) {
  refuse({ blocked: 'google_app_password_error', error: error instanceof Error ? error.message : String(error) });
}
