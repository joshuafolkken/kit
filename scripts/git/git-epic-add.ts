import { git_epic_add_plan, type AddPlan } from './git-epic-add-plan'
import type { InsertPosition } from './git-epic-chains'
import { git_epic_decision } from './git-epic-decision'
import { git_epic_read } from './git-epic-read'
import { format_issue_references, format_replaced_relations } from './git-epic-reference'
import { git_epic_relations } from './git-epic-relations'
import { git_gh_command } from './git-gh-command'

// `josh epic --add <E> <N...> [--before <M> | --after <M>] [--decision-file <path|->]` — insert
// children into an existing epic.
//
// Adding a child by editing the body is what the procedure told an agent to do, and it is what stops
// an unattended run: the body then declares an order the native `blocked-by` relations do not record,
// `epic:next` reports `declaration_mismatch`, and the verdict is `error`. This command writes the
// task-list row, the declaration and the relations from one input, so the three cannot disagree
// (joshuafolkken/kit#890).
//
// **`--decision-file` folds the fourth and fifth writes in** (joshuafolkken/kit#1350). An auto-decided
// placement has to be recorded in the epic's `## Decisions` and on each child, and no command wrote the
// epic half — so a run read the body, edited it and `PATCH`ed it back, which is the hand edit
// `CLAUDE.md` forbids. The epic half now rides on the body edit this command already makes, so it costs
// no round trip; the child half is one comment per addition, counted rather than thrown.

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

interface AddChildrenInput {
	epic_number: number
	children: ReadonlyArray<number>
	position?: InsertPosition | undefined
	// The decision record to write, from `--decision-file`. It goes to two places, and both used to be
	// separate calls a run made afterwards: the epic's `## Decisions` section — folded into the body
	// edit below, so it costs no round trip — and a comment on each child added
	// (joshuafolkken/kit#1350).
	decision?: string | undefined
}

function report_relations(plan: AddPlan, failures: { added: number; removed: number }): void {
	if (plan.removed.length > 0) {
		console.info(
			git_epic_relations.format_relation_report({
				links: plan.removed,
				failures: failures.removed,
				action: 'drop',
			}),
		)
	}

	if (plan.added.length === 0) return

	console.info(
		git_epic_relations.format_relation_report({
			links: plan.added,
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

// The two things one insertion can do, reported separately because they are different edits: an
// addition gains a task-list row, a relocation moves the row it already had. Either list can be empty
// — `--before` / `--after` on children the epic already tracks adds nothing at all
// (joshuafolkken/kit#1701) — so neither line is printed unconditionally.
function report_placements(epic_number: number, plan: AddPlan): void {
	const epic = `epic #${String(epic_number)}`

	if (plan.additions.length > 0) {
		console.info(`📋 Added ${format_issue_references(plan.additions)} to ${epic}.`)
	}

	if (plan.relocations.length > 0) {
		console.info(`📋 Moved ${format_issue_references(plan.relocations)} within ${epic}.`)
	}
}

// **What the insertion discarded, printed from `plan.replaced` rather than `plan.removed`**
// (joshuafolkken/kit#1711). The two differ by the filter `removed` carries for `gh`'s sake: a link the
// body declared but nobody ever recorded natively is dropped from the declaration all the same, and
// reporting from the work list let exactly those go by without a word. A positioned `--add` is the
// only invocation that can replace anything, so an addition that re-points nothing prints nothing.
function report_success(epic_number: number, plan: AddPlan): void {
	report_placements(epic_number, plan)

	if (plan.replaced.length > 0) {
		console.info(`↪ ${format_replaced_relations(plan.replaced)}`)
	}
}

// The child half of the decision record, posted after the epic's body carries its own half. A failure
// is counted rather than thrown for the reason a relation failure is: the insertion itself has landed,
// and an exception here would leave the caller unable to tell that from a refusal that wrote nothing.
async function comment_decision(children: ReadonlyArray<number>, decision: string): Promise<void> {
	const posted = await Promise.all(
		children.map(async (child) => await git_gh_command.issue_try_comment(String(child), decision)),
	)

	console.info(
		git_epic_decision.format_decision_report({
			total: children.length,
			failures: posted.filter((is_posted) => !is_posted).length,
		}),
	)
}

// The record posted to the children is `plan.decision`, not the caller's file: the plan is what folded
// the replaced relations into it, and reading the raw input here would leave the epic's `## Decisions`
// carrying a line the child comments do not (joshuafolkken/kit#1711).
async function write_plan(epic_number: number, plan: AddPlan): Promise<void> {
	await git_gh_command.issue_edit_body(String(epic_number), plan.body)
	report_success(epic_number, plan)
	await apply_plan(plan)

	// A relocation is a placement decision as much as an addition is, so the record reaches the child
	// that was moved too (joshuafolkken/kit#1701).
	if (plan.decision !== undefined) {
		await comment_decision([...plan.additions, ...plan.relocations], plan.decision)
	}
}

// Insert children into an existing epic, or refuse without writing anything. Every refusal happens
// before the body edit, so a rejected invocation leaves the epic exactly as it was.
async function add_children(input: AddChildrenInput): Promise<number> {
	const epic = await git_epic_read.read_epic(input.epic_number)

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
		decision: input.decision,
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
