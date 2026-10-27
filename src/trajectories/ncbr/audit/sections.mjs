// The sections of an LSI2 application form that hold written answers, by the
// number and title the form gives them. Which projekt_step page holds each
// section differs per application, so its id is declared beside the project
// (NCBR_SECTION_<KEY>, see #ncbr-settings) and read only for the sections a
// run selects: a run limited to two sections needs those two declared.
import { UsageError } from '../../../../dist/cli/usage.js';

const SECTIONS = [
  ['1.1', 'Informacje ogólne o projekcie'],
  ['1.2', 'Klasyfikacja projektu'],
  ['1.3', 'Podmioty realizujące projekt'],
  ['1.4', 'Konkurencja'],
  ['1.5', 'Miejsce realizacji projektu'],
  ['2.1', 'Cel projektu'],
  ['2.2', 'Opis rezultatu prac B+R'],
  ['2.3', 'Zapotrzebowanie rynkowe i potencjał'],
  ['2.4', 'Dodatkowe efekty zewnętrzne'],
  ['3.1', 'Sposób wdrożenia wyników projektu'],
  ['3.2', 'Plan wdrożenia rezultatu'],
  ['3.3', 'Analiza opłacalności wdrożenia'],
  ['3.4', 'Zasoby niezbędne do wdrożenia'],
  ['3.5', 'Prawa własności intelektualnej'],
  ['4.1', 'Zespół projektowy'],
  ['4.2', 'Zasoby techniczne oraz WNiP'],
  ['4.3', 'Podwykonawcy'],
  ['5.3', 'Premia za lokalizację'],
  ['5.4', 'Premia za rozpowszechnianie'],
  ['6.1', 'Plan prac B+R'],
  ['6.3', 'Wydatki rzeczywiste'],
  ['6.5', 'Koszty pośrednie'],
  ['7', 'Analiza ryzyka'],
  ['8', 'Źródła finansowania wydatków'],
  ['9.2', 'Wskaźniki rezultatu'],
  ['10.1', 'Zasady równości'],
  ['10.2', 'Karta Praw Podstawowych'],
  ['10.3', 'Konwencja o Prawach Osób Niepełnosprawnych'],
  ['10.4', 'Zasada zrównoważonego rozwoju'],
];

/**
 * The sections whose "<number> <title>" `pattern` matches (every section
 * without a pattern), each with the address of its projekt_step page. A
 * pattern that selects nothing is refused as a usage error.
 */
export function selectedSections(settings, pattern) {
  const chosen = SECTIONS.filter(
    ([id, title]) => !pattern || pattern.test(`${id} ${title}`),
  );
  if (!chosen.length)
    throw new UsageError(
      `SECTION_PATTERN ${pattern} selects none of the sections ${SECTIONS.map(([id]) => id).join(', ')}`,
    );
  const projectUrl = settings.projectUrl();
  return chosen.map(([id, title]) => ({
    id,
    title,
    url: `${projectUrl}/projekt_step/${settings.sectionId(id.replaceAll('.', '_'))}`,
  }));
}
