import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A real Pangram analysis, placed by Stado on a Weles host through
// `stado workload run weles-browser-task` with the pangram_analyze_text
// action: the run's `pangram` output must carry the analysed `text` and the
// `windows` Pangram labelled, each with offsets inside that text, a label
// and a likelihood, so a caller colouring words gets more than one verdict
// for the whole text. The text to analyse is the test's own input,
// WELES_TEST_PANGRAM_TEXT; WELES_TEST_TARGET pins the host when set. No
// text is a failed run, never a passed one.
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = join(root, "build/real-tests/pangram-windows", randomUUID());
mkdirSync(directory, { recursive: true });
const report = {
  command: [process.execPath, ...process.execArgv, ...process.argv],
  source_revision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  started_at: new Date().toISOString(),
  stado: null,
  cases: [],
};
const save = () =>
  writeFileSync(join(directory, "report.json"), JSON.stringify(report));
process.once("exit", (code) => {
  report.exit_status = code;
  report.finished_at = new Date().toISOString();
  save();
});
save();

test("a placed Pangram run leaves windows over the analysed text", () => {
  const text = process.env.WELES_TEST_PANGRAM_TEXT;
  assert.ok(text, "WELES_TEST_PANGRAM_TEXT names the text to analyse");
  const plan = join(directory, "pangram.plan.json");
  writeFileSync(
    plan,
    JSON.stringify({
      schema: "wisent.weles-browser-task-plan.v1",
      action: "pangram_analyze_text",
      url: "https://www.pangram.com/",
      objective: "Submit the text to Pangram and read its verdict.",
      session_label: "weles-test-pangram-windows",
      allow_login: true,
      params: { pangram_text: text },
    }),
  );
  const args = [
    "workload",
    "run",
    "weles-browser-task",
    "--plan",
    plan,
    "--json",
  ];
  if (process.env.WELES_TEST_TARGET)
    args.push("--target", process.env.WELES_TEST_TARGET);
  const run = spawnSync("stado", args, { encoding: "utf8" });
  report.stado = {
    command: ["stado", ...args],
    status: run.status,
    signal: run.signal,
    stdout: run.stdout,
    stderr: run.stderr,
  };
  save();
  assert.ok(
    run.status !== null,
    `stado ended by signal ${run.signal}: ${run.stderr}`,
  );
  assert.ok(!run.status, `stado refused the run: ${run.stderr}`);
  const document = JSON.parse(run.stdout);
  assert.ok(document.ok, `the run ended failed: ${document.stderr_tail}`);
  const pangram = document.outputs?.pangram;
  assert.ok(
    pangram,
    `the run left no pangram output: ${JSON.stringify(document.outputs)}`,
  );
  assert.equal(
    typeof pangram.text,
    "string",
    "the output carries the analysed text",
  );
  assert.ok(
    Array.isArray(pangram.windows) && pangram.windows.length,
    "the output carries windows",
  );
  for (const window of pangram.windows) {
    assert.ok(
      Number.isInteger(window.start_index) &&
        Number.isInteger(window.end_index) &&
        window.start_index < window.end_index &&
        window.end_index <= pangram.text.length,
      `window offsets lie inside the analysed text: ${JSON.stringify(window)}`,
    );
    assert.equal(
      typeof window.label,
      "string",
      `the window carries a label: ${JSON.stringify(window)}`,
    );
    assert.ok(
      Number.isFinite(window.ai_likelihood),
      `the window carries a likelihood: ${JSON.stringify(window)}`,
    );
  }
  report.cases.push({
    name: "windows",
    status: "passed",
    run_id: document.run_id,
    host: document.host,
    windows: pangram.windows.length,
  });
  save();
});
