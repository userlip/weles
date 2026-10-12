// The vetted legal-act rows of section 10.4, parsed from the application's markdown source,
// and the outdated acts the table must no longer hold. Which table row or
// autocomplete option is about an act is judged by the model (`rowAbout`).
import { readFileSync } from 'node:fs';

const MD = (await import('#ncbr-settings')).applicationFile(
  'wersja_B_10.4_zrownowazony_rozwoj.md',
);

const md = readFileSync(MD, 'utf8');

function legalRows() {
  return md
    .split('\n')
    .filter((line) => line.startsWith('| **') && !line.includes('|---|'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      const act = (cells[1] || '').replace(/\*\*/g, '');
      const justification = (cells[2] || '').replace(/\*\*/g, '');
      if (!act || !justification)
        throw new Error(`malformed legal-act row: ${line}`);
      const formJustification = act.startsWith('Inne:')
        ? `${act}. ${justification}`
        : justification;
      if (formJustification.length > 1000)
        throw new Error(
          `legal-act justification too long: ${act} ${formJustification.length}/1000`,
        );
      return {
        act,
        kind: act.startsWith('Inne:') ? 'inne' : 'lista',
        justification,
        justificationLength: justification.length,
        formJustification,
        formJustificationLength: formJustification.length,
      };
    });
}

export const targets = legalRows();
export const target = targets[0];
// The acts the application cited before its legal basis was vetted, as the
// model is asked to recognise them in the table.
export const staleActs = [
  'the EU directive on industrial emissions (integrated pollution prevention and control)',
];

/** What a table row or an autocomplete option about `row` is about. */
export function actSubject(row) {
  return `the legal act ${row.act}`;
}
