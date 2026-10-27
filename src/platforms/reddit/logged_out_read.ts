/**
 * One logged-out read of Reddit's JSON from a fresh browser session through
 * a fresh residential proxy session, with no cookies. A read that observes
 * nothing usable throws `Unobserved` naming why, with the status Reddit
 * answered when it answered: no proxy (a probe never goes out from this
 * host's own address), a session or request that failed, a body that could
 * not be read, or a body that is not JSON.
 */

import { WSession } from '../../session/wsession.js';
import { resolveProxy } from '../../proxy/config.js';

/** A read that observed nothing usable, with the status Reddit answered when it answered. */
export class Unobserved extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly exitIp?: string,
  ) {
    super(message);
  }
}

/** The message of a thrown value, or the value itself as text. */
export function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A fresh residential proxy session for `host`, its server carrying the
 * credentials; one that names no server is refused, so no probe goes out
 * from this host's own address.
 */
async function freshProxy(
  host: string,
): Promise<{ proxy: string; exit_ip?: string }> {
  const pw = await resolveProxy('residential us', host);
  if (!pw?.server)
    throw new Error(
      `no residential proxy was resolved for ${host}; the probe does not go out from this host`,
    );
  const proxy =
    pw.username && pw.password
      ? pw.server.replace(
          '://',
          `://${encodeURIComponent(pw.username)}:${encodeURIComponent(pw.password)}@`,
        )
      : pw.server;
  return { proxy, exit_ip: pw.exit_ip };
}

/** Closes `session`, saying when the close itself failed. */
async function release(session: WSession | null, label: string) {
  if (!session) return;
  await session
    .close()
    .catch((e: unknown) =>
      console.log(`[shadowban] ${label} session close failed: ${causeOf(e)}`),
    );
}

/** A logged-out answer: its status, whether it is a success, its body and the proxy's exit address. */
export interface LoggedOutAnswer {
  status: number;
  ok: boolean;
  body: string;
  exitIp?: string;
}

/**
 * The answer to a logged-out GET of `url` from a fresh session labelled
 * `label`, through a fresh proxy for `host`.
 */
export async function loggedOutRead(
  host: string,
  url: string,
  label: string,
): Promise<LoggedOutAnswer> {
  const { proxy, exit_ip } = await freshProxy(host);
  let session: WSession | null = null;
  try {
    session = await WSession.start({ label, proxy });
    // Certificates are verified: a proxy that intercepts TLS could otherwise
    // answer any body as Reddit's, and the read's verdict would be its word.
    const resp = await session.page.context().request.get(url, {
      headers: { Accept: 'application/json' },
    });
    const status = resp.status();
    let body: string;
    try {
      body = await resp.text();
    } catch (e: unknown) {
      throw new Unobserved(
        `${url} answered ${status}, but its body could not be read: ${causeOf(e)}`,
        status,
        exit_ip,
      );
    }
    return { status, ok: resp.ok(), body, exitIp: exit_ip };
  } finally {
    await release(session, label);
  }
}

/** The JSON `answer` of `url` carries, or the refusal naming the URL and its status. */
export function parsedAnswer(url: string, answer: LoggedOutAnswer): unknown {
  try {
    return JSON.parse(answer.body);
  } catch (e: unknown) {
    throw new Unobserved(
      `${url} answered ${answer.status} with a body that is not JSON (${causeOf(e)}): ${answer.body}`,
      answer.status,
      answer.exitIp,
    );
  }
}

/** `value[key]` when `value` is an object carrying `key`, else undefined. */
export function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || !(key in value)) {
    return undefined;
  }
  const found: unknown = Reflect.get(value, key);
  return found;
}
