import { issue_cite } from '#scripts/issue/issue-cite'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// `josh ship`'s durable stage record, and the decision of which stage a resumed ship may pass over,
// so a ship that died mid-way neither re-runs what already happened nor commits, pushes or merges
// twice.
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
	PREFLIGHT: 'preflight',
	REVIEW: 'review',
	GATE: 'gate',
	SYNC: 'sync',
	COMMIT: 'commit',
	ROUND_TWO: 'round-2',
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
const WORD_SEPARATOR = ' '
const STARTED_SEPARATOR = ','
const STARTED_INDEX = 3
const WORD_COUNT = STARTED_INDEX + 1

// `started` lists the stages the current attempt started, kept across a supervisor that ended without a
// stop so its successor's lines still carry them.
const record_schema = z.object({
	done: z.array(z.string()),
	started: z.array(z.string()).default([]),
})

type ShipRecord = z.infer<typeof record_schema>

const EMPTY_RECORD: ShipRecord = { done: [], started: [] }

// Keyed on the repository and the issue: every lane of one repository shares the common git directory,
// and two issues shipping from two lanes keep two records.
function record_path(repository: string, issue: string): string {
	return stamp_file.stamp_path(`${RECORD_PREFIX}${issue}${RECORD_SEPARATOR}`, repository)
}

function parse_record(raw: string): ShipRecord {
	return json_value.parse_with(raw, record_schema) ?? EMPTY_RECORD
}

// An absent, planted or malformed record reads as empty — the state decides from there, so "no
// record" is always the safe answer.
function read_record(target: string): ShipRecord {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? EMPTY_RECORD : parse_record(raw)
}

// The stages the record says completed.
function read_done(target: string): ReadonlySet<string> {
	return new Set(read_record(target).done)
}

function mark_done(target: string, stage: Stage): void {
	const record = read_record(target)

	stamp_file.replace_stamp(target, { ...record, done: [...new Set([...record.done, stage])] })
}

// The stages the current attempt has started, in the order it started them.
function read_started(target: string): ReadonlyArray<string> {
	return read_record(target).started
}

function mark_started(target: string, stage: Stage): void {
	const record = read_record(target)

	stamp_file.replace_stamp(target, { ...record, started: [...new Set([...record.started, stage])] })
}

// A `ship-stop` ends the attempt on the board (`run-board-phase.ts`), so the next attempt lists afresh
// while the completed stages stay recorded.
function end_attempt(target: string): void {
	stamp_file.replace_stamp(target, { ...read_record(target), started: [] })
}

// Removed once the report stage completes, so a later ship of the same issue starts from the preflight.
function clear(target: string): void {
	stamp_file.remove_stamp(target)
}

// Committed and on origin: the only state in which the commit stage has nothing left but the pull
// request, which `git -y` already finds rather than duplicates.
function is_shipped(state: ShipState): boolean {
	return state.is_committed && state.is_pushed
}

const DONE_BY: Record<Stage, (done: ReadonlySet<string>, state: ShipState) => boolean> = {
	// The preflight asks what the commit stage would refuse on, so a commit is
	// its output as it is the gate's; a resumed commit stage still asks `git -y`'s own preflight.
	[STAGE.PREFLIGHT]: (_done, state) => state.is_merged || state.is_committed,
	// The `--review` round precedes the commit, so a commit is its output as it
	// is the gate's. A record alone is not honored: before a commit the tree may have been edited since
	// the recorded round, and only a commit pins the tree that round read.
	[STAGE.REVIEW]: (_done, state) => state.is_merged || state.is_committed,
	[STAGE.GATE]: (_done, state) => state.is_merged || state.is_committed,
	// The merge of the default branch before the commit: once committed, a
	// conflicting pull request is the followup's to merge again.
	[STAGE.SYNC]: (_done, state) => state.is_merged || state.is_committed,
	[STAGE.COMMIT]: (done, state) => state.is_merged || (done.has(STAGE.COMMIT) && is_shipped(state)),
	// The round-2 pass reads the pushed fix delta, so its record is honored only
	// while that push still stands — new work pushed on top reruns it.
	[STAGE.ROUND_TWO]: (done, state) =>
		state.is_merged || (done.has(STAGE.ROUND_TWO) && is_shipped(state)),
	// A recorded followup still needs the shipped state: a record left by a merged ship whose report
	// failed must not pass over the followup of new, not-yet-pushed work on the same issue.
	[STAGE.FOLLOWUP]: (done, state) =>
		state.is_merged || (done.has(STAGE.FOLLOWUP) && is_shipped(state)),
	[STAGE.REPORT]: (done) => done.has(STAGE.REPORT),
}

// A supplied PR body is work only the commit stage delivers: a rerun carrying
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

// **The newest line carries the attempt's history**: a fourth word lists every
// stage the attempt has started, so the one line per issue a stream full of positions keeps still
// draws the whole track. A line with no started stage keeps the three-word form.
function event_text(
	issue: string,
	stage: Stage,
	phase: Phase,
	started: ReadonlyArray<string> = [],
): string {
	const words = [issue_cite.plain(issue), stage, phase]
	const listed = [...new Set(started)].join(STARTED_SEPARATOR)

	const full = started.length > 0 ? [...words, listed] : words

	return full.join(WORD_SEPARATOR)
}

// The stages a line says its attempt has started, `undefined` for a three-word line.
function started_of(text: string): ReadonlyArray<string> | undefined {
	return text.split(WORD_SEPARATOR, WORD_COUNT)[STARTED_INDEX]?.split(STARTED_SEPARATOR)
}

// A stop on a merge git could not finish is named `conflict` rather than by the stage it happened in,
// so the event stream reads the cause without anyone opening the report.
const CONFLICT = 'conflict'

function stop_reason(stage: Stage, conflicts: ReadonlyArray<string> = []): string {
	return conflicts.length > 0 ? CONFLICT : stage
}

const run_ship_stage = {
	PHASE,
	STAGE,
	clear,
	commit_flags,
	end_attempt,
	event_text,
	is_done,
	mark_done,
	mark_started,
	read_done,
	read_started,
	record_path,
	started_of,
	stop_reason,
}

export type { Phase, ShipState, Stage }
export { run_ship_stage }
