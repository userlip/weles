// Raising a session's browser window for the person who has to act in it
// (a manual sign-in). The page is brought to front through the browser; on
// macOS, Chromium is also activated through the system, and a refusal there
// is reported with what macOS answered.

import { spawnSync } from 'node:child_process';

function activateChromium(label, script) {
  const run = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  if (run.error || run.status)
    console.log(
      `[${label}] could not raise Chromium: ${run.error ? run.error.message : run.stderr.trim()}`,
    );
}

export async function bringBrowserToFront(s, label) {
  await s.page.bringToFront();
  if (process.platform !== 'darwin') return;
  activateChromium(label, 'tell application "Chromium" to activate');
  activateChromium(
    label,
    'tell application "System Events" to set frontmost of every process whose name is "Chromium" to true',
  );
}
