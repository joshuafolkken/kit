import type { LaneRecords, LaneStateRecord } from '#scripts/lane/lane-state'

// The invariants the lane lifecycle property test (joshuafolkken/kit#8771) checks after every step,
// each read off the lane records before and after the step, the board's rows and the world's model.
// Each returns why the step broke it, or `undefined`; the bug each one keeps out is named beside it.

interface StepFacts {
	// The trace name of the step and the lane it acted on, when it acted on one.
	name: string
	issue: string | undefined
	// Whether the step is a person's own lift of a pause (`lane:resume`, a withdraw, a close).
	lifts_pause: boolean
	// Whether the step's writer does not ask the work-tree guard yet (joshuafolkken/kit#8829).
	skips_tree_guard: boolean
}

interface StepRead {
	step: StepFacts
	before: LaneRecords
	after: LaneRecords
	// The issues `run:board` draws a row for, of this run or an earlier one, and of this run alone.
	board: ReadonlySet<string>
	own: ReadonlySet<string>
	// The issues this run launched, resumed or took over by a hand-over.
	current: ReadonlySet<string>
	// The issues whose branch or work tree is gone.
	treeless: ReadonlySet<string>
	// The most runs that held the primary checkout at once so far.
	checkout_peak: number
}

type Invariant = (read: StepRead) => string | undefined

function is_person_paused(record: LaneStateRecord | undefined): boolean {
	return record?.state === 'paused' && record.paused_by === 'person'
}

function first_issue(
	records: LaneRecords,
	is_match: (issue: string, record: LaneStateRecord) => boolean,
): string | undefined {
	return [...records].find(([issue, record]) => is_match(issue, record))?.[0]
}

// joshuafolkken/kit#8472: a hand-over, an adopt or a dependency resume lifted a person's pause.
function person_pause_kept(read: StepRead): string | undefined {
	const lifted = first_issue(read.before, (issue, record) => {
		const is_own_lift = read.step.lifts_pause && read.step.issue === issue

		return is_person_paused(record) && !is_own_lift && !is_person_paused(read.after.get(issue))
	})

	return lifted === undefined ? undefined : `#${lifted} lost its person pause`
}

// joshuafolkken/kit#7716: a merge's main:sync switched a checkout another run held.
function checkout_single(read: StepRead): string | undefined {
	if (read.checkout_peak <= 1) return undefined

	return `${String(read.checkout_peak)} runs held the primary checkout at once`
}

function is_set_running(before: LaneStateRecord | undefined, after: LaneStateRecord): boolean {
	if (after.state !== 'running') return false

	return before?.state !== 'running' || before.launched_at !== after.launched_at
}

// joshuafolkken/kit#7657: a resume or a restart reached a lane whose branch or work tree is gone. A
// writer that does not ask the guard yet is the known gap #8829, pinned by its own test.
function no_run_without_tree(read: StepRead): string | undefined {
	if (read.step.skips_tree_guard) return undefined

	const started = first_issue(read.after, (issue, record) => {
		return read.treeless.has(issue) && is_set_running(read.before.get(issue), record)
	})

	return started === undefined ? undefined : `#${started} ran with no branch or work tree`
}

function rows_of(read: StepRead, issue: string): ReadonlySet<string> {
	return read.current.has(issue) ? read.own : read.board
}

// joshuafolkken/kit#8455: a running lane — an adopted or handed-over one included — had no row, or
// none as the run that took it over.
function running_on_board(read: StepRead): string | undefined {
	const missing = first_issue(read.after, (issue, record) => {
		return record.state === 'running' && !rows_of(read, issue).has(issue)
	})

	return missing === undefined ? undefined : `#${missing} is running with no run:board row`
}

function ended_stays(read: StepRead): string | undefined {
	const revived = first_issue(read.before, (issue, record) => {
		const next = read.after.get(issue)?.state

		return record.state === 'ended' && next !== 'ended' && next !== 'open'
	})

	return revived === undefined ? undefined : `#${revived} left ended without an open`
}

const INVARIANTS: ReadonlyArray<Invariant> = [
	person_pause_kept,
	checkout_single,
	no_run_without_tree,
	running_on_board,
	ended_stays,
]

/** Why the step broke an invariant, each reason once; empty when it broke none. */
function violations(read: StepRead): Array<string> {
	return INVARIANTS.map((invariant) => invariant(read)).filter(
		(reason): reason is string => reason !== undefined,
	)
}

const lane_lifecycle_invariants = { violations }

export { lane_lifecycle_invariants }
export type { StepFacts, StepRead }
