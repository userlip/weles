// Real Skarbiec: the code a subscription sign-in answers Google's 2FA prompt
// with comes only from the account's own seed, never from the environment.
// Reads the real vault through the real login readers (dist/utils/
// login-accounts.js, so run after building Weles): --seeded names a
// subscription whose login item holds totp_secret, --seedless one whose item
// holds none. Both are read with CLAUDE_2FA_CODE and CODEX_2FA_CODE set to a
// decoy, the variables an earlier sign-in took a typed code from. The seeded
// account answers the code its seed gives now and never the decoy; the
// seedless one answers nothing, which the sign-in turns into
// google_2fa_material_missing (or a phone approval) instead of a typed code.
// A failed assertion is recorded in the report and then ends the run with
// its error, so the exit is the runtime's own failure exit.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { evidenceFor } from '../security/evidence.mjs';
import { resolveOtp } from '../../src/trajectories/_shared/services/google_sso/sign_in/challenge/seed.mjs';
import { generateTotp } from '../../src/trajectories/_shared/services/google_sso/totp_secret.mjs';

const evidence = await evidenceFor('google-seed-only');
const { report } = evidence;
const { values } = parseArgs({
  options: {
    seeded: { type: 'string' },
    seedless: { type: 'string' },
  },
});
try {
  for (const name of ['seeded', 'seedless']) {
    assert.ok(values[name], `--${name} <subscription id> is required`);
  }
  const decoy = 'decoy-code-typed-into-the-environment';
  process.env.CLAUDE_2FA_CODE = decoy;
  process.env.CODEX_2FA_CODE = decoy;
  const { listLoginAccounts, readLoginMaterial } = await import(
    '../../dist/utils/login-accounts.js'
  );
  const { accounts, errors } = listLoginAccounts();
  report.operations.push({
    operation: 'listLoginAccounts',
    accounts: accounts.map((account) => account.subscriptionId),
    errors,
  });
  const account = (id) => {
    const found = accounts.find((candidate) => candidate.subscriptionId === id);
    assert.ok(found, `the vault holds no admitted subscription login ${id}`);
    return found;
  };

  const seeded = readLoginMaterial(account(values.seeded));
  assert.ok(
    seeded.totpSecret,
    `${values.seeded}'s login item holds no totp_secret`,
  );
  const code = resolveOtp(seeded);
  assert.notEqual(code, decoy, 'a code from the environment answered Google');
  assert.equal(
    code,
    generateTotp(seeded.totpSecret),
    "the code is not the seed's current one",
  );
  report.operations.push({
    operation: 'resolveOtp',
    subscription: values.seeded,
    answered: 'seed',
  });

  const seedless = readLoginMaterial(account(values.seedless));
  assert.equal(
    seedless.totpSecret,
    undefined,
    `${values.seedless}'s login item holds a totp_secret`,
  );
  assert.equal(
    resolveOtp(seedless),
    null,
    'an account without a seed answered a code',
  );
  report.operations.push({
    operation: 'resolveOtp',
    subscription: values.seedless,
    answered: null,
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error);
  throw error;
} finally {
  await evidence.finish();
}
