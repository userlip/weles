// The video a launched context records, and the recordings store's budget.
// The frame size is WELES_VIDEO_SIZE=<width>x<height> when stated, else
// Playwright's own (the viewport scaled to fit 800x800); a large frame makes
// every canvas repaint a multi-megabyte RGBA write over the video pipe. The
// store is pruned, oldest run first, to WELES_RECORDINGS_MAX_BYTES when that
// is stated; unstated, nothing is pruned and the launch says so.

import { pruneRecordings } from '../../../runtime/prune.js';
import {
  recordingsBase,
  runRecordingsDir,
} from '../../../session/run-recordings.js';

export interface RecordVideo {
  dir: string;
  size?: { width: number; height: number };
}

/** The recordVideo option of a context that records, after pruning the store to its stated budget. */
export function recordVideoOption(): RecordVideo {
  const dir = runRecordingsDir(); // G17: recordings/<run_uuid>/<action>/
  const stated = process.env.WELES_VIDEO_SIZE?.trim();
  let size: RecordVideo['size'];
  if (stated) {
    const frame = stated.match(/^(?<width>\d+)x(?<height>\d+)$/)?.groups;
    if (!frame)
      throw new Error(
        `WELES_VIDEO_SIZE is ${JSON.stringify(stated)}, not <width>x<height>`,
      );
    size = { width: Number(frame.width), height: Number(frame.height) };
  }
  // The budget belongs to the store, not to this run; oldest-first deletion
  // leaves the run that is starting alone.
  const budget = process.env.WELES_RECORDINGS_MAX_BYTES?.trim();
  if (!budget) {
    console.error(
      `[recordings-prune] WELES_RECORDINGS_MAX_BYTES is not set, so the recordings store ${recordingsBase()} is not pruned`,
    );
  } else if (!/^\d+$/.test(budget)) {
    throw new Error(
      `WELES_RECORDINGS_MAX_BYTES is ${JSON.stringify(budget)}, not a whole number of bytes`,
    );
  } else {
    // The run still starts; what pruning could not examine or remove is said,
    // so a host that keeps filling has its cause on stderr.
    for (const failure of pruneRecordings(recordingsBase(), Number(budget)))
      console.error(`[recordings-prune] ${failure}`);
  }
  return size ? { dir, size } : { dir };
}
