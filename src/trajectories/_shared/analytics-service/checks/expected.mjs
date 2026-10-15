// Whether an analytics service action reached what it is for. Two kinds of
// proof are read: what the run's own inputs and the platform's routes make
// checkable without reading prose (the address the dashboard landed on, a
// measurement id, the site tag's loader, the website the caller named), and
// the page judged against the action's declared objective
// (catalog/<platform>.json), by the vision model. Either failing throws with
// the final address.
import { input, actionName } from '../action-catalog.mjs';
import { extractGaMeasurementId } from '../google-analytics/web-stream.mjs';
import { pageShows } from '../../page/judged/seen.mjs';

// Google Analytics' home report: a section that fell back to it did not open.
const GA_HOME_REPORT = '/reports/intelligenthome';

/** The structural proof each action has, as [holds, what failed]. */
function structuralProof(action, evidence) {
  const text = evidence.bodyText ? evidence.bodyText : '';
  const shown = `${text} ${JSON.stringify(evidence.formValues ? evidence.formValues : {})}`.toLowerCase();
  const url = evidence.url;
  const registered = [
    Boolean(extractGaMeasurementId(`${text} ${JSON.stringify(evidence.registration ? evidence.registration : {})}`)),
    'the registration exposed no measurement id',
  ];
  const proofs = {
    googleanalytics_get_measurement_id: [Boolean(extractGaMeasurementId(text)), 'no measurement id is visible'],
    // The global site tag is its loader script, whatever the page calls it.
    googleanalytics_get_global_site_tag: [text.includes('googletagmanager.com/gtag/js'), 'the site tag loader is not visible'],
    googleanalytics_view_debugview: [url.toLowerCase().includes('debugview'), 'DebugView did not open'],
    googleanalytics_view_key_events: [!new URL(url).pathname.endsWith('/admin'), 'the events report did not open'],
    googleanalytics_run_data_api_report: [!url.includes(GA_HOME_REPORT), 'the data report did not run'],
    googleanalytics_export_report: [!url.includes(GA_HOME_REPORT), 'no exportable report opened'],
    googleanalytics_view_acquisition: [!url.includes(GA_HOME_REPORT), 'the section fell back to the home report'],
    googleanalytics_view_engagement: [!url.includes(GA_HOME_REPORT), 'the section fell back to the home report'],
    googleanalytics_view_pages: [!url.includes(GA_HOME_REPORT), 'the section fell back to the home report'],
    googleanalytics_register: registered,
    umami_find_website: [shown.includes(String(input('DOMAIN_OR_NAME')).toLowerCase()), `website ${input('DOMAIN_OR_NAME')} is not visible`],
    umami_get_website_id: [shown.includes(String(input('DOMAIN_OR_NAME')).toLowerCase()), `website ${input('DOMAIN_OR_NAME')} is not visible`],
    umami_get_tracking_snippet: [shown.includes(String(input('WEBSITE_ID')).toLowerCase()), `the snippet for website ${input('WEBSITE_ID')} is not visible`],
    umami_create_website: [shown.includes(String(input('DOMAIN')).toLowerCase()), `website ${input('DOMAIN')} is not visible`],
  };
  if (action.endsWith('_realtime'))
    return [url.includes('realtime'), 'the realtime view did not open'];
  return Object.hasOwn(proofs, action) ? proofs[action] : [true, ''];
}

export async function assertExpectedEvidence(s, cfg, evidence) {
  const action = actionName();
  const [holds, failed] = structuralProof(action, evidence);
  if (!holds) throw new Error(`${action}: ${failed}; final_url=${evidence.url}`);
  if (!(await pageShows(s.page, `Does the page show that this was done: ${cfg.objective}?`)))
    throw new Error(
      `${action}: the page does not show its objective (${cfg.objective}); final_url=${evidence.url}`,
    );
}
