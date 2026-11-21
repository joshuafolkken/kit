import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_live } from '#scripts/epic/epic-live'
import { epic_parse } from '#scripts/epic/epic-parse'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_branch } from '#scripts/git/git-branch'
import { git_issue } from '#scripts/git/git-issue'
import { issue_publication } from '#scripts/issue/issue-publication'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { prepared_prerequisite, type RefusalWording } from '#scripts/issue/prepared-prerequisite'
import { error_text } from '#scripts/lib/error-message'

// `josh ship`'s `prepared-children` precondition (joshuafolkken/kit#8542): a lane that filed its split
// children prepared and shipped its own stage without `run:pause` left them unpublished, owned by no
// one (joshuafolkken/kit#8474). Before the ship, the prepared children whose record names this run's
// Issue as their `origin` — listed by the Issue itself or by an epic listing it — are published through
// `issue:file --publish`'s own path when every one has a plan, and refuse the ship with the plan and
// publish commands when one has none. A child filed outside a lane carries no `origin` and is left alone.

const PRECONDITION = 'prepared-children'

interface Filed {
	epic: number
	child: number
}

function is_filed_by(child: EpicChild, issue: number): boolean {
	return child.state === 'OPEN' && issue_publication_state.origin_of(child.body) === issue
}

async function filed_in(epic: number, issue: number, repo: string): Promise<Array<Filed>> {
	const listing = await epic_live.child(epic, repo)
	const numbers = epic_parse.parse_task_list_issue_numbers(listing.body)
	const children = await Promise.all(
		numbers.map(async (number) => await epic_live.child(number, repo)),
	)

	return children
		.filter((child) => is_filed_by(child, issue))
		.map(({ number }) => ({ epic, child: number }))
}

// A child two epics list is answered once, under the first.
async function filed_children(issue: number, repo: string): Promise<Array<Filed>> {
	const epics = [issue, ...(await epic_blocked_by.listing_epics(String(issue)))]
	const found = await Promise.all(epics.map(async (epic) => await filed_in(epic, issue, repo)))
	const by_child = new Map<number, Filed>()

	for (const filed of found.flat()) if (!by_child.has(filed.child)) by_child.set(filed.child, filed)

	return [...by_child.values()]
}

function wording_for(epic: number): RefusalWording {
	return {
		outcome: 'this lane filed it unpublished, so its ship is refused',
		rerun: `\`pnpm josh issue:file --publish ${String(epic)}\`, then re-detach the ship`,
	}
}

async function plan_refusals(filed: ReadonlyArray<Filed>): Promise<Array<string>> {
	const refusals = await Promise.all(
		filed.map(
			async ({ epic, child }) =>
				await prepared_prerequisite.refusal(String(child), wording_for(epic)),
		),
	)

	return refusals.filter((refusal) => refusal !== undefined)
}

// Only the children this lane filed are validated and published: a sibling another lane left prepared
// in the same epic neither withholds this ship nor is published by it.
async function publish_problem(
	epic: number,
	repo: string,
	filed: ReadonlyArray<Filed>,
): Promise<string | undefined> {
	const own = new Set(filed.filter((entry) => entry.epic === epic).map(({ child }) => child))

	try {
		await issue_publication.publish(epic, repo, (child) => own.has(child.number))

		return undefined
	} catch (error) {
		return `Prepared children of ${prepared_prerequisite.cite(epic)} this lane filed are not published: ${error_text.message_of(error)}`
	}
}

// Every epic is published once, with `issue:file --publish`'s own validation.
async function published(filed: ReadonlyArray<Filed>, repo: string): Promise<Array<string>> {
	const epics = [...new Set(filed.map(({ epic }) => epic))]
	const withheld = await Promise.all(
		epics.map(async (epic) => await publish_problem(epic, repo, filed)),
	)

	return withheld.filter((problem) => problem !== undefined)
}

// The refusals of the ship's prepared-children precondition; a branch with no Issue is the git
// preflight's to name.
async function problems(): Promise<Array<string>> {
	const issue = git_issue.branch_number(await git_branch.current())
	if (issue === undefined) return []
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) throw new Error('Cannot resolve the publication repository')
	const filed = await filed_children(Number(issue), repo)
	const refusals = await plan_refusals(filed)

	return refusals.length > 0 ? refusals : await published(filed, repo)
}

const run_ship_prepared_children = { PRECONDITION, problems }

export { run_ship_prepared_children }
