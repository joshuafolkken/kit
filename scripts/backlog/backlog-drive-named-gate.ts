import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_solo } from '#scripts/epic/epic-solo'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
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

async function gathered_child(issue: string): Promise<NamedPlain | undefined> {
	const result = await issue_state_cli.read_issue(issue)
	if (result.kind !== 'state') return undefined

	return { number: Number(issue), labels: result.state.labels }
}

// The epic children gathered this tick, with their labels, so a `run:solo` child holds the plain issues
// behind it. Any unreadable child is `undefined`, which admits none.
async function gathered_children(
	gathered: ReadonlyArray<string>,
): Promise<ReadonlyArray<NamedPlain> | undefined> {
	const children = await Promise.all(gathered.map(async (issue) => await gathered_child(issue)))

	return children.every((child) => child !== undefined) ? children : undefined
}

// The epic children gathered this tick lead the candidates: they already run, so a plain issue behind
// a `run:solo` child (or a `run:solo` plain issue behind any child) waits, and their declared paths are
// claimed before any plain issue's.
function candidates_of(
	plain: ReadonlyArray<NamedPlain>,
	children: ReadonlyArray<NamedPlain>,
	repo: string,
): Array<EpicChild> {
	return [...children, ...plain].map((issue) => child_of(issue, repo))
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
	const children = await gathered_children(gathered)
	const scope = await backlog_drive_named_scope.read(numbers, [...in_flight, ...gathered])
	if (children === undefined || scope === undefined) return []
	const { read, repo, declared, lanes } = scope
	const gated = epic_solo.select(candidates_of(plain, children, repo), read, repo)
	const separated = backlog_overlap.separate(gated, declared, { read, repo, lanes })

	return separated.offered.map((child) => child.number).filter((number) => numbers.includes(number))
}

export const backlog_drive_named_gate = { admitted }
export type { NamedPlain }
