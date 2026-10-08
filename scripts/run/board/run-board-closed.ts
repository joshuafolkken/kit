import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { issue_merged } from '#scripts/issue/issue-merged'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'

// A child the run touched that has left the open listing, read from GitHub one issue at a time
// (joshuafolkken/kit#3451). The listing is the board's only other source of a title, so a board opened
// after its children closed drew them nameless, timeless and without saying whether they merged.
// **A closed issue is read once**: what it answers does not change while it stays closed, so the board
// keeps the answer for the run and asks GitHub only about children it has not read yet.

interface ClosedIssue {
	title: string
	closed_ms: number | undefined
	// Closed by a merged pull request, rather than closed by hand.
	is_merged: boolean
}

const CLOSED_FIELDS = 'title,state,closedAt'
const CLOSED_STATE = 'CLOSED'
// The bound `issue:state` reads several issues under, so a run's worth of closed children does not draw
// GitHub's secondary rate limit.
const READ_CONCURRENCY = 4

const closed_schema = z.looseObject({
	title: z.string(),
	state: z.string(),
	closedAt: z.string().nullish(),
})

type ClosedView = z.infer<typeof closed_schema>

function closed_ms_of(view: ClosedView): number | undefined {
	const closed_ms = Date.parse(view.closedAt ?? '')

	return Number.isNaN(closed_ms) ? undefined : closed_ms
}

// `undefined` for an issue that is still open — the listing it was missing from was older than this
// read — or one whose issue or timeline could not be read; either is asked again on the next read, so a
// transient failure is never kept as closed-not-merged.
async function read_closed(issue: number): Promise<ClosedIssue | undefined> {
	const json = await git_gh_issue_read.issue_view_json(String(issue), CLOSED_FIELDS)
	const view = json === undefined ? undefined : parse_json_object_safe(json, closed_schema)

	if (view?.state !== CLOSED_STATE) return undefined

	const is_merged = await issue_merged.read_merge_state(String(issue))

	if (is_merged === undefined) return undefined

	return { title: view.title, closed_ms: closed_ms_of(view), is_merged }
}

// Every issue that answered as closed, by number.
async function read_all(
	issues: ReadonlyArray<number>,
	read: (issue: number) => Promise<ClosedIssue | undefined> = read_closed,
): Promise<ReadonlyMap<number, ClosedIssue>> {
	const answers = await bounded_pool.bounded_map(issues, READ_CONCURRENCY, async (issue) => ({
		issue,
		closed: await read(issue),
	}))

	return new Map(
		answers.flatMap(({ issue, closed }) =>
			closed === undefined ? [] : [[issue, closed] as const],
		),
	)
}

const run_board_closed = { read_all, read_closed }

export { run_board_closed }
export type { ClosedIssue }
