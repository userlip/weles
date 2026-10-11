/**
 * SMS verification client -- JuicySMS + sms-activate.
 * Plain HTTP GET calls, no external dependencies.
 */

import { costTracker } from '../runtime/cost.js';
import { readOptionalWelesServiceSecret } from '../../secrets/scoped-service.js';

const JUICY_BASE = 'https://juicysms.com/api';
function juicyApiKey(): string | undefined {
  return readOptionalWelesServiceSecret('juicySms', 'api_key');
}
function smsActivateApiKey(): string | undefined {
  return readOptionalWelesServiceSecret('smsActivate', 'api_key');
}

const SERVICE_IDS: Record<string, string> = {
  twitter: '4',
  tiktok: '76',
  instagram: '6',
  discord: '10',
  reddit: '474',
  google: '1',
  telegram: '5',
  whatsapp: '8',
  facebook: '12',
  yahoo: '15',
  linkedin: '284',
};

const COUNTRY_PREFIX: Record<string, string> = {
  US: '+1',
  UK: '+44',
  CA: '+1',
  NL: '+31',
  DE: '+49',
};

const SMSACTIVATE_SERVICES: Record<string, string> = {
  tiktok: 'lf',
  instagram: 'ig',
  discord: 'ds',
  reddit: 'dt',
  twitter: 'tw',
  google: 'go',
  telegram: 'tg',
  whatsapp: 'wa',
  facebook: 'fb',
  yahoo: 'mj',
  linkedin: 'li',
};
const SMSACTIVATE_COUNTRIES: Record<string, string> = {
  US: '12',
  UK: '16',
  NL: '15',
  DE: '43',
};

export interface SmsNumber {
  phone: string;
  orderId: string;
  provider: 'juicysms' | 'smsactivate';
  country: string;
}

function normalizePhone(raw: string, country: string): string {
  let p = raw.replace(/\D/g, '');
  if (country !== 'US' && p.startsWith('0')) p = p.slice(1);
  const pfx = COUNTRY_PREFIX[country] ?? '+1';
  const pfxDigits = pfx.replace(/\D/g, '');
  // Providers sometimes return the number already including the country code.
  if (p.startsWith(pfxDigits) && p.length > pfxDigits.length) return `+${p}`;
  return p.startsWith('+') ? p : `+${pfxDigits}${p}`;
}

