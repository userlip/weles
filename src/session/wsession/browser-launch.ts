/**
 * How the browser comes up, and what a freshly built WSession takes over from
 * it. Two halves, in the order WSession.start runs them:
 *
 *  - openSessionBrowser: service placement, the per-run timing seed, the
 *    operator devtools attach path, persona and proxy resolution, the
 *    pre-launch provenance envelope, the verified browser release,
 *    SSLKEYLOGFILE, the browser-evidence policy and the cookie injection —
 *    everything that must happen before a session object can exist.
 *  - adoptLaunchedBrowser: what the new session then owns — its realized proxy
 *    and persona, browser provenance, the SIGTERM seal, its generated
 *    identity, the exit-IP probe, the realized provenance write and the
 *    network instrumentation.
 *
 * The private constructor stays in the class, so start() is the only caller:
 * open, construct, adopt — the same sequence, the same order of effects.
 */

import type { BrowserContext, Page } from 'playwright';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  AsyncNewBrowser,
  type AsyncNewBrowserOptions,
} from '../../async_api.js';
import { type Persona, dressPersona } from '../../browser/persona.js';
import {
  type PersonaDevice,
  sampleDevice,
} from '../../browser/persona/device.js';
import type { Capture } from '../../capture/capture.js';
import { installBrowserEvidencePolicy } from '../../agent/browser-evidence-policy.js';
import { resolveProxy } from '../../proxy/config.js';
import { requestsNoProxy } from '../../proxy/resolve/url_form.js';
import { seedHumanTiming } from '../../utils/motion/timing.js';
import type { WSession } from '../wsession.js';
import { SessionStore } from '../store.js';
import { customBrowserSearchHint, findCustomBrowser } from '../find_browser.js';
import { loadOperatorCdpConfig } from '../placement/operator-cdp.js';
import { enforceWelesServicePlacement } from '../placement/service-placement.js';
import { isSkarbiecCredentialTask } from '../wsession-helpers/credential/task.js';
import { startInstrumentation } from '../wsession-helpers/net_record.js';
import {
  accountProfileDirectory,
  redactProxyForLog,
  type SessionProxy,
  type WSessionOptions,
} from './session-request.js';
import {
  hashDiagnosticValue,
  writePrelaunchSessionMeta,
  writeRealizedSessionMeta,
} from './run-provenance.js';
import {
  adoptOperatorBrowser,
  captureFor,
  type OperatorSession,
} from './browser-launch/attach.js';
import { probeExitIp } from './browser-launch/exit-probe.js';
import { recordingsDir } from '../run-recordings.js';

/**
 * The label of a session its caller did not label. Every reader of a
 * session's label takes it as no label: the run's shared recordings root, no
 * saved cookies, no SSLKEYLOGFILE of its own.
 */
const UNLABELLED = '';

// async_api decorates the context it returns with the browser release it used
// and the fingerprint the page actually presents.
interface RealizedContext {
  _welesBrowserProvenance?: unknown;
  _welesFingerprintConfig?: Record<string, unknown>;
}

// Provenance and the credential-task flag ride on the session for close() and
// the instrumentation dump; neither is part of the class's declared surface.
interface AdoptingSession {
  _browserProvenance: unknown;
  _secureCredentialTask: boolean;
}

/** A browser this run launched, with everything the session records about it. */
export interface LaunchedSession {
  kind: 'launched';
  ctx: BrowserContext;
  page: Page;
  capture: Capture;
  label: string;
  persona: Persona;
  proxy: SessionProxy | undefined;
  proxyRequest: string | undefined;
  platform: string | undefined;
  timingSeed: number;
}

export type SessionLaunch = OperatorSession | LaunchedSession;

