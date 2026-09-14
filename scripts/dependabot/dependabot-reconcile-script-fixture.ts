import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'

// Runs the reconciling step's own script against a `gh` that answers as a case describes and records
// what it was asked to do. The step's shell is where joshuafolkken/kit#845 put the arm-versus-withdraw
// choice and joshuafolkken/kit#846 put the retry policy, and neither is an expression any more — so
// the guards on them execute the script rather than matching substrings in it.
const { RECONCILE_STEP_ID, DECISION_VARIABLE, ENTITLEMENT_VARIABLE, DIAGNOSTIC_VARIABLE } =
	dependabot_workflow_fixture
const { MERGE_COMMAND, template_job, find_step, step_run } = dependabot_workflow_fixture

const WITHDRAW_COMMAND = 'gh pr merge --disable-auto'
const COMMENT_COMMAND = 'pr comment'
const ARMED_QUERY = '--json autoMergeRequest'
const WITHDRAW_CALL = 'pr merge --disable-auto'
const ARM_CALL = 'pr merge --auto --merge'
const ARMED_MARKER = 'auto'
const WITHDRAWN_MARKER = 'disable'
const NOTHING = ''
const METADATA_SILENT = 'metadata step did not answer'
const ARMED_NOTICE_TEXT = 'Auto-merge is enabled'
const TRUE = 'true'
const FALSE = 'false'
const EXECUTABLE_MODE = 0o755
const HEAD_SHA = 'cafebabe'
// The two outcomes the marker distinguishes, so a re-run that learned more is not silenced by the
// weaker notice already standing.
const ARMED_OUTCOME = 'armed'
const UNKNOWN_OUTCOME = 'unknown'
// More failures than any retry budget can outlast, so a case can model an outage that never lifts —
// including the dedup lookup, which goes through the same call as the state read.
const LASTING_OUTAGE = 99
const ONE_DIRECTION = 2

const workspace = mkdtempSync(path.join(tmpdir(), 'reconcile-'))

interface Case {
	should_be_armed: string
	may_arm: string
	is_armed: boolean
	metadata_answered?: string
	fail_reads?: number
	fail_merges?: number
	/** Fails the first N comment lookups on top of `fail_reads`, to exercise their own retry. */
	fail_posted_reads?: number
	/** Fails the first N armed-state reads on top of `fail_reads`, leaving the lookup working. */
	fail_state_reads?: number
	/** Fails armed-state reads from the Nth onward, so an early one can succeed and a later one not. */
	fail_state_reads_from?: number
	/** Fails the first N `gh pr comment` calls, to exercise the notice's retry. */
	fail_comments?: number
	expect_failure?: boolean
	posted_notice?: string
}

// What the reconciling script did: which direction it took, and what it said about why.
interface Outcome {
	direction: string
	stderr: string
}

function remove_workspace(): void {
	rmSync(workspace, { recursive: true, force: true })
}

// The reconciling step's own `env`, minus the entries GitHub would have expanded. Taking the retry
// count from the workflow rather than restating it here keeps the cases honest about what a runner
// actually does.
function literal_step_environment(): Record<string, string> {
	// Typed as unknown on purpose: an unquoted `RETRY_ATTEMPTS: 3` parses as a number, and calling a
	// string method on it would take the whole suite down with a `TypeError` rather than report that
	// the workflow declared something these guards cannot read.
	const declared: Record<string, unknown> = find_step(template_job(), RECONCILE_STEP_ID)?.env ?? {}

	return Object.fromEntries(
		Object.entries(declared)
			.filter(([, value]) => typeof value === 'string' && !value.includes('${{'))
			.map(([key, value]) => [key, String(value)]),
	)
}

// Refused rather than coerced: `Number(undefined)` is `NaN`, which the stub would interpolate as the
// string `NaN` and then never fail a call, so every retry case would pass without retrying anything.
function withdraw_attempts(): number {
	const declared = Number(literal_step_environment()['RETRY_ATTEMPTS'])

	if (!Number.isSafeInteger(declared)) {
		throw new TypeError('the reconciling step declares no RETRY_ATTEMPTS')
	}

	return declared
}

