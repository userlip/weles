/**
 * WSession — unified high-level API for weles browser automation.
 * Every method uses shared modules. Agent tools map 1:1 to these methods.
 *
 * The class lives here; its larger responsibilities live beside it —
 * ./wsession/ session-request (what a caller asked for and where that
 * request is named on disk), browser-launch (bringing the browser up and
 * adopting it), run-provenance (what the run recorded about itself),
 * network-observers (what the wire showed) and page-actions (how we reach an
 * element an ordinary human click cannot); ./steps/run-step (one numbered
 * step); ./identity/generated (the generated identity's placeholders).
 */

import type { BrowserContext } from 'playwright';
import type { Persona } from '../browser/persona.js';
import { SessionStore } from './store.js';
import { Capture } from '../capture/capture.js';
import { askPage, checkPage, type ScreenshottablePage } from '../vision/analyze.js';
import { humanType } from '../human/keyboard.js';
import { selectOption } from '../human/select.js';
import { waitCloudflare } from '../cloudflare/challenge.js';
import { solvePageCaptcha } from '../captcha/detect.js';
import { CaptchaSolver } from '../captcha/solver.js';
import { generateIdentity as genId, type Identity } from '../utils/identity/identity.js';
import { getNumber, textedCode, type SmsNumber } from '../utils/identity/sms.js';
import { installAtoms } from './atoms/wsession_atoms.js'; // installAtoms() is invoked at file end after WSession is declared
import { wsClick, wsFill, wsFillCredential, wsFillIdentity } from './wsession-helpers/finalize.js';
import { wsStoreCredential } from './wsession-helpers/credential/store.js';
import { isSkarbiecCredentialTask } from './wsession-helpers/credential/task.js';
import type { CapabilityRef } from '../utils/capability.js';
import { assertNonCredentialInput } from '../utils/capability.js';
import { type WSessionOptions } from './wsession/session-request.js';
import { adoptLaunchedBrowser, openSessionBrowser } from './wsession/browser-launch.js';
import { observeSessionNetwork } from './wsession/network-observers.js';
import type { StepArtifactFailure } from './wsession/run-provenance.js';
import {
  assertFocusedLiteralInput,
  wsClickSelector,
  wsFocus,
  wsJsClick,
  wsScroll,
  wsSetControl,
} from './wsession/page-actions.js';
import { runSessionStep } from './steps/run-step.js';
import { identityValue, keepIdentity, type IdentityField } from './identity/generated.js';

export type { WSessionOptions };

const asV = (p: any) => p as unknown as ScreenshottablePage;

export class WSession {
  page: any;
  readonly ctx: BrowserContext;
  readonly label: string;
  private _cap: Capture;
  private _store: SessionStore;
  private _solver: CaptchaSolver;
  private _env: Record<string, string> = {};
  // The names of the steps run so far; a step's number is its place here.
  private _steps: string[] = [];
  captchaResponse: any = null;
  captchaFormData: any = null;
  authBlocked: string | null = null;
  captchaHeaders: Record<string, string> = {};
  captchaEndpoint: string = '';
  proxyConfig:
    | { server: string; username?: string; password?: string; country?: string; exit_ip?: string; platform?: string }
    | undefined;
  personaConfig: Persona | undefined;
  // Identity assigned by WSession.start when opts.platform is set; eliminates
  // per-trajectory generateIdentity + field-rename boilerplate.
  identity: Identity | undefined;
  capturedResponses: Array<{
    ts: number;
    method: string;
    url: string;
    status: number;
    headers: Record<string, string>;
    body: string;
  }> = [];
  // Body reads still in flight for entries in capturedResponses. A caller that
  // judges captured responses awaits these first, so the judgement reads the
  // bodies that arrived instead of racing them.
  pendingResponseBodies = new Set<Promise<void>>();
  // Step screenshots / DOM dumps this run could not write, with the reason for
  // each. A step is never aborted by a missing artifact, so this list (and
  // step_artifact_failures.json beside the artifacts) is where the gap shows.
  stepArtifactFailures: StepArtifactFailure[] = [];
  private _smsOrder: SmsNumber | null = null;
  // Bytes the session received through its proxy (network-observers adds each
  // resource's bytes); the sum starts from no bytes received.
  private _proxyBytes = Number();
  private _cdp: any = null;
  private _cdpReady: Promise<void>;
  private _cdpAttachError: string | null = null;
  private _secureCredentialTask = false;
  private _storedCredentialReceipt: string | null = null;

  private constructor(ctx: BrowserContext, page: any, label: string, cap: Capture) {
    this.ctx = ctx;
    this.page = page;
    this.label = label;
    this._cap = cap;
    this._store = new SessionStore();
    this._solver = new CaptchaSolver();
    this._secureCredentialTask = isSkarbiecCredentialTask();
    // Captcha/auth interception, the response ledger and the proxy byte
    // counter, subscribed synchronously so nothing loaded by the first
    // navigation is missed. See ./wsession/network-observers.ts.
    this._cdpReady = observeSessionNetwork(this, ctx, page);
  }

