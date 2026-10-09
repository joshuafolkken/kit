import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'
import { epic_add_plan, type AddPlan } from './epic-add-plan'
import type { InsertPosition } from './epic-chains'
import { epic_decision } from './epic-decision'
import { epic_issue } from './epic-issue'
import { epic_read, type EpicReading } from './epic-read'
import {
	format_issue_references,
	format_replaced_relations,
	to_issue_reference,
} from './epic-reference'
import { epic_relations } from './epic-relations'

// `josh epic --add <E> <N...> [--before <M> | --after <M> | --order-before <M> | --order-after <M>]
// [--decision-file <path|->]` — insert children into an existing epic.
//
// **`--order-*` moves the row and writes nothing else**. `epic:next` offers
// children in task-list order, so putting one first meant `--before`, which records a `blocked-by`:
// "no dependency, but run this one first" had no spelling, and an order written that way stops every
// child behind the one that stalls.
//
// Adding a child by editing the body is what the procedure told an agent to do, and it is what stops
// an unattended run: the body then declares an order the native `blocked-by` relations do not record,
// `epic:next` reports `declaration_mismatch`, and the verdict is `error`. This command writes the
// task-list row, the declaration and the relations from one input, so the three cannot disagree.
//
// **`--decision-file` folds the fourth and fifth writes in**. An auto-decided
// placement has to be recorded in the epic's `## Decisions` and on each child, and no command wrote the
// epic half — so a run read the body, edited it and `PATCH`ed it back, which is the hand edit
// `CLAUDE.md` forbids. The epic half now rides on the body edit this command already makes, so it costs
// no round trip; the child half is one comment per addition, counted rather than thrown.

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

// A completed epic takes no new children: adding one silently produces a closed epic with unfinished
// children, whose backlog opt-in no longer fires, so the child never surfaces and the addition is
// lost. The refusal is only fired on a *confirmed* closed state — an
// unreadable state field leaves the addition to proceed, since blocking on a lookup that never
// answered would be the worse failure.
function is_closed_epic(state: string | undefined): boolean {
	return state !== undefined && epic_issue.normalize_state(state) === epic_issue.CLOSED
}

function closed_epic_error(epic_number: number): string {
	return `Epic ${session_cite.issue(epic_number)} is closed — a completed epic takes no new children. Reopen it if it is not actually done, or run \`pnpm josh epic:bundle <child>\` to place the child in an open epic instead.`
}

interface AddChildrenInput {
	epic_number: number
	children: ReadonlyArray<number>
	position?: InsertPosition | undefined
	// `--order-before` / `--order-after`: place the row at `position` and write nothing else — no
	// declaration, no `blocked-by`.
	is_order_only?: boolean | undefined
	// The decision record to write, from `--decision-file`. It goes to two places, neither of them a
	// separate call a run makes afterwards: the epic's `## Decisions` section — folded into the body
	// edit below, so it costs no round trip — and a comment on each child added.
	decision?: string | undefined
}

function report_relations(plan: AddPlan, failures: { added: number; removed: number }): void {
	if (plan.removed.length > 0) {
		console.info(
			epic_relations.format_relation_report({
				links: plan.removed,
				failures: failures.removed,
				action: 'drop',
			}),
		)
	}

	if (plan.added.length === 0) return

	console.info(
		epic_relations.format_relation_report({
			links: plan.added,
			failures: failures.added,
			action: 'record',
		}),
	)
}

// Dropped before recorded: inserting `#N` between `#B` and `#M` replaces `#B -> #M`, and applying the
// new link first would leave `#M` momentarily blocked by both.
async function apply_plan(plan: AddPlan): Promise<void> {
	const removed = await epic_relations.apply_relations(plan.removed, 'drop')
	const added = await epic_relations.apply_relations(plan.added, 'record')

	report_relations(plan, { added, removed })
}

// The two things one insertion can do, reported separately because they are different edits: an
// addition gains a task-list row, a relocation moves the row it already had. Either list can be empty
// — `--before` / `--after` on children the epic already tracks adds nothing at all
// — so neither line is printed unconditionally.
// A row moved onto the wrong side of an order the declaration already states. `epic:next` filters by
// `blocked_by` before it applies task-list order, so the move cannot change when that child is offered
// until the declaration itself changes — and the placement line above, read alone, says the opposite.
// It is a warning rather than a refusal for the reason `contradicted` gives.
function report_contradiction(plan: AddPlan): void {
	if (plan.contradicted.length === 0) return

	console.info(
		session_cite.text(
			`⚠️ ${format_issue_references(plan.contradicted)} is still held by a declared order, so \`epic:next\` will not offer it any earlier until that order is changed — \`--remove\` deletes one.`,
		),
	)
}

