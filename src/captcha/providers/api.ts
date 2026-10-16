import { lookup } from 'node:dns/promises';

// What every captcha provider call shares: the credential set, the
// createTask/getTaskResult exchange, and the proxy fields a task carries in
// the two dialects the providers speak.

export interface CaptchaCredentials {
  anticaptcha?: string;
  twocaptcha?: string;
  capsolver?: string;
  capmonster?: string;
  nocaptcha?: string;
  nopecha?: string;
}

// Creates the task and reads its result once. The providers have no push or
// blocking answer, so a task still being solved is reported by name with its
// task id and answered as null, like any other unsolved task.
export async function apiSolve(
  apiUrl: string,
  clientKey: string,
  task: Record<string, any>,
): Promise<string | null> {
  const svc = apiUrl.replace('https://api.', '').replace('.com', '');
  console.log(
    `[captcha:api] ${svc} createTask type=${task.type} enterprise=${task.isEnterprise} proxy=${!!task.proxyAddress}`,
  );
  const createRes = (await (
    await fetch(apiUrl + '/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey, task }),
    })
  ).json()) as any;
  if (createRes.errorId) {
    console.log(
      `[captcha:api] ${svc} createTask error: ${createRes.errorCode} ${createRes.errorDescription}`,
    );
    return null;
  }
  const taskId = createRes.taskId;
  if (!taskId) {
    console.log(`[captcha:api] ${svc} no taskId in response`);
    return null;
  }
  console.log(`[captcha:api] ${svc} taskId=${taskId}`);
  const res = (await (
    await fetch(apiUrl + '/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey, taskId }),
    })
  ).json()) as any;
  if (res.errorId) {
    console.log(
      `[captcha:api] ${svc} result error: ${res.errorCode} ${res.errorDescription}`,
    );
    return null;
  }
  if (res.status !== 'ready') {
    console.log(
      `[captcha:api] captcha_${svc}_processing: task ${taskId} has no result yet (status ${res.status})`,
    );
    return null;
  }
  // Two token fields are in use across the services: reCAPTCHA's own name and
  // the generic one. A ready task carrying neither is named, not passed on.
  const t = res.solution?.gRecaptchaResponse ?? res.solution?.token;
  if (!t) {
    console.log(
      `[captcha:api] ${svc} task ${taskId} is ready but its solution carries no token: ${JSON.stringify(res.solution)}`,
    );
    return null;
  }
  console.log(`[captcha:api] ${svc} solved, token_chars=${t.length}`);
  return t;
}

export type ProxyCredentials = {
  server?: string;
  username?: string;
  password?: string;
};

// The proxy URL a task names, which must carry its port: the services take
// the proxy as address and port, and a URL without one read as port NaN, so
// the task went out naming no usable proxy.
function proxyUrl(server: string): URL {
  const u = new URL(server);
  if (!u.port)
    throw new Error(
      `captcha proxy ${u.hostname} names no port; the solving services need one`,
    );
  return u;
}

// The proxy fields of a createTask task. The services require the proxy by IP
// address, so a host that does not resolve fails here with its cause rather
// than going out as a name the services refuse.
export async function proxyTaskFields(
  proxy?: ProxyCredentials,
): Promise<Record<string, any> | null> {
  if (!proxy?.server) return null;
  const u = proxyUrl(proxy.server);
  let ip: string;
  try {
    ({ address: ip } = await lookup(u.hostname));
  } catch (error) {
    throw new Error(
      `captcha proxy ${u.hostname} did not resolve to an address the solving services accept: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return {
    proxyType: u.protocol.replace(':', ''),
    proxyAddress: ip,
    proxyPort: Number(u.port),
    proxyLogin: proxy.username,
    proxyPassword: proxy.password,
  };
}

export function nopechaProxyFields(
  proxy?: ProxyCredentials,
): Record<string, any> | null {
  if (!proxy?.server) return null;
  const u = proxyUrl(proxy.server);
  const out: Record<string, any> = {
    scheme: u.protocol.replace(':', ''),
    host: u.hostname,
    port: Number(u.port),
  };
  if (proxy.username) out.username = proxy.username;
  if (proxy.password) out.password = proxy.password;
  return out;
}
