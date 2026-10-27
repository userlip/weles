// The host's own browser surface, measured rather than composed: the GPU
// strings, cores, memory, client-hint platform version and screen that the
// same browser build reports on this machine when nothing overrides them.
// Weles lays it over a run whose target system is the host's, since the real
// silicon leaks through the WebGL pixel hash whatever is claimed.

import { platform } from 'node:os';
import { probeHostHardware } from '../browser/launch/context/host-probe.js';

export interface HostScreen {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  availTop: number;
  colorDepth: number;
  dpr: number;
}

/** Chromium's high-entropy client hints as the unconfigured browser answers them. */
export interface HostClientHints {
  platformVersion: string;
  architecture: string;
  bitness: string;
}

export interface HostHardware {
  /** The Weles system name of this host, as personas and options name it. */
  osFamily: string;
  /** The version string of the browser build that was measured. */
  browserVersion: string;
  cores: number;
  /** navigator.deviceMemory; Gecko does not expose it. */
  deviceMemory?: number;
  /** Measured from Chromium only; Gecko does not expose client hints. */
  clientHints?: HostClientHints;
  glUnmaskedVendor: string;
  glRenderer: string;
  /** Measured only from a headed browser; a headless one reports its window. */
  screen?: HostScreen;
}

export interface HostHardwareRequest {
  browserType: string;
  executablePath: string;
  /** Whether the measured screen is wanted, which needs a headed probe. */
  withScreen: boolean;
}

const measured = new Map<string, Promise<HostHardware>>();

/** Honest host is on unless WELES_HONEST_HOST=0 turns it off for this run. */
export function honestHostEnabled(): boolean {
  return process.env.WELES_HONEST_HOST !== '0';
}

/** The Weles system name of this host, or null for a platform Weles has no persona system for. */
export function hostOsFamily(): string | null {
  const host = platform();
  if (host === 'darwin') return 'macos';
  if (host === 'win32') return 'windows';
  if (host === 'linux') return 'linux';
  return null;
}

/**
 * Measures the host surface once per browser build and screen need, and
 * reuses the measurement for every later run in this process. A failed
 * measurement is not kept, so the next run measures again and reports its
 * own failure.
 */
export function hostHardware(
  request: HostHardwareRequest,
): Promise<HostHardware> {
  const osFamily = hostOsFamily();
  if (!osFamily)
    return Promise.reject(
      new Error(
        `WELES_HONEST_HOST_UNSUPPORTED_PLATFORM: honest host has no Weles system for platform ${platform()}; set WELES_HONEST_HOST=0 for runs on this host`,
      ),
    );
  const key = JSON.stringify([
    request.browserType,
    request.executablePath,
    request.withScreen,
  ]);
  const known = measured.get(key);
  if (known) return known;
  const measurement = probeHostHardware({ ...request, osFamily });
  measured.set(key, measurement);
  measurement.catch(() => measured.delete(key));
  return measurement;
}