// The marker the workflow prefixes to its notice, scoped to a head so a case can seed one the run
// should recognize — or one written for a different head, which it should not.
function notice_marker(outcome: string = ARMED_OUTCOME, head_sha: string = HEAD_SHA): string {
	const declared = literal_step_environment()['NOTICE_MARKER']

	// Refused rather than defaulted: an empty marker is matched by every comment, so both dedup
	// guards would pass without the workflow declaring anything for them to match on.
	if (declared === undefined) throw new Error('the reconciling step declares no NOTICE_MARKER')

	return `${declared} ${head_sha} ${outcome} -->`
}

function recorded_calls(): string {
	return readFileSync(path.join(workspace, 'calls'), 'utf8')
}

// How many times the script asked `gh` to do each thing, so a case can assert that the withdrawal
// retried and the arming did not.
function call_count(matches: string): number {
	return recorded_calls()
		.split('\n')
		.filter((line) => line.includes(matches)).length
}

// What the run actually asked `gh pr comment` to post.
function posted_body(): string {
	return recorded_calls()
		.split('\n')
		.filter((line) => line.includes(COMMENT_COMMAND))
		.join('\n')
}

// Both directions are read, not just the first that matches: a script that armed *and* withdrew is
// the double-write these guards exist to catch, and reporting the first hit would hide it.
function directions_taken(): string {
	// The comment call is in the log too, and its body is prose this workflow writes: reading a
	// direction out of it would report one the run never took.
	const calls = recorded_calls()
		.split('\n')
		.filter((line) => !line.includes(COMMENT_COMMAND))
		.join('\n')
	const taken = [
		calls.includes('--disable-auto') ? WITHDRAWN_MARKER : NOTHING,
		calls.includes('--auto --merge') ? ARMED_MARKER : NOTHING,
	].filter(Boolean)

	expect(taken.length).toBeLessThan(ONE_DIRECTION)

	return taken[0] ?? NOTHING
}

// Answers `gh pr view` with the armed state the case describes, records every call so the assertion
// can name which direction the script took, and fails the first `fail_reads` / `fail_merges` of each
// so a case can model an API that is briefly, or lastingly, unavailable.
// How the stub answers `gh pr view`, for the armed state and for the standing-notice lookup. A read
// outage is an outage of the call, whatever it was asked for — the two go through the same API — so
// `fail_reads` counts them together, which is why the dedup cannot help when the state read is what
// never succeeded. `fail_posted_reads` fails only the lookup, to exercise its own retry.
function stub_reads(scenario: Case, reads: string): Array<string> {
	const posted = path.join(workspace, 'posted')
	const lookups = path.join(workspace, 'lookups')
	const states = path.join(workspace, 'states')

	return [
		'if [ "$2" = "view" ]; then',
		`  echo x >>"${reads}"`,
		`  [ "$(wc -l <"${reads}")" -le ${String(scenario.fail_reads ?? 0)} ] && exit 1`,
		'  if [[ "$*" == *comments* ]]; then',
		`    echo x >>"${lookups}"`,
		`    [ "$(wc -l <"${lookups}")" -le ${String(scenario.fail_posted_reads ?? 0)} ] && exit 1`,
		`    cat "${posted}"`,
		'    exit 0',
		'  fi',
		`  echo x >>"${states}"`,
		`  [ "$(wc -l <"${states}")" -le ${String(scenario.fail_state_reads ?? 0)} ] && exit 1`,
		`  [ "$(wc -l <"${states}")" -ge ${String(scenario.fail_state_reads_from ?? LASTING_OUTAGE)} ] && exit 1`,
		`  echo '${String(scenario.is_armed)}'`,
		'  exit 0',
		'fi',
	]
}

