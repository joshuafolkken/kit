import { epic_graph, type IssueReference } from '#scripts/epic/epic-graph'
import { git_gh_issue_alias_graphql } from '#scripts/gh/git-gh-issue-alias-graphql'
import {
	COMMENTS,
	comments_schema,
	git_gh_issue_graphql,
	ISSUE_FIELDS,
	issue_fields_schema,
	type GraphqlComments,
	type GraphqlIssueFields,
} from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'

// The decision walk's nodes in one GraphQL query per repository and hundred (joshuafolkken/kit#6819).
// REST reads each node on its own — the issue, and its relations when it is blocked — and the board
// walks the blocker chains again every two minutes.
//
// The walk asks for a node at a time, so `view_loader` holds each ask until the walk has asked for
// every node it can reach without an answer, then reads them together. Each answer is mapped into
// the `gh issue view --json` spelling `issue_view_json` answers, through the same REST mapping, so the
// node is the one the REST path would give. A node missing from the answer is read through REST.

// The fields the REST read asks `issue_view_json` for.
const NODE_FIELDS = 'number,title,body,state,labels,blockedBy'

interface PendingView {
	reference: IssueReference
	resolve: (json: string | undefined) => void
	reject: (error: unknown) => void
}

type ViewLoader = (reference: IssueReference) => Promise<string | undefined>

function to_view(issue: GraphqlIssueFields): string {
	const view = git_gh_issue_rest.to_gh_issue(
		git_gh_issue_graphql.to_rest_issue(issue),
		git_gh_issue_rest.split_fields(NODE_FIELDS),
		git_gh_issue_graphql.to_blocked_by(issue),
	)

	return JSON.stringify(view)
}

async function read_repository(
	repo: string,
	references: ReadonlyArray<IssueReference>,
): Promise<Array<readonly [string, string]>> {
	const numbers = references
		.filter((reference) => reference.repo === repo)
		.map(({ number }) => number)
	const read = await git_gh_issue_alias_graphql.read_aliased(
		numbers,
		ISSUE_FIELDS,
		issue_fields_schema,
		repo,
	)

	return [...read.answers].map(([number, issue]) => [
		epic_graph.key_of({ repo, number }),
		to_view(issue),
	])
}

// The views GraphQL answered, keyed by `epic_graph.key_of`.
async function read_views(
	references: ReadonlyArray<IssueReference>,
): Promise<ReadonlyMap<string, string>> {
	const repos = [...new Set(references.map(({ repo }) => repo))]
	const views = await Promise.all(
		repos.map(async (repo) => await read_repository(repo, references)),
	)

	return new Map(views.flat())
}

async function settle(batch: ReadonlyArray<PendingView>): Promise<void> {
	try {
		const views = await read_views(batch.map(({ reference }) => reference))

		for (const ask of batch) ask.resolve(views.get(epic_graph.key_of(ask.reference)))
	} catch (error) {
		for (const ask of batch) ask.reject(error)
	}
}

// Asks made before the walk next yields to the event loop are read in one batch: the walk's
// continuations on one batch's answers run as microtasks, so the next level gathers before it.
function view_loader(): ViewLoader {
	let pending: Array<PendingView> = []

	return async function load(reference: IssueReference): Promise<string | undefined> {
		if (pending.length === 0) {
			setImmediate(() => {
				const batch = pending

				pending = []
				void settle(batch)
			})
		}

		return await new Promise((resolve, reject) => {
			pending.push({ reference, resolve, reject })
		})
	}
}

// A listing cut at the page answers no comments, so REST reads every page of it.
function to_comments_json(comments: GraphqlComments): string | undefined {
	if (comments.pageInfo.hasNextPage) return undefined

	return git_gh_issue_graphql.to_rest_comments(comments.nodes)
}

// The `needs-decision` children's comments in the REST listing's JSON (joshuafolkken/kit#6857),
// keyed by number; a number missing from the answer is read through REST.
async function read_comments(
	numbers: ReadonlyArray<number>,
	repo: string,
): Promise<ReadonlyMap<number, string>> {
	const read = await git_gh_issue_alias_graphql.read_aliased(
		numbers,
		COMMENTS,
		comments_schema,
		repo,
	)
	const pairs = [...read.answers].map(
		([number, issue]) => [number, to_comments_json(issue.comments)] as const,
	)

	return new Map(pairs.filter((pair): pair is readonly [number, string] => pair[1] !== undefined))
}

const run_board_decision_graphql = { read_comments, view_loader }

export type { ViewLoader }
export { run_board_decision_graphql }
