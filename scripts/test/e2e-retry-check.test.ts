import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	CRASH_SIGNATURES,
	DEFAULT_LOG_DIRECTORY,
	e2e_retry_check,
	OUTPUT_NAME,
} from './e2e-retry-check'
import { OBSERVED_CRASH_LOG } from './e2e-retry-check-crash-fixture'
import { OBSERVED_HEALTHY_FAILURE_LOG } from './e2e-retry-check-healthy-fixture'

// A wrangler debug log from a run whose worker died. Trimmed to the lines the rule reads, with
// ordinary request logging around them so the guard is not satisfied by a file that is nothing but
// the signature.
const CRASHED_LOG = `
[wrangler:info] GET /en 200 OK (12ms)
Error in ProxyController: Error inside ProxyWorker
  cause: { name: 'Error', message: 'Network connection lost.' }
`

// The same shape for a run whose tests simply failed: the server logged every request and exited
// normally. Nothing here may be read as a crash, or a real failure gets a free second attempt.
const FAILED_SUITE_LOG = `
[wrangler:info] GET /en 200 OK (12ms)
[wrangler:info] GET /en/about 200 OK (8ms)
[wrangler:info] Shutting down local server.
`

// workerd logs this for any aborted in-flight request — a page closing, a navigation, a timeout —
// so it appears in runs where the server was never in trouble. It sits in the `cause` of every
// observed crash, which is exactly what makes it tempting and wrong.
const ABORTED_REQUEST_LOG = `
[wrangler:info] GET /en 200 OK (12ms)
workerd/io/io-context.c++: Network connection lost.
`

// The structural marker on its own, with no aborted connection behind it. A real teardown emits
// neither string (`OBSERVED_HEALTHY_FAILURE_LOG`), so this shape is not something wrangler is
// known to produce — which is the reason to keep it: the rule must stay wrong-proof against a
// build that starts emitting the marker alone, not merely against the builds observed so far.
const TEARDOWN_LOG = `
[wrangler:info] GET /en 200 OK (12ms)
Error in ProxyController: Error inside ProxyWorker
`

const CUSTOM_LOG_DIRECTORY = 'custom-logs/'
const LOG_FILE_NAME = 'wrangler.log'
const FIRST_LOG_FILE_NAME = 'wrangler-first.log'
const SECOND_LOG_FILE_NAME = 'wrangler-second.log'

// Assigning an absent value back writes the literal string "undefined", which leaves the variable
// set for everything that runs after this file — the opposite of restoring it. `vi.stubEnv` is what
// removes it properly; `delete process.env[name]` would do the same but on a computed key, which
// the lint rules ban.
function restore_environment(name: string, value: string | undefined): void {
	vi.stubEnv(name, value)
}

describe('e2e retry crash signature', () => {
	it('reads a dead preview server out of the log wrangler already writes', () => {
		expect(e2e_retry_check.has_crash_signature(CRASHED_LOG)).toBe(true)
	})

	// The property the whole rule rests on: a suite that failed on its own assertions must not look
	// like a crash, or a pull request would retry exactly the flake this gate exists to expose.
	it('does not read a crash out of a run whose tests merely failed', () => {
		expect(e2e_retry_check.has_crash_signature(FAILED_SUITE_LOG)).toBe(false)
	})

	// The narrowing this rule was corrected to. `Network connection lost.` is in the cause of every
	// observed crash, but workerd also logs it whenever an in-flight request is aborted, so matching
	// it would hand a retry to a genuinely failing pull request suite — the masking #872 exists to
	// prevent. The structural marker is present alongside it in a real crash, so nothing is lost.
	it('does not read a crash out of an aborted request alone', () => {
		expect(e2e_retry_check.has_crash_signature(ABORTED_REQUEST_LOG)).toBe(false)
	})

	// Neither half is sufficient alone, and the parameterized form is what keeps that true of a
	// signature added later: `Network connection lost.` appears whenever an in-flight request is
	// aborted, and a marker that reads as a crash on its own is one release away from matching a
	// log wrangler reshapes — the failure mode a signature has, and the one nothing else catches.
	it.each(CRASH_SIGNATURES)('does not read a crash out of %s alone', (signature) => {
		expect(e2e_retry_check.has_crash_signature(`prefix ${signature} suffix`)).toBe(false)
	})

	it('does not read a crash out of a proxy teardown with no aborted connection', () => {
		expect(e2e_retry_check.has_crash_signature(TEARDOWN_LOG)).toBe(false)
	})

	// The conjunction, asserted directly: every signature together is what a crash is.
	it('reads a crash when every signature is present', () => {
		expect(e2e_retry_check.has_crash_signature(CRASH_SIGNATURES.join(' ... '))).toBe(true)
	})
})

