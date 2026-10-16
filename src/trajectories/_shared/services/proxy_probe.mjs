// Probe whether a proxy provider's upstream actually accepts our auth.
//
// Why this exists: balance trajectories scrape the dashboard (e.g. "you have
// $8.75 left"), but the upstream proxy gateway can independently refuse the
// CONNECT — KYC pending, traffic limit reached, account suspended, fraud
// flag — and dashboard balance has no relation to that. A dashboard can show
// money while every CONNECT is refused for weeks.
//
// This helper does a real CONNECT through the upstream and returns the auth
// status. patchEffectiveBalance() writes the effective balance: what the
// dashboard shows when the upstream accepts us, none of it when it refuses,
// so the daily cron makes auto-topup decisions on the balance that can be
// used.

import { STATUS_CODES } from 'node:http';
import net from 'node:net';
import {
  findProxyByDisplayName,
  persistProxyContext,
} from '../skarbiec/proxies.mjs';

/** The status a proxy answers a CONNECT it accepts with, by its RFC 9110 name. */
const ACCEPTED = Number(
  Object.keys(STATUS_CODES).find((status) => STATUS_CODES[status] === 'OK'),
);

// CONNECT a known endpoint (api.ipify.org:443) through the proxy and report
// the proxy's answer: its HTTP status and reason, or the connection error
// when no status line came back.
export async function probeProxyAuth({ host, port, username, password }) {
  return new Promise((resolve) => {
    // The proxy answers the CONNECT, or the socket errors. Both are events;
    // a ten-second cap on top of them reported a working proxy on a slow
    // route as dead.
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(result);
    };
    sock.on('error', (e) =>
      finish({ ok: false, error: `connect: ${e.code ?? e.message}` }),
    );
    sock.on('connect', () => {
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      const req = `CONNECT api.ipify.org:443 HTTP/1.1\r\nHost: api.ipify.org:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`;
      sock.write(req);
    });
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      const line = buf.match(/^HTTP\/\d\.\d (?<status>\d+) (?<reason>.*)\r\n/);
      if (!line) return;
      const statusCode = Number(line.groups.status);
      finish({
        ok: statusCode === ACCEPTED,
        statusCode,
        reason: line.groups.reason.trim(),
      });
    });
  });
}

// Resolve upstream proxy credentials and endpoint from its exact Skarbiec item.
export async function probeCredsFor(displayName) {
  const proxy = findProxyByDisplayName(displayName);
  if (!proxy?.host || !proxy?.port || !proxy?.username || !proxy?.password)
    return null;
  let username = proxy.username;
  if (
    proxy.provider === 'brightdata' &&
    proxy.zone &&
    !username.startsWith('brd-customer-')
  ) {
    username = `brd-customer-${username}-zone-${proxy.zone}`;
  }
  return {
    id: proxy.id,
    host: proxy.host,
    port: proxy.port,
    username,
    password: proxy.password,
  };
}

/** Why the upstream could not be used, in the probe's own words. */
function refusalNote(probe) {
  if (probe.error) return `Effective balance $0: probe ${probe.error}`;
  const reason = probe.reason ? ` ${probe.reason}` : '';
  return `Effective balance $0: upstream returned ${probe.statusCode}${reason}`;
}

// Persist BOTH dashboard balance and probe outcome. A refused or failed probe
// leaves none of the balance usable, and a note says why so the operator can
// see the discrepancy. The cron's topup decision is then driven by the
// effective balance, not the dashboard's claim.
export async function patchEffectiveBalance(displayName, dashboardBalance) {
  const creds = await probeCredsFor(displayName);
  let probe = null;
  if (creds) probe = await probeProxyAuth(creds);

  // Every balance trajectory forensic-dumps on a regex miss and throws before
  // calling this helper, so dashboardBalance==null cannot reach here. A
  // scraped 0 is a real "depleted" reading and is counted as it is.
  const usable = !probe || probe.ok;
  // The usable part of the balance: all of it, or none of it.
  const effective = dashboardBalance * Number(usable);

  const now = new Date().toISOString();
  const patch = {
    balance_usd: effective,
    last_balance_check: now,
    updated_at: now,
  };
  if (probe) {
    patch.last_probe = {
      at: now,
      ok: probe.ok,
      ...(probe.statusCode ? { code: probe.statusCode } : {}),
      ...(probe.reason ? { reason: probe.reason } : {}),
      ...(probe.error ? { error: probe.error } : {}),
    };
  }
  if (!usable) patch.notes = refusalNote(probe);
  if (!creds?.id) return false;
  const persisted = persistProxyContext(creds.id, patch);
  const outcome = probe
    ? `${probe.ok ? 'OK' : 'refused'} ${probe.error ? probe.error : probe.statusCode}`
    : 'no-creds';
  console.log(
    `[probe] ${displayName} dashboard=$${dashboardBalance} probe=${outcome} effective=$${effective}`,
  );
  return persisted;
}
