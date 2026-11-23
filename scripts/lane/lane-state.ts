import { readdirSync } from 'node:fs'
import path from 'node:path'
import { repository_lock } from '#scripts/git/repository-lock'
import { session_cite } from '#scripts/issue/session-cite'
import { durable_state } from '#scripts/josh/durable-state'
import { stamp_file } from '#scripts/josh/stamp-file'
import { figure_format } from '#scripts/lib/figure-format'
import { run_carry } from '#scripts/run/carry/run-carry'
import { lane_state_event, type LanePosition } from './lane-state-event'
import {
	lane_state_record,
	type LaneRun,
	type LaneState,
	type LaneStateRecord,
	type PauseOrigin,
	type StuckProcess,
} from './lane-state-record'
import { lane_transition_table, type LaneTransitionEvent } from './lane-transition-table'

// One record per lane of where it is in its life — opened, running, paused, ended — written only by
// the lane commands and human-review stops, so a reader asks the record rather than guessing from
// the `.env` mtime, the event stream or the `ps` state.
//
// **It is a `durable_state` path keyed on the common git directory**, in
// `<common git dir>/josh/run-state` beside the carry record and the event stream and outside every
// work tree, so it is the same file from the main checkout and from inside the lane, it outlives
// `lane:close`'s removal of the lane, and a reboot does not clear it.
//
// **The write is `stamp_file.replace_stamp`'s** — a temporary file beside the target, renamed over it —
// so two commands writing the same lane at once leave one whole record, never a torn one. **The read,
// the transition check and that write are one step under a per-record lock**, as the event stream's
// append is: unlocked, a pause that read `running` could rename its `paused` over a merge's `ended`.
//
// **Every write is an event of the lifecycle table** (`lane-state-event.ts`): a change the table does
// not let through (an `ended` lane is not paused; a dependency wait's release does not resume a
// person's pause) is not written, and comes back `rejected`, warned about, to the command — which
// decides whether it carries on, as it does when the record cannot be written at all (`skipped`).

// **The record's shape, name and read are `lane-state-record.ts`'s**, which the vitest config reads too.
const LOCK_SUFFIX = '.lock'
// A change holds the lock for one read and one rename; a wait this long means a holder is stuck.
const LOCK_WAIT_MS = 5000
const { LANE_STATES, STATE_SUFFIX } = lane_state_record
// What a lane with no record is answered with: its state is unknown, so it keeps its place.
const NO_STATE_HINT = 'no lane state — counted in use'

// Each lane's record, by issue; a lane with none is left out (`read_states`).
type LaneRecords = ReadonlyMap<string, LaneStateRecord>

// The states each one moves to, derived from the lifecycle's events (`lane-transition-table.ts`). A
// lane with no record yet (opened before the record existed) moves to any of them.
const TRANSITIONS = lane_transition_table.allowed_transitions()

// One command's change: the state it leaves the lane in, and whether it launched a child — a launch
// stamps the launch time and its run; a resume transfers ownership to the current run.
interface LaneChange {
	issue: string
	state: LaneState
	command: string
	is_launch?: boolean
}

interface StateOptions {
	directory?: string | undefined
	now?: Date
}

// `rejected`: the lifecycle table refused the change (`lane-state-event.ts`); `skipped`: it could not
// be written at all. The caller decides whether it can carry on without the change.
type RecordOutcome =
	| { kind: 'written'; record: LaneStateRecord }
	| { kind: 'skipped'; reason: string }
	| { kind: 'rejected'; reason: string }

function state_path(directory: string, issue: string): string {
	return path.join(
		durable_state.ensure(durable_state.root()),
		lane_state_record.record_name(directory, issue),
	)
}

function is_allowed(from: LaneState | undefined, to: LaneState): boolean {
	return from === undefined || TRANSITIONS[from].includes(to)
}

function read_record(directory: string, issue: string): LaneStateRecord | undefined {
	return lane_state_record.read_record_file(state_path(directory, issue))
}

function write_record(directory: string, record: LaneStateRecord): void {
	stamp_file.replace_stamp(state_path(directory, record.issue), record)
}

// The run a launch belongs to: the carry's start and owner, read from the same common git directory.
function current_run(directory: string): LaneRun | undefined {
	const carried = run_carry.read_carry(run_carry.carry_path(directory))

	if (carried.kind !== 'carried') return undefined

	return { started_at: carried.carry.started_at, owner_pid: carried.carry.owner_pid }
}

function launch_fields(change: LaneChange, directory: string, now: Date): Partial<LaneStateRecord> {
	if (change.is_launch !== true) return {}

	// A relaunch makes the lane wholly this run's own, so a hand-over it was adopted through ends here.
	return { run: current_run(directory), launched_at: now.toISOString(), adopted_at: undefined }
}

