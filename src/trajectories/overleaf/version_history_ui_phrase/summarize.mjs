// Reading what the History UI shows about the phrase.

export async function summarizeVisible(page, queryText) {
  return await page.evaluate((queryText) => {
    const normalize = (s) =>
      String(s || '')
        .replace(/\s+/g, ' ')
        .trim();
    const texts = [];
    const addText = (label, value) => {
      const text = String(value || '');
      if (text.length < 20) return;
      if (texts.some((entry) => entry.text === text)) return;
      texts.push({ label, text });
    };
    const addDoc = (label, doc) => {
      if (!doc) return;
      try {
        if (typeof doc === 'string') addText(label, doc);
        else if (typeof doc.toString === 'function')
          addText(label, doc.toString());
        else if (typeof doc.getValue === 'function')
          addText(label, doc.getValue());
      } catch {
        // Ignore inaccessible editor internals.
      }
    };
    // An editor keeps its document on objects reachable from the element it
    // renders into (CodeMirror sets its view on the editable content node).
    // Every object reachable through own properties of each editable element
    // is read once for a document it exposes; DOM nodes are not followed, so
    // the walk stays on the editor's objects instead of the whole page.
    const seenObjects = new Set();
    const inspectObject = (obj, label) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj instanceof Node || obj === window) return;
      if (seenObjects.has(obj)) return;
      seenObjects.add(obj);
      try {
        if (typeof obj.getValue === 'function')
          addText(`${label}.getValue`, obj.getValue());
      } catch {}
      try {
        addDoc(`${label}.state.doc`, obj.state?.doc);
      } catch {}
      let keys;
      try {
        keys = Reflect.ownKeys(obj);
      } catch {
        // Some browser objects reject property enumeration.
        return;
      }
      for (const key of keys) {
        try {
          inspectObject(obj[key], `${label}.${String(key)}`);
        } catch {}
      }
    };
    const inspectDomEditorState = () => {
      for (const el of Array.from(
        document.querySelectorAll('[contenteditable]'),
      )) {
        for (const key of Reflect.ownKeys(el)) {
          try {
            inspectObject(el[key], `dom.${String(key)}`);
          } catch {}
        }
      }
    };
    const tokenizeWithOffsets = (s) => {
      const out = [];
      const re = /[A-Za-z0-9]+/g;
      let m;
      while ((m = re.exec(String(s || '')))) {
        out.push({
          token: m[0].toLowerCase(),
          start: m.index,
          end: m.index + m[0].length,
        });
      }
      return out;
    };
    const bestTokenWindow = (body, wanted) => {
      const targetTokens = tokenizeWithOffsets(wanted).map((t) => t.token);
      const bodyTokens = tokenizeWithOffsets(body);
      if (targetTokens.length < 3 || bodyTokens.length < targetTokens.length)
        return null;
      let best = null;
      for (let i = 0; i <= bodyTokens.length - targetTokens.length; i += 1) {
        let hits = 0;
        for (let j = 0; j < targetTokens.length; j += 1) {
          if (bodyTokens[i + j].token === targetTokens[j]) hits += 1;
        }
        const score = hits / targetTokens.length;
        if (!best || score > best.score) {
          best = {
            score,
            start: bodyTokens[i].start,
            end: bodyTokens[i + targetTokens.length - 1].end,
            hits,
          };
        }
      }
      const threshold = targetTokens.length >= 10 ? 0.82 : 0.9;
      return best && best.score >= threshold ? best : null;
    };
    // The document is the longest text an editor object exposes; every other
    // one is a part of it (a line, a selection, a view of the visible range).
    const bestDocumentText = () =>
      texts.reduce(
        (longest, entry) =>
          longest && longest.text.length >= entry.text.length ? longest : entry,
        null,
      );
    const wanted = normalize(queryText);
    const body = document.body.innerText || '';
    const rawBody = document.documentElement.textContent || '';
    inspectDomEditorState();
    const candidates = [];
    for (const el of Array.from(
      document.querySelectorAll('button,a,[role="button"],li,div'),
    )) {
      const text = normalize(el.textContent || '');
      if (!text || text.length < 3 || text.length > 500) continue;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.visibility === 'hidden' ||
        style.display === 'none'
      )
        continue;
      candidates.push(text);
      if (candidates.length >= 120) break;
    }
    const editorText = texts.map((entry) => entry.text).join('\n\n');
    const documentText = bestDocumentText();
    const nbody = normalize(
      [body, rawBody, editorText].filter(Boolean).join(' '),
    );
    const idx = wanted ? nbody.indexOf(wanted) : -1;
    const fuzzy = idx >= 0 ? null : bestTokenWindow(nbody, wanted);
    const targetIndex = idx >= 0 ? idx : fuzzy ? fuzzy.start : -1;
    const targetEnd = idx >= 0 ? idx + wanted.length : fuzzy ? fuzzy.end : -1;
    return {
      title: document.title,
      url: location.href,
      targetIndex,
      targetMatchKind: idx >= 0 ? 'exact' : fuzzy ? 'token_window' : 'none',
      targetScore: idx >= 0 ? 1 : (fuzzy?.score ?? 0),
      targetContext:
        targetIndex >= 0
          ? nbody.slice(Math.max(0, targetIndex - 500), targetEnd + 500)
          : null,
      documentText: documentText?.text ?? null,
      documentTextSource: documentText?.label ?? null,
      documentTextLength: documentText?.text.length ?? 0,
      editorTextSources: texts.map((entry) => ({
        label: entry.label,
        length: entry.text.length,
      })),
      visibleItems: Array.from(new Set(candidates)),
      bodyHead: nbody,
    };
  }, queryText);
}
