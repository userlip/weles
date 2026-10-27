/**
 * Do the User-Agent Client Hints agree with the build and the CPU they claim?
 *
 * Client hints are a structured restatement of the User-Agent, and that
 * structure is exactly what makes them brittle to forge: the brand list has a
 * deterministic, version-keyed order that a hand-written override gets wrong,
 * and the platform/architecture pair has to survive being cross-checked
 * against the GPU string.
 *
 * This family tracks the Chromium client-hints specification and Chromium's
 * own GREASE ordering. It moves when Chrome ships a new brand-list algorithm
 * or a new architecture token — an upstream schedule that has nothing to do
 * with the automation tells in the navigator family next door.
 */

import type { DetectionRule } from '../finding.js';

/** The platforms whose personas run on x86. */
const X86_PLATFORMS: Record<string, true> = { windows: true, linux: true };

/** A client hint as lowercase text; null when the page did not report it. */
function loweredHint(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.toLowerCase();
}

export const clientHintsRules: DetectionRule[] = [
  // ---------------------------------------------------------------------------
  // Client Hints / userAgentData
  // ---------------------------------------------------------------------------
  {
    id: 'uad_brand_order',
    name: 'Sec-CH-UA brand order',
    category: 'navigator',
    severity: 'critical',
    test(s, b) {
      const sBrands = s?.js?.userAgentData?.brands;
      const bBrands = b?.js?.userAgentData?.brands;
      if (!Array.isArray(sBrands) || !Array.isArray(bBrands)) return null;
      const sOrder = sBrands.map((x: any) => x?.brand).join('|');
      const bOrder = bBrands.map((x: any) => x?.brand).join('|');
      if (sOrder && bOrder && sOrder !== bOrder) {
        return {
          id: 'uad_brand_order',
          category: 'navigator',
          severity: 'critical',
          message: `Sec-CH-UA brand order is wrong (${sOrder} vs ${bOrder}). Real Chrome uses a deterministic, version-keyed order.`,
          evidence: { subjectBrands: sBrands, baselineBrands: bBrands },
        };
      }
      return null;
    },
  },
  {
    id: 'uad_platform_arch',
    name: 'Client-hints platform/architecture inconsistency',
    category: 'inconsistency',
    severity: 'critical',
    test(s) {
      const uad = s?.js?.userAgentData;
      if (!uad) return null;
      // A hint the page did not report cannot be inconsistent: architecture is a
      // high-entropy hint, absent unless requested, and is not judged as ''.
      const platform = loweredHint(uad.platform);
      const arch = loweredHint(uad.architecture);
      if (platform === null || arch === null) return null;
      const renderer = loweredHint(s?.js?.webgl1?.params?.UNMASKED_RENDERER);
      // Apple Silicon GPU must report arm arch on macOS.
      if (
        platform === 'macos' &&
        renderer !== null &&
        renderer.includes('apple') &&
        arch !== 'arm'
      ) {
        return {
          id: 'uad_platform_arch',
          category: 'inconsistency',
          severity: 'critical',
          message: `macOS + Apple GPU but client-hints architecture is '${arch}' (expected 'arm').`,
          evidence: {
            platform,
            architecture: arch,
            renderer: s?.js?.webgl?.unmaskedRenderer,
          },
        };
      }
      // Windows/Linux personas should be x86.
      if (Object.hasOwn(X86_PLATFORMS, platform) && arch !== 'x86') {
        return {
          id: 'uad_platform_arch',
          category: 'inconsistency',
          severity: 'warning',
          message: `${platform} client-hints architecture is '${arch}' (expected 'x86').`,
          evidence: { platform, architecture: arch },
        };
      }
      return null;
    },
  },
];