function resume_fields(change: LaneChange, directory: string): Partial<LaneStateRecord> {
	if (change.command !== 'lane:resume') return {}
	const run = current_run(directory)

	return run === undefined ? {} : { run }
}

interface NextRecordInput {
	change: LaneChange
	previous: LaneStateRecord | undefined
	verdict: { event: LaneTransitionEvent; paused_by: PauseOrigin | undefined }
}

function next_record(input: NextRecordInput, directory: string, now: Date): LaneStateRecord {
	const { change, previous } = input

	return {
		// An open starts a fresh life: a reopened lane keeps nothing of the run that launched it before.
		...(change.state !== 'open' && previous),
		issue: change.issue,
		state: change.state,
		changed_at: now.toISOString(),
		changed_by: change.command,
		paused_by: input.verdict.paused_by,
		...launch_fields(change, directory, now),
		...resume_fields(change, directory),
	}
}

function position_of(previous: LaneStateRecord | undefined): LanePosition | undefined {
	if (previous === undefined) return undefined

	return { state: previous.state, paused_by: lane_state_record.pause_origin(previous) }
}

const NO_RECORD_OR_RUN: RecordOutcome = { kind: 'skipped', reason: 'no record or run' }

// A hand-over: the record as it is — its state, who paused it, its last change — owned by the
// current run.
function handed_over(
	input: NextRecordInput,
	directory: string,
	now: Date,
): LaneStateRecord | undefined {
	const { previous } = input
	const run = current_run(directory)

	if (run === undefined || previous === undefined) return undefined

	return { ...previous, run, adopted_at: now.toISOString() }
}

function record_for(
	input: NextRecordInput,
	directory: string,
	now: Date,
): LaneStateRecord | undefined {
	const { is_owner_only } = lane_transition_table.row_of(input.verdict.event)

	return is_owner_only === true
		? handed_over(input, directory, now)
		: next_record(input, directory, now)
}

interface Held {
	directory: string
	now: Date
}

function apply_to(
	change: LaneChange,
	previous: LaneStateRecord | undefined,
	held: Held,
): RecordOutcome {
	const verdict = lane_state_event.judge(change, position_of(previous))

	if (verdict.kind === 'rejected') return verdict

	const record = record_for({ change, previous, verdict }, held.directory, held.now)

	if (record === undefined) return NO_RECORD_OR_RUN

	write_record(held.directory, record)

	return { kind: 'written', record }
}

function apply_held(change: LaneChange, directory: string, now: Date): RecordOutcome {
	return apply_to(change, read_record(directory, change.issue), { directory, now })
}

const NO_DIRECTORY: RecordOutcome = { kind: 'skipped', reason: 'no git directory' }

// The read, the check and the write of one record, under its lock.
function locked(directory: string, issue: string, held: () => RecordOutcome): RecordOutcome {
	const lock = `${state_path(directory, issue)}${LOCK_SUFFIX}`
	const outcome = repository_lock.with_lock_sync(held, lock, LOCK_WAIT_MS)

	return outcome ?? { kind: 'skipped', reason: `gave up waiting for the lock at ${lock}` }
}

function apply(change: LaneChange, directory: string, now: Date): RecordOutcome {
	return locked(directory, change.issue, () => apply_held(change, directory, now))
}

function warn(change: LaneChange, reason: string): void {
	console.warn(
		`${change.command} ${session_cite.issue(change.issue)}: lane state not recorded — ${reason}`,
	)
}

async function resolve_directory(directory: string | undefined): Promise<string | undefined> {
	return directory ?? (await run_carry.repository_directory())
}

async function outcome_of(change: LaneChange, options: StateOptions): Promise<RecordOutcome> {
	const directory = await resolve_directory(options.directory)

	if (directory === undefined) return NO_DIRECTORY

	return apply(change, directory, options.now ?? new Date())
}

// A write that threw is a write skipped for that reason, never an error out of the lane command.
async function settled(write: () => Promise<RecordOutcome>): Promise<RecordOutcome> {
	try {
		return await write()
	} catch (error: unknown) {
		return { kind: 'skipped', reason: error instanceof Error ? error.message : String(error) }
	}
}

async function record_change(
	change: LaneChange,
	options: StateOptions = {},
): Promise<RecordOutcome> {
	const outcome = await settled(async () => await outcome_of(change, options))

	if (outcome.kind !== 'written') warn(change, outcome.reason)

	return outcome
}

async function read_state(issue: string, directory?: string): Promise<LaneStateRecord | undefined> {
	const root = await resolve_directory(directory)

	return root === undefined ? undefined : read_record(root, issue)
}

