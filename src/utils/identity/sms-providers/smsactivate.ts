// SMS-Activate (https://api.sms-activate.org/stubs/handler_api.php), through
// its HTTP API. The API key is the Weles service secret smsActivate/api_key
// in Skarbiec.
import { readOptionalWelesServiceSecret } from '../../../secrets/scoped-service.js';
import { codeDigits, providerAnswer, type SmsProvider } from './protocol.js';

const HANDLER = 'https://api.sms-activate.org/stubs/handler_api.php';
// getStatus answers STATUS_OK with the code, STATUS_CANCEL, or one of the
// STATUS_WAIT_ states while the SMS is awaited:
// https://github.com/sms-activate/SMSActivateApi/blob/main/docs/response/api_activation/enums/SMSActivateGetStatusActivation.md
const RECEIVED = 'STATUS_OK:';
const CANCELLED = 'STATUS_CANCEL';
const WAITING = 'STATUS_WAIT_';

// SMS-Activate's own service codes and country ids.
const SERVICES: Record<string, string> = {
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
const COUNTRIES: Record<string, string> = {
  US: '12',
  UK: '16',
  NL: '15',
  DE: '43',
};

function handler(action: string, query: string): string {
  const key = readOptionalWelesServiceSecret('smsActivate', 'api_key');
  if (!key)
    throw new Error(
      'sms_smsactivate_unconfigured: Skarbiec holds no SMS-Activate API key',
    );
  return `${HANDLER}?api_key=${key}&action=${action}&${query}`;
}

export const smsActivate: SmsProvider = {
  name: 'smsactivate',
  configured: () =>
    Boolean(readOptionalWelesServiceSecret('smsActivate', 'api_key')),
  async rent(service, country) {
    const countryId = COUNTRIES[country];
    if (!countryId)
      return { unavailable: `sms-activate has no country id for ${country}` };
    const serviceCode = SERVICES[service.toLowerCase()];
    if (!serviceCode)
      return { unavailable: `sms-activate has no service code for ${service}` };
    const answer = await providerAnswer(
      handler('getNumberV2', `service=${serviceCode}&country=${countryId}`),
      'sms-activate getNumberV2',
    );
    // A number comes as JSON; no number (NO_NUMBERS, NO_BALANCE, ...) as a bare word.
    if (!answer.startsWith('{'))
      return {
        unavailable: `sms-activate getNumberV2 (${country}) answered ${answer}`,
      };
    const activation = JSON.parse(answer);
    if (!activation.activationId || !activation.phoneNumber)
      return {
        unavailable: `sms-activate getNumberV2 (${country}) answered ${answer}`,
      };
    const orderId = String(activation.activationId);
    // Status 1 tells SMS-Activate the number is in use and its SMS awaited.
    // The number is held whether or not the provider takes it, so a refusal
    // is said with the rented order instead of losing the paid number.
    await providerAnswer(
      handler('setStatus', `status=1&id=${orderId}`),
      `sms-activate setStatus ${orderId}`,
    ).catch((error: Error) =>
      console.error(
        `[sms] activation ${orderId} is rented, but its readiness was not set: ${error.message}`,
      ),
    );
    return { phone: String(activation.phoneNumber), orderId };
  },
  async read(orderId) {
    const answer = await providerAnswer(
      handler('getStatus', `id=${orderId}`),
      `sms-activate getStatus ${orderId}`,
    );
    if (answer.startsWith(RECEIVED))
      return {
        code: codeDigits(
          'smsactivate',
          orderId,
          answer,
          answer.slice(RECEIVED.length),
        ),
      };
    if (answer.startsWith(CANCELLED))
      throw new Error(
        `sms_smsactivate_cancelled: activation ${orderId} was cancelled`,
      );
    if (answer.startsWith(WAITING)) return { waiting: answer };
    throw new Error(
      `sms_smsactivate_ended: activation ${orderId} will receive no SMS: getStatus answered ${answer}`,
    );
  },
  async cancel(orderId) {
    // Status 8 is SMS-Activate's "cancel the activation".
    await providerAnswer(
      handler('setStatus', `status=8&id=${orderId}`),
      `sms-activate cancel of activation ${orderId}`,
    );
  },
};
