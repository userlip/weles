// The browser-evidence policy as the rest of the workshop meets it: what gets
// installed on a browser context before a run may use it, and whether one tool
// call against that context is authorized. The declaration and its ledger, the
// page APIs a run may not reach, the pinned network target and the reading of
// interactive controls live beside this file, because each of them changes for
// its own reasons; the two decisions below are what callers actually ask for.
import type { BrowserContext } from 'playwright';
import type { WSession } from '../session/wsession.js';
import type { ControlDescriptor } from './browser-evidence-policy/interactive-control/descriptors.js';
import { controlDescriptors } from './browser-evidence-policy/interactive-control/descriptors.js';
import {
  ALWAYS_WITHHELD_TOOLS,
  SAFE_PAGE_KEYS,
  classify,
  matchingControl,
  readOnlyForm,
  safeClick,
  targetText,
} from './browser-evidence-policy/interactive-control/admission.js';
import { initScript } from './browser-evidence-policy/page-api-withholding.js';
import {
  assertPublicAddress,
  configuredTarget,
  networkEvidenceUrl,
  publicAddresses,
  resolveBrowserEvidenceTarget,
  sameAddresses,
} from './browser-evidence-policy/pinned-network.js';
import {
  SPIS_BROWSER_EVIDENCE_POLICY,
  describeEdgeFailure,
  enabled,
  recordEdge,
  safeText,
  writeBrowserEvidencePolicy,
} from './browser-evidence-policy/withheld-ledger.js';
import { attachPageEdgeGuards } from './browser-evidence-policy/page-edge-guards.js';

export {
  SPIS_BROWSER_EVIDENCE_POLICY,
  publicAddresses,
  resolveBrowserEvidenceTarget,
  writeBrowserEvidencePolicy,
};

/**
 * Whether `method` reads without changing anything: one the platform's own
 * fetch refuses to send a body with (GET and HEAD); a forbidden one throws.
 */
function readOnlyMethod(method: string): boolean {
  new Request('https://method.invalid/', { method });
  let refusedBody: unknown;
  try {
    new Request('https://method.invalid/', { method, body: 'probe' });
  } catch (error) {
    refusedBody = error;
  }
  return refusedBody instanceof TypeError;
}

export async function installBrowserEvidencePolicy(
  context: BrowserContext,
  label: string,
): Promise<void> {
  if (!enabled()) return;
  const target = configuredTarget();
  const expectedTargetAddresses = [...new Set(target.addresses)].sort();
  expectedTargetAddresses.forEach(assertPublicAddress);
  const currentTargetAddresses = await publicAddresses(target.hostname);
  if (!sameAddresses(expectedTargetAddresses, currentTargetAddresses)) {
    throw new Error(
      'browser-evidence target DNS changed before browser policy installation',
    );
  }
  writeBrowserEvidencePolicy(label);
  await context.clearPermissions();
  await context.routeWebSocket('**/*', (socket) => {
    recordEdge(label, {
      category: 'network_policy',
      reason:
        'WebSocket transport withheld because the browser-evidence boundary permits only pinned HTTP(S)',
      source: 'browser_context',
      url: safeText(socket.url()),
    });
    socket.close();
  });
  // The request's address as the ledger keeps it, or the raw one it could not parse.
  const evidenceUrl = (raw: string) =>
    URL.canParse(raw) ? networkEvidenceUrl(new URL(raw)) : `unparsable: ${safeText(raw)}`;
  await context.route('**/*', async (route, request) => {
    try {
      const requestedUrl = new URL(request.url());
      const isMainNavigation =
        request.isNavigationRequest() && request.frame().parentFrame() === null;
      if (['about:', 'blob:', 'data:'].includes(requestedUrl.protocol)) {
        if (isMainNavigation && requestedUrl.href !== 'about:blank') {
          throw new Error('non-network main-frame navigation denied');
        }
        await route.continue();
        return;
      }
      if (
        !['http:', 'https:'].includes(requestedUrl.protocol) ||
        requestedUrl.username ||
        requestedUrl.password
      ) {
        throw new Error('non-HTTP(S) browser request denied');
      }
      if (!readOnlyMethod(request.method()))
        throw new Error('anonymous browser-evidence network policy permits only methods that carry no body (GET and HEAD)');
      if (requestedUrl.origin !== target.origin)
        throw new Error('browser request left the exact admitted target origin');
      if (!sameAddresses(expectedTargetAddresses, await publicAddresses(target.hostname)))
        throw new Error('target DNS differs from the admitted pinned address set');
      await route.continue();
    } catch (error) {
      recordEdge(label, {
        category: 'network_policy',
        reason: describeEdgeFailure(error),
        source: 'browser_context',
        url: evidenceUrl(request.url()),
      });
      try {
        await route.abort('blockedbyclient');
      } catch (abortError) {
        // A refusal that could not be delivered leaves the request in the
        // browser's hands, so the ledger keeps both facts: what was refused and
        // why the refusal never reached the request.
        recordEdge(label, {
          category: 'network_policy_unenforced',
          reason: `request refusal was not delivered: ${describeEdgeFailure(abortError)}; the refusal was: ${describeEdgeFailure(error)}`,
          source: 'browser_context',
          url: evidenceUrl(request.url()),
        });
      }
    }
  });
  await context.exposeBinding('__welesRecordWithheldEdge', (_source, raw) => {
    const edge = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const category = edge ? safeText(edge.category) : '';
    const api = edge ? safeText(edge.api) : '';
    // The page script reports every withheld call with its category and api;
    // a report without them is kept as itself, not named for it.
    if (!category || !api)
      recordEdge(label, {
        category: 'withheld_edge_report_malformed',
        reason: `the page reported a withheld call without its category and api: ${JSON.stringify(raw)}`,
        source: 'page_api',
      });
    else recordEdge(label, { category, api, source: 'page_api' });
  });
  await context.addInitScript(initScript, SPIS_BROWSER_EVIDENCE_POLICY.version);
  attachPageEdgeGuards(context, label);
}

