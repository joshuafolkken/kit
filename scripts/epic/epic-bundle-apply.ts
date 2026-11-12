import { issue_cite } from '#scripts/issue/issue-cite'
import { epic_add } from './epic-add'
import {
	epic_bundle,
	type BacklogIssue,
	type BundleAction,
	type BundleDecision,
} from './epic-bundle'
import { epic_bundle_recommend } from './epic-bundle-recommend'
import { epic_reconcile } from './epic-reconcile'
import { epic_run } from './epic-run'

// `josh epic:bundle <N> --apply` — write the answer whose placement is settled: `add_to_epic` through
// `epic --add`'s writer, `create_epic` through `epic`'s. Nothing here edits an epic itself, so the
// task list and the `blocked-by` relations stay as those writers keep them.
//
// **An order the candidates already record is carried into the epic body** by `epic --reconcile`,
// which declares exactly the recorded relations — an order nobody recorded is never invented.
//
// `ask` is placed in the epic the decision recommends, with the reasoning written through `epic --add`'s
// decision record on both the epic and the children. A cyclic spread recommends none and writes nothing.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ISO_DATE_LENGTH = 10

interface ApplyInput {
	decision: BundleDecision
	subject: BacklogIssue
	// The backlog rows of `decision.candidates`, as `format_order` reads them.
	members: ReadonlyArray<BacklogIssue>
	is_membership_established: boolean
}

const UNAPPLIED_LINES: Readonly<Partial<Record<BundleAction, string>>> = {
	ask: '↷ `--apply` wrote nothing: the related epics declare a cycle, so none is recommended. Choose one and place it with `pnpm josh epic --add <E> <N> --decision-file <path>`.',
	none: '↷ `--apply` wrote nothing: there is nothing to place.',
}
const WITHHELD_LINE =
	'↷ `--apply` wrote nothing: the epic listing was cut short, so no placement was confirmed.'
const UNREAD_EPIC_LINE =
	"✖ The new epic's number could not be read, so the recorded order was not written; run `pnpm josh epic --reconcile <E>` on it."

function has_order(input: ApplyInput): boolean {
	return epic_bundle.bundle_dependency_links(input.subject, input.members).length > 0
}

function children_of(input: ApplyInput): Array<number> {
	return epic_bundle.bundle_children(input.subject, input.members)
}

// An epic whose number could not be read cannot be given the order, so that is a failure rather than
// an order silently left out.
async function reconcile_order(
	epic_number: number | undefined,
	input: ApplyInput,
): Promise<number> {
	if (!has_order(input)) return SUCCESS_EXIT_CODE

	if (epic_number === undefined) {
		console.error(UNREAD_EPIC_LINE)

		return FAILURE_EXIT_CODE
	}

	return await epic_reconcile.reconcile_epic(epic_number)
}

// A member another epic tracks stays there: `add_to_epic` can name an inner epic while a candidate sits
// in its parent, and adding that candidate here would put one issue in two task lists.
function placeable(epic_number: number, input: ApplyInput): ApplyInput {
	const members = input.members.filter(
		(member) => member.epic === undefined || member.epic === epic_number,
	)

	return { ...input, members }
}

async function add_to_epic(
	epic_number: number,
	input: ApplyInput,
	decision: string | undefined,
): Promise<number> {
	const placed = placeable(epic_number, input)
	const added = await epic_add.add_children({
		epic_number,
		children: children_of(placed),
		...(decision !== undefined && { decision }),
	})
	if (added !== SUCCESS_EXIT_CODE) return added

	return await reconcile_order(epic_number, placed)
}

// The epic a placing answer names: `add_to_epic`'s own, or the one `ask` recommends.
function target_of(decision: BundleDecision): number | undefined {
	if (decision.action === 'add_to_epic') return decision.epic

	return decision.action === 'ask' ? decision.recommended : undefined
}

// `ask`'s placement was a choice between epics, so it carries its record; `add_to_epic`'s was not.
function record_of(input: ApplyInput, epic_number: number): string | undefined {
	if (input.decision.action !== 'ask') return undefined
	const date = new Date().toISOString().slice(0, ISO_DATE_LENGTH)
	const placement = {
		subject: input.subject.number,
		epic: epic_number,
		epics: input.decision.epics,
		members: input.members,
	}

	return epic_bundle_recommend.placement_record(placement, date)
}

// The title is the subject's, since the subject is what the bundle was asked about; the rationale is
// the verdict's own reason, which already names the signal that grouped them.
function title_of(subject: BacklogIssue): string {
	const title = subject.title ?? `bundle with ${issue_cite.plain_for('github', subject.number)}`

	return `Epic: ${title}`
}

async function create_epic(input: ApplyInput): Promise<number> {
	const epic_number = await epic_run.create_epic_number({
		title: title_of(input.subject),
		children: children_of(input),
		rationale: input.decision.reason,
		is_ordered: false,
	})

	return await reconcile_order(epic_number, input)
}

function report_unapplied(action: BundleAction): number {
	const line = UNAPPLIED_LINES[action]
	if (line !== undefined) console.info(line)

	return SUCCESS_EXIT_CODE
}

async function apply_decision(input: ApplyInput): Promise<number> {
	const { decision } = input

	if (!input.is_membership_established) {
		console.info(WITHHELD_LINE)

		return SUCCESS_EXIT_CODE
	}

	if (decision.action === 'create_epic') return await create_epic(input)

	const epic_number = target_of(decision)
	if (epic_number === undefined) return report_unapplied(decision.action)

	return await add_to_epic(epic_number, input, record_of(input, epic_number))
}

const epic_bundle_apply = {
	UNAPPLIED_LINES,
	WITHHELD_LINE,
	UNREAD_EPIC_LINE,
	title_of,
	apply_decision,
}

export { epic_bundle_apply }
export type { ApplyInput }
