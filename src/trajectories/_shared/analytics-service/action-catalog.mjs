// The analytics service's actions, read from the declarations beside this
// module (catalog/<platform>.json): for each platform its base addresses and
// its actions, each with where it opens, its risk, its objective and every
// input it reads, required or optional. The worker reads the same files to
// hand a run exactly the inputs its action declares (params-to-env), so the
// two sides cannot drift apart.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'catalog',
);
const DECLARATIONS = readdirSync(CATALOG_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) =>
    JSON.parse(readFileSync(path.join(CATALOG_DIR, file), 'utf8')),
  );
const BASES = Object.assign({}, ...DECLARATIONS.map((each) => each.bases));
const { UMAMI_BASE, UMAMI_APP_BASE, GA_BASE } = BASES;

/** The input `name` the worker handed this run; undefined when it has none. */
function input(name) {
  return process.env[name];
}

// A declared address names a platform base or an input in braces:
// `{UMAMI_APP_BASE}/websites/{WEBSITE_ID}/settings`.
function resolved(template) {
  return template.replace(/\{([A-Z_]+)\}/g, (_braced, name) => {
    if (Object.hasOwn(BASES, name)) return BASES[name];
    return input(name);
  });
}

// What each declared risk means for the run: a write or an admin action
// changes the platform's state and is staged for approval until
// WRITE_CONFIRM is given.
const RISKS = {
  read: { changesState: false },
  verify: { changesState: false },
  write: { changesState: true },
  admin: { changesState: true },
};

// Where an action's run goes: its dashboard section, the target site it
// checks, or the target site and then the dashboard that should show it.
const OPENINGS = {
  dashboard: { targetSite: false, dashboard: true, interacts: true },
  target_site: { targetSite: true, dashboard: false, interacts: false },
  target_site_then_dashboard: {
    targetSite: true,
    dashboard: true,
    interacts: false,
  },
};

function declared(table, name, value, what) {
  if (Object.hasOwn(table, value)) return table[value];
  throw new Error(
    `analytics action ${name} declares ${what} ${JSON.stringify(value)}; the catalog knows ${Object.keys(table).join(', ')}`,
  );
}

const ACTIONS = Object.fromEntries(
  DECLARATIONS.flatMap((declaration) =>
    Object.entries(declaration.actions).map(([name, action]) => {
      // An action states a field itself or takes its platform's declared one.
      const stated = (field) =>
        Object.hasOwn(action, field)
          ? action[field]
          : declaration.defaults[field];
      return [
        name,
        {
          platform: declaration.platform,
          risk: action.risk,
          changesState: declared(RISKS, name, action.risk, 'risk').changesState,
          opening: declared(OPENINGS, name, stated('opens'), 'opening'),
          signsIn: stated('signsIn'),
          scrolls: stated('scrolls'),
          url: () => resolved(action.url),
          // The dashboard section a run opens by the vision model after the
          // address, for an action whose address cannot name it.
          section: action.section,
          // Whether the run opens the data stream's tag installation instructions.
          showsTagInstructions: action.showsTagInstructions === true,
          inputs: action.inputs,
          required: Object.keys(action.inputs).filter(
            (key) => action.inputs[key] === 'required',
          ),
          objective: action.objective,
        },
      ];
    }),
  ),
);

/** The hostname of `url`; a site given as a bare host ("example.com") is read as https. */
function siteHostname(url) {
  return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`)
    .hostname;
}

/** The site's hostname without its www. */
function siteHost(url) {
  return siteHostname(url).replace(/^www\./, '');
}

/** The analytics action this run was handed; a run handed none is refused. */
function actionName() {
  if (process.env.SERVICE_ACTION) return process.env.SERVICE_ACTION;
  if (process.env.ACTION) return process.env.ACTION;
  if (process.env.PLATFORM && process.env.VERB)
    return `${process.env.PLATFORM}_${process.env.VERB}`;
  throw new Error(
    'no analytics action was named: SERVICE_ACTION, ACTION, or PLATFORM with VERB, is required',
  );
}

function actionUrl(cfg) {
  return cfg.url();
}

function missingInputs(cfg) {
  return cfg.required.filter((key) => !input(key));
}

export {
  UMAMI_BASE,
  UMAMI_APP_BASE,
  GA_BASE,
  ACTIONS,
  input,
  siteHost,
  siteHostname,
  actionName,
  actionUrl,
  missingInputs,
};
