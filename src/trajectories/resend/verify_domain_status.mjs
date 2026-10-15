// resend_verify_domain_status — email-domain health and auto-repair (no
// browser; wisent-integrations' Resend actions and Skarbiec state).
//
// On a runner whose egress address the caller lists (WHITELISTED_IPS), it:
//   1. re-verifies any Resend domain whose status drifted from `verified` (a
//      re-verify flips a stale status back) and reads its status once;
//   2. confirms real receiving, since status labels lie: reads the inbox once
//      for the probe each domain was sent on the previous run (its marker is
//      kept in Skarbiec): landed is healthy, not landed is broken, never probed
//      is unprobed; then sends this run's probe to every verified domain and
//      records its marker, so delivery time is the gap between runs;
//   3. reconciles each domain's status in Skarbiec (active / mx_broken), with
//      the cause DNS shows for a broken one;
//   4. writes the Slack-ready summary to MESSAGE_FILE and, when a domain needs
//      a person (or SLACK_NOTIFY_ALWAYS=1), starts slack_post_message to the
//      stated SLACK_CHANNEL.
// A broken domain is a finding, kept as an unhealthy verdict through the
// shared verdict writer; a check that cannot run throws.
//
// Env: SLACK_CHANNEL and WHITELISTED_IPS (required), SKIP_DOMAINS (a JSON
// array of domains the check leaves out), MESSAGE_FILE, SLACK_NOTIFY_ALWAYS.
// The Resend key stays in wisent-integrations; this journey holds only
// Weles' integration bearer.

import { runOutputPath } from '#run-output';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { submitWelesRun } from '../../../dist/worker/run-submit/index.js';
import { readDomainProbes, writeDomainProbe, writeDomainStatus } from '../_shared/skarbiec/accounts.mjs';
import { integrationAction, integrationsConfigured } from '../../_shared/integrations.mjs';
import { listReceived } from '../../_shared/resend-receiving.mjs';
import { parseJsonEnv, statedText } from '../_shared/inputs/stated.mjs';
import { egressIp } from '../_shared/network/egress_ip.mjs';
import { keepVerdict } from '../_shared/action/verdict.mjs';
import { diagnoseBroken } from './domain_status/diagnose.mjs';
import { domainHealthMessage } from './domain_status/message.mjs';

const LABEL = 'resend_verify_domain_status';

if (!integrationsConfigured())
  throw new Error('the Resend check needs STADO_INTEGRATION_API_URL and WELES_STADO_INTEGRATION_TOKEN');

// Absolute so the chained slack_post_message job (separate process) can read it.
const MESSAGE_FILE = resolve(process.env.MESSAGE_FILE || runOutputPath('resend-domains-status.txt'));
// Who is alerted when a domain needs a human is stated, never a person
// written here.
const SLACK_CHANNEL = statedText(
  ['SLACK_CHANNEL'],
  'the Slack channel or person Swiatowid alerts when a domain needs a human',
);
const WHITELISTED = statedText(
  ['WHITELISTED_IPS'],
  'the comma-separated egress addresses this check may run from',
)
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);
const SKIP = new Set(parseJsonEnv('SKIP_DOMAINS', []));

const ip = await egressIp();
if (!WHITELISTED.includes(ip))
  throw new Error(`RESEND_CHECK_EGRESS_REFUSED: egress address ${ip} is not in WHITELISTED_IPS [${WHITELISTED.join(', ')}]`);
console.log(`[gate] egress IP ${ip} is whitelisted`);

const domains = (action, body) => integrationAction('email-domains', action, body);

/** The `data` array of an integration answer, refused by name when it has none. */
function listOf(answer, what) {
  if (!Array.isArray(answer.data)) throw new Error(`${what} answered no data list: ${JSON.stringify(answer)}`);
  return answer.data;
}

const targets = listOf(await domains('resend.domain.list', {}), 'resend.domain.list').filter(
  (d) => !SKIP.has(d.name),
);
const out = { checked: targets.length, healthy: [], repaired: [], broken: [], unprobed: [] };

// 1. Re-verify every domain whose status drifted.
const repaired = new Set();
for (const d of targets) {
  if (d.status === 'verified') continue;
  console.log(`[verify] ${d.name} status=${d.status} -> re-verifying`);
  await domains('resend.domain.verify', { id: d.id });
  d.status = (await domains('resend.domain.get', { id: d.id })).status;
  if (d.status === 'verified') repaired.add(d.name);
}

// 2a. Judge the probes the previous run sent: one inbox read.
const previous = readDomainProbes();
const inbox = listOf(await listReceived(), 'resend.receiving.list');
const carries = (message, marker) =>
  String(message.subject).includes(marker) ||
  [message.to].flat().map((to) => (typeof to === 'string' ? to : to.email)).join(',').includes(marker);
const landed = new Set(
  Object.entries(previous)
    .filter(([, probe]) => inbox.some((message) => carries(message, probe.marker)))
    .map(([domain]) => domain),
);

// 2b. Send this run's probe to every verified domain; a refused send is
// reported by name and that domain stays without a fresh probe.
const refused = {};
for (const d of targets.filter((x) => x.status === 'verified')) {
  try {
    writeDomainProbe(d.name, (await domains('resend.domain.probe', { domain: d.name })).marker);
  } catch (error) {
    refused[d.name] = error.message;
    console.log(`[probe] ${d.name} send refused: ${error.message}`);
  }
}

// 3. Classify and reconcile, with the cause DNS shows for anything broken.
for (const d of targets) {
  const rec = {
    domain: d.name,
    status: d.status,
    receives: landed.has(d.name),
    repaired: repaired.has(d.name),
    probe_refused: refused[d.name],
  };
  if (!Object.hasOwn(previous, d.name)) {
    out.unprobed.push(rec);
    console.log(`[verify] ${d.name}: no probe from an earlier run yet -> UNPROBED`);
    continue;
  }
  if (rec.receives) {
    out.healthy.push(rec);
    if (rec.repaired) out.repaired.push(rec);
    writeDomainStatus(d.name, 'active');
  } else {
    rec.diagnosis = await diagnoseBroken(d.name);
    out.broken.push(rec);
    writeDomainStatus(d.name, 'mx_broken');
  }
  console.log(`[verify] ${d.name}: ${JSON.stringify(rec)}`);
}

// 4. The summary, handed to the chained Slack job as a file.
const msg = domainHealthMessage(out);
mkdirSync(dirname(MESSAGE_FILE), { recursive: true });
writeFileSync(MESSAGE_FILE, `${msg}\n`);
if (out.broken.length || process.env.SLACK_NOTIFY_ALWAYS === '1') {
  const runId = await submitWelesRun({
    action: 'slack_post_message',
    params: { message: msg, message_file: MESSAGE_FILE, slack_channel: SLACK_CHANNEL },
  });
  console.log(`[slack] started slack_post_message as Weles run ${runId} (channel=${SLACK_CHANNEL})`);
}
console.log(`\n=== SLACK (${MESSAGE_FILE}) ===\n${msg}`);

await keepVerdict(LABEL, null, {
  healthy: !out.broken.length,
  signal: out.broken.length ? 'resend_domains_broken' : 'resend_domains_healthy',
  details: out,
});
