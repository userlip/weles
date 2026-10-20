// The size and scale of the browser window a launch opens, and whether the
// fingerprint reports the host's real screen. Every size comes from what was
// stated (WELES_VIEWPORT) or measured (the persona's sampled screen, the
// host's screen), never from a default.

import type { Persona } from '../../persona.js';
import type { RuntimeFingerprintConfig } from '../support.js';

/**
 * Whether the fingerprint reports the host's real screen: WELES_HONEST_SCREEN
 * is 1 (yes) or 0 (no); unset, a headed browser reports it and a headless one,
 * whose window is its screen, does not. Any other value is refused by name.
 */
export function honestScreenEnabled(headless: boolean): boolean {
  const stated = process.env.WELES_HONEST_SCREEN?.trim();
  if (!stated) return !headless;
  if (stated === '1') return true;
  if (stated === '0') return false;
  throw new Error(
    `WELES_HONEST_SCREEN is ${JSON.stringify(stated)}: it is 1 (report the host screen) or 0 (report the persona's); unset, a headed browser reports the host screen`,
  );
}

export interface LaunchWindow {
  width: number;
  height: number;
  dpr: number;
}

/**
 * The window the launch opens: WELES_VIEWPORT=<width>x<height>, else the
 * persona's screen, else the honest host's available area, capped to the
 * host's available area when the fingerprint reports the host screen (a
 * window larger than its screen is a tell). Its scale is the host panel's,
 * else the persona's, else the sampled fingerprint's. A headless Chromium's
 * screen is its window.
 */
export function launchWindow(input: {
  fpConfig: RuntimeFingerprintConfig;
  persona: Persona | undefined;
  headless: boolean;
  isChromium: boolean;
}): LaunchWindow {
  const { fpConfig, persona, headless, isChromium } = input;
  const host = honestScreenEnabled(headless)
    ? fpConfig._honestHost?.screen
    : undefined;
  const viewport = process.env.WELES_VIEWPORT?.match(
    /^(?<width>\d+)x(?<height>\d+)$/,
  )?.groups;
  const stated = viewport
    ? { width: Number(viewport.width), height: Number(viewport.height) }
    : (persona?.screen ??
      (host ? { width: host.availWidth, height: host.availHeight } : null));
  if (!stated)
    throw new Error(
      'the browser window has no size: set WELES_VIEWPORT=<width>x<height>, give the session a persona, or let Weles read the host screen (WELES_HONEST_SCREEN on, honest host enabled)',
    );
  const width = host ? Math.min(stated.width, host.availWidth) : stated.width;
  const height = host
    ? Math.min(stated.height, host.availHeight)
    : stated.height;
  // DPR must match the real panel (honest-host) so deviceScaleFactor renders at
  // the true scale — a window claiming DPR 1 while screen reports DPR 2 (or the
  // canvas/pixel-hash renders at the wrong scale) is a tell.
  const dpr =
    host?.dpr ?? persona?.screen.dpr ?? fpConfig.window.devicePixelRatio;
  if (headless && isChromium) {
    fpConfig.screen = {
      ...fpConfig.screen,
      width,
      height,
      availWidth: width,
      availHeight: height,
    };
    fpConfig.window = {
      ...fpConfig.window,
      devicePixelRatio: dpr,
      outerWidth: width,
      outerHeight: height,
      innerWidth: width,
      innerHeight: height,
    };
  }
  return { width, height, dpr };
}
