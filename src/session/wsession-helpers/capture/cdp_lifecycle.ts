// CDP target lifecycle, frame attach/detach/navigate, performance setup
// and raw wire-level Network.* extra info, wired from
// startInstrumentation() through the WSession's existing CDP session (created
// in its constructor for Network.dataReceived). Network.*ExtraInfo events
// surface the actual on-the-wire headers (including HTTP/2 pseudo-headers and
// the cookie pair line as sent), connection-reuse info and final loaded byte
// counts that Playwright's ctx.on('response') hides.
//
// Each recorded protocol event is kept whole: its own parameters, with the
// time it arrived and the phase it is filed under. A domain that cannot be
// enabled records nothing, and its failure is kept where its events would
// have been, so a missing record reads as a refusal, not as silence.

import type { BrowserContext } from 'playwright';

type Sink = unknown[];
type Cdp = {
  send(method: string, params?: object): Promise<any>;
  on(method: string, listener: (params: any) => void): void;
};

/** Where one protocol event is filed: the record it joins, its phase there. */
type Filed = { sink: Sink; phase: string };

/** Record every event `table` names into its record, whole. */
function recordEvents(cdp: Cdp, table: Record<string, Filed>): void {
  for (const [method, { sink, phase }] of Object.entries(table))
    cdp.on(method, (params: object) =>
      sink.push({ t: Date.now(), phase, ...params }),
    );
}

/** The message of a failure, whatever was thrown. */
function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether default-on diagnostic `name` runs: WELES_CDP_<name>=0 stops it. */
function cdpFeatureEnabled(name: string): boolean {
  return process.env[`WELES_CDP_${name}`] !== '0';
}

/**
 * The firehose records every event, so it runs only when WELES_CDP_FIREHOSE
 * is 1, or, when that is unset, under WELES_FULL_DIAGNOSTICS=1.
 */
function cdpFirehoseMode(): 'off' | 'passive' {
  const stated = process.env.WELES_CDP_FIREHOSE;
  if (stated !== undefined) return stated === '1' ? 'passive' : 'off';
  return process.env.WELES_FULL_DIAGNOSTICS === '1' ? 'passive' : 'off';
}

/** Where each protocol event of the session's records is filed. */
function eventTable(
  ws: any,
  targetEvents: Sink,
  frameEvents: Sink,
): Record<string, Filed> {
  const network: Sink = ws._instCdpNetwork;
  const audio: Sink = ws._instWebAudio;
  const animations: Sink = ws._instAnimations;
  const indexedDb: Sink = ws._instIndexedDb;
  const page: Sink = ws._instPageEvents;
  const runtime: Sink = ws._instRuntime;
  const security: Sink = ws._instSecurity;
  const storage: Sink = ws._instStorageEvents;
  return {
    'Target.targetCreated': { sink: targetEvents, phase: 'created' },
    'Target.targetDestroyed': { sink: targetEvents, phase: 'destroyed' },
    'Target.targetInfoChanged': { sink: targetEvents, phase: 'changed' },
    'Page.frameAttached': { sink: frameEvents, phase: 'attached' },
    'Page.frameDetached': { sink: frameEvents, phase: 'detached' },
    'Page.frameNavigated': { sink: frameEvents, phase: 'navigated' },
    // The constructor's Network.enable delivers these to the same session.
    'Network.requestWillBeSentExtraInfo': { sink: network, phase: 'reqExtra' },
    'Network.responseReceivedExtraInfo': { sink: network, phase: 'resExtra' },
    'Network.loadingFinished': { sink: network, phase: 'loadingFinished' },
    'Network.loadingFailed': { sink: network, phase: 'loadingFailed' },
    'Network.signedExchangeReceived': {
      sink: network,
      phase: 'signedExchange',
    },
    'Network.requestServedFromCache': {
      sink: network,
      phase: 'servedFromCache',
    },
    'Network.webSocketHandshakeResponseReceived': {
      sink: network,
      phase: 'wsHandshakeRes',
    },
    'Network.webSocketWillSendHandshakeRequest': {
      sink: network,
      phase: 'wsHandshakeReq',
    },
    'WebAudio.contextCreated': { sink: audio, phase: 'contextCreated' },
    'WebAudio.contextDestroyed': { sink: audio, phase: 'contextDestroyed' },
    'WebAudio.contextChanged': { sink: audio, phase: 'contextChanged' },
    'Animation.animationCreated': { sink: animations, phase: 'created' },
    'Animation.animationStarted': { sink: animations, phase: 'started' },
    'Animation.animationCanceled': { sink: animations, phase: 'canceled' },
    'Animation.animationUpdated': { sink: animations, phase: 'updated' },
    // Many bot detectors keep fingerprint state in IndexedDB to survive
    // cookie wipes.
    'IndexedDB.databaseCreated': { sink: indexedDb, phase: 'created' },
    'IndexedDB.versionChange': { sink: indexedDb, phase: 'versionChange' },
    'Page.lifecycleEvent': { sink: page, phase: 'lifecycle' },
    'Page.javascriptDialogOpening': { sink: page, phase: 'dialog' },
    'Page.fileChooserOpened': { sink: page, phase: 'fileChooser' },
    'Page.windowOpen': { sink: page, phase: 'windowOpen' },
    'Page.navigatedWithinDocument': { sink: page, phase: 'navWithinDoc' },
    'Browser.downloadWillBegin': { sink: page, phase: 'downloadBegin' },
    'Browser.downloadProgress': { sink: page, phase: 'downloadProgress' },
    // Runtime keeps each console argument's RemoteObject and the stack,
    // which Playwright's page.on('console') does not.
    'Runtime.consoleAPICalled': { sink: runtime, phase: 'console' },
    'Runtime.exceptionThrown': { sink: runtime, phase: 'exception' },
    // Browser-level log entries: network, deprecation, intervention, security.
    'Log.entryAdded': { sink: ws._instLog, phase: 'entry' },
    // TLS state changes, mixed content, certificate warnings.
    'Security.securityStateChanged': { sink: security, phase: 'stateChanged' },
    'Security.visibleSecurityStateChanged': {
      sink: security,
      phase: 'visibleStateChanged',
    },
    'Storage.indexedDBListUpdated': { sink: storage, phase: 'idbList' },
    'Storage.cacheStorageListUpdated': { sink: storage, phase: 'cacheList' },
    'Storage.interestGroupAccessed': { sink: storage, phase: 'interestGroup' },
    'Storage.sharedStorageAccessed': { sink: storage, phase: 'sharedStorage' },
  };
}

