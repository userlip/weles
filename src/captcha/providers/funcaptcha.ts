/**
 * FunCaptcha (Arkose Labs) through every solving service whose key Weles
 * holds, in order: AntiCaptcha, 2captcha, CapMonster, CapSolver. The first
 * token any of them returns answers the challenge.
 */

import { costTracker } from '../../utils/runtime/cost.js';
import { markAllProvidersFailed, markCaptchaChallenge } from '../events.js';
import { apiSolve, twoCaptchaSolve, type CaptchaCredentials } from './api.js';

export async function solveFuncaptchaToken(
  creds: CaptchaCredentials,
  publicKey: string,
  url: string,
  subdomain?: string,
  blob?: string,
): Promise<string | null> {
  markCaptchaChallenge(); // G8
  console.log(
    `[captcha:solver] solveFuncaptcha pkey=${publicKey} subdomain=${subdomain} blob=${blob}...`,
  );
  if (creds.anticaptcha) {
    const task: Record<string, any> = {
      type: 'FunCaptchaTaskProxyless',
      websiteURL: url,
      websitePublicKey: publicKey,
    };
    if (subdomain)
      task.funcaptchaApiJSSubdomain = subdomain
        .replace(/^https?:\/\//, '')
        .replace('iframe.arkoselabs.com', 'client-api.arkoselabs.com');
    if (blob) task.data = JSON.stringify({ blob });
    const token = await apiSolve(
      'https://api.anti-captcha.com',
      creds.anticaptcha,
      task,
    );
    if (token) {
      console.log('[captcha:solver] FunCaptcha solved via anticaptcha');
      costTracker.recordCaptcha('anticaptcha', 'funcaptcha');
      return token;
    }
  }
  if (creds.twocaptcha) {
    const sd = subdomain
      ? subdomain
          .replace(/^https?:\/\//, '')
          .replace('iframe.arkoselabs.com', 'client-api.arkoselabs.com')
      : '';
    const surl = sd ? `https://${sd}` : '';
    const params = new URLSearchParams({
      key: creds.twocaptcha,
      method: 'funcaptcha',
      publickey: publicKey,
      pageurl: url,
      json: '1',
    });
    if (surl) params.set('surl', surl);
    if (blob) params.set('data[blob]', blob);
    console.log(`[captcha:api] 2captcha funcaptcha surl=${surl}`);
    const token = await twoCaptchaSolve(creds.twocaptcha, params, 'funcaptcha');
    if (token) {
      costTracker.recordCaptcha('twocaptcha', 'funcaptcha');
      return token;
    }
  }
  if (creds.capmonster) {
    const task: Record<string, any> = {
      type: 'FunCaptchaTaskProxyless',
      websiteURL: url,
      websitePublicKey: publicKey,
    };
    if (subdomain)
      task.funcaptchaApiJSSubdomain = subdomain
        .replace(/^https?:\/\//, '')
        .replace('iframe.arkoselabs.com', 'client-api.arkoselabs.com');
    if (blob) task.data = JSON.stringify({ blob });
    const token = await apiSolve(
      'https://api.capmonster.cloud',
      creds.capmonster,
      task,
    );
    if (token) {
      console.log('[captcha:solver] FunCaptcha solved via capmonster');
      costTracker.recordCaptcha('capmonster', 'funcaptcha');
      return token;
    }
  }
  if (creds.capsolver) {
    const task: Record<string, any> = {
      type: 'FunCaptchaTaskProxyLess',
      websiteURL: url,
      websitePublicKey: publicKey,
    };
    if (subdomain) {
      let s = subdomain.startsWith('http') ? subdomain : `https://${subdomain}`;
      s = s.replace('iframe.arkoselabs.com', 'client-api.arkoselabs.com');
      task.funcaptchaApiJSSubdomain = s;
    }
    if (blob) task.data = JSON.stringify({ blob });
    const token = await apiSolve(
      'https://api.capsolver.com',
      creds.capsolver,
      task,
    );
    if (token) {
      console.log('[captcha:solver] FunCaptcha solved via capsolver');
      costTracker.recordCaptcha('capsolver', 'funcaptcha');
      return token;
    }
  }
  console.log('[captcha:solver] All services failed for FunCaptcha');
  markAllProvidersFailed('funcaptcha'); // G8
  return null;
}
