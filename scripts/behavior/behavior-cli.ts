#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { status_icons } from '#scripts/lib/status-icons'
import { behavior_assertion, type Violation } from './behavior-assertion'
import { behavior_rules } from './behavior-rules'

// `josh behavior` — check the current run's recorded transcript against the behavior assertions and
// report where any broke (joshuafolkken/kit#2365). It runs inside `pnpm josh gate`, calls no model,
// and reads one file: the session it is running in.
//
// **The scope is the current run, not the whole corpus.** The store holds thousands of transcripts
// and over a gigabyte; walking all of it every gate would cost minutes, not the seconds the other
// checks take. Each gate checks its own run, so across runs the whole corpus is covered a run at a
// time — and the engine stays general, so a broad scan of past runs (the greenness check this seed
// assertion was verified with) is the same walk over a different set of files.

const PASS_EXIT_CODE = 0
const FAIL_EXIT_CODE = 1
const LABEL = 'josh behavior'

// The current run's transcript: the newest of the session's *own* files across the directories a run
// writes to, resolved by `cost-transcript.ts` exactly as `josh cost` resolves "the run that just
// finished". A gate runs inside that session, so its transcript is the newest own file.
function current_session(cwd: string = process.cwd()): SessionFile | undefined {
	const directories = cost_transcript.transcript_directories(cwd)
	const sessions = cost_transcript.list_sessions_across(directories)

	return sessions[cost_transcript.latest_own_index(sessions)]
}

// **A run with no transcript passes, and passes without the skip marker.** The gate reads `—
// skipping` to withhold its green record; a behavior check that found no transcript — a CI runner has
// none — has nothing to say about the tree and must not withhold the record the other checks earned.
function report_no_transcript(): number {
	console.info(`${LABEL}: no recorded transcript to check ${status_icons.PASS_ICON}`)

	return PASS_EXIT_CODE
}

// Which run and which point, in the assertion's own words — the failure names the place a reader
// opens rather than reporting that a rule broke somewhere.
function format_violation(violation: Violation): string {
	const where = `run ${violation.session_id} at position ${String(violation.position)}`

	return `${status_icons.FAIL_ICON} ${violation.assertion} broke in ${where}\n    ${violation.detail}`
}

function report_violations(violations: ReadonlyArray<Violation>): number {
	for (const violation of violations) console.error(format_violation(violation))
	console.error(`${LABEL}: ${String(violations.length)} behavior assertion(s) broke`)

	return FAIL_EXIT_CODE
}

function report_green(session_id: string): number {
	const count = String(behavior_rules.ALL_ASSERTIONS.length)

	console.info(`${LABEL}: ${count} assertion(s) green in ${session_id} ${status_icons.PASS_ICON}`)

	return PASS_EXIT_CODE
}

function check_session(file: SessionFile): number {
	const text = cost_transcript.read_optional(file)

	if (text === undefined) return report_no_transcript()

	const violations = behavior_assertion.check_transcript(
		text,
		file.session_id,
		behavior_rules.ALL_ASSERTIONS,
	)

	return violations.length > 0 ? report_violations(violations) : report_green(file.session_id)
}

function run(cwd: string = process.cwd()): number {
	const file = current_session(cwd)

	return file === undefined ? report_no_transcript() : check_session(file)
}

const behavior_cli = { LABEL, check_session, current_session, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run()

export { behavior_cli }
