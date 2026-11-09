import { issue_cite } from '#scripts/issue/issue-cite'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { run_pause, type AroundRelation } from '#scripts/run/pause/run-pause'
import { run_split, type EpicSlot, type SplitResult } from './run-split'

// `josh run:split <N> --prerequisite <P> [--title <title>]` — a prerequisite found mid-run
// (`backlogrun-child.md` → "When `#N` is not an epic") in one call: `#N` paused on `#P` through
// `run:pause`, `#P` placed ahead of `#N` — by the relation's own `epic --add --before` into the epic
// already tracking `#N`, or in a new ordered epic `#P` heads — and that epic audited. A tracking epic
// the listing cannot rule out parks `#N` with `needs-decision` instead.
//
// A new epic is created before the relation, so the relation is recorded inside it, never posted
// twice. A rerun past that point finds the epic tracking `#N` and takes the tracked path.

interface PrerequisiteRequest {
	issue: string
	prerequisite: string
	title: string | undefined
}

function park_body(request: PrerequisiteRequest, reason: string): string {
	const issue = issue_cite.plain_for('github', request.issue)
	const rerun = `pnpm josh run:split ${request.issue} --prerequisite ${request.prerequisite}`

	return `${NEEDS_DECISION_LABEL}: could not tell whether an epic already tracks ${issue} (${reason}), so ${issue_cite.plain_for('github', request.prerequisite)} was neither placed ahead of it nor recorded as its blocker. Rerun \`${rerun}\` once the epic listing reads in full, then clear this park with \`pnpm josh run:park ${request.issue} --clear\`.`
}

function create_argv(request: PrerequisiteRequest, title: string): Array<string> {
	return [title, request.prerequisite, request.issue, '--ordered']
}

async function pause_and_audit(
	request: PrerequisiteRequest,
	slot: EpicSlot,
	before: AroundRelation['before'],
): Promise<SplitResult> {
	const result = await run_pause.pause(request, { before, after: [run_split.audit_step(slot)] })
	const steps = result.kind === 'paused' ? { kind: 'done' as const, done: result.done } : result

	return run_split.placed(steps, slot)
}

async function in_new_epic(request: PrerequisiteRequest, title: string): Promise<SplitResult> {
	const slot: EpicSlot = {}

	async function create(): Promise<number> {
		return await run_split.create_epic(create_argv(request, title))
	}

	return await pause_and_audit(request, slot, [run_split.place_step(slot, create)])
}

async function prerequisite(request: PrerequisiteRequest): Promise<SplitResult> {
	const placement = await run_split.placement_of(request.issue, [request.prerequisite])

	if (placement.kind === 'unknown') {
		const body = park_body(request, placement.reason)

		return await run_split.park_after(run_pause.aside_of(request), body)
	}

	if (placement.kind === 'tracked') {
		return await pause_and_audit(request, { value: placement.epic }, [])
	}

	const { title } = request
	if (title === undefined) return run_split.UNTITLED

	return await in_new_epic(request, title)
}

const run_split_prerequisite = { prerequisite }

export type { PrerequisiteRequest }
export { run_split_prerequisite }