// The same rule, read against logs nobody wrote for it. Everything above this point is a fixture
// shaped to make a point; these two are what wrangler actually produced, and joshuafolkken/kit#911
// exists because the difference had never been checked.
describe('e2e retry crash signature against real wrangler logs', () => {
	it('reads a crash out of the log a preview server that died actually wrote', () => {
		expect(e2e_retry_check.has_crash_signature(OBSERVED_CRASH_LOG)).toBe(true)
	})

	// The doubt this suite was extended to settle: `Error in ProxyController` is emitted from the
	// proxy teardown that ends every run, the argument went, so a pull request whose tests merely
	// failed would be handed the retry that hides a flake. The observed log says otherwise —
	// neither signature is anywhere in a run that failed on an assertion with the server serving
	// every request throughout.
	it('does not read a crash out of a real run whose suite failed with a healthy server', () => {
		expect(e2e_retry_check.has_crash_signature(OBSERVED_HEALTHY_FAILURE_LOG)).toBe(false)
	})

	// Both real logs carry the bare `✘ [ERROR]` that #872 listed as a third crash marker, so
	// nothing may be built on it: in the healthy log it is an ordinary 404. Asserting it on both
	// sides is also what stops the healthy fixture from being trimmed down to a log with no errors
	// in it at all, which would pass the test above while proving nothing.
	it.each([
		['crashed', OBSERVED_CRASH_LOG],
		['healthy failure', OBSERVED_HEALTHY_FAILURE_LOG],
	])(
		'carries the console error marker in the %s log, so nothing may read it',
		(_name, log_text) => {
			expect(log_text).toContain('✘ [ERROR]')
		},
	)
})

describe('e2e retry check log reading', () => {
	let directory = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'e2e-retry-check-'))
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	it('reads nothing rather than throwing when the directory was never created', () => {
		expect(e2e_retry_check.read_log_texts(path.join(directory, 'absent'))).toEqual([])
	})

	// wrangler names the debug log after the run, and a job that restarted the server leaves more
	// than one file — under a dated subdirectory in some versions. Reading only the top level would
	// miss the crash exactly when the server had to be restarted.
	it('reads every file under the directory, including nested ones', () => {
		mkdirSync(path.join(directory, 'nested'))
		writeFileSync(path.join(directory, FIRST_LOG_FILE_NAME), 'quiet', 'utf8')
		writeFileSync(path.join(directory, 'nested', SECOND_LOG_FILE_NAME), CRASHED_LOG, 'utf8')

		expect(e2e_retry_check.has_crashed_log(e2e_retry_check.read_log_texts(directory))).toBe(true)
	})

	// The conjunction is per file, and this is the run that would break it otherwise: a server that
	// restarted leaves one log per attempt, and joining them lets an aborted request in the first
	// meet a proxy error in the second. Neither file is a crash, and the pair of them is not one
	// either — reading it as one would hand the retry to a failing pull request suite.
	it('does not read a crash out of two logs that carry one signature each', () => {
		writeFileSync(path.join(directory, FIRST_LOG_FILE_NAME), ABORTED_REQUEST_LOG, 'utf8')
		writeFileSync(path.join(directory, SECOND_LOG_FILE_NAME), TEARDOWN_LOG, 'utf8')

		expect(e2e_retry_check.has_crashed_log(e2e_retry_check.read_log_texts(directory))).toBe(false)
	})
})

