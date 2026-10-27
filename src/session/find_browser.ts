// Resolve only a checksum-verified, selected Weles browser release.
//
// Which release is selected comes from the deployment when it pins one
// (WELES_<BROWSER>_RELEASE_VERSION and _SHA256, both set), else from the
// host's own selection: the weles-chromium Stado delivery (weles-chromium
// release/install.sh) installs the exact coordinate, writes its receipt after
// verifying the archive checksum and executable layout, and records the
// release it verified in <install root>/selected (version=, sha256=). The
// executable is used only when its receipt matches that selection; anything
// else is refused with what was missing or did not match.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface BrowserLayout {
  envDir: string;
  envVersion: string;
  envSha256: string;
  installDirName: string;
  product: string;
  asset: string;
  appSubpath: string;
}

const LAYOUTS: Record<string, BrowserLayout> = {
  chromium: {
    envDir: 'WELES_CHROMIUM_DIR',
    envVersion: 'WELES_CHROMIUM_RELEASE_VERSION',
    envSha256: 'WELES_CHROMIUM_RELEASE_SHA256',
    installDirName: 'weles-chromium',
    product: 'weles-chromium',
    // Stado publishes every platform archive of a release as release.tar.gz
    // under the product's coordinate.
    asset: 'release.tar.gz',
    appSubpath:
      process.platform === 'darwin'
        ? 'Chromium.app/Contents/MacOS/Chromium'
        : 'chromium/chrome',
  },
  firefox: {
    envDir: 'WELES_FIREFOX_DIR',
    envVersion: 'WELES_FIREFOX_RELEASE_VERSION',
    envSha256: 'WELES_FIREFOX_RELEASE_SHA256',
    installDirName: 'weles-firefox',
    product: 'weles-firefox',
    asset: 'release.tar.gz',
    appSubpath:
      process.platform === 'darwin'
        ? 'Firefox.app/Contents/MacOS/firefox'
        : 'firefox/firefox',
  },
};

/** The browser families Weles launches from a selected Stado release. */
export const RELEASED_BROWSERS = Object.keys(LAYOUTS);

const HEX_PAIR_PATTERN = '[a-f\\d][a-f\\d]';
const HEX_QUAD_PATTERN = `${HEX_PAIR_PATTERN}${HEX_PAIR_PATTERN}`;
const HEX_OCTET_PATTERN = `${HEX_QUAD_PATTERN}${HEX_QUAD_PATTERN}`;
const HEX_BLOCK_PATTERN = `${HEX_OCTET_PATTERN}${HEX_OCTET_PATTERN}${HEX_OCTET_PATTERN}${HEX_OCTET_PATTERN}`;
const SHA256_PATTERN = new RegExp(`^${HEX_BLOCK_PATTERN}${HEX_BLOCK_PATTERN}$`);
const SELECTION_FILE = 'selected';

/** A verified executable, or the reason none can be used. */
type Located = { binary: string } | { refusal: string };

function releasePlatform(): string | undefined {
  if (process.platform === 'darwin' && process.arch === 'arm64')
    return 'darwin-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64')
    return 'darwin-amd64';
  if (process.platform === 'linux' && process.arch === 'x64')
    return 'linux-amd64';
  return undefined;
}

function installRoot(layout: BrowserLayout): string | { refusal: string } {
  const declared = process.env[layout.envDir]?.trim();
  if (declared) return declared;
  const home = process.env.HOME?.trim();
  if (!home) return { refusal: `${layout.envDir} and HOME are not set` };
  return join(home, '.local/share', layout.installDirName);
}

/** The selected release: the deployment's pin when it sets both values, else the host's selection record. */
function selection(
  layout: BrowserLayout,
  root: string,
): { version: string; digest: string } | { refusal: string } {
  const version = process.env[layout.envVersion]?.trim();
  const digest = process.env[layout.envSha256]?.trim().toLowerCase();
  if (version && digest) return { version, digest };
  if (version || digest)
    return {
      refusal: `the deployment pins only one of ${layout.envVersion} and ${layout.envSha256}`,
    };
  const record = join(root, SELECTION_FILE);
  if (!existsSync(record))
    return {
      refusal: `no ${layout.product} release is selected: neither ${layout.envVersion}/${layout.envSha256} nor ${record} names one`,
    };
  const fields = new Map(
    readFileSync(record, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, ...value] = line.split('=');
        return [key, value.join('=')] as const;
      }),
  );
  const recorded = {
    version: fields.get('version'),
    digest: fields.get('sha256'),
  };
  if (!recorded.version || !recorded.digest)
    return {
      refusal: `${record} names no version and sha256 (it reads ${JSON.stringify(Object.fromEntries(fields))})`,
    };
  return { version: recorded.version, digest: recorded.digest.toLowerCase() };
}

/** The version of the selected `browser` release; throws why none is selected. */
export function selectedBrowserVersion(browser: string): string {
  const layout = LAYOUTS[browser];
  if (!layout) throw new Error(`unknown browser family "${browser}"`);
  const root = installRoot(layout);
  if (typeof root !== 'string') throw new Error(root.refusal);
  const selected = selection(layout, root);
  if ('refusal' in selected) throw new Error(selected.refusal);
  return selected.version;
}

function locateBrowser(browser: string): Located {
  const layout = LAYOUTS[browser];
  if (!layout) return { refusal: `unknown browser family "${browser}"` };
  const platform = releasePlatform();
  if (!platform)
    return {
      refusal: `unsupported browser release platform ${process.platform}-${process.arch}`,
    };
  const root = installRoot(layout);
  if (typeof root !== 'string') return root;
  const selected = selection(layout, root);
  if ('refusal' in selected) return selected;
  if (!SHA256_PATTERN.test(selected.digest))
    return {
      refusal: `the selected ${layout.product} release names ${selected.digest}, not a SHA-256 digest`,
    };
  const installDir = join(root, selected.version);
  const binary = join(installDir, layout.appSubpath);
  const receiptPath = join(installDir, '.weles-release');
  const releaseUri = `stado://releases/${layout.product}/${selected.version}/${platform}/${layout.asset}`;
  const expectedReceipt = `release_uri=${releaseUri}\narchive_sha256=${selected.digest}\nplatform=${platform}\n`;
  if (!existsSync(binary))
    return {
      refusal: `the selected ${layout.product} release has no executable at ${binary}`,
    };
  if (!statSync(binary).isFile())
    return { refusal: `browser executable is not a file: ${binary}` };
  if (!existsSync(receiptPath))
    return {
      refusal: `the selected ${layout.product} release has no receipt at ${receiptPath}`,
    };
  const receipt = readFileSync(receiptPath, 'utf8');
  if (receipt !== expectedReceipt)
    return {
      refusal: `browser release receipt ${receiptPath} does not match the selected release: expected ${JSON.stringify(expectedReceipt)}; observed ${JSON.stringify(receipt)}`,
    };
  return { binary };
}

/**
 * The selected browser's executable, only when its verified release receipt
 * matches the selected immutable Stado coordinate and checksum; undefined
 * otherwise (customBrowserSearchHint says why).
 */
export function findCustomBrowser(browser: string): string | undefined {
  const located = locateBrowser(browser);
  return 'binary' in located ? located.binary : undefined;
}

/** The selected browser's executable, or why none can be used and how to install it. */
export function customBrowserSearchHint(browser: string): string {
  const located = locateBrowser(browser);
  if ('binary' in located)
    return `verified browser executable: ${located.binary}`;
  return `${located.refusal}; install the selected browser release through Stado`;
}

export function findCustomChromium(): string | undefined {
  return findCustomBrowser('chromium');
}
