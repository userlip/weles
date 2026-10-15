// What every SMS provider Weles rents numbers from answers, and the one way
// a provider's HTTP answer is read.

export type SmsProviderName = 'juicysms' | 'smsactivate';

/** A number a provider rented: its digits as the provider gave them, and the order that receives its SMS. */
export interface RentedOrder {
  phone: string;
  orderId: string;
}

/** A provider that holds no number for the service and country, in its own words. */
export interface Unavailable {
  unavailable: string;
}

/** One reading of an order: the code the provider holds, or its answer while the SMS has not arrived. */
export type SmsReading = { code: string } | { waiting: string };

export interface SmsProvider {
  readonly name: SmsProviderName;
  /** Whether Skarbiec holds this provider's API key. */
  configured(): boolean;
  rent(service: string, country: string): Promise<RentedOrder | Unavailable>;
  read(orderId: string): Promise<SmsReading>;
  /** Release the order; a cancel the provider does not take throws, since it leaves a paid number held. */
  cancel(orderId: string): Promise<void>;
}

/**
 * The text a provider answered `url` with. A request that fails or is
 * refused throws with `label` and the cause or HTTP status; the URL carries
 * the API key, so only `label` is quoted.
 */
export async function providerAnswer(url: string, label: string): Promise<string> {
  const response = await fetch(url).catch((error: Error) => {
    throw new Error(`${label} failed: ${error.message}`, { cause: error });
  });
  const text = (await response.text()).trim();
  if (!response.ok) throw new Error(`${label} answered HTTP ${response.status}: ${text}`);
  return text;
}

/**
 * The code a provider handed over, digits only: Instagram (and some other
 * services) formats it as '490 315'. An answer with no digits is refused
 * with what the provider said.
 */
export function codeDigits(provider: SmsProviderName, orderId: string, answer: string, carried: string): string {
  const code = carried.replace(/\D/g, '');
  if (!code) throw new Error(`sms_${provider}_unreadable: order ${orderId} answered ${answer}`);
  return code;
}
