import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_set_aside, type AsideRequest, type StepReport } from './run-set-aside'

// `josh run:pause <M> --for <N>` — set a run aside while its prerequisite `#N` lands first
// (`prerequisite.md`): the work in progress stashed under a fixed name, a comment on `#M` naming the
// pop, `#M` blocked by `#N` and the hold released, in that order.
//
// The set-aside steps are `run-set-aside.ts`'s, each asking whether it is already done, so a rerun
// after a failure carries on from the step that failed. The relation is `epic_blocked_by.record`'s,
// which keeps the tracking epic's declaration beside it and settles a recorded one on a rerun.

interface PauseRequest {
	issue: string
	prerequisite: string
}

type PauseResult =
	| { kind: 'paused'; done: ReadonlyArray<StepReport> }
	| { kind: 'failed'; step: string; reason: string; done: ReadonlyArray<StepReport> }

function aside_of(request: PauseRequest): AsideRequest {
	const issue = issue_cite.plain(request.issue)
	const prerequisite = issue_cite.plain(request.prerequisite)

	return {
		issue: request.issue,
		stash_message: `run:pause: ${issue} waits on ${prerequisite}`,
		marker: `<!-- josh:run-pause ${issue} for ${prerequisite} -->`,
		headline: `Paused: ${prerequisite} has to land first.`,
	}
}

async function pause(request: PauseRequest): Promise<PauseResult> {
	const steps = run_set_aside.steps_of(aside_of(request), [
		['blocked-by', async () => await epic_blocked_by.record(request)],
	])
	const result = await run_set_aside.run_steps(steps)

	return result.kind === 'done' ? { kind: 'paused', done: result.done } : result
}

const run_pause = { pause }

export type { PauseRequest, PauseResult }
export { run_pause }

export { type StepReport } from './run-set-aside'
