// Real qualification of the capture diagnosis (src/capture/diagnosis.ts)
// against the installed build: every evidence source the diagnosis asks for
// and cannot read is kept with its path and cause, in the model request and
// in the answer, whether the Jeden run answers or fails; and a reply that
// misses the output schema is refused with the check it failed and the part
// of the reply that failed it. Nothing is mocked: ffmpeg really runs on an
// empty recording, the console path really is a directory, the responses
// file really holds a JSON object, the DOM path really is absent, and Jeden
// is really called through the fleet's route (its own failure, when it
// fails, is the distinct first line).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const built = join(root, 'dist', 'capture', 'diagnosis.js');
if (!existsSync(built)) {
  throw new Error(
    `the built diagnosis module is missing at ${built}: this test drives the installed build, run the Weles build first`,
  );
}
const { diagnoseCapture, parseDiagnosisOutput } = await import(
  pathToFileURL(built).href
);

const evidence = join(root, 'build', 'real-tests', 'capture-diagnosis');
mkdirSync(evidence, { recursive: true });
const run = mkdtempSync(join(evidence, 'run-'));
const report = {
  started_at: new Date().toISOString(),
  run,
  checks: [],
  verdict: 'blocked',
};

function check(name, detail) {
  report.checks.push({ name, ...detail });
}

const UNREAD_LINE = /^unread evidence: (?<source>\S+) at (?<path>.+?): (?<cause>.+)$/;

function unreadFromLines(lines) {
  return lines.map((line) => {
    const match = line.match(UNREAD_LINE);
    assert.ok(match, `an unread evidence line names source, path and cause: ${line}`);
    return { source: match.groups.source, path: match.groups.path, cause: match.groups.cause };
  });
}

try {
  // Four sources, each unreadable for a different real reason.
  const framesDir = join(run, 'frames');
  mkdirSync(framesDir);
  const videoPath = join(run, 'recording.webm');
  writeFileSync(videoPath, '');
  const consolePath = join(run, 'console-as-directory');
  mkdirSync(consolePath);
  const responsesPath = join(run, 'responses.json');
  writeFileSync(responsesPath, JSON.stringify({ not: 'an array' }));
  const domPath = join(run, 'absent-dom.html');

  const answer = await diagnoseCapture(
    framesDir,
    videoPath,
    consolePath,
    responsesPath,
    domPath,
  );
  check('diagnosis answer', { answer });

  const expected = [
    ['video_frames', videoPath],
    ['console_lines', consolePath],
    ['network_responses', responsesPath],
    ['dom_snapshot', domPath],
  ];
  let unread;
  let outcome;
  if (answer.startsWith('Diagnosis unavailable: the Jeden run failed: ')) {
    outcome = 'jeden_failed';
    const [first, ...rest] = answer.split('\n');
    assert.notEqual(
      first,
      'Diagnosis unavailable: the Jeden run failed: ',
      'the Jeden failure line carries its cause',
    );
    unread = unreadFromLines(rest);
  } else if (answer.startsWith('Diagnosis unavailable: model output failed schema validation: ')) {
    outcome = 'schema_failed';
    const [first, ...rest] = answer.split('\n');
    assert.match(first, /; reply: /, 'the schema failure names the check and the reply part');
    unread = unreadFromLines(rest);
  } else {
    outcome = 'diagnosed';
    const diagnosis = JSON.parse(answer);
    assert.equal(typeof diagnosis.summary, 'string');
    assert.ok(Array.isArray(diagnosis.unread_evidence), 'the diagnosis carries unread_evidence');
    unread = diagnosis.unread_evidence;
  }
  check('outcome', { outcome, unread });

  for (const [source, path] of expected) {
    const entry = unread.find((item) => item.source === source);
    assert.ok(entry, `${source} is reported as unread`);
    assert.equal(entry.path, path, `${source} names the path it was looked for at`);
    assert.ok(entry.cause.trim(), `${source} names its cause`);
  }
  assert.match(
    unread.find((item) => item.source === 'console_lines').cause,
    /EISDIR/,
    'reading a directory as the console log names the operating system cause',
  );
  assert.match(
    unread.find((item) => item.source === 'network_responses').cause,
    /JSON object, not an array of response records/,
    'a responses file holding an object names the shape it holds',
  );
  assert.equal(
    unread.find((item) => item.source === 'dom_snapshot').cause,
    'no file at this path',
  );

  // The parser names the failing check and the part of the reply that failed it.
  const noObject = parseDiagnosisOutput('no json here');
  assert.deepEqual(noObject, {
    failure: 'the reply holds no JSON object',
    excerpt: 'no json here',
  });
  const badSummary = parseDiagnosisOutput(
    'prose {"summary": true, "errors": [], "anomalies": [], "next_steps": []} prose',
  );
  assert.deepEqual(badSummary, { failure: 'summary is not a string', excerpt: 'true' });
  const badItem = parseDiagnosisOutput(
    '{"summary": "ok", "errors": ["one", {"two": true}], "anomalies": [], "next_steps": []}',
  );
  assert.deepEqual(badItem, {
    failure: 'errors holds a value that is not a string',
    excerpt: '{"two":true}',
  });
  const missingList = parseDiagnosisOutput(
    '{"summary": "ok", "errors": [], "anomalies": "none", "next_steps": []}',
  );
  assert.deepEqual(missingList, {
    failure: 'anomalies is not an array',
    excerpt: '"none"',
  });
  const unparsable = parseDiagnosisOutput('{"summary": "ok", }');
  assert.ok('failure' in unparsable && unparsable.failure.startsWith('the JSON object does not parse: '));
  assert.equal(unparsable.excerpt, '{"summary": "ok", }');
  const good = parseDiagnosisOutput(
    'reply: {"summary": " fine ", "errors": [], "anomalies": ["a"], "next_steps": ["b"]}',
  );
  assert.deepEqual(good, {
    diagnosis: { summary: 'fine', errors: [], anomalies: ['a'], next_steps: ['b'] },
  });
  check('parser', { verdicts: [noObject, badSummary, badItem, missingList, unparsable, good] });

  report.verdict = 'passed';
} catch (error) {
  report.verdict = 'failed';
  report.error = String(error.stack || error);
  throw error;
} finally {
  report.finished_at = new Date().toISOString();
  writeFileSync(join(run, 'report.json'), JSON.stringify(report, null, '\t') + '\n');
  console.log(`${report.verdict}: ${join(run, 'report.json')}`);
}
