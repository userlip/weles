// One numbered step of a WSession: logged as it starts and ends, with the
// page's state before, after or at the error kept as step artifacts (unless
// the run is a credential task or asks for no instrumentation), and a
// credential the step revealed stored at once during a credential task.
import type { WSession } from '../wsession.js';
import { captureStepArtifacts } from '../wsession/run-provenance/step-artifacts.js';
import { wsAutoStoreCredential } from '../wsession-helpers/credential/store.js';

/** The members of WSession a step reads and writes. */
export interface StepState {
  page: any;
  _steps: string[];
  _secureCredentialTask: boolean;
  _storedCredentialReceipt: string | null;
  _instCheckpoints?: { checkpoint(label: string): Promise<void> };
}

/** What a step's log line says of the page it starts on. */
function describePage(page: any): string {
  if (typeof page.url !== 'function') return 'on a page with no url reader';
  const viewport = page.viewportSize();
  const size = viewport ? `${viewport.width}x${viewport.height}` : 'unset';
  return `url=${page.url()} closed=${page.isClosed()} viewport=${size}`;
}

export async function runSessionStep<T>(
  s: WSession,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const state = s as unknown as StepState;
  // Files of a step are named by its number, which is short and unique; the
  // log line pairs that number with the whole step name, so no name is cut
  // to fit a file name.
  const n = String(state._steps.push(name));
  const label = `${n}_${name.replace(/[^a-z\d]/gi, '_')}`;
  const retainStepArtifacts =
    !state._secureCredentialTask &&
    process.env.WELES_NO_INSTRUMENT !== '1' &&
    process.env.WELES_BROWSER_EVIDENCE_POLICY !== 'spis-browser-evidence.1';
  console.log(`[wsession] ${label} START ${describePage(state.page)}`);
  if (retainStepArtifacts) await captureStepArtifacts(s, 'before', n);
  try {
    const result = await fn();
    if (state._secureCredentialTask) {
      const stored = await wsAutoStoreCredential(s);
      if (stored) state._storedCredentialReceipt = stored;
    }
    console.log(`[wsession] ${label} OK result=${String(result)}`);
    if (retainStepArtifacts) await captureStepArtifacts(s, 'after', n);
    return result;
  } catch (error) {
    console.log(`[wsession] ${label} ERROR ${(error as Error).message}`);
    if (retainStepArtifacts) await captureStepArtifacts(s, 'error', n, error);
    throw error;
  } finally {
    await state._instCheckpoints?.checkpoint(`step:${label}`);
  }
}
