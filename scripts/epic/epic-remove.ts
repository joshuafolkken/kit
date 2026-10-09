import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'
import { epic_decision } from './epic-decision'
import { epic_read } from './epic-read'
import { format_dependency_links } from './epic-reference'
import { epic_relations } from './epic-relations'
import { epic_remove_plan, type RemovePlan } from './epic-remove-plan'

// `josh epic --remove <E> <M> <N> [<N2> ...] [--decision-file <path|->]` — delete a declared order
// from the epic's body and from the native `blocked-by` relations in one input.
//
// It is `--add`'s missing counterpart. `--add` exists because writing the declaration and the
// relations separately is what leaves them disagreeing; deleting them separately leaves them
// disagreeing in exactly the same way, and without a command for it the only route is the hand edit
// `CLAUDE.md` forbids.

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

interface RemoveOrderInput {
	epic_number: number
	path: ReadonlyArray<number>
	decision?: string | undefined
}

// The record is posted on **both ends** of every deleted order, not on one of them. Whoever later
// asks why `#B` is no longer waiting on `#A` may be reading either issue, and a record on one of
// them is a record the other reader never sees.
async function comment_decision(ends: ReadonlyArray<number>, decision: string): Promise<void> {
	const posted = await Promise.all(
		ends.map(async (end) => await git_gh_command.issue_try_comment(String(end), decision)),
	)

	console.info(
		epic_decision.format_decision_report({
			total: ends.length,
			failures: posted.filter((is_posted) => !is_posted).length,
		}),
	)
}

function report_relations(plan: RemovePlan, failures: number): void {
	if (plan.removed.length === 0) return

	console.info(
		epic_relations.format_relation_report({ links: plan.removed, failures, action: 'drop' }),
	)
}

async function write_plan(
	epic_number: number,
	plan: RemovePlan,
	decision: string | undefined,
): Promise<void> {
	await git_gh_command.issue_edit_body(String(epic_number), plan.body)
	console.info(
		session_cite.text(
			`📋 Removed ${format_dependency_links(plan.links)} from epic ${session_cite.issue(epic_number)}.`,
		),
	)
	report_relations(plan, await epic_relations.apply_relations(plan.removed, 'drop'))

	if (decision !== undefined) await comment_decision(plan.ends, decision)
}

// Delete a declared order, or refuse without writing anything. Every refusal happens before the body
// edit, so a rejected invocation leaves the epic exactly as it was.
async function remove_order(input: RemoveOrderInput): Promise<number> {
	const epic = await epic_read.read_epic(input.epic_number)

	if ('error' in epic) {
		console.error(`✖ ${epic.error}`)

		return FAILURE_EXIT_CODE
	}

	const outcome = epic_remove_plan.build_removal_plan({
		epic_number: input.epic_number,
		body: epic.subject.body,
		labels: epic.subject.labels,
		path: input.path,
		recorded: epic.recorded,
		repo: epic.repo,
		decision: input.decision,
	})

	if ('error' in outcome) {
		console.error(`✖ ${outcome.error}`)

		return FAILURE_EXIT_CODE
	}

	await write_plan(input.epic_number, outcome.plan, input.decision)

	return SUCCESS_EXIT_CODE
}

const epic_remove = {
	remove_order,
}

export { epic_remove }
export type { RemoveOrderInput }
