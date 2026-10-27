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

import http from 'node:http';
import https from 'node:https';
import { constants as http2 } from 'node:http2';
import echo from '../network/egress-echo.json' with { type: 'json' };
import {
  findProxyByDisplayName,
  persistProxyContext,
} from '../skarbiec/proxies.mjs';

// CONNECT the declared egress echo's host on the HTTPS port through the proxy
// with Node's own CONNECT client, and report the proxy's answer: its HTTP
// status and reason, or the socket's error when no status line came back.
// Both are events; no clock decides it.
export async function probeProxyAuth({ host, port, username, password }) {
  const { promise, resolve } = Promise.withResolvers();
  const request = http.request({
    host,
    port,
    method: 'CONNECT',
    path: `${new URL(echo.url).hostname}:${https.globalAgent.defaultPort}`,
    headers: {
      'Proxy-Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
  });
  request.once('connect', (answer, socket) => {
    socket.destroy();
    resolve({
      ok: answer.statusCode === http2.HTTP_STATUS_OK,
      statusCode: answer.statusCode,
      reason: answer.statusMessage,
    });
  });
  request.once('error', (error) =>
    resolve({
      ok: false,
      error: `connect: ${error.code ? `${error.code} ` : ''}${error.message}`,
    }),
  );
  request.end();
  return promise;
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
