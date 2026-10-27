# Recordings

Every run writes its evidence (HAR, PCAP, screenshots, screencast, proxy
preflight, session metadata, credential capture) under
`$WELES_RECORDINGS_ROOT/<run_uuid>/`. On a host, the root is the registry's
`targets[].weles.recordings_dir`, which Stado's `weles-recordings` workload
writes into the Weles LaunchAgents; the release launcher passes it on and
refuses to start, naming the variable and that workload, when the LaunchAgent
does not state it. A library or CLI caller states it before opening a
session. With it unset, the first write of evidence is refused naming the
variable; no directory under the working directory or the home directory is
assumed.

The run importer that builds a result's session provenance, the artifact
uploader and recording pruning all read this one root, so evidence a run wrote
is the evidence its result reports and uploads.

The API server reads a run's named result documents from this tree into
`outputs` (a generic task's `generic_task_result.json` as
`generic_browser_task`). A document that does not parse is named under
`output_errors` with its parse error rather than read as absent, and a
JSON-looking stdout line that does not parse is kept beside the run's
`result` as `result_errors`. `node --test tests/runs/result-files.mjs` writes
recording trees under its own recordings directory and checks both readings.

## Browser-evidence ledger

A run under the browser-evidence policy (`WELES_BROWSER_EVIDENCE_POLICY`
set to the policy version) writes `browser_evidence_policy.json` and appends
every withheld edge to `browser_evidence_withheld_edges.ndjson` in its run
directory; the run's label names that directory, and a run without one is
refused before the policy is installed. Each edge names its `category`, the
`api`, `tool` or `url` it concerns and, where something was refused or could
not be enforced, the `reason`. A page API the init script could not withhold
is recorded as `page_api_unenforced` with the page's own error; a report the
page could not hand to Weles is written to the page console as
`[weles] withheld <api> was not recorded: <cause>`.

The run's one target (`WELES_BROWSER_EVIDENCE_TARGET_ORIGIN`, `_HOST` and
`_ADDRESSES_JSON`) is admitted only when every address it is pinned to and
resolves to is public, and public is what IANA's IPv4 and IPv6
Special-Purpose Address Registries say: an address in a registered block is
public only when its most specific block is declared Globally Reachable. A
refusal names the address, the block and its registry name. Weles reads the
registries from iana.org once per process; when they cannot be read, no
target is admitted and the refusal says why. A setting that is missing or
malformed is refused naming that setting. The close-time fingerprint's
WebRTC routing rules judge candidate addresses by the same reading; when the
registries could not be read, the report carries the rule's error instead of
a verdict.

A run's cost rollup is `recordings/_costs/<ACTION_LOG_ID>.json`. A rollup
that cannot be read is never overwritten, and a run without `ACTION_LOG_ID`
has no rollup file; both are written to stderr as
`[cost] cost rollup not written: <cause>` when the process ends.

## Page-init patch failures

A page-init patch that cannot install itself (the screen or the WebRTC shim)
writes its failure on the page's console, and Weles keeps each one as a line
of `page-init-failures.jsonl` in the session's recordings directory and logs
`[page-init] patch failed on <url>: <report>`. A failed WebRTC shim, or a
report Weles cannot read, closes that page, because native WebRTC hands the
site the host and public addresses behind the proxy; the line then carries
`action: page closed: <why>`, and a trajectory using the page fails on the
closed page.

## Fingerprint detection reports

A closing session writes `fingerprint.json` and, when a baseline directory
exists (`WELES_BASELINE_DIR`, else `recordings/baselines`),
`detection_report.json`. The baseline is the one captured in the subject's
own browser family, the same `navigator.platform` and `navigator.vendor`,
the most recent when several are; a directory holding none of that family is
refused naming the subject's family and the families it holds. The report
counts findings per severity (`critical`, `warning`, `info`) and per
category; it carries no weighted score. A rule that could not judge is an
`info` finding `<rule>_error` with its cause. When the only change since the
early capture is TLS session resumption (the `pre_shared_key` extension), the
TLS mismatch findings it explains are removed and the counts are recomputed.

