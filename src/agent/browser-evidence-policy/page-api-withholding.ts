// The init script every page of an evidence context is loaded with: the browser
// APIs a browser-evidence run may not reach at all. It is serialized into the
// page, so it carries its own helpers and reaches the host only through the
// __welesRecordWithheldEdge binding the context installs.
export function initScript(policyVersion: string): void {
  const report = (category: string, api: string) => {
    try {
      const reportingGlobal = globalThis as unknown as {
        __welesRecordWithheldEdge?: (edge: unknown) => unknown;
      };
      void reportingGlobal.__welesRecordWithheldEdge?.({
        category,
        api,
        source: 'page_api',
      });
    } catch {}
  };
  // A withholding the page refused to install leaves that API reachable; the
  // ledger records it as unenforced, as a refusal the network route could not
  // deliver is, instead of the run carrying a policy version that covers it.
  const unenforced = (api: string) => report('page_api_unenforced', api);
  const denied = () =>
    new DOMException(
      'Withheld by Weles browser-evidence policy',
      'NotAllowedError',
    );
  const denyAsyncMethods = (
    owner: unknown,
    methods: string[],
    category: string,
    prefix: string,
  ) => {
    // Only an object or a function carries methods: Object() returns any
    // other value (an absent API included) as a different, wrapped value.
    if (Object(owner) !== owner) return;
    for (const method of methods) {
      try {
        const record = owner as Record<string, unknown>;
        if (typeof record[method] !== 'function') continue;
        Object.defineProperty(owner, method, {
          configurable: false,
          value: async () => {
            report(category, `${prefix}.${method}`);
            throw denied();
          },
        });
      } catch {
        unenforced(`${prefix}.${method}`);
      }
    }
  };

  try {
    if (navigator.permissions) {
      Object.defineProperty(navigator.permissions, 'query', {
        configurable: false,
        value: (descriptor: PermissionDescriptor) => {
          const name = String(descriptor?.name ?? 'unknown');
          report(
            name === 'notifications'
              ? 'notification_api'
              : 'browser_permission_api',
            `permissions.query:${name}`,
          );
          return Promise.resolve({
            state: 'denied',
            onchange: null,
          } as PermissionStatus);
        },
      });
    }
  } catch {
    unenforced('permissions.query');
  }

  try {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: false,
      value: class WithheldNotification {
        static get permission(): NotificationPermission {
          return 'denied';
        }
        static async requestPermission(): Promise<NotificationPermission> {
          report('notification_api', 'Notification.requestPermission');
          return 'denied';
        }
        constructor() {
          report('notification_api', 'new Notification');
          throw denied();
        }
      },
    });
  } catch {
    unenforced('Notification');
  }

  try {
    const media = navigator.mediaDevices;
    denyAsyncMethods(
      media,
      ['getUserMedia', 'getDisplayMedia', 'selectAudioOutput'],
      'browser_permission_api',
      'mediaDevices',
    );
  } catch {
    unenforced('mediaDevices');
  }

  try {
    const geo = navigator.geolocation;
    if (geo) {
      Object.defineProperty(geo, 'getCurrentPosition', {
        configurable: false,
        value: (
          _success: PositionCallback,
          failure?: PositionErrorCallback,
        ) => {
          report('browser_permission_api', 'geolocation.getCurrentPosition');
          failure?.({
            code: 1,
            message: denied().message,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      });
      Object.defineProperty(geo, 'watchPosition', {
        configurable: false,
        value: (
          _success: PositionCallback,
          failure?: PositionErrorCallback,
        ) => {
          report('browser_permission_api', 'geolocation.watchPosition');
          failure?.({
            code: 1,
            message: denied().message,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
          return -1;
        },
      });
    }
  } catch {
    unenforced('geolocation');
  }

  try {
    denyAsyncMethods(
      navigator.clipboard,
      ['read', 'readText', 'write', 'writeText'],
      'browser_permission_api',
      'clipboard',
    );
  } catch {
    unenforced('clipboard');
  }
  const navigatorCapabilities = navigator as unknown as Record<string, unknown>;
  denyAsyncMethods(
    navigatorCapabilities.usb,
    ['requestDevice'],
    'browser_permission_api',
    'usb',
  );
  denyAsyncMethods(
    navigatorCapabilities.serial,
    ['requestPort'],
    'browser_permission_api',
    'serial',
  );
  denyAsyncMethods(
    navigatorCapabilities.bluetooth,
    ['requestDevice'],
    'browser_permission_api',
    'bluetooth',
  );
  denyAsyncMethods(
    navigatorCapabilities.hid,
    ['requestDevice'],
    'browser_permission_api',
    'hid',
  );
  denyAsyncMethods(
    navigator.credentials,
    ['create', 'get', 'store', 'preventSilentAccess'],
    'authentication_submission',
    'credentials',
  );
  denyAsyncMethods(
    navigatorCapabilities.serviceWorker,
    ['register'],
    'network_policy',
    'serviceWorker',
  );
  denyAsyncMethods(navigator, ['share'], 'system_ui', 'navigator');

  for (const picker of [
    'showOpenFilePicker',
    'showSaveFilePicker',
    'showDirectoryPicker',
  ] as const) {
    try {
      if (
        typeof (globalThis as unknown as Record<string, unknown>)[picker] !==
        'function'
      )
        continue;
      Object.defineProperty(globalThis, picker, {
        configurable: false,
        value: async () => {
          report('system_ui', picker);
          throw denied();
        },
      });
    } catch {
      unenforced(picker);
    }
  }

  try {
    Object.defineProperty(globalThis, 'PaymentRequest', {
      configurable: false,
      value: class WithheldPaymentRequest {
        constructor() {
          report('purchase_subscription_payment', 'PaymentRequest');
          throw denied();
        }
      },
    });
  } catch {
    unenforced('PaymentRequest');
  }
  for (const rtcName of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
    try {
      if (!(rtcName in globalThis)) continue;
      Object.defineProperty(globalThis, rtcName, {
        configurable: false,
        value: class WithheldPeerConnection {
          constructor() {
            report('network_policy', rtcName);
            throw denied();
          }
        },
      });
    } catch {
      unenforced(rtcName);
    }
  }
  try {
    Object.defineProperty(globalThis, 'open', {
      configurable: false,
      value: () => {
        report('system_ui', 'window.open');
        return null;
      },
    });
  } catch {
    unenforced('window.open');
  }
  try {
    Object.defineProperty(navigator, 'registerProtocolHandler', {
      configurable: false,
      value: () => {
        report('system_ui', 'navigator.registerProtocolHandler');
        throw denied();
      },
    });
  } catch {
    unenforced('navigator.registerProtocolHandler');
  }

  Object.defineProperty(globalThis, '__welesBrowserEvidencePolicyVersion', {
    configurable: false,
    enumerable: false,
    value: policyVersion,
    writable: false,
  });
}
