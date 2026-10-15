// PerimeterX localStorage persistence for LinkedIn: the account's selected
// browser storage keys are kept in its Skarbiec record and restored into the
// next session, so PerimeterX sees a returning visitor instead of a cold one.
//
// Keys captured (matched by one pattern):
//   PXdOjV695v_*  PerimeterX visitor id, fingerprint, high-value detection
//   pxsid         PX session id
//   _pxvid        alternate visitor-id key (some PX deployments)
//   px_* / _px_*  PX cookie-mirror keys (px_ssd, _px_acp, ...)
//   rc::*         reCAPTCHA Enterprise client state
//   _grecaptcha   grecaptcha enterprise marker
//
// A storage the page refuses to read or write, or a record that cannot be
// updated, fails the step with its cause.

import { updateAccountMetadata } from '../../skarbiec/accounts.mjs';

const PX_LS_KEY_RE = /^(PXdOjV695v_|_pxvid|pxsid|_?px_|rc::|_grecaptcha)/;

/** Keeps the page's PX storage keys in `acct`'s record; answers the keys kept. */
export async function captureLinkedinPxStorage(s, acct) {
  if (!acct.id) throw new Error(`LINKEDIN_PX_ACCOUNT_UNIDENTIFIED: ${acct.username} has no Skarbiec id to keep its PX storage under`);
  const items = await s.page.evaluate((pattern) => {
    const keys = new RegExp(pattern);
    return Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => keys.test(key))
        .map((key) => [key, localStorage.getItem(key)]),
    );
  }, PX_LS_KEY_RE.source);
  const keys = Object.keys(items);
  if (!keys.length) {
    console.log('[linkedin_login] the page holds no PX storage to keep');
    return { keys };
  }
  const merged = {
    ...acct.metadata,
    linkedin_px_storage: items,
    linkedin_px_storage_at: new Date().toISOString(),
  };
  updateAccountMetadata(acct.id, merged);
  acct.metadata = merged;
  console.log(`[linkedin_login] kept ${keys.length} PX storage keys`);
  return { keys };
}

/** Writes `acct`'s kept PX storage into the page; answers the keys restored. */
export async function restoreLinkedinPxStorage(s, acct) {
  const stored = acct.metadata?.linkedin_px_storage;
  if (!stored) return { keys: [] };
  if (typeof stored !== 'object')
    throw new Error(`LINKEDIN_PX_STORAGE_MALFORMED: ${acct.username}'s kept PX storage is not an object`);
  await s.page.evaluate((kv) => {
    for (const [key, value] of Object.entries(kv)) localStorage.setItem(key, String(value));
  }, stored);
  const keys = Object.keys(stored);
  console.log(`[linkedin_login] restored ${keys.length} PX storage keys`);
  return { keys };
}
