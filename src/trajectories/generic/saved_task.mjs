import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// generic_saved_task replays one reviewed declaration. Two kinds reach here:
//
//   * a declared engagement — GENERIC_ENGAGEMENT plus the reviewed trajectory
//     the declaration names, both set by the dispatcher's admission step; and
//   * a saved trajectory definition, replayed step by step through
//     browser_task: either the one the run carries from Weles Web, which
//     admission puts in GENERIC_SAVED_TRAJECTORY_JSON, or one held as a vault
//     item named by GENERIC_SAVED_TRAJECTORY_ITEM.
//
// src/worker/deploy/weles-engagement-declaration.json is the only thing that
// says which reviewed trajectory an engagement replays, so nothing here maps a
// platform or a verb to a path: this file runs what admission already
// authorized, or it runs nothing. A saved definition is replayed only when it
// states its URL, objective and replay steps; one that leaves any out is
// refused by name, never filled in.

/** A variable as admission set it; unset and empty both mean it set none. */
function admitted(name) {
  const value = process.env[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setJsonEnv(name, value) {
  if (isObject(value)) process.env[name] = JSON.stringify(value);
}

/** The text `value` holds, or null when it holds none. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The replay steps `definition` states — under `replay`, or under `steps`
 * when it states no `replay` — each refused by position when malformed. */
function replaySteps(definition, reference) {
  const replay = Object.hasOwn(definition, 'replay')
    ? definition.replay
    : definition.steps;
  if (!Array.isArray(replay) || !replay.length) {
    throw new Error(`saved trajectory ${reference} states no replay steps`);
  }
  return replay.map((raw, index) => {
    if (!isObject(raw) || typeof raw.tool !== 'string' || !raw.tool) {
      throw new Error(
        `saved trajectory ${reference} step ${index} names no tool`,
      );
    }
    if (raw.args !== undefined && !isObject(raw.args)) {
      throw new Error(
        `saved trajectory ${reference} step ${index} has args that are not an object`,
      );
    }
    // browser_task reads a step without args as one that takes none.
    const step = { tool: raw.tool };
    if (raw.args !== undefined) step.args = raw.args;
    if (typeof raw.result === 'string') step.result = raw.result;
    return step;
  });
}

/** The text the saved definition states for `field`, or else its row's, or a
 * refusal naming the field. */
function stated(field, definition, row, reference) {
  const fromDefinition = text(definition[field]);
  if (fromDefinition !== null) return fromDefinition;
  const fromRow = text(row[field]);
  if (fromRow !== null) return fromRow;
  throw new Error(`saved trajectory ${reference} states no ${field}`);
}

/** The trajectory row named by vault item `item`. */
async function vaultRow(item) {
  // Imported here, not at the top: reading a vault record resolves the
  // attested Skarbiec binary through Stado while the module loads, and a
  // declared engagement replays a reviewed trajectory without any of that.
  const { readWelesRecord } = await import('../_shared/skarbiec/accounts.mjs');
  const document = readWelesRecord(item);
  const context = isObject(document.context) ? document.context : null;
  if (context === null || context.status !== 'active') {
    throw new Error(`saved trajectory is not active: ${item}`);
  }
  const fields = document.fields;
  if (!isObject(fields))
    throw new Error(`saved trajectory ${item} holds no fields`);
  if (typeof fields.definition_json !== 'string') {
    throw new Error(`saved trajectory ${item} holds no definition_json`);
  }
  let definition;
  try {
    definition = JSON.parse(fields.definition_json);
  } catch (error) {
    throw new Error(
      `saved trajectory ${item} definition_json does not parse: ${error.message}`,
    );
  }
  // The managed host a trajectory is bound to, from its fields or else its
  // context; stated in neither, it is bound to none. A trajectory without a
  // display name is named by its item.
  let executionHost = null;
  if (text(fields.execution_host) !== null)
    executionHost = fields.execution_host;
  else if (text(context.execution_host) !== null)
    executionHost = context.execution_host;
  return {
    id: item,
    name: text(context.display_name) === null ? item : context.display_name,
    url: fields.url,
    objective: fields.objective,
    definition,
    execution_host: executionHost,
  };
}

/** The saved trajectory the run carries, as admission passed it on. */
function carriedRow(id) {
  const carried = admitted('GENERIC_SAVED_TRAJECTORY_JSON');
  if (carried === null) {
    throw new Error(
      `saved trajectory ${id} reached execution without the trajectory its run carries`,
    );
  }
  let row;
  try {
    row = JSON.parse(carried);
  } catch (error) {
    throw new Error(
      `saved trajectory ${id} as carried does not parse: ${error.message}`,
    );
  }
  if (!isObject(row) || row.id !== id) {
    throw new Error(`saved trajectory ${id} was carried as ${carried}`);
  }
  return row;
}

const engagement = admitted('GENERIC_ENGAGEMENT');

if (engagement !== null) {
  // Admission resolved the declaration before this process existed. If the
  // reviewed trajectory did not arrive with the engagement, the run refuses
  // rather than guessing a path from the engagement name.
  const engagementTrajectory = admitted('GENERIC_ENGAGEMENT_TRAJECTORY');
  if (engagementTrajectory === null) {
    throw new Error(
      `declared engagement ${engagement} reached execution without its reviewed trajectory`,
    );
  }
  // Admission resolved the reviewed path against the checkout the launcher
  // named in WELES_REPO, or the one this module ships in, three directories
  // above it (welesRepositoryRoot in src/worker/declared/engagements.ts).
  const launcherRoot = admitted('WELES_REPO');
  const repositoryRoot =
    launcherRoot === null
      ? resolve(import.meta.dirname, '..', '..', '..')
      : resolve(launcherRoot);
  console.log(
    `[saved-task] engagement ${engagement} -> ${engagementTrajectory}`,
  );
  await import(pathToFileURL(join(repositoryRoot, engagementTrajectory)).href);
} else {
  const item = admitted('GENERIC_SAVED_TRAJECTORY_ITEM');
  const id = admitted('GENERIC_SAVED_TRAJECTORY_ID');
  if (item !== null && id !== null) {
    throw new Error(
      'generic_saved_task takes GENERIC_SAVED_TRAJECTORY_ID or GENERIC_SAVED_TRAJECTORY_ITEM, not both',
    );
  }
  if (item === null && id === null) {
    throw new Error(
      'GENERIC_SAVED_TRAJECTORY_ID or GENERIC_SAVED_TRAJECTORY_ITEM required',
    );
  }
  const reference = item === null ? id : item;
  const row = item === null ? carriedRow(id) : await vaultRow(item);
  if (!isObject(row.definition)) {
    throw new Error(
      `saved trajectory ${reference} has a definition that is not an object`,
    );
  }
  const definition = row.definition;
  if (row.execution_host) {
    const expectedHost = String(row.execution_host)
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '');
    const actualHost = hostname().trim().toLowerCase().replace(/\.+$/, '');
    if (expectedHost !== actualHost) {
      throw new Error(
        `saved trajectory ${reference} is bound to managed host ${expectedHost}; refusing execution on ${actualHost}`,
      );
    }
  }

  // A run carries its saved trajectory's own label and flow name when the
  // definition states them, otherwise this trajectory's name and the row's id.
  process.env.GENERIC_TASK_LABEL = definition.session_label
    ? String(definition.session_label)
    : 'generic_saved_task';
  process.env.GENERIC_TASK_URL = stated('url', definition, row, reference);
  process.env.GENERIC_TASK_OBJECTIVE = stated(
    'objective',
    definition,
    row,
    reference,
  );
  process.env.GENERIC_TASK_FLOW_NAME = definition.flow_name
    ? String(definition.flow_name)
    : `saved:${row.id}`;
  if (definition.proxy)
    process.env.GENERIC_TASK_PROXY = String(definition.proxy);
  if (definition.headless === true) process.env.GENERIC_TASK_HEADLESS = '1';
  if (definition.browser)
    process.env.GENERIC_TASK_BROWSER = String(definition.browser);
  if (definition.os) process.env.GENERIC_TASK_OS = String(definition.os);
  if (definition.locale)
    process.env.GENERIC_TASK_LOCALE = String(definition.locale);
  setJsonEnv('GENERIC_TASK_CONSTRAINTS', definition.constraints);
  setJsonEnv('GENERIC_TASK_ENV', definition.env);
  process.env.GENERIC_TASK_REPLAY = JSON.stringify(
    replaySteps(definition, reference),
  );
  process.env.GENERIC_TASK_REPLAY_ONLY = '1';
  process.env.GENERIC_TASK_SKIP_SAVED_FLOW_REPLAY = '1';

  console.log(
    `[saved-task] ${row.name} (${row.id}) -> ${process.env.GENERIC_TASK_URL}`,
  );
  await import('./browser_task.mjs');
}
