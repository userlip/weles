import { createHash } from 'node:crypto';
import {
  JourneyClient,
  StadoJourneyTransport,
  type JourneyTransport,
} from '../onboarding-runtime';

import { FileJourneyStorage } from './journey-storage.js';
import {
  OfflineJourneyTransport,
  VersionPinnedTransport,
} from './journey-transport.js';
import { loadReceiptVerifier, requireVerifiedClaims } from './receipt.js';
import {
  JOURNEY_ID,
  JOURNEY_VERSION,
  PRODUCT_ID,
  SOURCE_REVISION,
  WELES_FIRST_USE_FALLBACK,
  definition,
  hasPinnedProductSurface,
} from './journey-surface.js';
import {
  ONBOARDING_ACTIONS,
  render,
  stableSubject,
  stateDirectory,
  type ControlPlane,
  type OnboardingAction,
  type WelesOnboardingInput,
  type WelesOnboardingView,
} from './view/view.js';

const TOKEN_ENVIRONMENT_KEY = 'WELES_STADO_INTEGRATION_TOKEN';
/** A run that states no action reads where the journey stands. */
const DEFAULT_ACTION: OnboardingAction = 'status';
/** A SHA-256 hex digest is as long as the algorithm's own digest. */
const SHA256_HEX_LENGTH = createHash('sha256').digest('hex').length;

function isSha256Hex(value: string): boolean {
  return value.length === SHA256_HEX_LENGTH && /^[\da-f]+$/i.test(value);
}

/** A whole number of items, none negative. */
function isCount(value: number): boolean {
  return /^\d+$/.test(String(value));
}

export async function runWelesOnboarding(
  input: WelesOnboardingInput = {},
): Promise<WelesOnboardingView> {
  const action = input.action ?? DEFAULT_ACTION;
  if (!Object.hasOwn(ONBOARDING_ACTIONS, action))
    throw new Error(`unknown onboarding action: ${action}`);

  const environment = input.environment ?? process.env;
  const subject = stableSubject(input, environment);
  const subjectHash = createHash('sha256').update(subject).digest('hex');
  const baseUrl = environment.STADO_INTEGRATION_API_URL?.trim();
  const rawToken = environment[TOKEN_ENVIRONMENT_KEY];
  const token = rawToken?.trim();
  if (rawToken && (rawToken !== token || /\p{Cc}/u.test(rawToken))) {
    throw new Error(
      `${TOKEN_ENVIRONMENT_KEY} contains invalid whitespace or control characters`,
    );
  }
  const configured = Boolean(baseUrl && token);
  const baseTransport: JourneyTransport =
    baseUrl && token
      ? new StadoJourneyTransport({
          baseUrl,
          token,
          fetch: input.fetch,
        })
      : new OfflineJourneyTransport();
  const transport = new VersionPinnedTransport(
    baseTransport,
    JOURNEY_VERSION,
    hasPinnedProductSurface,
  );
  const storage = new FileJourneyStorage(
    stateDirectory(input, environment),
    hasPinnedProductSurface,
  );
  const client = new JourneyClient({
    productId: PRODUCT_ID,
    journeyId: JOURNEY_ID,
    subjectHash,
    scopeKind: 'device',
    transport,
    storage,
    canonicalFallback: WELES_FIRST_USE_FALLBACK,
  });

  const evidenceRevision = SOURCE_REVISION;
  await client.start(evidenceRevision);
  // Offline there is no control plane to send to; the events stay queued.
  let undeliveredEvents: string | undefined;
  if (configured) {
    try {
      await client.flush();
    } catch (error) {
      undeliveredEvents =
        error instanceof Error ? error.message : String(error);
    }
  }
  const progress = client.progress;
  if (!progress) throw new Error('Weles onboarding did not create progress');
  const central = configured
    ? await Promise.allSettled([
        transport.readState(PRODUCT_ID, progress.attempt_id, subjectHash),
        transport.assignExperiment({
          product_id: PRODUCT_ID,
          app_id: 'weles',
          platform: 'operator',
          surface: 'operator_cli',
          subject,
        }),
      ])
    : [];
  const plane: ControlPlane = {
    connected:
      configured &&
      !undeliveredEvents &&
      central.every((result) => result.status === 'fulfilled'),
    undeliveredEvents,
  };

  if (action === 'reset') {
    await client.reset(evidenceRevision);
    await client.expose(evidenceRevision);
    return render(client, plane);
  }

  if (client.progress?.status === 'completed') return render(client, plane);
  await client.expose(evidenceRevision);

  if (action === 'next') {
    if (client.screen?.screen_id === 'receipt-verification') {
      throw new Error(
        'the receipt-verification step requires a signed service receipt; use onboarding verify',
      );
    }
    const firstAction =
      client.screen?.screen_id === definition.entry_screen_id &&
      !client.progress?.completed_screen_ids.includes(
        definition.entry_screen_id,
      );
    const decision = await client.advance({}, evidenceRevision);
    if (!decision)
      throw new Error('the current onboarding step cannot advance');
    if (firstAction) {
      await client.emit(
        'onboarding_first_action_completed',
        {},
        evidenceRevision,
        decision,
        definition.entry_screen_id,
      );
    }
    await client.expose(evidenceRevision);
    return render(client, plane);
  }

  if (action === 'import') {
    if (client.screen?.screen_id !== 'existing-data') {
      throw new Error(
        'complete the authorization-boundary step before recording an import',
      );
    }
    const report = input.importReport;
    if (
      !report ||
      !isCount(report.imported) ||
      !isCount(report.unchanged) ||
      !isCount(report.refused) ||
      !(report.imported + report.unchanged)
    ) {
      throw new Error(
        'onboarding import requires a persisted Weles import result',
      );
    }
    const decision = await client.advance(
      { existing_data_imported: true },
      evidenceRevision,
    );
    if (!decision)
      throw new Error('the existing-data onboarding step cannot advance');
    await client.expose(evidenceRevision);
    return render(client, plane);
  }

  if (action === 'verify') {
    if (client.screen?.screen_id !== 'receipt-verification') {
      throw new Error(
        'complete the authorization-boundary and host-execution steps before verifying a receipt',
      );
    }
    if (
      !input.receipt ||
      !input.receiptKeys ||
      !Object.keys(input.receiptKeys).length
    ) {
      throw new Error(
        'receipt verification requires a receipt and trusted public-key map',
      );
    }
    const { verifyReceipt } = await loadReceiptVerifier();
    const claims = requireVerifiedClaims(
      verifyReceipt(input.receipt, input.receiptKeys),
    );
    if (claims.outcome !== 'completed') {
      throw new Error(
        `verified receipt outcome is not a completed Weles workflow: ${claims.outcome}`,
      );
    }
    const receiptRevision = isSha256Hex(claims.evidenceDigest)
      ? `sha256:${claims.evidenceDigest.toLowerCase()}`
      : `receipt:${createHash('sha256').update(claims.evidenceDigest).digest('hex')}`;
    const receiptEvidence = {
      task_id: claims.taskId,
      outcome: claims.outcome,
      evidence_digest: claims.evidenceDigest,
      receipt_key_id: claims.keyId,
    };
    const completed = await client.complete(
      { authorized_browser_workflow_completed: true },
      receiptRevision,
      receiptEvidence,
    );
    if (!completed)
      throw new Error(
        'verified receipt did not satisfy the Weles first-success contract',
      );
    await client.observeFirstSuccess(
      { authorized_browser_workflow_completed: true },
      receiptRevision,
      receiptEvidence,
    );
    return render(client, plane, claims);
  }

  return render(client, plane);
}
