// Minimal screen patch for the custom Chromium path. Loaded separately so the
// emulated screen holds even if the larger navigator.js stub fails on a
// particular page. A patch that cannot install itself leaves the browser's own
// behaviour in place, so it says so on the console under the marker Weles
// reads (src/page-init/failures.ts), never silently. The WebRTC leak guard is
// navigator/webrtc.js, loaded on its own on every launch path.

(function applyScreenPatch() {
  const scr = __weles && __weles.screen;
  if (!scr) return;
  try {
    const screenProxy = new Proxy(screen, {
      get(target, prop) {
        if (prop === 'availTop' && scr.availTop !== undefined)
          return scr.availTop;
        if (prop === 'availLeft' && scr.availLeft !== undefined)
          return scr.availLeft;
        if (prop === 'availWidth' && scr.availWidth !== undefined)
          return scr.availWidth;
        if (prop === 'availHeight' && scr.availHeight !== undefined)
          return scr.availHeight;
        if (prop === 'width' && scr.width !== undefined) return scr.width;
        if (prop === 'height' && scr.height !== undefined) return scr.height;
        if (prop === 'colorDepth' && scr.colorDepth !== undefined)
          return scr.colorDepth;
        if (prop === 'pixelDepth' && scr.pixelDepth !== undefined)
          return scr.pixelDepth;
        return target[prop];
      },
    });
    Object.defineProperty(window, 'screen', {
      get: function () {
        return screenProxy;
      },
      configurable: true,
      enumerable: true,
    });
  } catch (screenErr) {
    try {
      for (const [prop, val] of Object.entries(scr)) {
        if (val !== undefined) {
          Object.defineProperty(Screen.prototype, prop, {
            get: function () {
              return val;
            },
            configurable: true,
            enumerable: true,
          });
        }
      }
    } catch (fallbackErr) {
      console.debug(
        '__weles_page_init_failure__',
        JSON.stringify({
          patch: 'screen',
          error: String((fallbackErr && fallbackErr.message) || fallbackErr),
          first: String((screenErr && screenErr.message) || screenErr),
        }),
      );
    }
  }
})();
