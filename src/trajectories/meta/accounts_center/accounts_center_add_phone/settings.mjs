// The environment the Accounts Center phone step runs with: the kept Meta
// profile, the phone (META_VERIFY_PHONE, required), the SMS code when it is
// known (META_VERIFY_CODE) and whether this run only submits that code
// (META_VERIFY_CODE_ONLY=1).
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { keptProfileDir } from '../../../_shared/profile/persona.mjs';

export const USER_DATA_DIR = keptProfileDir('meta_ads');
export const VERIFY_PHONE = statedText(['META_VERIFY_PHONE'], 'the phone number added in Accounts Center');
export const VERIFY_CODE = process.env.META_VERIFY_CODE;
export const CODE_ONLY = process.env.META_VERIFY_CODE_ONLY === '1';
