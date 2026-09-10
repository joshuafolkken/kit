import { epic_fetch } from '#scripts/epic/epic-fetch'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_epic_parse } from './git-epic-parse'
import { git_epic_validate, type EpicSubject } from './git-epic-validate'
import { git_gh_command } from './git-gh-command'

// Reading an epic and its current graph, for the two commands that edit its declared order.
//
// `--add` and `--remove` need exactly the same three things before they may compute anything: the
// epic's labels and body, the repository a declared bare number names, and every child with its
// native relations. They were the same forty lines twice until joshuafolkken/kit#1712 gave the
// removal a home; a second copy is where one of them comes to accept a graph the other refuses.

// Refused rather than stood in for, and both callers *write*. Since joshuafolkken/kit#1126 a plan
// filters recorded relations by the declared repository, so a placeholder drops every one of them:
// the "reconcile them before inserting" guard never fires, the superseded link is never dropped, and
// relations that already exist are re-POSTed — leaving the epic in exactly the mismatched state
// `epic:audit` refuses to run on.
const UNKNOWN_REPO =
	"Could not read this repository from `git remote`, so the epic's relations cannot be keyed by repository — check `gh auth status` and that this is a checkout with an `origin` remote."

interface EpicReading {
	subject: EpicSubject
	recorded: ReadonlyArray<EpicChild>
	repo: string
}

async function read_subject(epic_number: number): Promise<EpicSubject | undefined> {
	return git_epic_validate.parse_epic_subject(
		await git_gh_command.issue_get_labels_and_body(String(epic_number)),
	)
}

// The current children with their native relations. A child that cannot be read stops the command
// for the reason it stops `epic:next`: a missing node makes whatever it blocks look unblocked, and
// an edit computed against that graph would record or drop the wrong order.
async function read_recorded(
	body: string | undefined,
): Promise<{ children: ReadonlyArray<EpicChild>; repo: string } | { error: string }> {
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) return { error: UNKNOWN_REPO }
	const tracked = git_epic_parse.parse_task_list_issue_numbers(body)
	if (tracked.length === 0) return { children: [], repo }

	const fetched = await epic_fetch.fetch_children(tracked, repo)

	if (fetched.unreadable.length > 0) {
		const list = epic_graph.format_references(fetched.unreadable, repo)

		return { error: `Could not read ${list}; the epic's dependency graph is incomplete.` }
	}

	return { children: fetched.children, repo }
}

// The epic and its current graph, or the reason neither could be read.
async function read_epic(epic_number: number): Promise<EpicReading | { error: string }> {
	const subject = await read_subject(epic_number)
	if (subject === undefined) return { error: `Could not read issue #${String(epic_number)}.` }

	const recorded = await read_recorded(subject.body)
	if ('error' in recorded) return { error: recorded.error }

	return { subject, recorded: recorded.children, repo: recorded.repo }
}

const git_epic_read = {
	UNKNOWN_REPO,
	read_epic,
}

export { git_epic_read }
export type { EpicReading }
