#!/usr/bin/env tsx
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Whether the preview server process died during a failed E2E attempt.
//
// This command reports a fact and nothing else. Whether that fact should produce a retry is the
// workflow's decision, and it has to be, because a step that errors publishes no output at all: a
// default-branch push must retry whatever happens here, so its rule cannot depend on this command
// succeeding. `templates/workflows/ci.yml` therefore ORs `E2E_RETRY_UNCONDITIONAL` in front of this
// output rather than passing the flag down — one rule, in the one place that survives a failure.
//
// The distinction being drawn is between a suite that failed and a suite that never got to run. A
// pull request must not retry the first: that is what hides a real flake before it is merged
// (#872). It may retry the second, because the preview server dying is produced by the CI substrate
// rather than by the diff under review. The rule lives in a script rather than in the workflow's
// shell because it is the one part of the chain that can be wrong without anyone noticing — a
// signature that stops matching silently stops retrying — and here it has unit tests that turn that
// drift into a red build.

// The crash, spelled as wrangler spells it in the debug log the E2E job already uploads as
// `e2e-web-server-log`. **Every** string here must be present, not any of them, and the conjunction
// is the point: each half is individually weaker than it looks. `Network connection lost.` is
// logged by workerd for any aborted in-flight request — a page closing, a navigation, a timeout —
// so a suite that merely failed can produce it with the server perfectly healthy. `Error in
// ProxyController` is the structural marker for a worker that is gone, but it is not established
// that wrangler never emits it while tearing the proxy down, which happens at the end of every run
// including a failing one. Requiring both costs nothing — an observed crash carries them together —
// and each one narrows the other's exposure.
const CRASH_SIGNATURES: ReadonlyArray<string> = [
	'Error in ProxyController',
	'Network connection lost.',
]

// Both are the workflow's values, exported so the guard in `ci-yml-e2e-retry.test.ts` can assert
// this command reads the log that job actually writes. A rename on one side alone would leave the
// check reading nothing and quietly reporting "no crash" on every run.
const LOG_PATH_VARIABLE = 'WRANGLER_LOG_PATH'
const DEFAULT_LOG_DIRECTORY = 'e2e-web-server-logs'
const OUTPUT_NAME = 'crashed'

function has_crash_signature(log_text: string): boolean {
	return CRASH_SIGNATURES.every((signature) => log_text.includes(signature))
}

function read_file_safe(file_path: string): string {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return ''
	}
}

// Every file under the directory, because wrangler names the debug log after the run and a job that
// restarted the server leaves more than one.
function read_directory_text(directory: string): string {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => read_file_safe(path.join(entry.parentPath, entry.name)))
		.join('\n')
}

// Nothing about reading a log may be fatal: this command decides whether to spend one more CI
// minute, and throwing would fail the job over a diagnostic. Every way the path can disappoint ends
// at the same answer — it is missing, it is a file rather than the expected directory (a spelling
// `WRANGLER_LOG_PATH` supports, which is why the workflow strips a trailing slash), or it cannot be
// read at all. An empty read is then reported as "no crash", which is the safe verdict: a consumer
// whose preview script is not wrangler writes no log, and reading silence as a crash would retry
// every failing suite in that project — the masking this rule exists to prevent.
function read_log_text(target: string): string {
	try {
		return statSync(target).isDirectory() ? read_directory_text(target) : read_file_safe(target)
	} catch {
		return ''
	}
}

// The one write this command makes, and the only call left that could throw: a full disk, a
// read-only mount, an output file the runner removed. Nothing here may be fatal — a job must not go
// red over a step that only decides whether to spend one more CI minute — so the failure is
// announced and stepped over. A verdict that cannot be published simply does not produce a retry,
// which for a pull request is the status quo and for the default branch is nothing at all, since
// the flag there is read ahead of this output.
function write_github_output(has_crashed: boolean): void {
	const output_path = process.env['GITHUB_OUTPUT']
	if (output_path === undefined || output_path === '') return

	try {
		appendFileSync(output_path, `${OUTPUT_NAME}=${String(has_crashed)}\n`)
	} catch {
		console.info('::warning::Could not publish the E2E crash check verdict; no retry will follow.')
	}
}

function resolve_log_directory(): string {
	const configured = process.env[LOG_PATH_VARIABLE] ?? ''

	return configured === '' ? DEFAULT_LOG_DIRECTORY : configured
}

function run_retry_check(): boolean {
	const has_crashed = has_crash_signature(read_log_text(resolve_log_directory()))
	const verdict = has_crashed
		? 'the preview server log carries a crash signature'
		: 'no crash signature in the preview server log, so the suite itself failed'

	console.info(`::notice::E2E preview server crash check: ${verdict}`)
	write_github_output(has_crashed)

	return has_crashed
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	run_retry_check()
}

const e2e_retry_check = {
	has_crash_signature,
	read_log_text,
	resolve_log_directory,
	run_retry_check,
}

export { e2e_retry_check, CRASH_SIGNATURES, DEFAULT_LOG_DIRECTORY, LOG_PATH_VARIABLE, OUTPUT_NAME }
