import { clickOffered } from '../../page/judged/seen.mjs';
import { GA_BASE, input, actionName, actionUrl } from '../action-catalog.mjs';
import { waitRendered } from '../page-interaction.mjs';
import { openDataStreamDetail } from './web-stream.mjs';

function propertyRoute(section = 'reports') {
  const propertyId = input('PROPERTY_ID');
  if (!propertyId) return GA_BASE;
  return `${GA_BASE}#/p${propertyId}/${section}`;
}

function resolvedUrl(cfg) {
  const action = actionName();
  if (cfg.platform === 'googleanalytics') {
    if (action.includes('realtime')) return propertyRoute('realtime');
    if (action.includes('debugview')) return propertyRoute('admin/debugview');
    if (action === 'googleanalytics_get_global_site_tag') {
      const streamId = input('STREAM_ID');
      return streamId && streamId !== 'unknown-stream'
        ? propertyRoute(`admin/streams/table/${streamId}`)
        : propertyRoute('admin/streams/table');
    }
    if (action.includes('acquisition'))
      return propertyRoute('reports/acquisition');
    if (action.includes('engagement'))
      return propertyRoute('reports/engagement');
    if (action.includes('pages'))
      return propertyRoute('reports/engagement/pages-and-screens');
    if (action === 'googleanalytics_export_report')
      return propertyRoute('reports/engagement/pages-and-screens');
    if (action.includes('key_event'))
      return propertyRoute('admin/events/key-events');
    if (action.includes('audience')) return propertyRoute('admin/audiences');
    if (action.includes('custom_dimension') || action.includes('custom_metric'))
      return propertyRoute('admin/custom-definitions');
    if (action.includes('data_retention'))
      return propertyRoute('admin/data-retention');
    return actionUrl(cfg);
  }
  return actionUrl(cfg);
}

// The navigation steps that lead to each action's section, described to the
// vision model so they are found in whatever language GA renders them.
const REPORTS = 'the Reports section of the navigation';
const ADMIN = 'the Admin section of the navigation';
const PAGES = [
  REPORTS,
  'the Engagement reports',
  'the Pages and screens report',
];
const SECTION_STEPS = {
  googleanalytics_view_realtime: ['the realtime report'],
  googleanalytics_verify_realtime: ['the realtime report'],
  googleanalytics_view_acquisition: [REPORTS, 'the Acquisition reports'],
  googleanalytics_view_engagement: [REPORTS, 'the Engagement reports'],
  googleanalytics_view_pages: PAGES,
  googleanalytics_export_report: PAGES,
  googleanalytics_view_key_events: [ADMIN, 'the Events settings'],
  googleanalytics_view_debugview: [ADMIN, 'the DebugView page'],
  googleanalytics_get_global_site_tag: [ADMIN, 'the Data streams settings'],
};

async function openExpectedDashboardSection(s) {
  const action = actionName();
  const steps = SECTION_STEPS[action];
  if (!steps) return;
  for (const step of steps) {
    await clickOffered(s.page, step);
    await waitRendered(s.page, 30);
  }
  if (action === 'googleanalytics_get_global_site_tag') {
    await openDataStreamDetail(s);
    await waitRendered(s.page, 30);
    await clickOffered(
      s.page,
      'the button that shows the tag installation instructions',
    );
    await waitRendered(s.page, 30);
  }
}

export { propertyRoute, resolvedUrl, openExpectedDashboardSection };
