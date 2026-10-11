/**
 * Multi-vantage Reddit shadowban probe.
 *
 * Background: Reddit's edge tier has documented false positives where
 * /user/<u>/about.json returns 404 for a healthy account when the request
 * routes through certain residential proxy IPs (see src/trajectories/
 * reddit/health.mjs and DETECTION_ANTIPATTERNS.md). A single about.json
 * 404 is therefore unreliable as a shadowban verdict.
 *
 * This probe spreads the caller's number of independent fetches across as
 * many fresh proxy sticky sessions (no cookies), each via a freshly-launched
 * WSession. The verdict:
 *   - any vantage returns 200 with a valid body -> 'healthy'
 *   - every vantage returns 404                 -> 'shadowbanned'
 *   - anything else (403/429/errors, a mix)     -> 'indeterminate'
 *
 * Used by:
 *   - src/trajectories/reddit/shadowban_check.mjs (standalone trajectory)
 *   - src/trajectories/reddit/actions/comment/organic_comment.mjs (post-submit verify)
 *   - src/trajectories/reddit/actions/comment.mjs (post-submit verify)
 */

import { WSession } from '../../session/wsession.js';
import { resolveProxy } from '../../proxy/config.js';

export type ShadowbanVerdict = 'shadowbanned' | 'healthy' | 'indeterminate';

export interface VantageResult {
  vantage: number;
  status: number;
  has_body: boolean;
  exit_ip?: string;
  err?: string;
}

export interface MultiVantageProbeResult {
  verdict: ShadowbanVerdict;
  username: string;
  vantages: VantageResult[];
  ts: string;
}

/**
 * Probe https://old.reddit.com/user/<username>/about.json from N independent
 * fresh sessions, each with no cookies and a freshly-rolled sticky proxy
 * session. Returns the per-vantage results plus an aggregate verdict.
 *
 * @param username  the reddit username to probe (case-sensitive — pass the
 *                  real handle from /api/me.json, not our stored email-prefix
 *                  username, which Reddit auto-replaces during signup).
 * @param vantages  number of independent vantages to use, the caller's
 *                  choice: each vantage spins up a separate Chromium.
 */
export async function probeShadowban(
  username: string,
  vantages: number,
): Promise<MultiVantageProbeResult> {
  const results: VantageResult[] = [];
  const url = `https://old.reddit.com/user/${encodeURIComponent(username)}/about.json`;

  for (let i = 0; i < vantages; i++) {
    let session: WSession | null = null;
    try {
      // Fresh proxy with a fresh sticky session id. resolveProxy() rolls
      // a new sessId each call (see config.ts:213) so each vantage exits
      // through a different residential IP. No account-cookie restoration
      // — this is the "logged-out" view of the user.
      const pw = await resolveProxy('residential us', 'www.reddit.com').catch(
        () => undefined,
      );
      const proxyUrl = pw?.server
        ? `${pw.server.replace(/^http(s?):\/\//, 'http$1://')}`
        : undefined;
      // Build the auth-embedded URL for WSession.start.
      const proxyForSession =
        pw?.server && pw.username && pw.password
          ? `${pw.server.replace('://', `://${encodeURIComponent(pw.username)}:${encodeURIComponent(pw.password)}@`)}`
          : proxyUrl;

      session = await WSession.start({
        label: `reddit_shadowban_probe_v${i + 1}`,
        proxy: proxyForSession,
      });

      const resp = await session.page
        .context()
        .request.get(url, {
          headers: {
            Accept: 'application/json',
            // Plain UA — about.json sometimes 403s for bare-fetch UAs but the
            // session UA inherits the persona.
          },
          ignoreHTTPSErrors: true,
          // Playwright's request client carries its own 30s limit; 0 removes it,
          // so Reddit's answer or the network's error ends the read.
          timeout: 0,
        })
        .catch((e: any) => ({
          _err: e?.message ?? 'fetch_error',
          status: () => 0,
          text: async () => '',
        }));

      const status =
        typeof (resp as any).status === 'function' ? (resp as any).status() : 0;
      let body = '';
      try {
        body =
          typeof (resp as any).text === 'function'
            ? await (resp as any).text()
            : '';
      } catch {
        /* skip */
      }
      let hasBody = false;
      try {
        const j = JSON.parse(body);
        hasBody = typeof j?.data?.name === 'string' && j.data.name.length > 0;
      } catch {
        /* not JSON */
      }
      results.push({
        vantage: i + 1,
        status,
        has_body: hasBody,
        exit_ip: pw?.exit_ip,
        err: (resp as any)._err,
      });
    } catch (e: any) {
      results.push({
        vantage: i + 1,
        status: 0,
        has_body: false,
        err: e?.message ?? 'launch_error',
      });
    } finally {
      if (session)
        await session
          .close()
          .catch((e: any) =>
            console.log(
              `[shadowban] vantage session close failed: ${e?.message ?? e}`,
            ),
          );
    }
  }

  // Tally: one logged-out vantage that sees the profile proves it public;
  // shadowbanned needs every vantage to answer 404, so no count is chosen.
  const four_oh_four = results.filter((r) => r.status === 404).length;
  const ok = results.filter((r) => r.status === 200 && r.has_body).length;

  let verdict: ShadowbanVerdict;
  if (ok) verdict = 'healthy';
  else if (results.length && four_oh_four === results.length)
    verdict = 'shadowbanned';
  else verdict = 'indeterminate';

  return { verdict, username, vantages: results, ts: new Date().toISOString() };
}

