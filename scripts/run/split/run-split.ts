import { epic_command } from '#scripts/epic/epic'
import { epic_audit_cli } from '#scripts/epic/epic-audit-cli'
import { epic_blocked_by, type ChildrenTracking } from '#scripts/epic/epic-blocked-by'
import { issue_cite } from '#scripts/issue/issue-cite'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import {
	run_set_aside,
	type AsideRequest,
	type Step,
	type StepReport,
	type StepsResult,
} from '#scripts/run/pause/run-set-aside'

// `josh run:split <N> --children <N1,N2,...> [--ordered] [--title <title>]` — a split found mid-run
// (`backlogrun-child.md` → "When `#N` is not an epic") in one call: the run set aside (stash, comment,
// release), its children placed — into the epic already tracking `#N`, or a new epic `#N` heads — and
// that epic audited. A tracking epic the listing cannot rule out parks `#N` with `needs-decision`
// instead: "could not tell" is not "no epic".
//
// The placement is asked before anything is written, so a missing `--title` refuses on a clean slate.

const SUCCESS_EXIT_CODE = 0

interface SplitRequest {
	issue: string
	children: ReadonlyArray<string>
	is_ordered: boolean
	title: string | undefined
}

type Placement =
	({ kind: 'tracked' } & ChildrenTracking) | { kind: 'none' } | { kind: 'unknown'; reason: string }

type SplitResult =
	| { kind: 'epic'; epic: number; done: ReadonlyArray<StepReport> }
	| { kind: 'needs-decision'; done: ReadonlyArray<StepReport> }
	| { kind: 'failed'; step: string; reason: string; done: ReadonlyArray<StepReport> }

async function placement_of(issue: string, children: ReadonlyArray<string>): Promise<Placement> {
	try {
		const tracking = await epic_blocked_by.tracking_with(issue, children)

		return tracking === undefined ? { kind: 'none' } : { kind: 'tracked', ...tracking }
	} catch (error) {
		return { kind: 'unknown', reason: error_text.message_of(error) }
	}
}

function cited_children(request: SplitRequest): string {
	return request.children.map((child) => issue_cite.plain_for('github', child)).join(', ')
}

// `is_handed_off` when the children take the work over; a park keeps it on `#issue`'s own lane.
function aside_of(request: SplitRequest, is_handed_off = false): AsideRequest {
	const issue = issue_cite.plain_for('program', request.issue)
	const children = cited_children(request)

	return {
		issue: request.issue,
		stash_message: `run:split: ${issue} split into ${children}`,
		marker: `<!-- josh:run-split ${issue} into ${children} -->`,
		headline: `Split: ${issue} continues beside ${children} in one epic.`,
		is_handed_off,
	}
}

// `--after <N>` makes `#N` the head of an ordered split's chain inside an existing epic too.
function add_argv(request: SplitRequest, epic: number): Array<string> {
	const order = request.is_ordered ? ['--after', request.issue] : []

	return ['--add', String(epic), ...request.children, ...order]
}

function create_argv(request: SplitRequest, title: string): Array<string> {
	const order = request.is_ordered ? ['--ordered'] : []

	return [title, request.issue, ...request.children, ...order]
}

// An epic already listing every child is a rerun past a later failed step — the first run's own epic,
// whether it added the children or created it — so `epic --add`, which refuses an add with nothing
// new, is not asked again.
async function add_to(request: SplitRequest, tracking: ChildrenTracking): Promise<number> {
	const { epic } = tracking
	if (tracking.lists_children) return epic
	const code = await epic_command.run(add_argv(request, epic))

	if (code !== SUCCESS_EXIT_CODE) {
		throw new Error(`\`epic --add\` into ${session_cite.issue(epic)} failed`)
	}

	return epic
}

async function create_epic(argv: ReadonlyArray<string>): Promise<number> {
	const creation = await epic_command.create(argv)
	if (creation.kind === 'created' && creation.epic !== undefined) return creation.epic

	throw new Error('`epic` created no epic whose number could be read')
}

async function audit(epic: number): Promise<string> {
	const code = await epic_audit_cli.run([String(epic)])
	if (code !== SUCCESS_EXIT_CODE) throw new Error(`\`epic:audit ${String(epic)}\` found errors`)

	return 'passed'
}

function park_body(request: SplitRequest, reason: string): string {
	const issue = issue_cite.plain_for('github', request.issue)

	return `${NEEDS_DECISION_LABEL}: could not tell whether an epic already tracks ${issue} (${reason}), so the split was not placed. Place ${cited_children(request)} by hand once the epic listing reads in full.`
}

async function park(issue: string, body: string): Promise<string> {
	const write = await issue_park.apply(issue, NEEDS_DECISION_LABEL, body)
	if (!write.is_labelled) throw new Error(`the \`${NEEDS_DECISION_LABEL}\` label was not applied`)

	return NEEDS_DECISION_LABEL
}

interface EpicSlot {
	value?: number
}

function placed(result: StepsResult, slot: EpicSlot): SplitResult {
	if (result.kind === 'failed') return result

	if (slot.value === undefined) {
		return { kind: 'failed', step: 'place', reason: 'no epic was placed', done: result.done }
	}

	return { kind: 'epic', epic: slot.value, done: result.done }
}

function place_step(slot: EpicSlot, place: () => Promise<number>): Step {
	async function act(): Promise<string> {
		slot.value = await place()

		return `epic ${session_cite.issue(slot.value)}`
	}

	return ['place', act]
}

// The tracked or created epic is carried from the `place` step to the `audit` step through `slot`;
// `audit` runs only once `place` filled it.
function audit_step(slot: EpicSlot): Step {
	return ['audit', async () => await audit(slot.value ?? NaN)]
}

async function place_and_audit(
	request: SplitRequest,
	place: () => Promise<number>,
): Promise<SplitResult> {
	const slot: EpicSlot = {}
	const steps = run_set_aside.steps_of(aside_of(request, true), [
		place_step(slot, place),
		audit_step(slot),
	])

	return placed(await run_set_aside.run_steps(steps), slot)
}

// The set-aside `aside` names, then `#issue` parked with `needs-decision` and `body`.
async function park_after(aside: AsideRequest, body: string): Promise<SplitResult> {
	const steps = run_set_aside.steps_of(aside, [['park', async () => await park(aside.issue, body)]])
	const result = await run_set_aside.run_steps(steps)

	return result.kind === 'done' ? { kind: NEEDS_DECISION_LABEL, done: result.done } : result
}

const UNTITLED: SplitResult = {
	kind: 'failed',
	step: 'title',
	reason: 'no epic tracks the issue, so `--title` is required to create one; nothing was written',
	done: [],
}

async function split(request: SplitRequest): Promise<SplitResult> {
	const placement = await placement_of(request.issue, request.children)

	if (placement.kind === 'unknown') {
		return await park_after(aside_of(request), park_body(request, placement.reason))
	}

	if (placement.kind === 'tracked') {
		return await place_and_audit(request, async () => await add_to(request, placement))
	}

	const { title } = request
	if (title === undefined) return UNTITLED

	return await place_and_audit(request, async () => await create_epic(create_argv(request, title)))
}

// The steps `run-split-prerequisite.ts` shares, so both forms place, audit and park alike.
const run_split = {
	split,
	placement_of,
	create_epic,
	place_step,
	audit_step,
	placed,
	park_after,
	UNTITLED,
}

export type { EpicSlot, SplitRequest, SplitResult }
export { run_split }
