import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { getSocialAccount } from '../../dist/utils/credentials.js';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('direct-message');
const { report, request } = evidence;
const { values } = parseArgs({
  options: {
    'sender-account-id': { type: 'string' },
    'recipient-account-id': { type: 'string' },
    'recipient-handle': { type: 'string' },
    message: { type: 'string' },
    subject: { type: 'string' },
  },
});
const senderId = values['sender-account-id'];
const recipientId = values['recipient-account-id'];
const recipientHandle = values['recipient-handle'];
const message = values.message;
const subject = values.subject;
let connected = false;
let failure;

async function run(action, params, accountId) {
  const admission = await request('/run', {
    action,
    ...(accountId ? { account_id: accountId } : {}),
    params,
    detached: true,
  });
  const id = admission.value.detached_run;
  assert.ok(id, JSON.stringify(admission.value));
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

try {
  assert.equal(
    hostname(),
    process.env.WELES_TEST_DEDICATED_HOST,
    'run on the Stado-selected dedicated Weles host',
  );
  for (const [name, value] of Object.entries({
    senderId,
    recipientId,
    recipientHandle,
    message,
    subject,
  })) {
    assert.ok(typeof value === 'string' && value.trim(), `${name} is required`);
  }
  process.env.ACCOUNT_ID = recipientId;
  const recipient = await getSocialAccount('discord');
  assert.equal(recipient?.id, recipientId, 'the recipient fixture must exist');
  assert.equal(recipient.metadata.weles_real_test_fixture, true);
  assert.equal(
    recipient.username.replace(/^@/, '').toLowerCase(),
    recipientHandle.replace(/^@/, '').toLowerCase(),
  );
  process.env.ACCOUNT_ID = senderId;
  const sender = await getSocialAccount('discord');
  assert.equal(sender?.id, senderId, 'the sender fixture must exist');
  assert.equal(sender.metadata.weles_real_test_fixture, true);
  assert.notEqual(sender.id, recipient.id);
  report.fixture = { sender: senderId, recipient: recipientId };

  await evidence.connect();
  connected = true;
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);
  for (const platform of [
    'discord',
    'instagram',
    'linkedin',
    'reddit',
    'snapchat',
    'tiktok',
    'twitter',
  ]) {
    const action = `${platform}_dm`;
    const noRecipient = await run(action, {
      recipient_handle: '',
      message,
      subject,
    });
    assert.equal(noRecipient.ok, false, JSON.stringify(noRecipient));
    assert.match(
      [
        noRecipient.error,
        noRecipient.stderr_tail,
        noRecipient.stdout_tail,
      ].join('\n'),
      /none of RECIPIENT_HANDLE is set/,
    );
    const noMessage = await run(action, {
      recipient_handle: recipientHandle,
      message: '',
      subject,
    });
    assert.equal(noMessage.ok, false, JSON.stringify(noMessage));
    assert.match(
      [noMessage.error, noMessage.stderr_tail, noMessage.stdout_tail].join(
        '\n',
      ),
      /none of DM_MESSAGE is set/,
    );
  }
  const noSubject = await run('reddit_dm', {
    recipient_handle: recipientHandle,
    message,
    subject: '',
  });
  assert.equal(noSubject.ok, false, JSON.stringify(noSubject));
  assert.match(
    [noSubject.error, noSubject.stderr_tail, noSubject.stdout_tail].join('\n'),
    /none of DM_SUBJECT is set/,
  );
  report.reddit_subject_refusal = noSubject;

  const delivered = await run(
    'discord_dm',
    { recipient_handle: recipientHandle, message },
    senderId,
  );
  assert.equal(delivered.ok, true, JSON.stringify(delivered));
  const receiptLine = delivered.stdout_tail
    ?.split('\n')
    .find((line) => line.includes('"acknowledgement":"provider_response"'));
  assert.ok(receiptLine, JSON.stringify(delivered));
  const receipt = JSON.parse(receiptLine);
  assert.equal(receipt.recipient_requested, recipientHandle.replace(/^@/, ''));
  assert.equal(receipt.acknowledgement, 'provider_response');
  assert.ok(receipt.channel_id && receipt.message_id);
  report.provider_acknowledgement = receipt;
  report.delivered = delivered;
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = connected ? 'failed' : 'blocked';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
} finally {
  await evidence.finish();
}
if (failure) throw failure;
