# Recordings

Every run writes its evidence (HAR, PCAP, screenshots, screencast, proxy
preflight, session metadata, credential capture) under
`$WELES_RECORDINGS_ROOT/<run_uuid>/`. The release launcher exports
`WELES_RECORDINGS_ROOT`; a library or CLI caller states it before opening a
session. With it unset, the first write of evidence is refused naming the
variable; no directory under the working directory is assumed.

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
