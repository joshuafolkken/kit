import { epic_fetch } from '#scripts/epic/epic-fetch'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_epic_add_plan, type AddPlan } from './git-epic-add-plan'
import type { InsertPosition } from './git-epic-chains'
import { git_epic_parse } from './git-epic-parse'
import { format_issue_references } from './git-epic-reference'
import { git_epic_relations } from './git-epic-relations'
import { git_epic_validate, type EpicSubject } from './git-epic-validate'
import { git_gh_command } from './git-gh-command'

// `josh epic --add <E> <N...> [--before <M> | --after <M>]` — insert children into an existing epic.
//
// Adding a child by editing the body is what the procedure told an agent to do, and it is what stops
// an unattended run: the body then declares an order the native `blocked-by` relations do not record,
// `epic:next` reports `declaration_mismatch`, and the verdict is `error`. This command writes the
// task-list row, the declaration and the relations from one input, so the three cannot disagree
// (joshuafolkken/kit#890).

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
// Refused rather than stood in for, and this path *writes*. Since joshuafolkken/kit#1126 the plan
// filters recorded relations by the declared repository, so a placeholder drops every one of them:
// the "reconcile them before inserting" guard never fires, the superseded link is never dropped, and
// relations that already exist are re-POSTed — leaving the epic in exactly the mismatched state
// `epic:audit` refuses to run on.
const UNKNOWN_REPO =
	"Could not read this repository from `git remote`, so the epic's relations cannot be keyed by repository — check `gh auth status` and that this is a checkout with an `origin` remote."

interface AddChildrenInput {
	epic_number: number
	children: ReadonlyArray<number>
	position?: InsertPosition | undefined
}

async function read_subject(epic_number: number): Promise<EpicSubject | undefined> {
	return git_epic_validate.parse_epic_subject(
		await git_gh_command.issue_get_labels_and_body(String(epic_number)),
	)
}

// The current children with their native relations. A child that cannot be read stops the command
// for the reason it stops `epic:next`: a missing node makes whatever it blocks look unblocked, and
// an insertion computed against that graph would record the wrong order.
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

function report_relations(plan: AddPlan, failures: { added: number; removed: number }): void {
	if (plan.removed.length > 0) {
		console.info(
			git_epic_relations.format_relation_report({
				total: plan.removed.length,
				failures: failures.removed,
				action: 'drop',
			}),
		)
	}

	if (plan.added.length === 0) return

	console.info(
		git_epic_relations.format_relation_report({
			total: plan.added.length,
			failures: failures.added,
			action: 'record',
		}),
	)
}

// Dropped before recorded: inserting `#N` between `#B` and `#M` replaces `#B -> #M`, and applying the
// new link first would leave `#M` momentarily blocked by both.
async function apply_plan(plan: AddPlan): Promise<void> {
	const removed = await git_epic_relations.apply_relations(plan.removed, 'drop')
	const added = await git_epic_relations.apply_relations(plan.added, 'record')

	report_relations(plan, { added, removed })
}

function report_success(epic_number: number, plan: AddPlan): void {
	const list = format_issue_references(plan.additions)

	console.info(`📋 Added ${list} to epic #${String(epic_number)}.`)

	if (plan.removed.length > 0) {
		console.info(`↪ Re-pointed: ${git_epic_add_plan.format_links(plan.removed)} was replaced.`)
	}
}

// The epic and its current graph, or the reason neither could be read.
async function read_epic(
	epic_number: number,
): Promise<
	{ subject: EpicSubject; recorded: ReadonlyArray<EpicChild>; repo: string } | { error: string }
> {
	const subject = await read_subject(epic_number)
	if (subject === undefined) return { error: `Could not read issue #${String(epic_number)}.` }

	const recorded = await read_recorded(subject.body)
	if ('error' in recorded) return { error: recorded.error }

	return { subject, recorded: recorded.children, repo: recorded.repo }
}

async function write_plan(epic_number: number, plan: AddPlan): Promise<void> {
	await git_gh_command.issue_edit_body(String(epic_number), plan.body)
	report_success(epic_number, plan)
	await apply_plan(plan)
}

// Insert children into an existing epic, or refuse without writing anything. Every refusal happens
// before the body edit, so a rejected invocation leaves the epic exactly as it was.
async function add_children(input: AddChildrenInput): Promise<number> {
	const epic = await read_epic(input.epic_number)

	if ('error' in epic) {
		console.error(`✖ ${epic.error}`)

		return FAILURE_EXIT_CODE
	}

	const outcome = git_epic_add_plan.build_plan({
		epic_number: input.epic_number,
		body: epic.subject.body,
		labels: epic.subject.labels,
		children: input.children,
		position: input.position,
		recorded: epic.recorded,
		repo: epic.repo,
	})

	if ('error' in outcome) {
		console.error(`✖ ${outcome.error}`)

		return FAILURE_EXIT_CODE
	}

	await write_plan(input.epic_number, outcome.plan)

	return SUCCESS_EXIT_CODE
}

const git_epic_add = {
	add_children,
}

export { git_epic_add }
export type { AddChildrenInput }
