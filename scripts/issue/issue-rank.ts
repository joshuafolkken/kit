import {
	BUG_LABEL,
	has_label_name,
	INTERRUPT_ROUTE_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_SOLO_LABEL,
} from './issue-labels'

// The keys that decide which open issue is offered first, defined once for
// every ranking that asks: the `🗒 Next issues` display, the `auto-ok` pickup and `backlog:next`.
//
// In order: `priority:high`, then a defect on the verification path (`bug` with `run:solo`, or
// `route:interrupt`), then how many other open issues wait on it. Below those, the caller's own order
// stands — the sort is stable, so recency and the defect-rate adjustment survive as the last key.
//
// **`run:solo` alone is not a key.** It means "runs alone", not "runs first": tidying that only touches
// the verification path carries it too, and a low-priority one is not owed a place ahead of the queue.
// Only a defect on that path is, because `backlogrun-lanes.md` holds a batch until it has merged.

interface RankRow {
	labels: ReadonlyArray<string>
	dependents: number
}

// One open issue as its key and the keys of the issues it is blocked by. The caller names the key
// format, so a ranking over listing rows and one over graph children each count in their own terms.
interface DependencyRow {
	key: string
	blockers: ReadonlyArray<string>
}

const NO_DEPENDENTS = 0

function flag(is_set: boolean): number {
	return is_set ? 1 : 0
}

function is_priority(labels: ReadonlyArray<string>): boolean {
	return has_label_name(labels, PRIORITY_HIGH_LABEL)
}

function is_verification_defect(labels: ReadonlyArray<string>): boolean {
	if (has_label_name(labels, INTERRUPT_ROUTE_LABEL)) return true

	return has_label_name(labels, BUG_LABEL) && has_label_name(labels, RUN_SOLO_LABEL)
}

// Negated so that the larger value sorts first under an ascending comparison.
function keys_of(row: RankRow): ReadonlyArray<number> {
	return [
		-flag(is_priority(row.labels)),
		-flag(is_verification_defect(row.labels)),
		-row.dependents,
	]
}

function compare(first: RankRow, second: RankRow): number {
	const second_keys = keys_of(second)
	const differences = keys_of(first).map((key, index) => key - (second_keys[index] ?? 0))

	return differences.find((difference) => difference !== 0) ?? 0
}

// How many of the rows wait on each key. A blocker outside the rows counts nothing, because only an
// open issue in the same pool can be held back by it.
function count_dependents(rows: ReadonlyArray<DependencyRow>): ReadonlyMap<string, number> {
	const counts = new Map<string, number>()

	for (const row of rows) {
		const blockers = new Set(row.blockers)

		for (const blocker of blockers) counts.set(blocker, (counts.get(blocker) ?? NO_DEPENDENTS) + 1)
	}

	return counts
}

// The items in rank order, ties kept in the order they arrived.
function rank<T>(items: ReadonlyArray<T>, row_of: (item: T) => RankRow): Array<T> {
	return items
		.map((item) => ({ item, row: row_of(item) }))
		.toSorted((first, second) => compare(first.row, second.row))
		.map((entry) => entry.item)
}

const issue_rank = { count_dependents, rank }

export { issue_rank }
export type { DependencyRow, RankRow }
