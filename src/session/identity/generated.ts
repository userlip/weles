// The identity a register session generates: each value is put in the
// session's $<PLATFORM>_NEW_<FIELD> placeholders, and a page field asked for
// by its name takes the matching value without the value passing through a
// model's tool arguments.
import type { Identity } from '../../utils/identity/identity.js';

/** The identity fields a page field can ask for, by the name the agent tool uses. */
export type IdentityField =
  | 'email'
  | 'password'
  | 'username'
  | 'first_name'
  | 'last_name'
  | 'birth_month'
  | 'birth_day'
  | 'birth_year';

const FIELD_KEYS: Record<IdentityField, keyof Identity> = {
  email: 'email',
  password: 'password',
  username: 'username',
  first_name: 'firstName',
  last_name: 'lastName',
  birth_month: 'birthMonth',
  birth_day: 'birthDay',
  birth_year: 'birthYear',
};

/** The placeholder suffix each identity value is kept under. */
const PLACEHOLDERS: Record<keyof Identity, string> = {
  username: 'USERNAME',
  email: 'EMAIL',
  password: 'PASSWORD',
  firstName: 'FIRSTNAME',
  lastName: 'LASTNAME',
  birthMonth: 'BIRTHMONTH',
  birthDay: 'BIRTHDAY',
  birthYear: 'BIRTHYEAR',
};

/** The value of `identity` a field of the named kind takes. */
export function identityValue(identity: Identity, field: IdentityField): string {
  return identity[FIELD_KEYS[field]];
}

/** Put each value of `identity` into `env` as $<PLATFORM>_NEW_<FIELD>. */
export function keepIdentity(env: Record<string, string>, platform: string, identity: Identity): void {
  const prefix = platform.toUpperCase();
  for (const [key, suffix] of Object.entries(PLACEHOLDERS) as [keyof Identity, string][])
    env[`${prefix}_NEW_${suffix}`] = identity[key];
}
