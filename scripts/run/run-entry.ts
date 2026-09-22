import { run_hold_cli } from './run-hold-cli'
import { run_step } from './run-step'

// `josh run:entry <N>` — the one call a `fullrun` makes to open a run (joshuafolkken/kit#2372). It
// folds the fixed entry sequence a lane spends four separate round trips on — claim the tree
// (`run:hold`), read the session budget (`cost --cut`), gather the issue reads (`run:prep`), and decide
// the pre-implementation step (`run:step`) — into one composite, the same shape `backlog:offer` folded
// the parent loop head on (joshuafolkken/kit#2162). Context cost grows with the square of a lane's
// round trips, so collapsing four into one is where the fold pays the most.
//
// **This module is the pure half**, kept apart from the chaining CLI the way `run-prep.ts` is kept from
// `run-prep-cli.ts` and `run-review.ts` from its steps. It shapes the summary line the reader branches
// on, and answers the two things a test must pin without a hold ever being written or a session ever
// read: the exit code the loop reads, and whether the run may proceed to implement.

const SUMMARY_PREFIX = 'entry #'
const SUMMARY_DASH = ' — '
const FIELD_SEPARATOR = ' · '
const HOLD_LABEL = 'hold: '
const COST_LABEL = 'cost: '
const VERDICT_LABEL = 'verdict: '
const SECTION_SEPARATOR = '\n\n'

// The three cost verdicts this composite reads: the two `cost --cut` prints on its first line, and the
// stand-in a dispatched lane child records when the parent owns the budget question and this skips it.
const COST_UNDER = 'under'
const COST_OVER = 'over'
const COST_SKIPPED = 'skipped'

// The placeholder verdict for a summary printed before the pre-implementation step was reached — a
// short-circuit on a `busy` hold or an `over` budget prints the summary without a `run:step` answer.
const NO_VERDICT = '-'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface EntryParts {
	issue_number: string
	// `run:hold`'s single token — `hold`, `busy` or `unknown`.
	hold: string
	// `cost --cut`'s first-line verdict, or `skipped` in a lane child.
	cost: string
	// `run:step`'s pre-implementation verdict, or `-` when a stop short-circuited before it.
	verdict: string
	// The `run:prep` report body, or the one-line note that stands in for it on a short-circuit.
	report: string
}

// The leading line carries the three facts a run branches on — did the tree claim, is the budget
// spent, and which flow the pre-implementation step names — so the decision is read off the first line
// without parsing the report below it, exactly as `run:prep`'s own summary does.
function summary(parts: EntryParts): string {
	const fields = [
		`${HOLD_LABEL}${parts.hold}`,
		`${COST_LABEL}${parts.cost}`,
		`${VERDICT_LABEL}${parts.verdict}`,
	]

	return `${SUMMARY_PREFIX}${parts.issue_number}${SUMMARY_DASH}${fields.join(FIELD_SEPARATOR)}`
}

function format_report(parts: EntryParts): string {
	return [summary(parts), parts.report].join(SECTION_SEPARATOR)
}

// The tree must be held and the budget not spent, or the run stops before it reads anything else — the
// two gates `fullrun.md` steps 1 and 3 stop on, decided from the tokens rather than from a sentence.
function can_proceed(hold: string, cost: string): boolean {
	return hold === run_hold_cli.HOLD_VERDICT && cost !== COST_OVER
}

// Non-zero when the run cannot proceed to its flow: a tree not held, a spent budget, or a state the
// reads could not resolve (`unknown`). A readable `update-deps`, `human-review` or `already-done`
// verdict is a flow the reader routes on, not a failure, so it exits zero — the same contract
// `run:prep` keeps, where a bundled read that succeeded exits zero whatever the state says.
function exit_code(parts: EntryParts): number {
	const is_ok = can_proceed(parts.hold, parts.cost) && parts.verdict !== run_step.UNKNOWN

	return is_ok ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const run_entry = {
	COST_OVER,
	COST_SKIPPED,
	COST_UNDER,
	NO_VERDICT,
	SUMMARY_PREFIX,
	exit_code,
	format_report,
	can_proceed,
	summary,
}

export type { EntryParts }
export { run_entry }
