import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { open_issue_schema } from '#scripts/git/git-schemas'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { z } from 'zod'
import { backlog_pool } from './backlog-pool'

// `josh backlog:plan --pending-publication` — the prepared issues that hold an open issue back
// (joshuafolkken/kit#8087). A prepared issue leaves the start pool until its epic publishes, and the
// issue it blocks reads as an ordinary dependency wait, so the pair was found only by opening each
// waiting issue in turn. This lists every pair from one open-issue read.

interface PendingPair {
	blocker: number
	waiting: number
}

interface OpenRead {
	children: ReadonlyArray<EpicChild>
	is_capped: boolean
}

// The relations listing names no `createdAt`, which nothing here reads; the default lets its rows
// reach `backlog_pool.to_children` as the open rows they are.
const relations_schema = open_issue_schema.extend({ createdAt: z.string().default('') })
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const UNREADABLE_MESSAGE =
	"Could not read this repository's open issues and their blockers. Check `gh auth status` and ask again."
const TRUNCATED_MESSAGE = `⚠ The open-issue listing stopped at ${String(auto_ok_cli.LISTING_LIMIT)} rows, so pairs past the cut are missing.`

const NONE_LINE = 'No prepared issue blocks an open issue.'
const PUBLISH_LINE =
	'Publish the epic each prepared issue belongs to: pnpm josh issue:file --publish <epic>'

// `blocked_by` keeps a relation after its blocker closes, so a blocker counts only while it is in the
// open set; a blocker in another repository is not one this listing read.
function pending_numbers(children: ReadonlyArray<EpicChild>): ReadonlySet<number> {
	return new Set(
		children
			.filter((child) => issue_publication_state.is_pending(child.body))
			.map((child) => child.number),
	)
}

function pairs_of(children: ReadonlyArray<EpicChild>, repo: string): ReadonlyArray<PendingPair> {
	const pending = pending_numbers(children.filter((child) => child.repo === repo))

	return children
		.flatMap((child) =>
			child.blocked_by
				.filter((blocker) => blocker.repo === repo && pending.has(blocker.number))
				.map((blocker) => ({ blocker: blocker.number, waiting: child.number })),
		)
		.toSorted((left, right) => left.blocker - right.blocker || left.waiting - right.waiting)
}

function lines_of(pairs: ReadonlyArray<PendingPair>): ReadonlyArray<string> {
	if (pairs.length === 0) return [NONE_LINE]

	return [
		...pairs.map(
			(pair) =>
				`${issue_cite.plain_for('program', pair.blocker)} pending publication ← ${issue_cite.plain_for('program', pair.waiting)}`,
		),
		PUBLISH_LINE,
	]
}

async function read_children(repo: string): Promise<OpenRead | undefined> {
	const { json, is_capped } = await git_gh_command.issue_list_open_relations(
		auto_ok_cli.LISTING_LIMIT,
	)
	const read = json === undefined ? undefined : read_json_listing(json, relations_schema)

	if (read?.kind !== 'read') return undefined

	return { children: backlog_pool.to_children(read.rows, repo), is_capped }
}

// A cut listing can miss a pair, so the cut is reported rather than read as a complete answer.
async function report(): Promise<number> {
	const repo = await git_gh_command.repo_get_name_with_owner()
	const read = repo === undefined ? undefined : await read_children(repo)

	if (repo === undefined || read === undefined) {
		console.error(UNREADABLE_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	if (read.is_capped) console.error(TRUNCATED_MESSAGE)
	console.info(lines_of(pairs_of(read.children, repo)).join('\n'))

	return SUCCESS_EXIT_CODE
}

const backlog_pending_publication = {
	NONE_LINE,
	PUBLISH_LINE,
	TRUNCATED_MESSAGE,
	UNREADABLE_MESSAGE,
	lines_of,
	pairs_of,
	report,
}

export type { PendingPair }
export { backlog_pending_publication }
