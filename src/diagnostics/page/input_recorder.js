// Input event recorder for human-vs-trajectory diffing. Reuses the stealth
// core property_trap.js installs under Symbol.for('weles.inst'): entries go
// through its logAccess into the same hidden log, the value setter it installs
// reports native source via api.makeNative, and its listeners are registered
// through api.origAddEL (the real addEventListener captured before the trap
// wrap) so they don't pollute the addEventListener trap log.
//
// Typed values never reach the log. A field write is recorded with the
// value's length, and a printable key as `_` without its key code, so a
// password typed while page diagnostics run cannot be read back from the
// run's recordings.
(function () {
  const api = globalThis[Symbol.for('weles.inst')];
  if (!api || api._inputInstalled || !api.origAddEL) return;
  api._inputInstalled = true;
  const rec = function (type, fields) {
    api.logAccess('Input', type, fields);
  };
  const listen = function (target, type, record) {
    api.origAddEL.call(target, type, record, { capture: true, passive: true });
  };

  listen(document, 'pointermove', function (ev) {
    rec('pointermove', { x: ev.clientX, y: ev.clientY });
  });
  const POINTER_PRESSES = {
    pointerdown: true,
    pointerup: true,
    click: true,
    dblclick: true,
    contextmenu: true,
  };
  Object.keys(POINTER_PRESSES).forEach(function (type) {
    listen(document, type, function (ev) {
      rec(type, {
        x: ev.clientX,
        y: ev.clientY,
        btn: ev.button,
        tag: ev.target instanceof Element ? ev.target.tagName : null,
      });
    });
  });

  // One code point is a character the user typed: it is recorded as `_`, and
  // its key code, which names the physical key, is left out with it.
  const PRINTABLE = /^.$/u;
  const KEY_EVENTS = { keydown: true, keyup: true };
  Object.keys(KEY_EVENTS).forEach(function (type) {
    listen(document, type, function (ev) {
      const mod = {
        shift: ev.shiftKey,
        ctrl: ev.ctrlKey,
        meta: ev.metaKey,
        alt: ev.altKey,
      };
      rec(
        type,
        PRINTABLE.test(ev.key)
          ? { key: '_', mod: mod }
          : { key: ev.key, code: ev.code, mod: mod },
      );
    });
  });

  listen(document, 'wheel', function (ev) {
    rec('wheel', { dy: ev.deltaY, dx: ev.deltaX });
  });
  listen(window, 'scroll', function () {
    rec('scroll', { sy: window.scrollY, sx: window.scrollX });
  });
  listen(document, 'visibilitychange', function () {
    rec('visibilitychange', { s: document.visibilityState });
  });
  listen(window, 'focus', function () {
    rec('focus', {});
  });
  listen(window, 'blur', function () {
    rec('blur', {});
  });

  // Every programmatic or keyboard-driven write to a field's value, with the
  // field's identity and the length the field holds afterwards.
  const hookValueSetter = function (proto, label) {
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!d || !d.set || !d.get) return;
    Object.defineProperty(proto, 'value', {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set: api.makeNative(function (v) {
        const written = d.set.call(this, v);
        rec(label + '_value_set', {
          id: this.id,
          name: this.name,
          type: this.type,
          tag: this.tagName,
          len: d.get.call(this).length,
        });
        return written;
      }, d.set),
    });
  };
  hookValueSetter(HTMLInputElement.prototype, 'input');
  hookValueSetter(HTMLTextAreaElement.prototype, 'textarea');

  // Fires after every keystroke or autocomplete selection changes a field.
  listen(document, 'input', function (ev) {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement))
      return;
    rec('input_event', {
      id: t.id,
      name: t.name,
      type: t.type,
      len: t.value.length,
      isTrusted: ev.isTrusted,
    });
  });
})();
