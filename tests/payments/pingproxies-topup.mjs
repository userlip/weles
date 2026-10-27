// Run only on a dedicated Weles host with an isolated Byteful account and card.
// This journey makes one real charge; all fixture paths stay under build/real-tests.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WSession } from '../../dist/session/wsession.js';
import { humanClickLocator } from '../../dist/human/mouse.js';
import { runRecordingsDir } from '../../dist/session/run-recordings.js';
import { pageSettled } from '../../src/trajectories/_shared/page/settled.mjs';
import {
  getGoogleSsoCreds,
  googleSso,
  readShownBalance,
} from '../../src/trajectories/_shared/services/google_sso.mjs';
import { evidenceFor } from '../security/evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { report, finish } = await evidenceFor('pingproxies-topup');
let failure;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for the isolated payment journey`);
  return value;
}

function fixture(name) {
  const path = realpathSync(required(name));
  const allowed = `${realpathSync(join(root, 'build/real-tests'))}${sep}`;
  if (!path.startsWith(allowed))
    throw new Error(`${name} must be an isolated file under build/real-tests/`);
  return path;
}

function paymentCommand(env) {
  const entry = 'src/trajectories/pingproxies/topup.mjs';
  const result = spawnSync(process.execPath, [entry], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  report.operations.push({
    command: [process.execPath, entry],
    input: { amount: env.TOPUP_USD, confirmation: Boolean(env.TOPUP_CONFIRM) },
    exit_status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.ok(
    Number.isInteger(result.status),
    'trajectory must return an exit status',
  );
  return result;
}

async function observedBalance(email, phase) {
  const login = await getGoogleSsoCreds(email);
  const session = await WSession.start({
    label: 'pingproxies_payment_observation',
    browser: 'chromium',
  });
  try {
    await session.goto('https://dashboard.byteful.com/login');
    await pageSettled(session.page);
    const google = session.page
      .locator(
        'button:has-text("Continue with Google"), button:has-text("Sign in with Google")',
      )
      .filter({ visible: true })
      .first();
    assert.ok(await google.isEnabled(), 'Google sign-in unavailable');
    await humanClickLocator(session.page, google);
    assert.ok(
      await googleSso(session, login, { originHost: 'byteful.com' }),
      'dedicated account sign-in did not complete',
    );
    await pageSettled(session.page);
    const balance = await readShownBalance(session.page);
    assert.ok(Number.isFinite(balance), 'provider did not show a USD balance');
    const screenshot = join(
      runRecordingsDir('pingproxies_payment_test'),
      `${phase}.png`,
    );
    await session.page.screenshot({ path: screenshot, fullPage: true });
    report.recordings.push({ observation: phase, path: screenshot });
    return balance;
  } finally {
    await session.close();
  }
}

try {
  assert.equal(hostname(), required('WELES_TEST_DEDICATED_HOST'));
  required('PROXY_URL');
  const confirmation = required('TOPUP_CONFIRM');
  assert.equal(required('WELES_FRESH_PROFILE'), confirmation);
  process.env.WELES_RECORDINGS_ROOT = join(
    root,
    'build/real-tests/payment-recordings',
  );
  process.env.WELES_RUN_ID = randomUUID();
  const credentials = fixture('WELES_TEST_PAYMENT_CREDENTIALS');
  const cardFile = fixture('WELES_TEST_PAYMENT_CARD');
  const account = required('WELES_TEST_PAYMENT_ACCOUNT_EMAIL');
  const amount = Number(required('WELES_TEST_PAYMENT_USD'));
  assert.ok(Number.isFinite(amount) && amount >= Number.MIN_VALUE);
  const card = JSON.parse(readFileSync(cardFile, 'utf8'));
  assert.ok(
    card.number && card.exp && card.cvc,
    'isolated card fixture incomplete',
  );
  const cardLast4 = String(card.number)
    .replace(/\D/g, '')
    .match(/(\d\d\d\d)$/)
    ?.pop();
  assert.ok(cardLast4, 'isolated card fixture has no last-four digits');
  report.fixtures = { credentials, card_file: cardFile, account, amount };
  process.env.WELES_CREDENTIALS_FILE = credentials;
  const env = {
    WELES_CREDENTIALS_FILE: credentials,
    TOPUP_CARD_JSON: JSON.stringify(card),
    TOPUP_CARD_NUMBER: undefined,
    TOPUP_CARD_EXP: undefined,
    TOPUP_CARD_CVC: undefined,
    TOPUP_USD: String(amount),
    TOPUP_CONFIRM: confirmation,
  };

  const absentConfirmation = paymentCommand({ ...env, TOPUP_CONFIRM: '' });
  assert.ok(
    absentConfirmation.status,
    'top-up without confirmation must refuse',
  );
  assert.match(absentConfirmation.stdout, /TOPUP_CONFIRM=.*required/);
  const invalidCard = paymentCommand({ ...env, TOPUP_CARD_JSON: '{' });
  assert.ok(invalidCard.status, 'invalid card bundle must refuse');
  assert.match(invalidCard.stdout, /TOPUP_CARD_JSON is not valid JSON/);
  const unrepresentable = paymentCommand({
    ...env,
    TOPUP_USD: String(Number.EPSILON),
  });
  assert.ok(unrepresentable.status, 'sub-cent charge must refuse');
  assert.match(unrepresentable.stdout, /cannot be charged as whole USD cents/);

  const before = await observedBalance(account, 'before');
  report.operations.push({
    observation: 'provider_balance_before',
    amount_usd: before,
  });
  const marker = join(dirname(cardFile), 'payment-attempt.json');
  try {
    writeFileSync(
      marker,
      JSON.stringify({
        source_revision: report.source_revision,
        account,
        amount,
      }),
      { flag: 'wx' },
    );
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `this isolated card fixture already attempted a purchase at ${marker}; reconcile its provider ledger before a different fixture is used`,
        { cause: error },
      );
    throw error;
  }
  report.operations.push({ observation: 'purchase_claimed', marker });
  const purchase = paymentCommand(env);
  assert.ok(!purchase.status, `${purchase.stdout}\n${purchase.stderr}`);
  assert.match(
    purchase.stdout,
    new RegExp(`selected saved card ending ${cardLast4}`),
  );
  assert.match(
    purchase.stdout,
    /PASS-CHARGED: Stripe payment intent \S+ succeeded/,
  );
  const after = await observedBalance(account, 'after');
  report.operations.push({
    observation: 'provider_balance_after',
    amount_usd: after,
  });
  assert.ok(
    after >= before + amount,
    `dedicated provider balance did not increase by the requested amount: before=${before}, after=${after}, requested=${amount}`,
  );
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = 'failed';
  report.error = error.message;
} finally {
  await finish();
  if (failure) throw failure;
}