  async runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return runSessionStep(this, name, fn);
  }

  takeStoredCredentialReceipt(): string | null {
    const receipt = this._storedCredentialReceipt;
    this._storedCredentialReceipt = null;
    return receipt;
  }

  static async start(opts: WSessionOptions = {}): Promise<WSession> {
    const launch = await openSessionBrowser(opts);
    const ws = new WSession(launch.ctx, launch.page, launch.label, launch.capture);
    await ws._cdpReady;
    if (launch.kind === 'launched') await adoptLaunchedBrowser(ws, launch);
    return ws;
  }

  async goto(url: string): Promise<string> {
    return this.runStep(`goto_${url.split('/').pop()}`, async () => {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitCloudflare(asV(this.page));
      return `navigated to ${this.page.url()}`;
    });
  }

  // Method bodies live in ./wsession-helpers/finalize.ts and
  // ./wsession/page-actions.ts.
  async click(target: string): Promise<string> {
    return wsClick(this, target);
  }
  async fill(target: string, value: string): Promise<string> {
    return wsFill(this, target, value);
  }
  async fillCredential(
    target: string,
    fieldClass: 'password' | 'email' | 'username' | 'token' | 'api-key',
    capability: CapabilityRef,
  ): Promise<string> {
    return wsFillCredential(this, target, fieldClass, capability);
  }
  async fillIdentity(target: string, field: IdentityField): Promise<string> {
    if (!this.identity) throw new Error('generated identity is unavailable');
    return wsFillIdentity(this, target, field, identityValue(this.identity, field));
  }
  async storeCredential(target: string, fieldClass: 'token' | 'api-key'): Promise<string> {
    return wsStoreCredential(this, target, fieldClass);
  }

  async focus(selector: string): Promise<string> {
    return wsFocus(this, selector);
  }
  async jsClick(selector?: string, text?: string): Promise<string> {
    return wsJsClick(this, selector, text);
  }
  async clickSelector(selector: string): Promise<string> {
    return wsClickSelector(this, selector);
  }
  async type(value: string): Promise<string> {
    const literal = assertNonCredentialInput(value);
    return this.runStep('type', async () => {
      await assertFocusedLiteralInput(this, literal);
      await humanType(this.page, literal);
      return 'typed';
    });
  }
  async press(key: string): Promise<string> {
    return this.runStep(`press_${key}`, async () => {
      await this.page.keyboard.press(key);
      return `pressed ${key}`;
    });
  }
  async select(target: string, value: string): Promise<string> {
    return this.runStep(`select_${target}_${value}`, async () => {
      const result = await selectOption(this.page, target, this.resolveEnv(value));
      return result ? `selected: ${result}` : 'no-select-found';
    });
  }
  async setControl(selector: string, value?: unknown, checked?: unknown): Promise<string> {
    return wsSetControl(this, selector, value, checked);
  }
  async scroll(direction: string, amount?: number): Promise<string> {
    return wsScroll(this, direction, amount);
  }

  async read(question: string): Promise<string> {
    return askPage(asV(this.page), question);
  }
  async solveCaptcha(): Promise<string> {
    return this.runStep('solveCaptcha', async () => {
      const result = await solvePageCaptcha(this.page, this._solver, this);
      if (result === null) return 'no supported captcha detected';
      return result ? 'captcha solved' : 'captcha failed';
    });
  }

  /** The newest mail for `email` from a sender containing `sender`, once it arrives. */
  async newestMail(email: string, sender: string): Promise<string> {
    const { wsNewestMail } = await import('./wsession-helpers/finalize.js');
    return wsNewestMail(this, email, sender);
  }
  /** Rent a number for `service` in `country`; it is kept for textedCode and in $<SERVICE>_NEW_PHONE. */
  async checkSms(service: string, country: string): Promise<string> {
    this._smsOrder = await getNumber(service, country);
    this._env[`${service.toUpperCase()}_NEW_PHONE`] = this._smsOrder.phone;
    return `phone: ${this._smsOrder.phone}`;
  }
  /** The code texted to the number checkSms rented, once it arrives. */
  async textedCode(): Promise<string> {
    if (!this._smsOrder) throw new Error('SMS_ORDER_MISSING: this session rented no number (checkSms rents one)');
    return textedCode(this._smsOrder);
  }

  async generateIdentity(platform: string): Promise<Identity> {
    const id = await genId(platform);
    keepIdentity(this._env, platform, id);
    return id;
  }

  async saveCookies(): Promise<string> {
    if (!this.label) return 'no label';
    await this._store.capturePlaywright(this.ctx, this.label);
    return 'cookies saved';
  }
  async needsLogin(): Promise<boolean> {
    return await checkPage(asV(this.page), 'Is this a login page?');
  }
  async screenshot(label: string): Promise<string> {
    return await this._cap.screenshot(this.page, label);
  }

  async saveAccount(
    platform: string,
    data: { username: string; email: string; password: string; name?: string; status?: string },
  ): Promise<string> {
    const { wsSaveAccount } = await import('./wsession-helpers/finalize.js');
    return wsSaveAccount(this, platform, data);
  }
  async close(): Promise<void> {
    const { wsClose } = await import('./wsession-helpers/finalize.js');
    return wsClose(this);
  }

  /** `v` with each $NAME or ${NAME} the session generated, or the environment holds, put in; a name neither holds stays as written. */
  resolveEnv(v: string): string {
    const out = v.replace(/\$\{?([A-Z_][A-Z\d_]*)\}?/g, (written, k) => {
      if (Object.hasOwn(this._env, k)) return this._env[k];
      const declared = process.env[k];
      return declared === undefined ? written : declared;
    });
    if (/\$\{?[A-Z_][A-Z\d_]*_NEW_[A-Z\d_]*\}?/.test(out))
      throw new Error('unresolved generated identity placeholder');
    return out;
  }
}

installAtoms(WSession);
