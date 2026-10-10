import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { issue_merged } from '#scripts/issue/issue-merged'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'

// A child the run touched that has left the open listing, read from GitHub one issue at a time. The
// listing is the board's only other source of a title, so without this read a board opened after its
// children closed would draw them nameless, timeless and without saying whether they merged.
// **A closed issue is read once**: what it answers does not change while it stays closed, so the board
// keeps the answer for the run and asks GitHub only about children it has not read yet.

interface ClosedIssue {
	title: string
	// Its label names, so a closed row still draws its release category (joshuafolkken/kit#3577).
	labels: ReadonlyArray<string>
	closed_ms: number | undefined
	// Closed by a merged pull request, rather than closed by hand.
	is_merged: boolean
}

const CLOSED_FIELDS = 'title,state,closedAt,labels'
const CLOSED_STATE = 'CLOSED'
const STILL_OPEN = 'open' as const

// What one issue answered: closed, still open, or `undefined` when it could not be read.
type ClosedRead = ClosedIssue | typeof STILL_OPEN | undefined

// Every issue that answered as closed, and whether every issue answered at all — an ended run stops
// asking only once a read answered whole, so a transient failure is never kept as still open.
interface ClosedAnswer {
	closed: ReadonlyMap<number, ClosedIssue>
	is_whole: boolean
}

// The bound `issue:state` reads several issues under, so a run's worth of closed children does not draw
// GitHub's secondary rate limit.
const READ_CONCURRENCY = 4

const closed_schema = z.looseObject({
	title: z.string(),
	state: z.string(),
	closedAt: z.string().nullish(),
	labels: z.array(issue_label_schema).default([]),
})

type ClosedView = z.infer<typeof closed_schema>

function closed_ms_of(view: ClosedView): number | undefined {
	const closed_ms = Date.parse(view.closedAt ?? '')

	return Number.isNaN(closed_ms) ? undefined : closed_ms
}

// `STILL_OPEN` for an issue the listing it was missing from was older than this read; `undefined` for one
// whose issue or timeline could not be read. Either is asked again on the next read, so a transient
// failure is never kept as closed-not-merged.
async function read_closed(issue: number): Promise<ClosedRead> {
	const json = await git_gh_issue_read.issue_view_json(String(issue), CLOSED_FIELDS)
	const view = json === undefined ? undefined : parse_json_object_or_undefined(json, closed_schema)

	if (view === undefined) return undefined
	if (view.state !== CLOSED_STATE) return STILL_OPEN

	const is_merged = await issue_merged.read_merge_state(String(issue))

	if (is_merged === undefined) return undefined

	const labels = view.labels.map((label) => label.name)

	return { title: view.title, labels, closed_ms: closed_ms_of(view), is_merged }
}

async function read_all(
	issues: ReadonlyArray<number>,
	read: (issue: number) => Promise<ClosedRead> = read_closed,
): Promise<ClosedAnswer> {
	const answers = await bounded_pool.bounded_map(issues, READ_CONCURRENCY, async (issue) => ({
		issue,
		answer: await read(issue),
	}))
	const closed = new Map(
		answers.flatMap(({ issue, answer }) =>
			typeof answer === 'object' ? [[issue, answer] as const] : [],
		),
	)

	return { closed, is_whole: answers.every(({ answer }) => answer !== undefined) }
}

const run_board_closed = { STILL_OPEN, read_all, read_closed }

export { run_board_closed }
export type { ClosedAnswer, ClosedIssue }
