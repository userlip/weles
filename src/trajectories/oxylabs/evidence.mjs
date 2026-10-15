// Where an Oxylabs purchase leaves its evidence: a full-page screenshot of
// each step and the page text beside them, in the run's own recordings. A
// screenshot that cannot be taken fails the step, so the evidence the run
// names is evidence that exists.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';

/** The evidence directory of the run labelled `label`, and its recorders. */
export function purchaseEvidence(label) {
  const dir = runRecordingsDir(label);
  mkdirSync(dir, { recursive: true });
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const shot = async (s, name) => {
    const path = join(dir, `${stamp()}_${name}.png`);
    await s.page.screenshot({ path, fullPage: true });
    console.log(`[shot] ${path}`);
    return path;
  };
  return { dir, stamp, shot };
}
