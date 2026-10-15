import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { issue_watch_diff } from '#scripts/issue/issue-watch-diff'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'
import { auto_ok_judge, type JudgeIssue } from './auto-ok-judge'

// The reading half of `josh auto-ok:judge`: the open issues that still owe a judgement, shared by the
// command's listing and the backlog driver's check for a free lane with nothing opted in.
//
// **The driver asks once a minute while it watches**, so it hands in a cache it keeps for its process:
// an issue seen judged is remembered with its `updatedAt`, and its comments are read again only once
// that moves — a body edit, a comment or a label change. Without it every watch minute would read the
// comments of every candidate in the repository.

// The listing cap `auto-ok:next` reads the opted-in pool under; the open backlog is read under the same.
const LISTING_LIMIT = 200
// How many comment listings run at once — a handful of `gh` processes, never one per candidate.
const COMMENT_READ_WIDTH = 4

const row_schema = z.looseObject({
	number: z.number(),
	title: z.string(),
	body: z.string().nullish(),
	labels: z.array(issue_label_schema),
	updatedAt: z.string(),
})

interface JudgeRow extends JudgeIssue {
	title: string
	updated_at: string
}

// An issue's number to the `updatedAt` it was last seen judged at.
type JudgedCache = Map<number, string>

function to_row(raw: z.infer<typeof row_schema>): JudgeRow {
	return {
		number: raw.number,
		title: raw.title,
		body: raw.body ?? '',
		labels: raw.labels.map((label) => label.name),
		updated_at: raw.updatedAt,
	}
}

// `undefined` when the listing could not be read, which is never "nothing to judge".
async function read_candidates(): Promise<ReadonlyArray<JudgeRow> | undefined> {
	const { json } = await git_gh_command.issue_list_open_for_judgement(LISTING_LIMIT)

	if (json === undefined) return undefined

	const listing = read_json_listing(json, row_schema)

	if (listing.kind !== 'read') return undefined

	return listing.rows.map((raw) => to_row(raw)).filter((row) => auto_ok_judge.is_candidate(row))
}

// `true` only for an issue known to owe a judgement: a failed comment read learns nothing, so it is
// neither counted nor remembered.
async function owes_judgement(row: JudgeRow, cache: JudgedCache): Promise<boolean> {
	if (cache.get(row.number) === row.updated_at) return false

	const comments = issue_watch_diff.parse_comments(
		await git_gh_command.issue_list_comments(String(row.number)),
	)

	if (comments === undefined) return false
	if (!auto_ok_judge.is_judged(row.body, comments)) return true

	cache.set(row.number, row.updated_at)

	return false
}

async function owed(cache: JudgedCache = new Map()): Promise<ReadonlyArray<JudgeRow> | undefined> {
	const candidates = await read_candidates()

	if (candidates === undefined) return undefined

	const owing = await bounded_pool.bounded_map(
		candidates,
		COMMENT_READ_WIDTH,
		async (row) => await owes_judgement(row, cache),
	)

	return candidates.filter((_row, index) => owing[index] === true)
}

const auto_ok_judge_read = { owed }

export type { JudgedCache, JudgeRow }
export { auto_ok_judge_read }
