/**
 * hCaptcha, plain or enterprise, through every solving service whose key
 * Weles holds, in order: AntiCaptcha, CapMonster, CapSolver. A proxied task
 * names the proxy by IP address and port, which the services require; a
 * proxy that names no port or does not resolve fails the solve with the host
 * and cause, since no service could take it.
 */

import { lookup } from 'node:dns/promises';
import { costTracker } from '../../utils/runtime/cost.js';
import { markAllProvidersFailed, markCaptchaChallenge } from '../events.js';
import { apiSolve, type CaptchaCredentials } from './api.js';

export type HcaptchaOptions = {
  enterprisePayload?: { rqdata: string; rqtoken?: string };
  userAgent?: string;
  proxy?: { server: string; username?: string; password?: string };
};

export async function solveHcaptchaToken(
  creds: CaptchaCredentials,
  sitekey: string,
  url: string,
  options?: HcaptchaOptions,
): Promise<string | null> {
  markCaptchaChallenge(); // G8
  const enterprise = !!options?.enterprisePayload;
  const useProxy = !!options?.proxy?.server;
  const baseTask: Record<string, any> = {
    type: useProxy ? 'HCaptchaTask' : 'HCaptchaTaskProxyless',
    websiteURL: url,
    websiteKey: sitekey,
  };
  if (enterprise) {
    baseTask.isEnterprise = true;
    baseTask.enterprisePayload = {
      rqdata: options!.enterprisePayload!.rqdata,
    };
  }
  if (options?.userAgent) baseTask.userAgent = options.userAgent;
  if (useProxy) {
    const u = new URL(options!.proxy!.server);
    if (!u.port) {
      markAllProvidersFailed('hcaptcha');
      throw new Error(
        `hCaptcha proxy ${u.hostname} names no port; the solving services need one`,
      );
    }
    let ip: string;
    try {
      ({ address: ip } = await lookup(u.hostname));
    } catch (error) {
      markAllProvidersFailed('hcaptcha');
      throw new Error(
        `hCaptcha proxy ${u.hostname} did not resolve to an address the solving services accept: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    Object.assign(baseTask, {
      proxyType: u.protocol.replace(':', ''),
      proxyAddress: ip,
      proxyPort: Number(u.port),
      proxyLogin: options!.proxy!.username,
      proxyPassword: options!.proxy!.password,
    });
  }
  console.log(
    `[captcha:solver] solveHcaptcha enterprise=${enterprise} proxy=${useProxy ? `${baseTask.proxyAddress}:${baseTask.proxyPort}` : 'none'} sitekey=${sitekey}`,
  );
  // Try all services: anticaptcha → capmonster → capsolver
  if (creds.anticaptcha) {
    const token = await apiSolve(
      'https://api.anti-captcha.com',
      creds.anticaptcha,
      baseTask,
    );
    if (token) {
      console.log('[captcha:solver] Solved via anticaptcha');
      costTracker.recordCaptcha('anticaptcha', 'hcaptcha');
      return token;
    }
  }
  if (creds.capmonster) {
    const token = await apiSolve(
      'https://api.capmonster.cloud',
      creds.capmonster,
      baseTask,
    );
    if (token) {
      console.log('[captcha:solver] Solved via capmonster');
      costTracker.recordCaptcha('capmonster', 'hcaptcha');
      return token;
    }
  }
  if (creds.capsolver) {
    // CapSolver: HCaptchaEnterpriseTaskProxyLess is its own task type;
    // HCaptchaTaskProxyless + isEnterprise returns ERROR_INVALID_TASK_DATA.
    const t: Record<string, any> = {
      ...baseTask,
      type: enterprise
        ? useProxy
          ? 'HCaptchaEnterpriseTask'
          : 'HCaptchaEnterpriseTaskProxyLess'
        : useProxy
          ? 'HCaptchaTask'
          : 'HCaptchaTaskProxyLess',
    };
    delete t.isEnterprise;
    const token = await apiSolve(
      'https://api.capsolver.com',
      creds.capsolver,
      t,
    );
    if (token) {
      console.log('[captcha:solver] Solved via capsolver');
      costTracker.recordCaptcha('capsolver', 'hcaptcha');
      return token;
    }
  }
  console.log('[captcha:solver] All services failed for hCaptcha');
  markAllProvidersFailed('hcaptcha'); // G8
  return null;
}