// One provider request's text, or null with the reason added to `failures`:
// a network error, or a refusal with its HTTP status. The URL carries the API
// key, so only `label` is quoted.
async function providerText(
  url: string,
  label: string,
  failures: string[],
): Promise<string | null> {
  try {
    const response = await fetch(url);
    const text = (await response.text()).trim();
    if (!response.ok) {
      failures.push(`${label} answered HTTP ${response.status}: ${text}`);
      return null;
    }
    return text;
  } catch (error) {
    failures.push(
      `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function getNumber(
  service: string,
  country = 'UK',
): Promise<SmsNumber | null> {
  const failures: string[] = [];
  // Try JuicySMS — only the requested country (caller handles rotation)
  const jKey = juicyApiKey();
  if (jKey) {
    const sid = SERVICE_IDS[service.toLowerCase()] ?? service;
    const url = `${JUICY_BASE}/makeorder?key=${jKey}&serviceId=${sid}&country=${country}`;
    const text = String(await providerText(url, 'juicysms makeorder', failures));
    const m = text.match(/ORDER_ID_(\d+)_NUMBER_(\d+)/);
    if (m) {
      console.log(`[sms] juicysms: got ${m[2]} (order ${m[1]}, ${country})`);
      costTracker.recordSms('juicysms', service);
      return {
        phone: normalizePhone(m[2], country),
        orderId: m[1],
        provider: 'juicysms',
        country,
      };
    }
    if (text.includes('OPEN_ORDER')) {
      const oid = text.match(/(\d+)/)?.[1];
      if (oid) {
        await providerText(
          `${JUICY_BASE}/cancelorder?key=${jKey}&orderId=${oid}`,
          `juicysms cancelorder ${oid}`,
          failures,
        );
      }
      const t2 = String(await providerText(url, 'juicysms makeorder (retry)', failures));
      const m2 = t2.match(/ORDER_ID_(\d+)_NUMBER_(\d+)/);
      if (m2) {
        costTracker.recordSms('juicysms', service);
        return {
          phone: normalizePhone(m2[2], country),
          orderId: m2[1],
          provider: 'juicysms',
          country,
        };
      }
    }
    // A refused request is already in `failures`; only a real answer that
    // carried no number is logged here.
    if (text !== String(null)) console.log(`[sms] juicysms (${country}): ${text}`);
  }
  // Try sms-activate
  const saKey = smsActivateApiKey();
  if (saKey) {
    const svc = SMSACTIVATE_SERVICES[service.toLowerCase()] ?? service;
    const cc = SMSACTIVATE_COUNTRIES[country] ?? '12';
    const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${saKey}&action=getNumberV2&service=${svc}&country=${cc}`;
    const answer = await providerText(url, 'sms-activate getNumberV2', failures);
    if (answer !== null) {
      let d: any;
      try {
        d = JSON.parse(answer);
      } catch (error) {
        failures.push(
          `sms-activate getNumberV2 answered non-JSON (${error instanceof Error ? error.message : String(error)}): ${answer}`,
        );
      }
      if (d?.activationId) {
        const phone = String(d.phoneNumber ?? '');
        console.log(
          `[sms] sms-activate: got ${phone} (activation ${d.activationId})`,
        );
        // The number is held whether or not the provider takes the "ready"
        // status; a refused status is said, not dropped with the rest.
        const statusFailures: string[] = [];
        await providerText(
          `https://api.sms-activate.org/stubs/handler_api.php?api_key=${saKey}&action=setStatus&status=1&id=${d.activationId}`,
          `sms-activate setStatus ${d.activationId}`,
          statusFailures,
        );
        for (const failure of statusFailures) console.error(`[sms] ${failure}`);
        costTracker.recordSms('smsactivate', service);
        return {
          phone: normalizePhone(phone, country),
          orderId: String(d.activationId),
          provider: 'smsactivate',
          country,
        };
      }
    }
  }
  console.log(
    `[sms] no number for ${service} (${country})${failures.length ? `: ${failures.join('; ')}` : ': no provider is configured'}`,
  );
  return null;
}

/** One read of an SMS order. Returns the code when the provider has it;
 * otherwise throws a named error carrying the provider's own answer
 * (`sms_<provider>_waiting` while the SMS has not arrived, `..._cancelled`
 * for a cancelled activation). SMS delivery has no push or blocking read,
 * so the caller reads again later with the same order id instead of
 * this function waiting. */
export async function readCode(
  orderId: string,
  provider: 'juicysms' | 'smsactivate',
): Promise<string> {
  if (provider === 'juicysms') {
    const jKey = juicyApiKey();
    if (!jKey)
      throw new Error('sms_juicysms_unconfigured: no JuicySMS API key');
    const r = await fetch(
      `${JUICY_BASE}/getsms?key=${jKey}&orderId=${orderId}`,
    );
    if (!r.ok)
      throw new Error(
        `sms_juicysms_http_${r.status}: getsms for order ${orderId} failed`,
      );
    const text = (await r.text()).trim();
    if (text.startsWith('SUCCESS_')) {
      // Instagram (and some other services) formats the code as '490 315'
      // with a space in the middle, so strip all non-digits before matching.
      const digits = text.replace('SUCCESS_', '').replace(/\D/g, '');
      const code = digits.match(/^(\d{4,8})$/)?.[1];
      if (!code)
        throw new Error(
          `sms_juicysms_unreadable: order ${orderId} answered ${text}`,
        );
      console.log(`[sms] code: ${code}`);
      return code;
    }
    throw new Error(
      `sms_juicysms_waiting: order ${orderId} has no code yet (${text}); read it again with this order id`,
    );
  }
  const saKey = smsActivateApiKey();
  if (!saKey)
    throw new Error('sms_smsactivate_unconfigured: no SMS-Activate API key');
  const r = await fetch(
    `https://api.sms-activate.org/stubs/handler_api.php?api_key=${saKey}&action=getStatus&id=${orderId}`,
  );
  if (!r.ok)
    throw new Error(
      `sms_smsactivate_http_${r.status}: getStatus for order ${orderId} failed`,
    );
  const text = (await r.text()).trim();
  if (text.startsWith('STATUS_OK:')) {
    const code = text.split(':')[1].match(/(\d{4,8})/)?.[1];
    if (!code)
      throw new Error(
        `sms_smsactivate_unreadable: order ${orderId} answered ${text}`,
      );
    console.log(`[sms] code: ${code}`);
    return code;
  }
  if (text.includes('STATUS_CANCEL'))
    throw new Error(
      `sms_smsactivate_cancelled: activation ${orderId} was cancelled`,
    );
  throw new Error(
    `sms_smsactivate_waiting: order ${orderId} has no code yet (${text}); read it again with this order id`,
  );
}

export async function cancelOrder(
  orderId: string,
  provider: 'juicysms' | 'smsactivate',
): Promise<void> {
  // A cancel the provider did not take leaves a paid number held; the failure
  // is said with the order and cause (the URL carries the API key, so only the
  // provider name is quoted).
  const report = (outcome: string) =>
    console.error(`[sms] cancel of ${provider} order ${orderId} ${outcome}`);
  const send = async (url: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) report(`answered HTTP ${response.status}`);
    } catch (error) {
      report(`failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  if (provider === 'juicysms') {
    const jKey = juicyApiKey();
    if (!jKey) return report('was not sent: no JuicySMS API key');
    await send(`${JUICY_BASE}/cancelorder?key=${jKey}&orderId=${orderId}`);
  } else {
    const saKey = smsActivateApiKey();
    if (!saKey) return report('was not sent: no sms-activate API key');
    await send(
      `https://api.sms-activate.org/stubs/handler_api.php?api_key=${saKey}&action=setStatus&status=8&id=${orderId}`,
    );
  }
}
