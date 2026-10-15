// JuicySMS (https://juicysms.com/api), through its plain-text HTTP API. The
// API key is the Weles service secret juicySms/api_key in Skarbiec.
import { readOptionalWelesServiceSecret } from '../../../secrets/scoped-service.js';
import { codeDigits, providerAnswer, type SmsProvider } from './protocol.js';

const BASE = 'https://juicysms.com/api';
const ORDERED = /ORDER_ID_(?<order>\d+)_NUMBER_(?<number>\d+)/;
const OPEN_ORDER = /OPEN_ORDER\D*(?<order>\d+)/;
const SUCCESS = 'SUCCESS_';

// JuicySMS's own service ids.
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

function key(): string {
  const value = readOptionalWelesServiceSecret('juicySms', 'api_key');
  if (!value) throw new Error('sms_juicysms_unconfigured: Skarbiec holds no JuicySMS API key');
  return value;
}

export const juicySms: SmsProvider = {
  name: 'juicysms',
  configured: () => Boolean(readOptionalWelesServiceSecret('juicySms', 'api_key')),
  async rent(service, country) {
    const serviceId = SERVICE_IDS[service.toLowerCase()];
    if (!serviceId) return { unavailable: `juicysms has no service id for ${service}` };
    const url = `${BASE}/makeorder?key=${key()}&serviceId=${serviceId}&country=${country}`;
    let answer = await providerAnswer(url, 'juicysms makeorder');
    // JuicySMS holds one open order per service: an order an earlier run
    // left open is named in the answer, released, and the number ordered
    // with it gone.
    const open = OPEN_ORDER.exec(answer)?.groups;
    if (open) {
      await juicySms.cancel(open.order);
      answer = await providerAnswer(url, `juicysms makeorder after releasing open order ${open.order}`);
    }
    const ordered = ORDERED.exec(answer)?.groups;
    if (!ordered) return { unavailable: `juicysms makeorder (${country}) answered ${answer}` };
    return { phone: ordered.number, orderId: ordered.order };
  },
  async read(orderId) {
    const answer = await providerAnswer(`${BASE}/getsms?key=${key()}&orderId=${orderId}`, `juicysms getsms ${orderId}`);
    if (answer.startsWith(SUCCESS)) return { code: codeDigits('juicysms', orderId, answer, answer.slice(SUCCESS.length)) };
    return { waiting: answer };
  },
  async cancel(orderId) {
    await providerAnswer(`${BASE}/cancelorder?key=${key()}&orderId=${orderId}`, `juicysms cancelorder ${orderId}`);
  },
};