export async function openSessionBrowser(
  opts: WSessionOptions,
): Promise<SessionLaunch> {
  enforceWelesServicePlacement('WSession.start');
  const label = opts.label ?? UNLABELLED;
  const secureCredentialTask = isSkarbiecCredentialTask();
  // One per-run human-timing seed, generated at session start and routed into
  // the shared seeded stream (utils/motion/timing.ts) every pointer-trace
  // segment, target point and typing choice draws from, so the run is
  // reproducible from the recorded seed; a draw before the seed is refused.
  // Recorded into session_meta as a required number (result.run.timing_seed).
  const timingSeed = randomBytes(Uint32Array.BYTES_PER_ELEMENT).readUInt32BE();
  seedHumanTiming(timingSeed);
  const operatorCdp = opts.operatorCdp ? loadOperatorCdpConfig() : null;
  console.log(
    `[wsession] start() label=${label} operatorCdp=${Boolean(operatorCdp)} proxy=${redactProxyForLog(opts.proxy)}`,
  );
  if (label && !secureCredentialTask) process.env.WELES_LABEL = label;
  if (operatorCdp) return await adoptOperatorBrowser(operatorCdp, label);
  const proxyRequested = !!opts.proxy && !requestsNoProxy(String(opts.proxy));
  // WELES_FORCE_BROWSER pins the persona's browser engine globally (e.g. on a
  // host that only has the patched Chromium installed, not Firefox). Explicit
  // opts.browser still wins; unset follows the fingerprint dataset's shares.
  // The device is sampled before the proxy resolves, because the exit
  // preflight presents it; its locale follows the exit the proxy reports.
  const device: PersonaDevice =
    opts.persona ??
    sampleDevice({
      os: opts.os as Persona['os'] | undefined,
      browser: (opts.browser ?? process.env.WELES_FORCE_BROWSER) as
        | Persona['browser']
        | undefined,
    });
  const proxy = proxyRequested
    ? await resolveProxy(opts.proxy!, opts.targetHost, device)
    : undefined;
  // Pre-launch envelope; overwritten with the realized data after launch.
  writePrelaunchSessionMeta({
    label,
    persona: device,
    proxy,
    proxyRequested: opts.proxy,
    timingSeed,
  });
  if (proxyRequested && !proxy) {
    throw new Error(
      `proxy_unavailable: requested ${opts.proxy} ${opts.targetHost ? `for ${opts.targetHost}` : 'with no target host'}`,
    );
  }
  // The exit's observed country and timezone, else the country the proxy was
  // resolved for; a run without a proxy states its country.
  const persona: Persona =
    opts.persona ??
    dressPersona(device, {
      country: proxy?.exit_reputation?.countryCode ?? proxy?.country,
      timezone: proxy?.exit_reputation?.timezone,
    });
  // WELES_PAGE_DIAGNOSTICS=0 force-disables in-page instrumentation (property-trap,
  // input-recorder) as a clean-room control for signup A/B tests.
  const instrumentationDisabled =
    process.env.WELES_NO_INSTRUMENT === '1' ||
    process.env.WELES_BROWSER_EVIDENCE_POLICY === 'spis-browser-evidence.1';
  const pageDiagnostics =
    secureCredentialTask ||
    instrumentationDisabled ||
    process.env.WELES_PAGE_DIAGNOSTICS === '0'
      ? false
      : (opts.pageDiagnostics ?? label !== 'linkedin_register');
  const userDataDir =
    opts.userDataDir ??
    process.env.WELES_USER_DATA_DIR ??
    accountProfileDirectory(opts, persona.browser);
  const bOpts: AsyncNewBrowserOptions = {
    os: persona.os,
    browser: persona.browser,
    headless: opts.headless ?? process.env.WELES_HEADLESS === '1',
    recordVideo: secureCredentialTask
      ? false
      : (opts.record ?? process.env.WELES_DISABLE_RECORDING !== '1'),
    locale: opts.locale,
    persona,
    proxy,
    pageDiagnostics,
    userAgent: opts.userAgent,
    userDataDir,
  };
  if (process.env.CHROMIUM_PATH) {
    throw new Error(
      'Explicit browser path overrides are retired; configure the exact Stado browser release version and SHA-256',
    );
  }
  const cp = findCustomBrowser(persona.browser);
  if (!cp) {
    throw new Error(
      `Verified ${persona.browser} release not found: ${customBrowserSearchHint(persona.browser)}`,
    );
  }
  if (secureCredentialTask) {
    delete process.env.SSLKEYLOGFILE;
    delete process.env.WELES_LABEL;
  } else if (label && !instrumentationDisabled) {
    process.env.SSLKEYLOGFILE = join(recordingsDir(label), 'sslkey.log');
    process.env.WELES_LABEL = label;
  } else {
    delete process.env.SSLKEYLOGFILE;
  }
  const ctx = await AsyncNewBrowser(bOpts);
  await installBrowserEvidencePolicy(ctx, label);
  const [opened] = ctx.pages();
  const page = opened || (await ctx.newPage());
  const capture = captureFor(page, label);
  if (label && !instrumentationDisabled) {
    const s = new SessionStore();
    await s.injectPlaywright(ctx, label);
  }
  return {
    kind: 'launched',
    ctx,
    page,
    capture,
    label,
    persona,
    proxy,
    proxyRequest: opts.proxy,
    platform: opts.platform,
    timingSeed,
  };
}

/** What the new session owns once its browser is up. */
export async function adoptLaunchedBrowser(
  ws: WSession,
  launch: LaunchedSession,
): Promise<void> {
  const realized = launch.ctx as BrowserContext & RealizedContext;
  const session = ws as unknown as AdoptingSession;
  ws.proxyConfig = launch.proxy;
  ws.personaConfig = launch.persona;
  session._browserProvenance = realized._welesBrowserProvenance;
  // G17g: on a worker SIGTERM (graceful timeout), close the context so
  // Playwright seals the HAR + video before the process is hard-killed.
  process.once('SIGTERM', () => {
    launch.ctx
      .close()
      .catch((error: unknown) =>
        console.error(
          `[wsession] ${launch.label}: closing the browser on SIGTERM failed, so its HAR and video may be unsealed: ${error}`,
        ),
      );
  });
  if (launch.platform) {
    ws.identity = await ws.generateIdentity(launch.platform);
    console.log(
      `[wsession] identity generated platform=${launch.platform} username_hash=${hashDiagnosticValue(ws.identity.username)}`,
    );
  }
  await probeExitIp(launch);
  // async_api always attaches the realized fingerprint to the context it built.
  const realizedFingerprint = realized._welesFingerprintConfig as Record<
    string,
    unknown
  >;
  writeRealizedSessionMeta({
    label: launch.label,
    persona: launch.persona,
    proxy: launch.proxy,
    proxyRequested: launch.proxyRequest,
    timingSeed: launch.timingSeed,
    realizedFingerprint,
    browserProvenance: realized._welesBrowserProvenance,
    identity: ws.identity,
  });
  // Complete-record network capture: NO domain filter, NO body truncation.
  // Captures every request/response (utf8 + base64), WebSocket frames in both
  // directions, TCP serverAddr, TLS securityDetails. Runs on every WSession —
  // keepers and trajectories — without exception. See net_record.ts.
  if (!session._secureCredentialTask && process.env.WELES_NO_INSTRUMENT !== '1')
    startInstrumentation(ws, launch.ctx, launch.label);
}
