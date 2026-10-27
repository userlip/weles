/**
 * Rented phone numbers and the codes texted to them, from the SMS providers
 * whose API keys Skarbiec holds (./sms-providers): JuicySMS first, then
 * SMS-Activate. A number is only rented in the country asked for. Each
 * provider that holds no number says why in its own words, and a run that
 * gets no number is refused with every provider's answer.
 */

import { costTracker } from '../runtime/cost.js';
import { juicySms } from './sms-providers/juicysms.js';
import type { SmsProvider, SmsProviderName } from './sms-providers/protocol.js';
import { smsActivate } from './sms-providers/smsactivate.js';

const PROVIDERS: SmsProvider[] = [juicySms, smsActivate];

// Each supported country's calling code.
const COUNTRY_PREFIX: Record<string, string> = {
  US: '+1',
  UK: '+44',
  CA: '+1',
  NL: '+31',
  DE: '+49',
};
// The national trunk prefix a country's numbers may be written with; the
// countries of the North American plan have none.
const TRUNK_PREFIX: Record<string, string> = {
  UK: '0',
  NL: '0',
  DE: '0',
};

export interface SmsNumber {
  phone: string;
  orderId: string;
  provider: SmsProviderName;
  country: string;
}

/** No provider rented a number for the service in the country; `answers` holds what each said. */
export class SmsNumberUnavailable extends Error {
  readonly code = 'SMS_NUMBER_UNAVAILABLE';
  constructor(
    readonly service: string,
    readonly country: string,
    readonly answers: string[],
  ) {
    super(
      `sms_number_unavailable: no ${country} number for ${service}: ${answers.join('; ')}`,
    );
  }
}

/** The number in international form: a national trunk prefix is dropped, and a number the provider gave with its calling code keeps it once. */
function internationalPhone(raw: string, country: string): string {
  const written = raw.replace(/\D/g, '');
  const trunk = TRUNK_PREFIX[country];
  const digits =
    trunk && written.startsWith(trunk) ? written.slice(trunk.length) : written;
  const prefix = COUNTRY_PREFIX[country].replace(/\D/g, '');
  if (digits.startsWith(prefix) && digits.length > prefix.length)
    return `+${digits}`;
  return `+${prefix}${digits}`;
}

function providerOf(order: SmsNumber): SmsProvider {
  const provider = PROVIDERS.find(
    (candidate) => candidate.name === order.provider,
  );
  if (!provider)
    throw new Error(
      `sms_provider_unknown: order ${order.orderId} names ${order.provider}`,
    );
  return provider;
}

/** Rent a number for `service` in `country` from the first configured provider that holds one. */
export async function getNumber(
  service: string,
  country: string,
): Promise<SmsNumber> {
  if (!Object.hasOwn(COUNTRY_PREFIX, country))
    throw new Error(
      `sms_country_unsupported: ${country} has no dialling prefix here; supported: ${Object.keys(COUNTRY_PREFIX).join(', ')}; no number was bought`,
    );
  const configured = PROVIDERS.filter((provider) => provider.configured());
  if (!configured.length)
    throw new SmsNumberUnavailable(service, country, [
      'Skarbiec holds no SMS provider API key',
    ]);
  const answers: string[] = [];
  for (const provider of configured) {
    let rented;
    try {
      rented = await provider.rent(service, country);
    } catch (error) {
      // A provider that fails is one answer; the next configured provider is asked.
      answers.push((error as Error).message);
      continue;
    }
    if ('unavailable' in rented) {
      answers.push(rented.unavailable);
      continue;
    }
    for (const answer of answers)
      console.error(`[sms] before ${provider.name} rented a number: ${answer}`);
    const phone = internationalPhone(rented.phone, country);
    console.log(
      `[sms] ${provider.name}: got ${phone} (order ${rented.orderId}, ${country})`,
    );
    costTracker.recordSms(provider.name, service);
    return { phone, orderId: rented.orderId, provider: provider.name, country };
  }
  throw new SmsNumberUnavailable(service, country, answers);
}

/**
 * The code texted to the rented number, once it arrives. An SMS has no
 * clock that ends its delivery and the providers offer no push or blocking
 * read, so the order is read again as soon as each reading answers, until
 * the provider hands over the code, refuses the order, or the run is
 * cancelled. A provider that fails, or answers a code with no digits, is
 * refused with what it said.
 */
export async function textedCode(order: SmsNumber): Promise<string> {
  const provider = providerOf(order);
  for (;;) {
    const reading = await provider.read(order.orderId);
    if ('code' in reading) {
      console.log(`[sms] code for order ${order.orderId}: ${reading.code}`);
      return reading.code;
    }
  }
}

/** Release the rented number; a cancel the provider does not take throws, since it leaves a paid number held. */
export async function cancelOrder(order: SmsNumber): Promise<void> {
  await providerOf(order).cancel(order.orderId);
}