// The issue each record of `directory` is for, read off the file names `state_path` writes.
function recorded_issues(directory: string): Array<string> {
	const empty = state_path(directory, '')
	const head = path.basename(empty).slice(0, -STATE_SUFFIX.length)

	return readdirSync(path.dirname(empty))
		.filter((name) => name.startsWith(head) && name.endsWith(STATE_SUFFIX))
		.map((name) => name.slice(head.length, -STATE_SUFFIX.length))
		.filter((issue) => issue.length > 0)
}

/** Every lane's record, a closed lane's included — the record outlives the work tree. */
async function read_records(directory?: string): Promise<Array<LaneStateRecord>> {
	const root = await resolve_directory(directory)

	if (root === undefined) return []

	const records = recorded_issues(root).map((issue) => read_record(root, issue))

	return records.filter((record) => record !== undefined)
}

function stuck_held(issue: string, stuck: Array<StuckProcess>, directory: string): RecordOutcome {
	const previous = read_record(directory, issue)

	if (previous === undefined) return { kind: 'skipped', reason: 'no record' }

	const record = { ...previous, stuck }

	write_record(directory, record)

	return { kind: 'written', record }
}

/**
 * Note on the lane's record the processes its close could not end, leaving its state as it is: a lane
 * a close has not finished is not `ended`. A lane with no record is not given one.
 */
async function record_stuck(
	issue: string,
	stuck: Array<StuckProcess>,
	directory?: string,
): Promise<RecordOutcome> {
	const root = await resolve_directory(directory)

	if (root === undefined) return NO_DIRECTORY

	return locked(root, issue, () => stuck_held(issue, stuck, root))
}

// `adopt`: a lane with no record is given an `open` one (`lane:adopt`); `hand-over`: a lane whose owner
// run ended becomes the current run's, its state and pause kept (`backlog-drive-carried.ts`).
type OwnerMove = 'adopt' | 'hand-over'

function owner_change(issue: string, move: OwnerMove, previous?: LaneStateRecord): LaneChange {
	if (move === 'adopt') return { issue, state: 'open', command: lane_state_record.ADOPT_COMMAND }

	return { issue, state: previous?.state ?? 'open', command: lane_state_event.HAND_OVER_COMMAND }
}

function owner_held(issue: string, move: OwnerMove, held: Held): RecordOutcome {
	const previous = read_record(held.directory, issue)

	return apply_to(owner_change(issue, move, previous), previous, held)
}

/**
 * Move the lane to a new owner by the table's adopt or hand-over event. An adopt never overwrites a
 * record that appeared since the caller read none; a hand-over keeps the state and who paused it
 * (joshuafolkken/kit#8455, joshuafolkken/kit#8472). The caller has judged the owner run ended.
 */
async function record_owner(
	issue: string,
	move: OwnerMove,
	options: StateOptions = {},
): Promise<RecordOutcome> {
	return await settled(async () => {
		const directory = await resolve_directory(options.directory)

		if (directory === undefined) return NO_DIRECTORY

		const held = { directory, now: options.now ?? new Date() }

		return locked(directory, issue, () => owner_held(issue, move, held))
	})
}

/** Each of `issues`' records, by issue; an issue with none is left out. */
async function read_states(
	issues: ReadonlyArray<string>,
	directory?: string,
): Promise<LaneRecords> {
	const root = await resolve_directory(directory)

	if (root === undefined) return new Map()

	const read = issues.map((issue): [string, LaneStateRecord | undefined] => [
		issue,
		read_record(root, issue),
	])

	return new Map(read.filter((entry): entry is [string, LaneStateRecord] => entry[1] !== undefined))
}

/** `paused since 01:28 by lane:pause` — the one wording every reader names a paused lane in. */
function paused_text(since_ms: number, changed_by: string): string {
	return `paused since ${figure_format.minute_of(since_ms)} by ${changed_by}`
}

/** `paused_text` for a paused record, naming the command of who paused it; `undefined` for any other. */
function paused_note(record: LaneStateRecord | undefined): string | undefined {
	const origin = lane_state_record.pause_origin(record)

	if (record === undefined || origin === undefined) return undefined

	return paused_text(Date.parse(record.changed_at), lane_state_record.PAUSE_ORIGIN_COMMANDS[origin])
}

const lane_state = {
	LANE_STATES,
	NO_STATE_HINT,
	is_allowed,
	paused_note,
	paused_text,
	read_records,
	read_state,
	read_states,
	record_change,
	record_owner,
	record_stuck,
	recorded_issues,
	state_path,
}

export { lane_state }
export type { LaneChange, LaneRecords, OwnerMove, RecordOutcome }

export { type LaneState, type LaneStateRecord, type StuckProcess } from './lane-state-record'
