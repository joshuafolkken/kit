import { epic_command } from '#scripts/epic/epic'
import { epic_audit_cli } from '#scripts/epic/epic-audit-cli'
import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
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
	{ kind: 'tracked'; epic: number } | { kind: 'none' } | { kind: 'unknown'; reason: string }

type SplitResult =
	| { kind: 'epic'; epic: number; done: ReadonlyArray<StepReport> }
	| { kind: 'needs-decision'; done: ReadonlyArray<StepReport> }
	| { kind: 'failed'; step: string; reason: string; done: ReadonlyArray<StepReport> }

async function placement_of(issue: string): Promise<Placement> {
	try {
		const epic = await epic_blocked_by.tracking_epic_of(issue)

		return epic === undefined ? { kind: 'none' } : { kind: 'tracked', epic }
	} catch (error) {
		return { kind: 'unknown', reason: error_text.message_of(error) }
	}
}

function cited_children(request: SplitRequest): string {
	return request.children.map((child) => issue_cite.plain(child)).join(', ')
}

function aside_of(request: SplitRequest): AsideRequest {
	const issue = issue_cite.plain(request.issue)
	const children = cited_children(request)

	return {
		issue: request.issue,
		stash_message: `run:split: ${issue} split into ${children}`,
		marker: `<!-- josh:run-split ${issue} into ${children} -->`,
		headline: `Split: ${issue} continues beside ${children} in one epic.`,
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

async function add_to(request: SplitRequest, epic: number): Promise<number> {
	const code = await epic_command.run(add_argv(request, epic))

	if (code !== SUCCESS_EXIT_CODE) {
		throw new Error(`\`epic --add\` into ${session_cite.issue(epic)} failed`)
	}

	return epic
}

async function create_for(request: SplitRequest, title: string): Promise<number> {
	const creation = await epic_command.create(create_argv(request, title))
	if (creation.kind === 'created' && creation.epic !== undefined) return creation.epic

	throw new Error('`epic` created no epic whose number could be read')
}

async function audit(epic: number): Promise<string> {
	const code = await epic_audit_cli.run([String(epic)])
	if (code !== SUCCESS_EXIT_CODE) throw new Error(`\`epic:audit ${String(epic)}\` found errors`)

	return 'passed'
}

function park_body(request: SplitRequest, reason: string): string {
	const issue = issue_cite.plain(request.issue)

	return `${NEEDS_DECISION_LABEL}: could not tell whether an epic already tracks ${issue} (${reason}), so the split was not placed. Place ${cited_children(request)} by hand once the epic listing reads in full.`
}

async function park(request: SplitRequest, reason: string): Promise<string> {
	const body = park_body(request, reason)
	const write = await issue_park.apply(request.issue, NEEDS_DECISION_LABEL, body)
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
async function place_and_audit(
	request: SplitRequest,
	place: () => Promise<number>,
): Promise<SplitResult> {
	const slot: EpicSlot = {}
	const steps = run_set_aside.steps_of(aside_of(request), [
		place_step(slot, place),
		['audit', async () => await audit(slot.value ?? NaN)],
	])

	return placed(await run_set_aside.run_steps(steps), slot)
}

async function park_after_aside(request: SplitRequest, reason: string): Promise<SplitResult> {
	const steps = run_set_aside.steps_of(aside_of(request), [
		['park', async () => await park(request, reason)],
	])
	const result = await run_set_aside.run_steps(steps)

	return result.kind === 'done' ? { kind: NEEDS_DECISION_LABEL, done: result.done } : result
}

const NO_TITLE_REASON =
	'no epic tracks the issue, so `--title` is required to create one; nothing was written'

async function split(request: SplitRequest): Promise<SplitResult> {
	const placement = await placement_of(request.issue)

	if (placement.kind === 'unknown') return await park_after_aside(request, placement.reason)

	if (placement.kind === 'tracked') {
		return await place_and_audit(request, async () => await add_to(request, placement.epic))
	}

	const { title } = request

	if (title === undefined) {
		return { kind: 'failed', step: 'title', reason: NO_TITLE_REASON, done: [] }
	}

	return await place_and_audit(request, async () => await create_for(request, title))
}

const run_split = { split }

export type { SplitRequest, SplitResult }
export { run_split }
