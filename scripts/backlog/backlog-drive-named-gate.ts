import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_solo } from '#scripts/epic/epic-solo'
import { backlog_drive_named_scope } from './backlog-drive-named-scope'
import { backlog_overlap } from './backlog-overlap'

// A plain named issue the offer gathered, with the label names its state read carried.
interface NamedPlain {
	number: number
	labels: ReadonlyArray<string>
}

function child_of(issue: NamedPlain, repo: string): EpicChild {
	return { number: issue.number, repo, state: 'OPEN', labels: issue.labels, blocked_by: [] }
}

// The epic children gathered this tick lead the candidates: they already run, so a `run:solo` plain
// issue behind them waits and their declared paths are claimed before any plain issue's.
function candidates_of(
	plain: ReadonlyArray<NamedPlain>,
	gathered: ReadonlyArray<string>,
	repo: string,
): Array<EpicChild> {
	const children = gathered.map((issue) => child_of({ number: Number(issue), labels: [] }, repo))

	return [...children, ...plain.map((issue) => child_of(issue, repo))]
}

// **The named issues pass the pool's `run:solo` hold and path-overlap separation**
// (joshuafolkken/kit#8953): run side by side, a named issue could otherwise start beside a solo holder,
// an epic child gathered in the same tick, or a lane declaring the same paths. The gate is the pool's
// (`backlog-rank.ts` → `select`), without its re-ranking: the typed order is the priority. An
// unreadable repository admits none, as an unreadable busy listing does.
async function admitted(
	plain: ReadonlyArray<NamedPlain>,
	in_flight: ReadonlyArray<string>,
	gathered: ReadonlyArray<string>,
): Promise<ReadonlyArray<number>> {
	if (plain.length === 0) return []
	const numbers = plain.map((issue) => issue.number)
	const scope = await backlog_drive_named_scope.read(numbers, [...in_flight, ...gathered])
	if (scope === undefined) return []
	const { read, repo, declared, lanes } = scope
	const gated = epic_solo.select(candidates_of(plain, gathered, repo), read, repo)
	const separated = backlog_overlap.separate(gated, declared, { read, repo, lanes })

	return separated.offered.map((child) => child.number).filter((number) => numbers.includes(number))
}

export const backlog_drive_named_gate = { admitted }
export type { NamedPlain }
