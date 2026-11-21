import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_language } from '#scripts/josh/session-language'
import { run_pause_comment } from './run-pause-comment'
import { run_pause_publish } from './run-pause-publish'
import { run_set_aside, type AsideRequest, type Step, type StepReport } from './run-set-aside'

// `josh run:pause <M> --for <N>` — set a run aside while its prerequisite `#N` lands first
// (`prerequisite.md`): the work in progress stashed under a fixed name, a comment on `#M` naming the
// pop, `#M` blocked by `#N`, a prepared `#N` published (or what it needs noted on both, by
// `run-pause-publish.ts`) and the hold released, in that order. A prepared `#N` with no recorded plan
// is refused before the first step (joshuafolkken/kit#8105).
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

// Prose in the session language: the comment is found by its marker, never by this line.
function headline(prerequisite: string): string {
	return session_language.is_japanese(session_language.resolve_session_lang().lang)
		? `一時停止: 先に ${prerequisite} が入る必要がある。`
		: `Paused: ${prerequisite} has to land first.`
}

function aside_of(request: PauseRequest): AsideRequest {
	const issue = issue_cite.plain_for('program', request.issue)
	const prerequisite = issue_cite.plain_for('program', request.prerequisite)

	return {
		issue: request.issue,
		stash_message: `run:pause: ${issue} waits on ${prerequisite}`,
		marker: `${run_pause_comment.marker_of(request.issue)}${prerequisite} -->`,
		headline: headline(prerequisite),
	}
}

// The steps `run:split --prerequisite` runs inside the set-aside, around the relation: `before` an
// epic created first, so the relation is recorded inside it, `after` the audit of that epic.
interface AroundRelation {
	before: ReadonlyArray<Step>
	after: ReadonlyArray<Step>
}

const NO_STEPS: AroundRelation = { before: [], after: [] }

async function pause(
	request: PauseRequest,
	around: AroundRelation = NO_STEPS,
): Promise<PauseResult> {
	const unplanned = await run_pause_publish.unplanned(request)
	if (unplanned !== undefined) return { kind: 'failed', step: 'plan', reason: unplanned, done: [] }

	const steps = run_set_aside.steps_of(aside_of(request), [
		...around.before,
		['blocked-by', async () => await epic_blocked_by.record(request)],
		...around.after,
		['publish-prepared', async () => await run_pause_publish.publish_prepared(request)],
	])
	const result = await run_set_aside.run_steps(steps)

	return result.kind === 'done' ? { kind: 'paused', done: result.done } : result
}

const run_pause = { pause, aside_of }

export type { AroundRelation, PauseRequest, PauseResult }
export { run_pause }

export { type StepReport } from './run-set-aside'
