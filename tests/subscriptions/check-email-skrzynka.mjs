// Real Skrzynka: a session's check_email reads the code from the mail
// Skrzynka holds for an address, not from the mail provider. Requires the
// skrzynka program, an isolated organization whose mailbox already holds a
// message to --recipient from a sender containing --sender that carries
// --code, and an address of that organization with no mail (--empty).
// Run after building Weles (dist/); the session object carries only the
// placeholder resolution check_email uses, the mail path is the real one.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('check-email-skrzynka');
const { report, command } = evidence;
const { values } = parseArgs({
  options: {
    skrzynka: { type: 'string' },
    organization: { type: 'string' },
    recipient: { type: 'string' },
    sender: { type: 'string' },
    code: { type: 'string' },
    empty: { type: 'string' },
  },
});
const session = { resolveEnv: (value) => value };
try {
  for (const name of [
    'skrzynka',
    'organization',
    'recipient',
    'sender',
    'code',
    'empty',
  ])
    assert.ok(values[name]?.trim(), `--${name} is required`);
  const stored = JSON.parse(
    command(values.skrzynka, [
      '--organization',
      values.organization,
      'message',
      'list',
      '--recipient',
      values.recipient,
      '--sender',
      values.sender,
    ]),
  );
  assert.ok(
    stored.some((message) => message.body_text.includes(values.code)),
    `Skrzynka holds no message to ${values.recipient} carrying the fixture code`,
  );
  const { wsCheckEmail } = await import(
    '../../dist/session/wsession-helpers/close/account_record.js'
  );
  process.env.WELES_SKRZYNKA_BIN = values.skrzynka;

  delete process.env.WELES_SKRZYNKA_ORGANIZATION;
  const unconfigured = await wsCheckEmail(
    session,
    values.recipient,
    values.sender,
  );
  report.operations.push({ check_email: 'unconfigured', answer: unconfigured });
  assert.match(
    unconfigured,
    /^error: WELES_SKRZYNKA_ORGANIZATION names no Skrzynka organization/,
  );

  process.env.WELES_SKRZYNKA_ORGANIZATION = values.organization;
  const read = await wsCheckEmail(session, values.recipient, values.sender);
  report.operations.push({ check_email: 'stored', answer: read });
  assert.equal(read, values.code, 'check_email answers the stored code');

  const none = await wsCheckEmail(session, values.empty, values.sender);
  report.operations.push({ check_email: 'empty', answer: none });
  assert.match(none, /^no email .* has arrived at /);

  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await evidence.finish();
}