// **An order-only move reports the place, because nothing else will**. An
// ordinary insertion is followed by the replaced-relation line and the relation report, which between
// them say where the child landed; `--order-*` writes neither, so without this line the console says a
// row moved and never says where to. The position is read from the input rather than the plan: the
// plan deliberately carries no record of it, the declaration being what it did not change.
function report_order(input: AddChildrenInput, plan: AddPlan): void {
	const { position } = input
	if (position === undefined) return

	const placed = format_issue_references([...plan.additions, ...plan.relocations])
	const target = to_issue_reference(position.target)

	console.info(
		session_cite.text(
			`📋 Placed ${placed} ${position.kind} ${target} in epic ${session_cite.issue(input.epic_number)} — order only, no dependency written.`,
		),
	)
	report_contradiction(plan)
}

function report_placements(input: AddChildrenInput, plan: AddPlan): void {
	if (input.is_order_only === true) {
		report_order(input, plan)

		return
	}

	const epic = `epic ${session_cite.issue(input.epic_number)}`

	if (plan.additions.length > 0) {
		console.info(
			session_cite.text(`📋 Added ${format_issue_references(plan.additions)} to ${epic}.`),
		)
	}

	if (plan.relocations.length > 0) {
		console.info(
			session_cite.text(`📋 Moved ${format_issue_references(plan.relocations)} within ${epic}.`),
		)
	}
}

// **What the insertion discarded, printed from `plan.replaced` rather than `plan.removed`**.
// The two differ by the filter `removed` carries for `gh`'s sake: a link the
// body declared but nobody ever recorded natively is dropped from the declaration all the same, and
// reporting from the work list let exactly those go by without a word. A positioned `--add` is the
// only invocation that can replace anything, so an addition that re-points nothing prints nothing.
function report_success(input: AddChildrenInput, plan: AddPlan): void {
	report_placements(input, plan)

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
		epic_decision.format_decision_report({
			total: children.length,
			failures: posted.filter((is_posted) => !is_posted).length,
		}),
	)
}

// The record posted to the children is `plan.decision`, not the caller's file: the plan is what folded
// the replaced relations into it, and reading the raw input here would leave the epic's `## Decisions`
// carrying a line the child comments do not.
// A child new to the epic, not a reordering — the only insertion that can put runnable work in the pool.
function has_new_child(input: AddChildrenInput, plan: AddPlan): boolean {
	return input.is_order_only !== true && plan.additions.length > 0
}

async function write_plan(input: AddChildrenInput, plan: AddPlan): Promise<void> {
	await git_gh_command.issue_edit_body(String(input.epic_number), plan.body)
	report_success(input, plan)
	await apply_plan(plan)

	// A relocation is a placement decision as much as an addition is, so the record reaches the child
	// that was moved too.
	if (plan.decision !== undefined) {
		await comment_decision([...plan.additions, ...plan.relocations], plan.decision)
	}

	if (has_new_child(input, plan)) await backlog_ready.print_offer_hint()
}

// The epic ready to receive children, or the reason it cannot be added to: unreadable, or closed.
// Both reasons come back as a bare string the one caller prefixes `✖` onto,
// so the two refusals read identically on stderr.
async function read_open_epic(epic_number: number): Promise<EpicReading | { error: string }> {
	const epic = await epic_read.read_epic(epic_number)
	if ('error' in epic) return epic
	if (is_closed_epic(epic.subject.state)) return { error: closed_epic_error(epic_number) }

	return epic
}

// Insert children into an existing epic, or refuse without writing anything. Every refusal happens
// before the body edit, so a rejected invocation leaves the epic exactly as it was.
async function add_children(input: AddChildrenInput): Promise<number> {
	const epic = await read_open_epic(input.epic_number)

	if ('error' in epic) {
		console.error(`✖ ${epic.error}`)

		return FAILURE_EXIT_CODE
	}

	const outcome = epic_add_plan.build_plan({
		epic_number: input.epic_number,
		body: epic.subject.body,
		labels: epic.subject.labels,
		children: input.children,
		position: input.position,
		is_order_only: input.is_order_only,
		recorded: epic.recorded,
		repo: epic.repo,
		decision: input.decision,
	})

	if ('error' in outcome) {
		console.error(`✖ ${outcome.error}`)

		return FAILURE_EXIT_CODE
	}

	await write_plan(input, outcome.plan)

	return SUCCESS_EXIT_CODE
}

const epic_add = {
	add_children,
}

export { epic_add }
export type { AddChildrenInput }
