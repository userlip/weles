// reCAPTCHA v3 tokens from the remote providers, tried in the order their
// provenance has proven useful: NopeCHA, CapSolver, AntiCaptcha.
import { costTracker } from '../../../utils/runtime/cost.js';
import { markAllProvidersFailed, markCaptchaChallenge } from '../../events.js';
import {
  apiSolve,
  nopechaProxyFields,
  type CaptchaCredentials,
  type ProxyCredentials,
} from '../api.js';

async function solveRecaptchaV3Nopecha(
  creds: CaptchaCredentials,
  sitekey: string,
  url: string,
  action?: string,
  proxy?: ProxyCredentials,
  dataS?: string,
  enterprise?: boolean,
): Promise<string | null> {
  const k = creds.nopecha;
  if (!k) return null;
  const body: Record<string, any> = { sitekey, url };
  const data: Record<string, any> = {
    action: action ?? 'verify',
    theme: 'light',
  };
  if (dataS) data.s = dataS;
  body.data = data;
  if (enterprise) body.enterprise = true;
  const np = nopechaProxyFields(proxy);
  if (np) body.proxy = np;
  console.log(
    `[captcha:api] nopecha recaptcha3 create action=${data.action} enterprise=${!!enterprise} proxy=${!!np}`,
  );
  try {
    const post = (await (
      await fetch('https://api.nopecha.com/v1/token/recaptcha3', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${k}`,
        },
        body: JSON.stringify(body),
      })
    ).json()) as any;
    const jobId = post?.data;
    if (!jobId) {
      console.log(
        `[captcha:api] nopecha recaptcha3 no jobId: ${JSON.stringify(post)}`,
      );
      return null;
    }
    console.log(`[captcha:api] nopecha recaptcha3 jobId=${jobId}`);
    // One read: the provider has no push or blocking answer.
    const res = (await (
      await fetch(`https://api.nopecha.com/v1/token/recaptcha3?id=${jobId}`, {
        headers: { Authorization: `Basic ${k}` },
      })
    ).json()) as any;
    if (typeof res?.data === 'string' && res.data) {
      console.log(
        `[captcha:api] nopecha recaptcha3 solved token_chars=${res.data.length}`,
      );
      return res.data;
    }
    if (res?.error === 14) {
      console.log(
        `[captcha:api] captcha_nopecha_processing: job ${jobId} has no result yet`,
      );
      return null;
    }
    console.log(
      `[captcha:api] nopecha recaptcha3 error: ${JSON.stringify(res)}`,
    );
  } catch (e: any) {
    console.log(`[captcha:api] nopecha recaptcha3 fetch err: ${e.message}`);
  }
  return null;
}

export async function solveRecaptchaV3Token(
  creds: CaptchaCredentials,
  sitekey: string,
  url: string,
  action?: string,
  options?: { proxy?: ProxyCredentials; dataS?: string; enterprise?: boolean },
): Promise<string | null> {
  markCaptchaChallenge(); // G8
  // NopeCHA V3 first.
  if (creds.nopecha) {
    const token = await solveRecaptchaV3Nopecha(
      creds,
      sitekey,
      url,
      action,
      options?.proxy,
      options?.dataS,
      options?.enterprise,
    );
    if (token) {
      console.log('[captcha:solver] ReCaptchaV3 solved via nopecha');
      costTracker.recordCaptcha('nopecha', 'recaptcha_v3');
      return token;
    }
  }
  // CapSolver V3 first (enterprise + non-enterprise), then AntiCaptcha.
  if (creds.capsolver) {
    const token = await apiSolve('https://api.capsolver.com', creds.capsolver, {
      type: 'ReCaptchaV3EnterpriseTaskProxyLess',
      websiteURL: url,
      websiteKey: sitekey,
      minScore: 0.9,
      pageAction: action ?? 'verify',
    });
    if (token) {
      console.log(
        '[captcha:solver] ReCaptchaV3Enterprise solved via capsolver',
      );
      costTracker.recordCaptcha('capsolver', 'recaptcha_v3');
      return token;
    }
    const tokenV3 = await apiSolve(
      'https://api.capsolver.com',
      creds.capsolver,
      {
        type: 'ReCaptchaV3TaskProxyLess',
        websiteURL: url,
        websiteKey: sitekey,
        minScore: 0.9,
        pageAction: action ?? 'verify',
      },
    );
    if (tokenV3) {
      console.log('[captcha:solver] ReCaptchaV3 solved via capsolver');
      costTracker.recordCaptcha('capsolver', 'recaptcha_v3');
      return tokenV3;
    }
  }
  if (creds.anticaptcha) {
    const token = await apiSolve(
      'https://api.anti-captcha.com',
      creds.anticaptcha,
      {
        type: 'RecaptchaV3TaskProxyless',
        websiteURL: url,
        websiteKey: sitekey,
        minScore: 0.7,
        pageAction: action ?? 'verify',
      },
    );
    if (token) {
      console.log('[captcha:solver] ReCaptchaV3 solved via anticaptcha');
      costTracker.recordCaptcha('anticaptcha', 'recaptcha_v3');
      return token;
    }
  }
  markAllProvidersFailed('recaptcha_v3'); // G8
  return null;
}
