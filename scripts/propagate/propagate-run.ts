import { status_icons } from '#scripts/status-icons'
import type { PropagateTarget } from './propagate-targets'

// Running the per-consumer sequence, and reporting what happened to every consumer.
//
// One consumer's failure never stops another: the whole point of the command is to leave the run
// knowing which consumers took the release and which did not, and a run that aborts on the first
// failure answers that for a prefix of them (joshuafolkken/kit#863).

// The steps, in order, that carry a release into one consumer. `josh` here is the consumer's own
// installed CLI, run from the consumer's directory — which is what keeps kit's self-sync guard
// (joshuafolkken/kit#868) out of the way: the sync runs in a consumer project, where it belongs.
const STEP_PRECHECK = 'working tree check'
const STEP_UPGRADE = 'josh vu'
const STEP_SYNC = 'josh sync'
const STEP_VERIFY = 'verification gate'
const STEP_ISSUE = 'open issue'
const STEP_PR = 'josh git'
const STEP_RETURN = 'return to default branch'
// The precheck is first for the reason it exists: everything after it writes. A consumer with
// uncommitted work must be refused before `josh vu` touches its lockfile, not after.
const STEP_ORDER: ReadonlyArray<string> = [
	STEP_PRECHECK,
	STEP_UPGRADE,
	STEP_SYNC,
	STEP_VERIFY,
	STEP_ISSUE,
	STEP_PR,
	STEP_RETURN,
]
const PROPAGATED_REASON = 'opened a pull request'

type RunOutcome = 'propagated' | 'failed' | 'skipped'

interface StepResult {
	step: string
	is_ok: boolean
	detail?: string
	// Set when the step succeeded *and* there is nothing left to do — an upgrade that changed no
	// file, for instance. The sequence ends here as a skip rather than opening an empty pull request.
	is_complete?: boolean
}

interface TargetResult {
	repo: string
	outcome: RunOutcome
	reason: string
	steps: ReadonlyArray<StepResult>
}

// One step's execution, injected so the sequencing is testable without spawning anything.
type RunStep = (target: PropagateTarget, step: string) => StepResult

const SKIP_REASONS: Readonly<Record<string, string>> = {
	up_to_date: 'already carries this release',
	not_downstream: 'does not depend on this package',
	missing_checkout: 'no local checkout at the mapped path — reported, not cloned',
	unreadable: 'package.json could not be read',
}

// The reason text for a candidate that is not going to be processed. A missing local checkout is
// reported rather than cloned: propagation writes to a working tree, and creating one nobody asked
// for is not a step this command may take on its own.
function skip_reason(target: PropagateTarget): string {
	return SKIP_REASONS[target.state] ?? 'not eligible'
}

const LEFTOVER_NOTE = ' — upgrade/sync changes left uncommitted'

// Whether the failure happened after a step that writes into the consumer. The pre-check writes
// nothing, so a consumer refused there is untouched; everything later leaves changes behind, and a
// run that does not say so leaves a working tree the *next* run will silently refuse.
function has_leftover_changes(steps: ReadonlyArray<StepResult>): boolean {
	return steps.some((result) => result.step === STEP_UPGRADE)
}

function failure_reason(result: StepResult, steps: ReadonlyArray<StepResult>): string {
	const base =
		result.detail === undefined
			? `${result.step} failed`
			: `${result.step} failed: ${result.detail}`

	return has_leftover_changes(steps) ? `${base}${LEFTOVER_NOTE}` : base
}

// Run one consumer's sequence, stopping at its first failing step. Stopping is per consumer: a
// failed verification gate must not go on to open a pull request for that consumer, and must not
// affect any other.
// The result a step ends the sequence with, or nothing when the sequence continues.
function terminal_result(
	repo: string,
	result: StepResult,
	steps: ReadonlyArray<StepResult>,
): TargetResult | undefined {
	if (!result.is_ok) {
		return { repo, outcome: 'failed', reason: failure_reason(result, steps), steps }
	}

	if (result.is_complete === true) {
		return { repo, outcome: 'skipped', reason: result.detail ?? 'nothing to do', steps }
	}

	return undefined
}

function run_target(
	target: PropagateTarget,
	run_step: RunStep,
	success_reason: string = PROPAGATED_REASON,
): TargetResult {
	const steps: Array<StepResult> = []

	for (const step of STEP_ORDER) {
		const result = run_step(target, step)

		steps.push(result)
		const terminal = terminal_result(target.repo, result, steps)

		if (terminal !== undefined) return terminal
	}

	return { repo: target.repo, outcome: 'propagated', reason: success_reason, steps }
}

// Every candidate's result, in the order the map produced them. Candidates that are not ready are
// recorded as skips rather than dropped, so the report accounts for every repository considered.
function run_targets(
	targets: ReadonlyArray<PropagateTarget>,
	run_step: RunStep,
	success_reason: string = PROPAGATED_REASON,
): Array<TargetResult> {
	return targets.map((target) =>
		target.state === 'ready'
			? run_target(target, run_step, success_reason)
			: { repo: target.repo, outcome: 'skipped' as const, reason: skip_reason(target), steps: [] },
	)
}

// Whether the run as a whole failed. A skip is not a failure — a consumer that already carries the
// release, or never depended on the package, is a correct outcome.
function has_failure(results: ReadonlyArray<TargetResult>): boolean {
	return results.some((result) => result.outcome === 'failed')
}

const OUTCOME_ICONS: Readonly<Record<RunOutcome, string>> = {
	propagated: '✓',
	failed: status_icons.FAIL_ICON,
	skipped: '–',
}

function format_result(result: TargetResult): string {
	return `  ${OUTCOME_ICONS[result.outcome]} ${result.repo}  ${result.reason}`
}

// The whole run, as one block. Printed together at the end rather than streamed, so the answer to
// "which consumers took this release" is in one place instead of interleaved with four commands'
// output per consumer.
function format_report(results: ReadonlyArray<TargetResult>): string {
	if (results.length === 0) return 'No repositories were considered.'

	return results.map((result) => format_result(result)).join('\n')
}

const propagate_run = {
	PROPAGATED_REASON,
	LEFTOVER_NOTE,
	has_leftover_changes,
	STEP_RETURN,
	STEP_PRECHECK,
	STEP_ISSUE,
	STEP_UPGRADE,
	STEP_SYNC,
	STEP_VERIFY,
	STEP_PR,
	STEP_ORDER,
	skip_reason,
	run_target,
	run_targets,
	has_failure,
	format_report,
}

export type { RunOutcome, RunStep, StepResult, TargetResult }
export { propagate_run }
