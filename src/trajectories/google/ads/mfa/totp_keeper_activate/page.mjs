// The page as the keeper reports and drives it.
import { action } from './keeper.mjs';

export async function state() {
  const res = await action({
    action: 'eval',
    js: `(() => ({
      url: location.href,
      title: document.title,
      text: document.body ? document.body.innerText.replace(/\\s+/g, ' ') : '',
      inputs: Array.from(document.querySelectorAll('input')).map((el) => ({
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        placeholder: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || '',
        visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        valueLength: String(el.value || '').length,
      })),
      controls: Array.from(document.querySelectorAll('button, [role="button"], a, [role="link"], li, div[role="option"]')).map((el) => ({
        tag: (el.tagName || '').toLowerCase(),
        role: el.getAttribute('role') || '',
        text: (el.innerText ?? el.textContent).replace(/\\s+/g, ' ').trim(),
        href: el.href || '',
        aria: el.getAttribute('aria-label') || '',
      })).filter((item) => item.text || item.href || item.aria),
    }))()`,
  });
  if (!res?.result)
    throw new Error(
      `the keeper read no page state (eval answered ${JSON.stringify(res)}), so the step cannot tell which Google page it is on`,
    );
  return res.result;
}

// A page that did not settle is read mid-navigation, and the next step then
// acts on the page it is leaving; the keeper's refusal ends the step instead.
export async function idle(kind = 'deliberate') {
  await action({ action: 'settle' });
}

export async function nav(url) {
  await action({ action: 'nav', url });
  await idle('deliberate');
}

export function selectorForText(text) {
  const escaped = String(text).replace(/"/g, '\\"');
  return `button:has-text("${escaped}"), [role="button"]:has-text("${escaped}"), a:has-text("${escaped}"), [role="link"]:has-text("${escaped}"), li:has-text("${escaped}"), div[role="option"]:has-text("${escaped}")`;
}

export async function clickText(values) {
  const list = Array.isArray(values) ? values : [values];
  const failures = [];
  for (const value of list) {
    try {
      await action({ action: 'click', selector: selectorForText(value) });
      await idle('deliberate');
      return value;
    } catch (error) {
      failures.push(`click ${JSON.stringify(value)}: ${error.message}`);
    }
    const needle = JSON.stringify(String(value).toLowerCase());
    const hit = await action({
      action: 'eval',
      js: `(() => {
        const needle = ${needle};
        const norm = (v) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const visible = (el) => {
          const r = el.getBoundingClientRect?.();
          return Boolean(r && r.width && r.height && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
        };
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, [role="link"], li, div[role="option"]'));
        return nodes.map((el) => {
          if (!visible(el)) return null;
          const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
          if (!text.includes(needle)) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, area: r.width * r.height };
        }).filter(Boolean).sort((a, b) => a.area - b.area)[0] || null;
      })()`,
    }).catch((error) => {
      failures.push(`find ${JSON.stringify(value)}: ${error.message}`);
      return null;
    });
    if (hit?.result) {
      await action({ action: 'humanclick', x: hit.result.x, y: hit.result.y });
      await idle('deliberate');
      return value;
    }
  }
  throw new Error(
    `clickText found no control for ${list.join(', ')}${failures.length ? `: ${failures.join('; ')}` : ''}`,
  );
}

export async function fill(selector, text) {
  await action({ action: 'fill', selector, text });
  await idle('short');
}

export async function press(key) {
  await action({ action: 'press', key });
  await idle('deliberate');
}