export function attachCdpLifecycle(
  ws: any,
  _ctx: BrowserContext,
  targetEvents: any[],
  frameEvents: any[],
): Promise<void> {
  return (async () => {
    try {
      // Observe the constructor's actual protocol setup, including its failure.
      await ws._cdpReady;
      const cdp: Cdp = ws._cdp;
      if (ws._cdpAttachError)
        targetEvents.push({
          t: Date.now(),
          phase: 'attach_error',
          err: ws._cdpAttachError,
        });
      if (!cdp) {
        if (!ws._cdpAttachError)
          throw new Error('CDP initialization completed without a session');
        return;
      }
      /** Enable `method`; a refusal joins the target events and `errorKey`. */
      const enable = async (
        method: string,
        params?: object,
        errorKey?: string,
      ): Promise<void> => {
        try {
          await cdp.send(method, params);
        } catch (error) {
          const err = failure(error);
          targetEvents.push({
            t: Date.now(),
            phase: 'enable_error',
            method,
            err,
          });
          if (errorKey) ws[errorKey] = err;
        }
      };
      await enable('Target.setDiscoverTargets', { discover: true });
      await enable('Page.enable');
      await enable('Performance.enable');
      ws._instCdpNetwork = [];
      ws._instWebAudio = [];
      ws._instAnimations = [];
      ws._instIndexedDb = [];
      ws._instPageEvents = [];
      ws._instRuntime = [];
      ws._instLog = [];
      ws._instSecurity = [];
      ws._instStorageEvents = [];
      recordEvents(cdp, eventTable(ws, targetEvents, frameEvents));
      // One-shot system facts, read once at session start: the GPU adapters
      // with vendor, device, driver and decoders, and the flags Chrome was
      // launched with; a read Chrome refuses keeps its refusal in its place.
      for (const [key, method, params] of [
        ['_instSystemInfo', 'SystemInfo.getInfo', undefined],
        ['_instBrowserVersion', 'Browser.getVersion', undefined],
        ['_instHistograms', 'Browser.getHistograms', { delta: false }],
        ['_instNavigationHistory', 'Page.getNavigationHistory', undefined],
      ] as const) {
        try {
          ws[key] = await cdp.send(method, params);
        } catch (error) {
          ws[key] = { error: failure(error) };
        }
      }
      // CDP Tracing: every browser-internal event (V8 GC and JIT, layout,
      // paint, GPU, blink, devtools timeline). dataCollected chunks are
      // accumulated and written at tracingComplete. The categories leave out
      // Tracing's verbose log class; Chrome samples at its own default rate.
      ws._instTracing = [];
      if (cdpFeatureEnabled('TRACING')) {
        cdp.on('Tracing.dataCollected', (params: { value: unknown[] }) => {
          for (const event of params.value) ws._instTracing.push(event);
        });
        await enable(
          'Tracing.start',
          {
            categories:
              'v8,blink,devtools.timeline,disabled-by-default-devtools.timeline,latencyInfo,toplevel',
          },
          '_instTracingError',
        );
      }
      // JS coverage: which functions actually ran.
      const js = '_instJsCoverageError';
      await enable('Profiler.enable', undefined, js);
      await enable(
        'Profiler.startPreciseCoverage',
        { callCount: false, detailed: false },
        js,
      );
      // CSS coverage: which rules matched.
      const css = '_instCssCoverageError';
      await enable('DOM.enable', undefined, css);
      await enable('CSS.enable', undefined, css);
      await enable('CSS.startRuleUsageTracking', undefined, css);
      await enable('WebAudio.enable', undefined, '_instWebAudioError');
      await enable('Animation.enable', undefined, '_instAnimationsError');
      await enable('IndexedDB.enable', undefined, '_instIndexedDbError');
      await enable('Page.setLifecycleEventsEnabled', { enabled: true });
      await enable('Runtime.enable');
      await enable('Log.enable');
      await enable('Security.enable');
      // The firehose: Playwright's CDP session announces every protocol event
      // it delivers as 'event' {method, params}; each is recorded under its
      // domain and name, so no copy of the protocol's event list is kept.
      // Only the domains enabled above deliver events; the firehose enables
      // none of its own.
      ws._instCdpFirehose = [];
      ws._instCdpFirehoseMode = cdpFirehoseMode();
      if (ws._instCdpFirehoseMode !== 'off')
        cdp.on('event', (event: { method: string; params: unknown }) => {
          const [domain, ...name] = event.method.split('.');
          ws._instCdpFirehose.push({
            t: Date.now(),
            domain,
            event: name.join('.'),
            payload: event.params,
          });
        });
    } catch (error) {
      targetEvents.push({
        t: Date.now(),
        phase: 'attach_error',
        err: failure(error),
      });
    }
  })();
}