The LinkedIn signup checks the fingerprint before LinkedIn sees the account:
any critical finding, or at least `WELES_EARLY_FP_WARNINGS` warnings, stops
the run with `FINGERPRINT_INCONSISTENT`. A check that cannot run (no baseline
directory, no baseline of the subject's family, an unreadable probe) stops it
with its cause; `WELES_EARLY_FP=0` registers without the check.

## Secrets in session metadata

A run's `session_meta.json` keeps the names of the environment variables it
ran with as `env_names`, sorted, and never their values: no reading of a
variable's name tells a secret from a setting, and nothing reads a recorded
value back. Runs recorded earlier kept the environment itself as `env_all`,
in clear or with name-matched values redacted. `weles recordings scrub
[--json]` rewrites every such envelope under `WELES_RECORDINGS_ROOT` to
`env_names` and answers `root`, the `scrubbed` files, how many were already
`clean`, and every `failed` file with why (unreadable, not JSON, `env_all`
not an object); any failure makes the command exit non-zero after listing
all of them. The run importer carries `env_names` (or an old envelope's
names) into the imported session, and a run without session metadata carries
none rather than the importer's own environment.

A value that was in a recording in clear is to be rotated where it is issued,
through Skarbiec; scrubbing removes the copy, not the exposure.

## Pointer trace

Every pointer move and scroll Weles makes replays a person's recorded hand:
`$WELES_RECORDINGS_ROOT/pointer-trace.json` holds stretches of pointer travel
between two presses and the wheel steps scrolled with. A move picks one
stretch with the run's seeded draw and carries it onto the move's start and
end by turning and scaling it whole, so the curve and the spacing of its
points are the person's; a scroll is made of recorded wheel steps, the last
one cut to the distance left. A click or hover lands at a point inside the
settled target drawn the same way. Nothing in Weles writes pointer geometry
of its own and nothing pauses on a clock: each step waits on the page
settling.

The trace is harvested from the instrumentation dumps (`<time>.inst.json`)
of runs a person drove, a keeper or operator session, whose page input
recorder logged every pointermove, press and wheel event:

```text
weles pointer harvest $WELES_RECORDINGS_ROOT/<run>/<time>.inst.json [...] [--json]
weles pointer show [--json]
```

`harvest` refuses a dump without an access log, and dumps that hold no
travel between presses or no vertical wheel step, naming them; it writes the
trace with the dumps it came from. A Weles automated run is not a source: its
moves are this trace replayed. On a host without the trace every move and
scroll is refused with `no pointer trace at <path>` and the harvest command
to run.

With `WELES_INPUT=native` the same travel goes through the OS event queue
(cliclick). A page coordinate becomes a screen coordinate by the page
content's screen origin, measured once per page: the OS pointer is put inside
the window's content area and the page's own pointer event answers
`screenX - clientX` and `screenY - clientY`. No toolbar height, window
position or jitter is assumed; a page that is not focused and visible, or a
frontmost application this run did not launch, is refused.

A raw `CDPPage` (`page.mouse`, `page.keyboard`) follows the same trace: each
move replays a recorded segment unless `WELES_INSTANT_INPUT=1` asks for one
event; a press's click count is the presses made since the pointer last
moved, and a press, release or wheel before any move is refused. Keys are
described by the US layout Playwright declares for the Chromium it drives,
modifiers are sent as the protocol's mask, and a key the layout does not name
is refused. `page.keyboard.press` takes a chord as Playwright writes it
(`Control+A`, `ControlOrMeta+K`, `Shift++`): modifiers go down in order, the
last key is pressed, and keys come up in reverse; a modifier already held stays
held. `ControlOrMeta` is Meta when the driven Chromium reports a macOS user
agent (`Browser.getVersion`), Control otherwise. Every key of the chord is
checked before the first event, so an unknown key sends nothing.
