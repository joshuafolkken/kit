import { cost_format } from '#scripts/cost-runtime/cost-format'
import type { RunCostReport } from '#scripts/cost/cost-run-report'
import type { RoleTotals } from '#scripts/cost/cost-run-roles'
import type { CategoryCount } from '#scripts/review/review-finding-ledger'
import type { RunEvent } from '#scripts/run/run-event-stream'

// The composition half of `josh retrospective` — the end-of-run retrospective's aggregation
// (joshuafolkken/kit#2328). A run that drains its backlog has spent time and money that nobody reads;
// this folds the four measurements that already exist — the run tree's cost and time
// (`cost-run-report.ts`), the recurring review findings (`review-finding-ledger.ts`), the observation
// ledger and the run's own event stream — into one digest, so the retrospective step has something to
// weigh. It adds no new measurement, per the observation-filing rule against readerless numbers; every
// input here is read from a command that was already keeping it.
//
// **It is a pure function of the four inputs.** The gathering — loading the run tree, reading the
// ledger, opening the stream — is the CLI's; this shapes what they return and nothing else, so the
// digest is unit-tested against fixed inputs rather than against a live store.

const MS_PER_MINUTE = 60_000
const PERCENT = 100
// A role whose share of the run's wall clock runs this far ahead of its share of the cost is time the
// run spent waiting rather than working — the disparity the retrospective exists to surface (the wake
// role in the baseline sat at 52% of the time for 25% of the cost, a gap of 0.27).
const WAITING_GAP = 0.2

// The friction each event kind marks — a place the run did not run straight through — counted back
// over the whole run. A plan, a child launch, a merge and a PR opening are the run working as intended,
// so they are not friction and are left out.
const FRICTION_KINDS = ['park', 'outage', 'cut', 'review-round'] as const

interface RetrospectiveInputs {
	cost: RunCostReport | undefined
	findings: ReadonlyArray<CategoryCount>
	zero_rounds: number
	// The observation ledger's entry lines, already filtered to entries by the caller.
	observations: ReadonlyArray<string>
	events: ReadonlyArray<RunEvent>
}

const CLOSING =
	'Weigh these against retrospective.md: file the improvements worth carrying into the next run, and stack the rest in the observation ledger.'

function minutes(ms: number): string {
	return String(Math.round(ms / MS_PER_MINUTE))
}

function percent(share: number): string {
	return `${String(Math.round(share * PERCENT))}%`
}

// A role's time share running ahead of its cost share is the run waiting rather than working, so it is
// called out; a role that pays its way carries no note.
function waiting_note(role: RoleTotals): string {
	return role.elapsed_share - role.cost_share >= WAITING_GAP ? ' — waiting-heavy' : ''
}

function role_line(role: RoleTotals): string {
	const spent = `${percent(role.cost_share)} cost, ${percent(role.elapsed_share)} time`

	return `  ${role.role}: ${spent}${waiting_note(role)}`
}

function cost_lines(cost: RunCostReport | undefined): Array<string> {
	if (cost === undefined) return ['Run cost & time: no run transcripts found']

	const totals = `${String(cost.session_count)} session(s), ${minutes(cost.total_elapsed_ms)} min, ${cost_format.format_usd(cost.total_usd)}`

	return [`Run cost & time: ${totals}`, ...cost.roles.map((role) => role_line(role))]
}

function findings_lines(
	findings: ReadonlyArray<CategoryCount>,
	zero_rounds: number,
): Array<string> {
	const denominator = `${String(zero_rounds)} zero-finding round(s)`

	if (findings.length === 0) return [`Review findings: none recorded (${denominator})`]

	const body = findings.map((entry) => `  ${entry.category}: ${String(entry.count)}`)

	return [`Review findings (${denominator}):`, ...body]
}

function observation_lines(observations: ReadonlyArray<string>): Array<string> {
	return [`Observation ledger: ${String(observations.length)} entry(ies) held`]
}

function friction_count(events: ReadonlyArray<RunEvent>, kind: string): number {
	return events.filter((event) => event.kind === kind).length
}

function friction_lines(events: ReadonlyArray<RunEvent>): Array<string> {
	const counts = FRICTION_KINDS.map((kind) => `${kind} ${String(friction_count(events, kind))}`)

	return [`Run events: ${counts.join(', ')}`]
}

// The four sections in a fixed order, separated by blank lines, closed by the pointer that hands the
// judgement — which improvements are worth filing — to `retrospective.md`.
function compose(inputs: RetrospectiveInputs): string {
	return [
		...cost_lines(inputs.cost),
		'',
		...findings_lines(inputs.findings, inputs.zero_rounds),
		'',
		...observation_lines(inputs.observations),
		'',
		...friction_lines(inputs.events),
		'',
		CLOSING,
	].join('\n')
}

const retrospective = { CLOSING, FRICTION_KINDS, WAITING_GAP, compose }

export type { RetrospectiveInputs }
export { retrospective }
