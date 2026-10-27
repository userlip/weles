// Real Skrzynka: a session's check_email answers the newest mail Skrzynka
// holds for an address (its sender, subject and text), not the mail
// provider's copy. Requires the skrzynka program and an isolated
// organization whose mailbox already holds a message to --recipient from a
// sender containing --sender that carries --code.
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
  const { wsNewestMail } = await import(
    '../../dist/session/wsession-helpers/close/account_record.js'
  );
  process.env.WELES_SKRZYNKA_BIN = values.skrzynka;

  delete process.env.WELES_SKRZYNKA_ORGANIZATION;
  await assert.rejects(
    wsNewestMail(session, values.recipient, values.sender),
    /WELES_SKRZYNKA_ORGANIZATION names no Skrzynka organization/,
  );
  report.operations.push({ check_email: 'unconfigured', refused: true });

  process.env.WELES_SKRZYNKA_ORGANIZATION = values.organization;
  const read = await wsNewestMail(session, values.recipient, values.sender);
  report.operations.push({ check_email: 'stored', answer: read });
  const [newest] = stored;
  assert.ok(
    read.includes(`Subject: ${newest.subject}`),
    'check_email answers the newest mail with its subject',
  );
  assert.ok(
    read.includes(values.code),
    'check_email answers the mail text that carries the code',
  );

  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await evidence.finish();
}
