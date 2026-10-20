// The device a persona presents (operating system, browser engine, screen,
// GPU, cores and memory), sampled from fingerprint-generator's dataset of real
// desktop browsers. One sample supplies every field, so the combination is one
// the dataset observed, and the operating-system and browser shares are the
// dataset's own when the caller does not force them: every desktop system,
// and every engine Weles launches from a selected release.

import { FingerprintGenerator } from 'fingerprint-generator';
import type { BrowserName } from 'header-generator';
import { PLATFORM_MAP } from '../../fingerprint/chromium.js';
import { RELEASED_BROWSERS } from '../../session/find_browser.js';

export type PersonaOs = 'macos' | 'windows' | 'linux';
export type PersonaBrowser = 'chromium' | 'firefox' | 'webkit';

export interface PersonaDevice {
  os: PersonaOs;
  browser: PersonaBrowser;
  /** The full Chrome version of a Chromium sample's user-agent data. */
  chromeVersion?: string;
  /** The platform token of the sampled user agent, e.g. `Windows NT 10.0; Win64; x64`. */
  userAgentOs: string;
  platform: string;
  gpu: { vendor: string; renderer: string };
  screen: { width: number; height: number; dpr: number };
  hardwareConcurrency: number;
  // Optional navigator.deviceMemory override. When absent, the browser build
  // supplies its own value.
  deviceMemory?: number;
}

/** The operating system whose declared navigator.platform the sample reports. */
function systemOf(platform: string): PersonaOs {
  const declared = Object.entries(PLATFORM_MAP).find(
    ([, value]) => value === platform,
  );
  if (!declared)
    throw new Error(
      `persona_device_unreadable: the sampled navigator.platform ${JSON.stringify(platform)} is none of the declared ${JSON.stringify(PLATFORM_MAP)}`,
    );
  const [system] = declared;
  return system as PersonaOs;
}

/**
 * The engine of a sampled navigator, read from what each engine exposes:
 * user-agent client hints only in Chromium, navigator.oscpu only in Gecko.
 */
function engineOf(nav: {
  userAgentData: unknown;
  oscpu?: string;
}): PersonaBrowser {
  if (nav.userAgentData) return 'chromium';
  if (nav.oscpu) return 'firefox';
  return 'webkit';
}

/** One desktop device from the dataset, of `os` and `browser` when forced. */
export function sampleDevice(opts: {
  os?: PersonaOs;
  browser?: PersonaBrowser;
}): PersonaDevice {
  const families = opts.browser ? [opts.browser] : RELEASED_BROWSERS;
  const { fingerprint } = new FingerprintGenerator({
    // The dataset names Weles's Chromium family by its Chrome browser; the
    // generator refuses a family its dataset does not hold.
    browsers: families.map(
      (family) => (family === 'chromium' ? 'chrome' : family) as BrowserName,
    ),
    ...(opts.os ? { operatingSystems: [opts.os] } : {}),
    devices: ['desktop'],
  }).getFingerprint();
  const nav = fingerprint.navigator;
  const userAgentOs = nav.userAgent.match(
    /^Mozilla\/[\d.]+ \((?<token>[^)]+?)(?:; rv:[\d.]+)?\)/,
  )?.groups?.token;
  if (!userAgentOs)
    throw new Error(
      `persona_device_unreadable: the sampled user agent ${JSON.stringify(nav.userAgent)} carries no platform token`,
    );
  const chromeVersion = nav.userAgentData?.uaFullVersion;
  return {
    os: opts.os ?? systemOf(nav.platform),
    browser: opts.browser ?? engineOf(nav),
    ...(chromeVersion ? { chromeVersion } : {}),
    userAgentOs,
    platform: nav.platform,
    gpu: {
      vendor: fingerprint.videoCard.vendor,
      renderer: fingerprint.videoCard.renderer,
    },
    screen: {
      width: fingerprint.screen.width,
      height: fingerprint.screen.height,
      dpr: fingerprint.screen.devicePixelRatio,
    },
    hardwareConcurrency: nav.hardwareConcurrency,
    ...(nav.deviceMemory ? { deviceMemory: nav.deviceMemory } : {}),
  };
}
