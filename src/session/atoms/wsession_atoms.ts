/**
 * Shared interaction atoms on WSession. Added via prototype augmentation so
 * wsession.ts stays under its 300-line cap. Each atom replaces a pattern
 * duplicated 5+ times across trajectories (see docs/DETECTION_ANTIPATTERNS.md).
 *
 * wsession.ts calls installAtoms(WSession) at the bottom of its module so
 * the class is fully defined before prototype assignment runs. Side-effect
 * import was the previous shape but breaks under CJS circular load.
 */
import type { WSession } from '../wsession.js';
import { updateAccount } from '../../state/skarbiec-records.js';

declare module '../wsession.js' {
  interface WSession {
    waitFor(
      selector: string,
      opts: { state: 'attached' | 'visible' | 'hidden' | 'detached' },
    ): Promise<string>;
    fillSelector(css: string, value: string): Promise<string>;
    patchAccount(
      accountId: string,
      patch: Record<string, unknown>,
    ): Promise<boolean>;
  }
}

export function installAtoms(
  W: typeof import('../wsession.js').WSession,
): void {
  W.prototype.waitFor = function (selector, opts) {
    const { state } = opts;
    return this.runStep(`waitFor_${selector}`, async () => {
      try {
        await (this as WSession).page
          .locator(selector)
          .first()
          .waitFor({ state });
      } catch (error) {
        throw new Error(
          `waiting for ${selector} to become ${state} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return `waited ${state}: ${selector}`;
    });
  };

  W.prototype.fillSelector = function (css, value) {
    return this.runStep(`fillSel_${css}`, async () => {
      const v = (this as WSession).resolveEnv(value);
      const loc = (this as WSession).page.locator(css).first();
      if (!(await loc.count()))
        throw new Error(
          `no element matches ${css} on ${(this as WSession).page.url()}; nothing was filled`,
        );
      await loc.fill(v);
      return `filled ${css}`;
    });
  };

  W.prototype.patchAccount = async function (accountId, patch) {
    if (!accountId) return false;
    // A failed update is thrown with its account and cause: the callers store
    // a freshly issued token here and do not read the result.
    const metadata =
      patch.metadata && typeof patch.metadata === 'object'
        ? (patch.metadata as Record<string, unknown>)
        : undefined;
    const active =
      typeof patch.is_active === 'boolean' ? patch.is_active : undefined;
    try {
      return await updateAccount(accountId, { metadata, active });
    } catch (error) {
      throw new Error(
        `account ${accountId} was not updated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