export type BrowserEvidenceToolAuthorization = {
  invoke: () => Promise<string>;
};

export async function enforceBrowserEvidenceToolPolicy(
  session: WSession,
  tool: string,
  args: Record<string, unknown>,
): Promise<BrowserEvidenceToolAuthorization | null> {
  if (!enabled()) return null;
  const pageUrl = safeText(session.page.url());
  let decision: { category: string; reason: string } | null =
    Object.hasOwn(ALWAYS_WITHHELD_TOOLS, tool) ? ALWAYS_WITHHELD_TOOLS[tool] : null;
  let control: ControlDescriptor | null = null;
  let authorization: BrowserEvidenceToolAuthorization | null = null;
  const text = targetText(tool, args);

  if (!decision && tool === 'navigate') {
    const requested = typeof args.url === 'string' && URL.canParse(args.url) ? new URL(args.url) : null;
    const target = configuredTarget();
    if (!requested)
      decision = { category: 'network_policy', reason: 'navigation URL is invalid or has no admitted target binding' };
    else if (requested.protocol !== 'https:' || requested.username || requested.password || requested.origin !== target.origin)
      decision = { category: 'network_policy', reason: 'navigation left the exact admitted public target origin' };
  }
  if (!decision && tool === 'press_key') {
    const key = typeof args.key === 'string' ? args.key : null;
    if (key && Object.hasOwn(SAFE_PAGE_KEYS, key)) return null;
    // A key press that names no key, or Enter, can submit the active form.
    decision =
      !key || key.toLowerCase() === 'enter'
        ? { category: 'form_submission', reason: 'Enter, or a key press that names no key, is withheld because it can submit the active form' }
        : { category: 'system_ui_keyboard', reason: 'keyboard chord or system-capable key withheld' };
  }

  if (
    !decision &&
    [
      'click',
      'js_click',
      'focus',
      'fill',
      'type_text',
      'select_option',
    ].includes(tool)
  ) {
    const descriptors = await controlDescriptors(session);
    const active = descriptors.find((candidate) => candidate.active);
    control = tool === 'type_text' ? (active ? active : null) : matchingControl(text, descriptors);
    decision = classify(text, control, pageUrl);
    if (!decision && !control) {
      decision = {
        category: 'unresolved_interactive_control',
        reason: 'control did not resolve to one exact fresh element',
      };
    } else if (
      !decision &&
      control &&
      (tool === 'click' || tool === 'js_click')
    ) {
      if (!safeClick(control, pageUrl)) {
        decision = {
          category: 'ambiguous_interactive_control',
          reason:
            'control is not an explicit same-origin link, tab, disclosure, or safe cancellation control',
        };
      } else {
        authorization = {
          invoke: async () => {
            await control!.element.click();
            return `clicked exact browser-evidence control: ${safeText(control!.label)}`;
          },
        };
      }
    } else if (!decision && control && tool === 'focus') {
      authorization = {
        invoke: async () => {
          await control!.element.focus();
          return `focused exact browser-evidence control: ${safeText(control!.label)}`;
        },
      };
    } else if (
      !decision &&
      control &&
      (tool === 'fill' || tool === 'type_text')
    ) {
      const searchControl =
        (control.type === 'search' || control.role === 'searchbox') &&
        readOnlyForm(control, pageUrl);
      if (!searchControl || typeof args.value !== 'string') {
        decision = {
          category: 'ambiguous_input_control',
          reason: 'only exact read-only GET search/filter inputs are permitted',
        };
      } else {
        authorization = {
          invoke: async () => {
            if (tool === 'fill')
              await control!.element.fill(String(args.value));
            else await control!.element.type(String(args.value));
            return `updated exact read-only search control: ${safeText(control!.label)}`;
          },
        };
      }
    } else if (!decision && control && tool === 'select_option') {
      // A select inside a read-only (GET) form only changes the query it reads.
      const filterControl = control.tag === 'select' && readOnlyForm(control, pageUrl);
      if (!filterControl || typeof args.value !== 'string') {
        decision = {
          category: 'ambiguous_input_control',
          reason: 'only exact read-only GET filter selections are permitted',
        };
      } else {
        authorization = {
          invoke: async () => {
            await control!.element.selectOption(String(args.value));
            return `updated exact read-only filter control: ${safeText(control!.label)}`;
          },
        };
      }
    }
  }

  if (!decision) return authorization;
  recordEdge(session.label, {
    category: decision.category,
    reason: decision.reason,
    source: 'tool_dispatch',
    tool,
    target: text,
    url: pageUrl,
    control: control
      ? {
          label: safeText(control.label),
          type: safeText(control.type),
          role: safeText(control.role),
          href: safeText(control.href),
          formAction: safeText(control.formAction),
        }
      : null,
  });
  throw new Error(`policy_withheld:${decision.category}:${decision.reason}`);
}
