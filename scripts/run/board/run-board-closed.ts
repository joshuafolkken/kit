import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { ALREADY_DONE_LABEL, has_label_name } from '#scripts/issue/issue-labels'
import { issue_merged } from '#scripts/issue/issue-merged'
import { issue_outcome, type IssueOutcome } from '#scripts/issue/issue-outcome'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'
import { run_board_closed_graphql, type ClosedSource } from './run-board-closed-graphql'

// A child the run touched that has left the open listing, read from GitHub one issue at a time. The
// listing is the board's only other source of a title, so without this read a board opened after its
// children closed would draw them nameless, timeless and without saying whether they merged.
// **A closed issue is read once**: what it answers does not change while it stays closed, so the board
// keeps the answer for the run and asks GitHub only about children it has not read yet.

interface ClosedIssue {
	outcome?: IssueOutcome | undefined
	title: string
	// Its label names, so a closed row still draws its release category (joshuafolkken/kit#3577).
	labels: ReadonlyArray<string>
	closed_ms: number | undefined
	// Closed by a merged pull request, rather than closed by hand.
	is_merged: boolean
	// Closed as not planned — withdrawn rather than finished (joshuafolkken/kit#3958).
	is_not_planned: boolean
}

const CLOSED_FIELDS = 'title,state,stateReason,closedAt,labels'
const CLOSED_STATE = 'CLOSED'
const NOT_PLANNED_REASON = 'not_planned'
const STILL_OPEN = 'open' as const

// What one issue answered: closed, still open, or `undefined` when it could not be read.
type ClosedRead = ClosedIssue | typeof STILL_OPEN | undefined

// How a closed child ended — merged, withdrawn as not planned, closed as already done
// (`josh issue:already-done`, joshuafolkken/kit#7095), or done.
type ClosedState = 'merged' | 'withdrawn' | 'already_done' | 'done'

// The open listing a closed read is weighed against, and when it was read.
interface ListingRead {
	open_numbers: ReadonlySet<number> | undefined
	read_ms: number | undefined
}

// Every issue that answered as closed, and whether every issue answered at all — an ended run stops
// asking only once a read answered whole, so a transient failure is never kept as still open.
interface ClosedAnswer {
	closed: ReadonlyMap<number, ClosedIssue>
	is_whole: boolean
}

// A bound on the closed-issue reads, so a run's worth of closed children does not draw GitHub's
// secondary rate limit.
const READ_CONCURRENCY = 4

const closed_schema = z.looseObject({
	title: z.string(),
	state: z.string(),
	stateReason: z.string().nullish(),
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
//
// Sent with the previous ETag (joshuafolkken/kit#6696): a parked or human child stays a candidate after
// its run ends, so the board asks every two minutes, and an unchanged issue answers `304` for no core.
async function read_view(
	issue: number,
	source: ClosedSource | undefined,
): Promise<ClosedView | undefined> {
	const json =
		source?.json ??
		(await git_gh_issue_read.issue_view_json(
			String(issue),
			CLOSED_FIELDS,
			undefined,
			git_gh_etag_read.read,
		))

	return json === undefined ? undefined : parse_json_object_or_undefined(json, closed_schema)
}

async function read_merged(
	issue: number,
	source: ClosedSource | undefined,
): Promise<boolean | undefined> {
	return source?.is_merged ?? (await issue_merged.read_merge_state(String(issue)))
}

// `source` is what GraphQL already answered for the issue (`run-board-closed-graphql.ts`); what it
// left unanswered — the whole issue, or a timeline past one page — is read through REST.
async function read_closed(issue: number, source?: ClosedSource): Promise<ClosedRead> {
	const view = await read_view(issue, source)

	if (view === undefined) return undefined
	if (view.state !== CLOSED_STATE) return STILL_OPEN

	const is_merged = await read_merged(issue, source)

	if (is_merged === undefined) return undefined

	const labels = view.labels.map((label) => label.name)

	const is_not_planned = view.stateReason === NOT_PLANNED_REASON

	return {
		title: view.title,
		labels,
		closed_ms: closed_ms_of(view),
		is_merged,
		is_not_planned,
		...(await issue_outcome.recorded(issue, is_merged)),
	}
}

async function read_all(
	issues: ReadonlyArray<number>,
	read: (issue: number, source?: ClosedSource) => Promise<ClosedRead> = read_closed,
): Promise<ClosedAnswer> {
	const sources = await run_board_closed_graphql.read_sources(issues)
	const answers = await bounded_pool.bounded_map(issues, READ_CONCURRENCY, async (issue) => ({
		issue,
		answer: await read(issue, sources.get(issue)),
	}))
	const closed = new Map(
		answers.flatMap(({ issue, answer }) =>
			typeof answer === 'object' ? [[issue, answer] as const] : [],
		),
	)

	return { closed, is_whole: answers.every(({ answer }) => answer !== undefined) }
}

function state_of(closed: ClosedIssue): ClosedState {
	if (closed.is_merged) return 'merged'

	if (closed.is_not_planned) return 'withdrawn'

	return has_label_name(closed.labels, ALREADY_DONE_LABEL) ? 'already_done' : 'done'
}

// A person reopened the child when a listing read after its close holds it again. A listing read
// before the close — the plan an ended run holds — proves nothing, so it kept a closed child in
// 🙋 decision (joshuafolkken/kit#6535).
function is_reopened(issue: number, closed: ClosedIssue, listing: ListingRead): boolean {
	if (listing.open_numbers?.has(issue) !== true) return false

	return closed.closed_ms === undefined || (listing.read_ms ?? -Infinity) > closed.closed_ms
}

const run_board_closed = { STILL_OPEN, is_reopened, read_all, read_closed, state_of }

export { run_board_closed }
export type { ClosedAnswer, ClosedIssue, ListingRead }
