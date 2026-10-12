// What the report page shows, and the date preset control on it.
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../../../_shared/page/settled.mjs';

export async function collectPageState(page) {
  return await page.evaluate(() => {
    const norm = (value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      return (
        style &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      );
    };
    const cssPath = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        let part = node.localName || node.tagName.toLowerCase();
        if (node.id) {
          part += `#${node.id}`;
          parts.unshift(part);
          break;
        }
        const parent = node.parentElement || node.getRootNode()?.host || null;
        if (parent?.children) {
          const same = Array.from(parent.children).filter(
            (child) => child.localName === node.localName,
          );
          if (same.length > 1)
            part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };
    const roots = [];
    const addRoot = (root, label) => {
      roots.push({ root, label });
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot)
          addRoot(el.shadowRoot, `${label} >> ${el.localName}`);
      }
    };
    addRoot(document, 'document');

    const all = [];
    for (const { root, label } of roots) {
      for (const el of Array.from(root.querySelectorAll('*')))
        all.push({ el, root: label });
    }

    // A control is an element the page makes interactive: a form or link
    // element, an ARIA role, a click handler or a tab stop.
    const controls = all
      .filter(({ el }) =>
        el.matches(
          'a, button, input, select, textarea, option, [role], [onclick], [tabindex]',
        ),
      )
      .map(({ el, root }, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          root,
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          type: el.getAttribute('type') || '',
          id: el.id || '',
          name: el.getAttribute('name') || '',
          className: String(el.className || ''),
          text: norm(el.innerText ?? el.textContent),
          ariaLabel: el.getAttribute('aria-label') || '',
          title: el.getAttribute('title') || '',
          placeholder: el.getAttribute('placeholder') || '',
          value: 'value' in el ? norm(el.value) : null,
          href: el.href || '',
          checked: Boolean(el.checked),
          selected: Boolean(el.selected),
          disabled: Boolean(
            el.disabled || el.getAttribute('aria-disabled') === 'true',
          ),
          expanded: el.getAttribute('aria-expanded') || '',
          visible: visible(el),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          path: cssPath(el),
        };
      })
      .filter(
        (item) =>
          item.visible ||
          item.text ||
          item.ariaLabel ||
          item.value ||
          item.href,
      );

    const rows = all
      .filter(({ el }) => el.matches('tr, li, section, article, [role="row"]'))
      .map(({ el, root }) => ({
        root,
        tableRow: el.matches('tr, [role="row"]'),
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        text: norm(el.innerText ?? el.textContent),
        visible: visible(el),
        path: cssPath(el),
      }))
      .filter((row) => row.visible && row.text);

    // Storage is listed by key and size; a value may hold a session token.
    const listed = (store) =>
      Array.from({ length: store.length }, (_, i) => {
        const key = store.key(i);
        return { key, valueLength: store.getItem(key).length };
      });
    const storage = {
      localStorage: listed(window.localStorage),
      sessionStorage: listed(window.sessionStorage),
    };

    // The resources Apple Ads itself served.
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).hostname === location.hostname)
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: Math.round(entry.transferSize),
        duration: Math.round(entry.duration),
      }));

    return {
      url: location.href,
      title: document.title,
      text: norm(document.body?.innerText ?? document.body?.textContent),
      controls,
      rows,
      storage,
      resources,
    };
  });
}

export async function clickDatePreset(page, label) {
  try {
    const opener = page
      .locator(
        [
          'apui-wc-date-range-picker .date-range-picker__main-content',
          'apui-wc-date-range-picker .form-input--date-range-picker',
          'apui-wc-date-range-picker .date-range-picker',
          '.table-toolbar__date',
          '.date-range-picker',
        ].join(', '),
      )
      .filter({ visible: true })
      .first();
    if ((await opener.count()) === 0)
      return {
        ok: false,
        stage: 'open',
        reason: 'date picker opener not found',
      };
    await humanClickLocator(page, opener);
    await pageSettled(page);

    const item = page
      .getByText(label, { exact: true })
      .filter({ visible: true })
      .first();
    if ((await item.count()) === 0)
      return {
        ok: false,
        stage: 'select',
        reason: `preset not found: ${label}`,
      };
    const clickable = item
      .locator(
        'xpath=ancestor-or-self::*[self::li or self::button or self::a or @role="button"][1]',
      )
      .or(item)
      .first();
    await humanClickLocator(page, clickable);
    await pageSettled(page);
    const detail = await clickable.evaluate((el) => ({
      tag: el.tagName,
      text: String(el.innerText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim(),
      className: String(el.className || ''),
      visible: Boolean(
        el.offsetWidth || el.offsetHeight || el.getClientRects().length,
      ),
      url: location.href,
    }));
    return { ok: true, stage: 'select', label, ...detail };
  } catch (error) {
    return { ok: false, stage: 'exception', reason: error.message };
  }
}
