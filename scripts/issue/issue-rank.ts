import {
	BUG_LABEL,
	has_label_name,
	INTERRUPT_ROUTE_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_SOLO_LABEL,
} from './issue-labels'

// The keys that decide which open issue is offered first, defined once for
// every ranking that asks: the `🗒 Next issues` display, the `auto-ok` pickup and `backlog:next`.
//
// First, an issue whose body declares it runs last (`issue_priority.is_last`) follows every
// undeclared one, so a wide-reach upgrade queues behind the rest of its pool (joshuafolkken/kit#5310);
// declared ones rank among themselves by the keys below.
//
// Then, in order: the priority class (`priority:critical`, then `priority:high`, then neither), then a defect on the verification path
// (`bug` with `run:solo`, or `route:interrupt`), then any defect (`is_defect`, which the caller reads
// from `defect_rate.is_defect`, so a defect waits behind no feature of its priority
// (joshuafolkken/kit#7912)), then resumable work (an owned stash, a pause comment or a linked open PR),
// then the minutes its cause lost (`issue_priority.lost_minutes`: the body's
// cause-loss lines summed over its recurrences (joshuafolkken/kit#4928), else its causing-lane line,
// so causes of one lane are told apart (joshuafolkken/kit#4861); `0` when neither is declared, so an
// undeclared issue follows every declared one of its priority), then how many other open issues wait
// on it, transitively (`count_dependents`: a chain's head runs ahead of an independent issue
// (joshuafolkken/kit#5506)), then declared size-estimate lines, smallest first (undeclared last),
// then the minutes a week its declared speed-up saves
// (`expected_effect_lint.weekly_minutes`, on the same minute scale; `0` when undeclared, so a measured
// time-saver runs ahead of an unmeasured feature (joshuafolkken/kit#5302)). Below those, the caller's
// own order stands — the sort is stable, so oldest-first ties and the defect-rate deferral survive.
//
// **An issue blocking an open issue takes the highest class of the issues it blocks**, transitively
// (`blocked_priorities`, over the same pool rows as `count_dependents`): a blocker filed without the
// label, such as a split child of a `priority:high` parent, otherwise queues behind every high issue it
// holds back (joshuafolkken/kit#8541). The labels are never rewritten — only the order reads the class.
//
// **`run:solo` alone is not a key.** It means "runs alone", not "runs first": tidying that only touches
// the verification path carries it too, and a low-priority one is not owed a place ahead of the queue.
// Only a defect on that path is, because `backlogrun-lanes.md` holds a batch until it has merged.

interface RankRow {
	is_resumable?: boolean | undefined
	is_defect: boolean
	is_last: boolean
	labels: ReadonlyArray<string>
	lost_minutes: number
	gain_minutes: number
	dependents: number
	blocked_priority: number
	estimated_lines?: number | undefined
}

// One open issue as its key, its labels and the keys of the issues it is blocked by. The caller names
// the key format, so a ranking over listing rows and one over graph children each count in their own
// terms.
interface DependencyRow {
	key: string
	labels: ReadonlyArray<string>
	blockers: ReadonlyArray<string>
}

type DependencyRank = Pick<RankRow, 'blocked_priority' | 'dependents'>

const NO_DEPENDENTS = 0
const NO_PRIORITY_CLASS = 0
const HIGH_PRIORITY_CLASS = 1
const CRITICAL_PRIORITY_CLASS = 2

function flag(is_set: boolean): number {
	return is_set ? 1 : 0
}

function priority_class(labels: ReadonlyArray<string>): number {
	if (has_label_name(labels, PRIORITY_CRITICAL_LABEL)) return CRITICAL_PRIORITY_CLASS

	return has_label_name(labels, PRIORITY_HIGH_LABEL) ? HIGH_PRIORITY_CLASS : NO_PRIORITY_CLASS
}

function is_verification_defect(labels: ReadonlyArray<string>): boolean {
	if (has_label_name(labels, INTERRUPT_ROUTE_LABEL)) return true

	return has_label_name(labels, BUG_LABEL) && has_label_name(labels, RUN_SOLO_LABEL)
}

