import { epic_label_age, type LabeledAt } from '#scripts/epic/epic-label-age'
import { session_cite } from '#scripts/issue/session-cite'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'

// `josh run:stale` — the stale `in-progress` cleanup `backlogrun-park.md` describes, as one command.
//
// **Age alone is not the test.** Past `epic_label_age`'s window the checkout holding the issue decides: a
// `halfrun` stop and a `needs-human-review` child leave uncommitted work there, a run still inside the
// tree or a `prrun` stop keeps its record, and a detached ship still runs from it. Each keeps the
// label, with the reason printed;
// only a stale label nothing holds is removed. A label whose age cannot be read is left alone.

interface StalePorts {
	now: () => Date
	// The open issues carrying `in-progress`, or `undefined` when the listing could not be read.
	read_holders: () => Promise<ReadonlyArray<number> | undefined>
	read_labeled_at: (issue: number) => Promise<LabeledAt>
	// The checkout the issue's run lives in — its lane, or the work tree whose run record names it.
	checkout_of: (issue: number) => Promise<string | undefined>
	read_hold: (directory: string) => Promise<HoldRead>
	is_tree_dirty: (directory: string) => Promise<boolean>
	// Whether a process still runs from the checkout or carries the issue's lane mark — a detached
	// `josh ship` leaves a clean tree and no live record, and still holds the label.
	has_residents: (issue: number, directory: string) => boolean
	unmark: (issue: number) => Promise<boolean>
}

interface StaleVerdict {
	issue: number
	action: 'kept' | 'removed'
	reason: string
}

const NO_HOLDERS = 'no open issue carries `in-progress`'
const UNREADABLE = '✖ the `in-progress` listing could not be read — run it again'
const FAILURE_EXIT_CODE = 1

// A run still inside the tree for this issue, its stop-marked (`prrun` stop) record even once expired,
// or a record that cannot be read, keeps the label.
function is_live(read: HoldRead, issue: number): boolean {
	if (read.kind === 'unreadable') return true
	if (read.kind === 'free' || read.hold.issue !== String(issue)) return false

	return read.kind === 'held' || run_hold.is_stop_marked(read.hold)
}

async function hold_reason(
	issue: number,
	directory: string,
	ports: StalePorts,
): Promise<string | undefined> {
	if (await ports.is_tree_dirty(directory)) return `uncommitted changes in ${directory}`
	if (is_live(await ports.read_hold(directory), issue)) return `a live run holds ${directory}`
	if (ports.has_residents(issue, directory)) return `a process still runs from ${directory}`

	return undefined
}

async function clear(issue: number, age: string, ports: StalePorts): Promise<StaleVerdict> {
	const directory = await ports.checkout_of(issue)
	const reason = directory === undefined ? undefined : await hold_reason(issue, directory, ports)
	if (reason !== undefined) return { issue, action: 'kept', reason: `${age}; ${reason}` }

	const is_removed = await ports.unmark(issue)

	return is_removed
		? { issue, action: 'removed', reason: age }
		: { issue, action: 'kept', reason: `${age}; the removal was refused` }
}

async function judge(issue: number, ports: StalePorts): Promise<StaleVerdict> {
	const labeled_at = await ports.read_labeled_at(issue)
	const now = ports.now()
	const age = epic_label_age.age_text(labeled_at, now)

	if (!epic_label_age.is_stale(labeled_at, now)) return { issue, action: 'kept', reason: age }

	return await clear(issue, age, ports)
}

// Each issue is judged on its own; the verdicts keep the listing's order.
async function sweep(
	issues: ReadonlyArray<number>,
	ports: StalePorts,
): Promise<Array<StaleVerdict>> {
	return await Promise.all(issues.map(async (issue) => await judge(issue, ports)))
}

function format(verdict: StaleVerdict): string {
	return `${session_cite.issue(String(verdict.issue))} ${verdict.action} — ${verdict.reason}`
}

async function run(ports: StalePorts): Promise<number> {
	const issues = await ports.read_holders()

	if (issues === undefined) {
		console.error(UNREADABLE)

		return FAILURE_EXIT_CODE
	}

	if (issues.length === 0) console.info(NO_HOLDERS)

	const verdicts = await sweep(issues, ports)

	for (const verdict of verdicts) console.info(format(verdict))

	return 0
}

const run_stale = {
	judge,
	run,
}

export type { StalePorts, StaleVerdict }
export { run_stale }