// Every way the configured path can disappoint. They share one answer — "no crash", never a thrown
// error — because this command runs inside a step whose only job is to decide whether to spend one
// more CI minute, and a step that throws is a job that fails over a diagnostic.
describe('e2e retry check log path shapes', () => {
	let directory = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'e2e-retry-path-'))
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	// WRANGLER_LOG_PATH may name a file rather than a directory — a spelling wrangler supports, and
	// one the workflow acknowledges by stripping a trailing slash before using the value. Reading it
	// as a directory throws ENOTDIR, which on a default-branch push would fail the job over a
	// diagnostic; reading the file is both non-fatal and the answer the caller wanted.
	it('reads the log when the path names a file rather than a directory', () => {
		const file_path = path.join(directory, LOG_FILE_NAME)

		writeFileSync(file_path, CRASHED_LOG, 'utf8')

		expect(e2e_retry_check.has_crashed_log(e2e_retry_check.read_log_texts(file_path))).toBe(true)
	})

	// Nothing about reading a log may be fatal. An unreadable directory has to end at the same "no
	// crash" answer as a missing one, because the alternative is a thrown error inside a step whose
	// only job is to decide whether to spend one more CI minute. The mode is restored before the
	// suite's own cleanup, which cannot remove a directory it may not enter.
	it('reads nothing rather than throwing when the directory cannot be read', () => {
		const locked = path.join(directory, 'locked')

		mkdirSync(locked, { mode: 0o000 })

		try {
			expect(e2e_retry_check.read_log_texts(locked)).toEqual([])
		} finally {
			chmodSync(locked, 0o700)
		}
	})

	// The throw this guard exists for, reproduced without depending on the user the tests run as:
	// a path below a file makes stat fail with ENOTDIR every time, where an unreadable directory
	// merely reads as empty when the process happens to be root.
	it('reads nothing rather than throwing when the path descends into a file', () => {
		const file_path = path.join(directory, LOG_FILE_NAME)

		writeFileSync(file_path, CRASHED_LOG, 'utf8')

		expect(e2e_retry_check.read_log_texts(path.join(file_path, 'nested'))).toEqual([])
	})
})

describe('e2e retry check environment', () => {
	const original_log_path = process.env['WRANGLER_LOG_PATH']

	afterEach(() => {
		restore_environment('WRANGLER_LOG_PATH', original_log_path)
	})

	// The workflow points wrangler at a workspace-relative directory and the upload step reads the
	// same value; resolving it from the same variable is what keeps this command reading the file
	// that was actually written rather than a path repeated here and drifted since.
	it('reads the log directory from the variable the workflow already sets', () => {
		process.env['WRANGLER_LOG_PATH'] = CUSTOM_LOG_DIRECTORY

		expect(e2e_retry_check.resolve_log_directory()).toBe(CUSTOM_LOG_DIRECTORY)
	})

	it('falls back to the directory the workflow defaults to when the variable is unset', () => {
		delete process.env['WRANGLER_LOG_PATH']

		expect(e2e_retry_check.resolve_log_directory()).toBe(DEFAULT_LOG_DIRECTORY)
	})
})

describe('e2e retry check output', () => {
	const original_output = process.env['GITHUB_OUTPUT']
	const original_log_path = process.env['WRANGLER_LOG_PATH']
	let directory = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'e2e-retry-output-'))
	})

	afterEach(() => {
		restore_environment('GITHUB_OUTPUT', original_output)
		restore_environment('WRANGLER_LOG_PATH', original_log_path)
		rmSync(directory, { recursive: true, force: true })
	})

	// The workflow branches on this one line; a fact the step does not publish is a retry that never
	// happens however correct the rule above is.
	it('publishes the verdict under the name the workflow reads', () => {
		const output_path = path.join(directory, 'github-output')

		writeFileSync(output_path, '', 'utf8')
		writeFileSync(path.join(directory, LOG_FILE_NAME), CRASHED_LOG, 'utf8')
		process.env['GITHUB_OUTPUT'] = output_path
		process.env['WRANGLER_LOG_PATH'] = directory

		expect(e2e_retry_check.run_retry_check()).toBe(true)
		expect(readFileSync(output_path, 'utf8')).toContain(`${OUTPUT_NAME}=true`)
	})

	// Running the command outside Actions must not throw: it is invoked by hand when a maintainer
	// wants to know how a captured log would have been read.
	it('still reports a verdict when there is no Actions output file', () => {
		delete process.env['GITHUB_OUTPUT']
		process.env['WRANGLER_LOG_PATH'] = directory

		expect(e2e_retry_check.run_retry_check()).toBe(false)
	})
})