// How it answers the two calls that change something: the merge, and the notice.
function stub_writes(scenario: Case, merges: string): Array<string> {
	const comments = path.join(workspace, 'comments')

	return [
		'if [ "$2" = "merge" ]; then',
		`  echo x >>"${merges}"`,
		`  [ "$(wc -l <"${merges}")" -le ${String(scenario.fail_merges ?? 0)} ] && exit 1`,
		'fi',
		'if [ "$2" = "comment" ]; then',
		`  echo x >>"${comments}"`,
		`  [ "$(wc -l <"${comments}")" -le ${String(scenario.fail_comments ?? 0)} ] && exit 1`,
		'fi',
	]
}

function stub_script(scenario: Case, calls: string, reads: string, merges: string): string {
	return [
		'#!/usr/bin/env bash',
		`echo "$*" >>"${calls}"`,
		...stub_reads(scenario, reads),
		...stub_writes(scenario, merges),
		'exit 0',
		'',
	].join('\n')
}

// Written out rather than interpolated into the stub: a notice containing an apostrophe would
// otherwise close the quoting around it and change what the stub answers.
function seed_posted_notice(scenario: Case): void {
	writeFileSync(path.join(workspace, 'posted'), scenario.posted_notice ?? '')
}

// The three logs the stub appends to, emptied so each case counts only its own calls.
function reset_call_logs(): [string, string, string] {
	const logs: [string, string, string] = [
		path.join(workspace, 'calls'),
		path.join(workspace, 'reads'),
		path.join(workspace, 'merges'),
	]

	const extra = ['lookups', 'comments', 'states'].map((name) => path.join(workspace, name))

	for (const name of [...logs, ...extra]) writeFileSync(name, '')

	return logs
}

function write_gh_stub(scenario: Case): string {
	const bin = path.join(workspace, 'bin')
	const stub = path.join(bin, 'gh')

	mkdirSync(bin, { recursive: true })
	seed_posted_notice(scenario)

	const [calls, reads, merges] = reset_call_logs()

	writeFileSync(stub, stub_script(scenario, calls, reads, merges))
	chmodSync(stub, EXECUTABLE_MODE)

	return bin
}

function run_reconcile(scenario: Case): Outcome {
	const bin = write_gh_stub(scenario)
	const script = step_run(find_step(template_job(), RECONCILE_STEP_ID))

	// A renamed step yields the empty script, which bash runs happily and which would make every
	// "does nothing" case pass without testing anything.
	expect(script).toContain(MERGE_COMMAND)
	expect(script).toContain(WITHDRAW_COMMAND)

	const result = spawnSync('bash', ['-e', '-c', script], {
		encoding: 'utf8',
		env: {
			...process.env,
			...literal_step_environment(),
			PATH: `${bin}:${process.env['PATH'] ?? ''}`,
			[DECISION_VARIABLE]: scenario.should_be_armed,
			[ENTITLEMENT_VARIABLE]: scenario.may_arm,
			[DIAGNOSTIC_VARIABLE]: scenario.metadata_answered ?? TRUE,
			PR_URL: 'https://example.invalid/pr/1',
			HEAD_SHA,
			// Zero so the suite does not wait out the workflow's own backoff; the retry count is the
			// workflow's, read from the step rather than substituted here.
			RETRY_BACKOFF_SECONDS: '0',
		},
	})

	expect(result.status === 0).toBe(scenario.expect_failure !== true)

	return { direction: directions_taken(), stderr: result.stderr }
}

const reconcile_script_fixture = {
	ARM_CALL,
	ARMED_MARKER,
	ARMED_QUERY,
	COMMENT_COMMAND,
	FALSE,
	METADATA_SILENT,
	ARMED_NOTICE_TEXT,
	NOTHING,
	TRUE,
	WITHDRAWN_MARKER,
	WITHDRAW_CALL,
	HEAD_SHA,
	LASTING_OUTAGE,
	ARMED_OUTCOME,
	UNKNOWN_OUTCOME,
	call_count,
	notice_marker,
	posted_body,
	remove_workspace,
	run_reconcile,
	withdraw_attempts,
}

export { reconcile_script_fixture }
export type { Case, Outcome }
