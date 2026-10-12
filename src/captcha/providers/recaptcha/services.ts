// reCAPTCHA v2 tokens from the two services that are not task APIs: 2captcha's
// in.php/res.php pair and NopeCHA's token API. Each answers from one read.
import {
  nopechaProxyFields,
  type CaptchaCredentials,
  type ProxyCredentials,
} from '../api.js';

export async function solveRecaptchaV2TwoCaptcha(
  creds: CaptchaCredentials,
  sitekey: string,
  url: string,
  invisible: boolean,
  enterprise: boolean,
  proxy?: ProxyCredentials,
  dataS?: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    key: creds.twocaptcha!,
    method: 'userrecaptcha',
    googlekey: sitekey,
    pageurl: url,
    json: '1',
  });
  if (invisible) params.set('invisible', '1');
  if (enterprise) params.set('enterprise', '1');
  if (dataS) params.set('data-s', dataS);
  if (proxy?.server) {
    const u = new URL(proxy.server);
    const proxyAddr = `${u.hostname}:${u.port}`;
    const proxyType = u.protocol.replace(':', '');
    params.set(
      'proxy',
      proxy.username
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@${proxyAddr}`
        : proxyAddr,
    );
    params.set('proxytype', proxyType);
  }
  console.log('[captcha:api] 2captcha recaptcha v2 create');
  const cr = (await (
    await fetch('https://2captcha.com/in.php?' + params.toString())
  )
    .json()
    .catch(() => ({}))) as any;
  if (cr.status !== 1 || !cr.request) {
    console.log(
      `[captcha:api] 2captcha create error: ${cr.request ?? cr.error_text ?? JSON.stringify(cr)}`,
    );
    return null;
  }
  const tid = cr.request;
  console.log(`[captcha:api] 2captcha taskId=${tid}`);
  // One read: the provider has no push or blocking answer.
  const res = (await (
    await fetch(
      `https://2captcha.com/res.php?key=${creds.twocaptcha}&action=get&id=${tid}&json=1`,
    )
  ).json()) as any;
  if (res.status === 1) {
    console.log('[captcha:api] 2captcha solved');
    return res.request;
  }
  if (res.request === 'CAPCHA_NOT_READY') {
    console.log(
      `[captcha:api] captcha_2captcha_processing: task ${tid} has no result yet`,
    );
    return null;
  }
  console.log(`[captcha:api] 2captcha error: ${res.request}`);
  return null;
}

export async function solveRecaptchaV2Nopecha(
  creds: CaptchaCredentials,
  sitekey: string,
  url: string,
  invisible: boolean,
  enterprise: boolean,
  proxy?: ProxyCredentials,
  dataS?: string,
): Promise<string | null> {
  const k = creds.nopecha;
  if (!k) return null;
  const body: Record<string, any> = { sitekey, url };
  const data: Record<string, any> = { theme: 'light' };
  if (dataS) data.s = dataS;
  if (invisible) data.invisible = true;
  if (Object.keys(data).length) body.data = data;
  if (enterprise) body.enterprise = true;
  const np = nopechaProxyFields(proxy);
  if (np) body.proxy = np;
  console.log(
    `[captcha:api] nopecha recaptcha2 create enterprise=${enterprise} invisible=${invisible} proxy=${!!np}`,
  );
  try {
    const post = (await (
      await fetch('https://api.nopecha.com/v1/token/recaptcha2', {
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
        `[captcha:api] nopecha recaptcha2 no jobId: ${JSON.stringify(post)}`,
      );
      return null;
    }
    console.log(`[captcha:api] nopecha recaptcha2 jobId=${jobId}`);
    // One read: the provider has no push or blocking answer.
    const res = (await (
      await fetch(`https://api.nopecha.com/v1/token/recaptcha2?id=${jobId}`, {
        headers: { Authorization: `Basic ${k}` },
      })
    ).json()) as any;
    if (typeof res?.data === 'string' && res.data) {
      console.log(
        `[captcha:api] nopecha recaptcha2 solved token_chars=${res.data.length}`,
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
      `[captcha:api] nopecha recaptcha2 error: ${JSON.stringify(res)}`,
    );
  } catch (e: any) {
    console.log(`[captcha:api] nopecha recaptcha2 fetch err: ${e.message}`);
  }
  return null;
}