/**
 * Single-vantage permalink-JSON visibility check. Used by the deferred
 * post-submit verify path: after the comment was submitted, wait T seconds,
 * then re-fetch the comment's permalink JSON via a fresh proxy with no
 * cookies, and confirm the comment node is present.
 *
 * `visible` is an observation only when `err` is absent: true if the
 * comment node is in the permalink JSON, false if the JSON was read and the
 * node is missing (auto-removed or shadowbanned). A proxy that cannot be
 * resolved, a non-2xx answer (rate limit, block page), a body that cannot
 * be read or is not JSON all set `err` - they say nothing about the comment
 * and used to read as "not visible", which flagged the account shadowbanned.
 */
export async function probeCommentVisibility(opts: {
  postPermalinkBase: string; // e.g. 'https://old.reddit.com/r/sub/comments/abc/post-slug'
  commentId: string; // base36 id, e.g. 'oj0vwon'
  expectedAuthor?: string; // optional sanity check
}): Promise<{
  visible: boolean;
  /** The permalink's HTTP status; absent when no answer arrived. */
  status?: number;
  exit_ip?: string;
  err?: string;
}> {
  const { postPermalinkBase, commentId, expectedAuthor } = opts;
  const url = `${postPermalinkBase.replace(/\/$/, '')}/${commentId}/.json`;

  let session: WSession | null = null;
  try {
    const pw = await resolveProxy('residential us', 'old.reddit.com');
    const proxyForSession =
      pw?.server && pw.username && pw.password
        ? `${pw.server.replace('://', `://${encodeURIComponent(pw.username)}:${encodeURIComponent(pw.password)}@`)}`
        : pw?.server;
    session = await WSession.start({
      label: 'reddit_visibility_probe',
      proxy: proxyForSession,
    });
    const resp = await session.page.context().request.get(url, {
      headers: { Accept: 'application/json' },
      ignoreHTTPSErrors: true,
      timeout: 0,
    });
    const status = resp.status();
    if (!resp.ok()) {
      return {
        visible: false,
        status,
        exit_ip: pw?.exit_ip,
        err: `the permalink JSON answered HTTP ${status}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await resp.text());
    } catch (e: unknown) {
      return {
        visible: false,
        status,
        exit_ip: pw?.exit_ip,
        err: `the permalink JSON could not be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const node = permalinkComment(parsed);
    const nodeData = field(node, 'data');
    const visible =
      field(node, 'kind') === 't1' &&
      field(nodeData, 'id') === commentId &&
      (!expectedAuthor || field(nodeData, 'author') === expectedAuthor);
    return { visible, status, exit_ip: pw?.exit_ip };
  } catch (e: unknown) {
    return { visible: false, err: e instanceof Error ? e.message : String(e) };
  } finally {
    if (session)
      await session
        .close()
        .catch((e: any) =>
          console.log(
            `[shadowban] probe session close failed: ${e?.message ?? e}`,
          ),
        );
  }
}

/** `value[key]` when `value` is an object carrying `key`, else undefined. */
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || !(key in value)) {
    return undefined;
  }
  const found: unknown = Reflect.get(value, key);
  return found;
}

/**
 * The comment node of a permalink JSON document: the first child of the
 * second listing (the first listing is the post).
 */
function permalinkComment(document: unknown): unknown {
  if (!Array.isArray(document)) return undefined;
  const [, comments] = document;
  const children = field(field(comments, 'data'), 'children');
  if (!Array.isArray(children)) return undefined;
  const [node] = children;
  return node;
}
