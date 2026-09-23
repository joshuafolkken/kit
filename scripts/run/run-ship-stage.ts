import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'

// `josh ship`'s durable stage record, and the decision of which stage a resumed ship may pass over
// (joshuafolkken/kit#2426). The composite used to be a straight line with no memory: a ship that died
// after its push re-ran the gate, and nothing checked whether the commit, the push or the merge had
// already happened.
//
// **The record is a hint; the repository's actual state is the authority.** A record can be lost — a
// temp directory wiped — or outlived by the tree it describes, when new work was committed after it
// was written. So every skip below is decided from the observed state first, and a recorded stage is
// honored only where that state still corroborates it: a lost record re-derives the same answer from
// the state, and a stale one is overruled by it. Neither can produce a second commit, push or merge.
//
// **The gate is never skipped on the record's word.** It is passed over only once its output — a
// commit — exists; otherwise it runs, and `josh gate`'s own tree-keyed green record is what makes a
// re-run on an unchanged tree a reuse rather than a second execution. No quality gate is folded away.

const STAGE = {
	REVIEW: 'review',
	GATE: 'gate',
	COMMIT: 'commit',
	FOLLOWUP: 'followup',
	REPORT: 'report',
} as const

type Stage = (typeof STAGE)[keyof typeof STAGE]

// Where one stage is on the event stream: started, succeeded, failed, or passed over as already done.
const PHASE = {
	START: 'start',
	DONE: 'done',
	FAILED: 'failed',
	SKIPPED: 'skipped',
} as const

type Phase = (typeof PHASE)[keyof typeof PHASE]

interface ShipState {
	is_committed: boolean
	is_pushed: boolean
	is_merged: boolean
}

const RECORD_PREFIX = 'josh-ship-stages-'
const RECORD_SEPARATOR = '-'
const SKIP_COMMIT_FLAG = '--skip-commit'
const SKIP_PUSH_FLAG = '--skip-push'

const record_schema = z.object({ done: z.array(z.string()) })

// Keyed on the repository and the issue: every lane of one repository shares the common git directory,
// and two issues shipping from two lanes keep two records.
function record_path(repository: string, issue: string): string {
	return stamp_file.stamp_path(`${RECORD_PREFIX}${issue}${RECORD_SEPARATOR}`, repository)
}

function parse_done(raw: string): ReadonlySet<string> {
	try {
		return new Set(record_schema.parse(JSON.parse(raw)).done)
	} catch {
		return new Set()
	}
}

// The stages the record says completed. An absent, planted or malformed record reads as none — the
// state decides from there, so "no record" is always the safe answer.
function read_done(target: string): ReadonlySet<string> {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? new Set() : parse_done(raw)
}

function mark_done(target: string, stage: Stage): void {
	const done = new Set([...read_done(target), stage])

	stamp_file.replace_stamp(target, { done: [...done] })
}

// Removed once the report stage completes, so a later ship of the same issue starts from the gate.
function clear(target: string): void {
	stamp_file.remove_stamp(target)
}

// Committed and on origin: the only state in which the commit stage has nothing left but the pull
// request, which `git -y` already finds rather than duplicates.
function is_shipped(state: ShipState): boolean {
	return state.is_committed && state.is_pushed
}

const DONE_BY: Record<Stage, (done: ReadonlySet<string>, state: ShipState) => boolean> = {
	// The `--review` round (joshuafolkken/kit#2427) precedes the commit, so a commit is its output as it
	// is the gate's. A record alone is not honored: before a commit the tree may have been edited since
	// the recorded round, and only a commit pins the tree that round read.
	[STAGE.REVIEW]: (_done, state) => state.is_merged || state.is_committed,
	[STAGE.GATE]: (_done, state) => state.is_merged || state.is_committed,
	[STAGE.COMMIT]: (done, state) => state.is_merged || (done.has(STAGE.COMMIT) && is_shipped(state)),
	// A recorded followup still needs the shipped state: a record left by a merged ship whose report
	// failed must not pass over the followup of new, not-yet-pushed work on the same issue.
	[STAGE.FOLLOWUP]: (done, state) =>
		state.is_merged || (done.has(STAGE.FOLLOWUP) && is_shipped(state)),
	[STAGE.REPORT]: (done) => done.has(STAGE.REPORT),
}

// A supplied PR body is work only the commit stage delivers (joshuafolkken/kit#2446): a rerun carrying
// the live-execution evidence a refused `followup` asked for reruns `git -y`, whose skip flags leave the
// commit and push alone while the body reaches the already-open pull request.
function is_done(
	stage: Stage,
	done: ReadonlySet<string>,
	state: ShipState,
	has_body = false,
): boolean {
	if (has_body && stage === STAGE.COMMIT && !state.is_merged) return false

	return DONE_BY[stage](done, state)
}

// The `git -y` flags that keep a resumed commit stage from repeating what already happened: an
// existing commit is not made again, and a commit already on origin is not pushed again. A push is
// skipped only on top of a skipped commit — new work committed now must still be pushed.
function commit_flags(state: ShipState): ReadonlyArray<string> {
	if (!state.is_committed) return []

	return state.is_pushed ? [SKIP_COMMIT_FLAG, SKIP_PUSH_FLAG] : [SKIP_COMMIT_FLAG]
}

function event_text(issue: string, stage: Stage, phase: Phase): string {
	return `#${issue} ${stage} ${phase}`
}

const run_ship_stage = {
	PHASE,
	STAGE,
	clear,
	commit_flags,
	event_text,
	is_done,
	mark_done,
	read_done,
	record_path,
}

export type { Phase, ShipState, Stage }
export { run_ship_stage }