// Descending keys are negated for the ascending comparison; `is_last` and estimated lines are not.
function keys_of(row: RankRow): ReadonlyArray<number> {
	return [
		flag(row.is_last),
		-Math.max(priority_class(row.labels), row.blocked_priority),
		-flag(is_verification_defect(row.labels)),
		-flag(row.is_defect),
		-flag(row.is_resumable === true),
		-row.lost_minutes,
		-row.dependents,
		row.estimated_lines ?? Number.MAX_SAFE_INTEGER,
		-row.gain_minutes,
	]
}

function compare(first: RankRow, second: RankRow): number {
	const second_keys = keys_of(second)
	const differences = keys_of(first).map((key, index) => key - (second_keys[index] ?? 0))

	return differences.find((difference) => difference !== 0) ?? 0
}

function blockers_by_key(rows: ReadonlyArray<DependencyRow>): ReadonlyMap<string, Array<string>> {
	const blockers = new Map<string, Array<string>>()

	for (const row of rows) blockers.set(row.key, [...(blockers.get(row.key) ?? []), ...row.blockers])

	return blockers
}

// Every key the row waits on, directly or through another row, itself excluded. The visited set stops
// a cycle.
function upstream_of(key: string, blockers: ReadonlyMap<string, Array<string>>): Set<string> {
	const seen = new Set<string>([key])
	const pending = [...(blockers.get(key) ?? [])]

	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (seen.has(next)) continue
		seen.add(next)
		pending.push(...(blockers.get(next) ?? []))
	}

	seen.delete(key)

	return seen
}

// Calls `visit` once for each pair of a row's key and a key it waits on, transitively. Only a row of
// the pool is walked, because only an open issue in the same pool can be held back.
function for_each_upstream(
	rows: ReadonlyArray<DependencyRow>,
	visit: (upstream: string, key: string) => void,
): void {
	const blockers = blockers_by_key(rows)

	for (const key of blockers.keys()) {
		for (const upstream of upstream_of(key, blockers)) visit(upstream, key)
	}
}

// How many of the rows wait on each key, transitively: a chain's head counts every row behind it, so
// the issue that unblocks the longest run of lanes is offered first (joshuafolkken/kit#5506).
function count_dependents(rows: ReadonlyArray<DependencyRow>): ReadonlyMap<string, number> {
	const counts = new Map<string, number>()

	for_each_upstream(rows, (upstream) => {
		counts.set(upstream, (counts.get(upstream) ?? NO_DEPENDENTS) + 1)
	})

	return counts
}

// The highest priority class among the rows waiting on each key, transitively (joshuafolkken/kit#8541).
function blocked_priorities(rows: ReadonlyArray<DependencyRow>): ReadonlyMap<string, number> {
	const classes = new Map(rows.map((row) => [row.key, priority_class(row.labels)]))
	const priorities = new Map<string, number>()

	for_each_upstream(rows, (upstream, key) => {
		const blocked = classes.get(key) ?? NO_PRIORITY_CLASS

		priorities.set(upstream, Math.max(priorities.get(upstream) ?? NO_PRIORITY_CLASS, blocked))
	})

	return priorities
}

// The `dependents` and `blocked_priority` keys of each row, `0` for a key no row waits on.
function dependency_ranks(rows: ReadonlyArray<DependencyRow>): (key: string) => DependencyRank {
	const dependents = count_dependents(rows)
	const priorities = blocked_priorities(rows)

	return (key) => ({
		dependents: dependents.get(key) ?? NO_DEPENDENTS,
		blocked_priority: priorities.get(key) ?? NO_PRIORITY_CLASS,
	})
}

// The items in rank order, ties kept in the order they arrived.
function rank<T>(items: ReadonlyArray<T>, row_of: (item: T) => RankRow): Array<T> {
	return items
		.map((item) => ({ item, row: row_of(item) }))
		.toSorted((first, second) => compare(first.row, second.row))
		.map((entry) => entry.item)
}

const issue_rank = { blocked_priorities, count_dependents, dependency_ranks, rank }

export { issue_rank }
export type { DependencyRank, DependencyRow, RankRow }
