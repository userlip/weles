// The browser-evidence guards on every page of a context: a JavaScript dialog
// is dismissed and a download cancelled, each kept in the ledger, and a
// dismissal or cancellation that failed is kept beside it by name.
import type { BrowserContext, Page } from 'playwright';
import { describeEdgeFailure, recordEdge, safeText } from './withheld-ledger.js';

export function attachPageEdgeGuards(context: BrowserContext, label: string): void {
  const attach = (page: Page) => {
    page.on('dialog', async (dialog) => {
      recordEdge(label, {
        category: 'browser_dialog',
        reason: 'JavaScript dialog automatically dismissed',
        source: 'browser_context',
        dialogType: safeText(dialog.type()),
        message: safeText(dialog.message()),
        url: safeText(page.url()),
      });
      try {
        await dialog.dismiss();
      } catch (error) {
        // A dialog that would not close is a state of the page: the run goes on
        // against a page that still holds a modal, and the ledger says so.
        recordEdge(label, {
          category: 'browser_dialog_undismissed',
          reason: `JavaScript dialog stayed open because dismissal failed: ${describeEdgeFailure(error)}`,
          source: 'browser_context',
          dialogType: safeText(dialog.type()),
          message: safeText(dialog.message()),
          url: safeText(page.url()),
        });
      }
    });
    page.on('download', async (download) => {
      recordEdge(label, {
        category: 'system_ui_download',
        reason: 'download cancelled before persistence or system UI',
        source: 'browser_context',
        suggestedFilename: safeText(download.suggestedFilename()),
        url: safeText(download.url()),
      });
      try {
        await download.cancel();
      } catch (error) {
        // The cancellation edge above claims the download never persisted; a
        // failed cancellation withdraws that claim by name.
        recordEdge(label, {
          category: 'system_ui_download_uncancelled',
          reason: `download was not cancelled: ${describeEdgeFailure(error)}`,
          source: 'browser_context',
          suggestedFilename: safeText(download.suggestedFilename()),
          url: safeText(download.url()),
        });
      }
    });
  };
  context.pages().forEach(attach);
  context.on('page', attach);
}
