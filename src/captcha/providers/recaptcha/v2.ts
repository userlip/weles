// reCAPTCHA v2 tokens from the remote providers, tried in the order their
// provenance has proven useful, with the in-page tile solver as the last
// resort. The CaptchaSolver class keeps the credential loading and calls this
// with its credentials.
import { solveRecaptchaV2 as solveRecaptchaV2InPage } from '../../recaptcha.js';
import { costTracker } from '../../../utils/runtime/cost.js';
import { markCaptchaChallenge, markAllProvidersFailed } from '../../events.js';
import {
  apiSolve,
  proxyTaskFields,
  type CaptchaCredentials,
  type ProxyCredentials,
} from '../api.js';
import {
  solveRecaptchaV2Nopecha,
  solveRecaptchaV2TwoCaptcha,
} from './services.js';

/** One task a service is asked to solve, and whether it is its enterprise task. */
type V2Task = { type: string; enterprise: boolean };

type Page = any;

export async function solveRecaptchaV2Token(
  creds: CaptchaCredentials,
  page: Page,
  sitekey: string,
  options?: {
    enterprise?: boolean;
    invisible?: boolean;
    url?: string;
    proxy?: ProxyCredentials;
    dataS?: string;
  },
): Promise<string | boolean | null> {
  markCaptchaChallenge(); // G8: a challenge was faced (flips challenge_faced even if every provider fails)
  const url =
    options?.url ??
    (typeof page?.url === 'function' ? page.url() : page?.url) ??
    '';
  const isInv = !!options?.invisible;
  const isEnt = !!options?.enterprise;
  const proxy = await proxyTaskFields(options?.proxy).catch((e: any) => {
    console.log(`[captcha:solver] proxy parse skipped: ${e.message}`);
    return null;
  });

  // NopeCHA Token API first — different token provenance may bypass LinkedIn rejection.
  if (creds.nopecha) {
    const token = await solveRecaptchaV2Nopecha(
      creds,
      sitekey,
      url,
      isInv,
      isEnt,
      options?.proxy,
      options?.dataS,
    );
    if (token) {
      console.log('[captcha:solver] V2 solved via nopecha');
      costTracker.recordCaptcha('nopecha', 'recaptcha_v2');
      return token;
    }
  }

  // CapMonster: try enterprise first, then standard (with invisible flag when applicable).
  if (creds.capmonster) {
    const types: V2Task[] = [];
    if (isEnt)
      types.push({
        type: proxy
          ? 'RecaptchaV2EnterpriseTask'
          : 'RecaptchaV2EnterpriseTaskProxyless',
        enterprise: true,
      });
    types.push({
      type: proxy ? 'NoCaptchaTask' : 'NoCaptchaTaskProxyless',
      enterprise: false,
    });
    for (const { type: tType, enterprise } of types) {
      const task: Record<string, any> = {
        type: tType,
        websiteURL: url,
        websiteKey: sitekey,
      };
      if (!enterprise && isInv) task.isInvisible = true;
      if (options?.dataS) {
        if (enterprise) {
          task.enterprisePayload = { s: options.dataS };
        } else {
          task.recaptchaDataSValue = options.dataS;
        }
      }
      if (proxy) Object.assign(task, proxy);
      const t = await apiSolve(
        'https://api.capmonster.cloud',
        creds.capmonster,
        task,
      );
      if (t) {
        console.log(`[captcha:solver] ${tType} solved via capmonster`);
        costTracker.recordCaptcha('capmonster', 'recaptcha_v2');
        return t;
      }
    }
  }
  // CapSolver: try enterprise first, then standard (with invisible flag when applicable).
  if (creds.capsolver) {
    const types: V2Task[] = [];
    if (isEnt)
      types.push({
        type: proxy
          ? 'ReCaptchaV2EnterpriseTask'
          : 'ReCaptchaV2EnterpriseTaskProxyLess',
        enterprise: true,
      });
    types.push({
      type: proxy ? 'ReCaptchaV2Task' : 'ReCaptchaV2TaskProxyLess',
      enterprise: false,
    });
    for (const { type: taskType, enterprise } of types) {
      const task: Record<string, any> = {
        type: taskType,
        websiteURL: url,
        websiteKey: sitekey,
      };
      if (isInv) task.isInvisible = true;
      if (options?.dataS && enterprise) {
        task.enterprisePayload = { s: options.dataS };
      }
      if (proxy) Object.assign(task, proxy);
      const token = await apiSolve(
        'https://api.capsolver.com',
        creds.capsolver,
        task,
      );
      if (token) {
        console.log(`[captcha:solver] ${taskType} solved via capsolver`);
        costTracker.recordCaptcha('capsolver', 'recaptcha_v2');
        return token;
      }
    }
  }
  // AntiCaptcha.
  if (creds.anticaptcha) {
    const task: Record<string, any> = {
      type: proxy ? 'RecaptchaV2Task' : 'RecaptchaV2TaskProxyless',
      websiteURL: url,
      websiteKey: sitekey,
      isEnterprise: isEnt,
    };
    if (isInv) task.isInvisible = true;
    if (options?.dataS) task.recaptchaDataSValue = options.dataS;
    if (proxy) Object.assign(task, proxy);
    const token = await apiSolve(
      'https://api.anti-captcha.com',
      creds.anticaptcha,
      task,
    );
    if (token) {
      console.log(`[captcha:solver] V2 solved via anticaptcha`);
      costTracker.recordCaptcha('anticaptcha', 'recaptcha_v2');
      return token;
    }
  }
  // 2captcha fallback.
  if (creds.twocaptcha) {
    const token = await solveRecaptchaV2TwoCaptcha(
      creds,
      sitekey,
      url,
      isInv,
      isEnt,
      options?.proxy,
      options?.dataS,
    );
    if (token) {
      console.log('[captcha:solver] V2 solved via 2captcha');
      costTracker.recordCaptcha('twocaptcha', 'recaptcha_v2');
      return token;
    }
  }
  // Image-grid path for cases where API solvers fail and Google's
  // standard frame chain IS present (non-LinkedIn enterprise sites).
  if (isEnt) return solveRecaptchaV2InPage(page);
  markAllProvidersFailed('recaptcha_v2'); // G8
  return null;
}
