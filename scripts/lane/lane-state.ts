import { readdirSync } from 'node:fs'
import path from 'node:path'
import { repository_lock } from '#scripts/git/repository-lock'
import { session_cite } from '#scripts/issue/session-cite'
import { durable_state } from '#scripts/josh/durable-state'
import { stamp_file } from '#scripts/josh/stamp-file'
import { figure_format } from '#scripts/lib/figure-format'
import { json_value } from '#scripts/lib/json-value'
import { run_carry } from '#scripts/run/carry/run-carry'
import { z } from 'zod'

// One record per lane of where it is in its life — opened, running, paused, ended — written only by
// the lane commands (joshuafolkken/kit#4268), so a reader asks the record rather than guessing from
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
// **A transition the lifecycle does not have is not written** (an `ended` lane is not paused); it is
// warned about and the command carries on, as it does when the record cannot be written at all — the
// record never fails the command that keeps it.

const STATE_PREFIX = durable_state.PREFIX.LANE_STATE
const STATE_SUFFIX = '.json'
const LOCK_SUFFIX = '.lock'
// A change holds the lock for one read and one rename; a wait this long means a holder is stuck.
const LOCK_WAIT_MS = 5000
const LANE_STATES = ['open', 'running', 'paused', 'ended'] as const
// What a lane with no record is answered with: its state is unknown, so it keeps its place.
const NO_STATE_HINT = 'no lane state — counted in use'

type LaneState = (typeof LANE_STATES)[number]

const lane_run_schema = z.object({ started_at: z.string(), owner_pid: z.number().optional() })

// A process the last `lane:close` could not end even with a SIGKILL, and why (`lane-reap-settle.ts`).
const stuck_schema = z.object({ pid: z.number(), reason: z.string() })

const lane_state_schema = z.object({
	issue: z.string(),
	run: lane_run_schema.optional(),
	state: z.enum(LANE_STATES),
	launched_at: z.string().optional(),
	changed_at: z.string(),
	changed_by: z.string(),
	stuck: z.array(stuck_schema).optional(),
})

type LaneRun = z.infer<typeof lane_run_schema>
type LaneStateRecord = z.infer<typeof lane_state_schema>
type StuckProcess = z.infer<typeof stuck_schema>
// Each lane's record, by issue; a lane with none is left out (`read_states`).
type LaneRecords = ReadonlyMap<string, LaneStateRecord>

// The states each one moves to. A lane with no record yet (opened before the record existed) moves to
// any of them.
const TRANSITIONS: Record<LaneState, ReadonlyArray<LaneState>> = {
	open: ['open', 'running', 'ended'],
	running: ['running', 'paused', 'ended'],
	paused: ['paused', 'running', 'ended'],
	ended: ['ended', 'open'],
}

// One command's change: the state it leaves the lane in, and whether it launched a child — a launch
// stamps the launch time and the run that launched it, which every other change keeps.
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

type RecordOutcome =
	{ kind: 'written'; record: LaneStateRecord } | { kind: 'skipped'; reason: string }

function state_path(directory: string, issue: string): string {
	return durable_state.path(STATE_PREFIX, directory, `-${issue}${STATE_SUFFIX}`)
}

function is_allowed(from: LaneState | undefined, to: LaneState): boolean {
	return from === undefined || TRANSITIONS[from].includes(to)
}

function read_record(directory: string, issue: string): LaneStateRecord | undefined {
	const raw = stamp_file.read_stamp_text(state_path(directory, issue))

	return raw === undefined ? undefined : json_value.parse_with(raw, lane_state_schema)
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

	return { run: current_run(directory), launched_at: now.toISOString() }
}

function next_record(
	change: LaneChange,
	previous: LaneStateRecord | undefined,
	directory: string,
	now: Date,
): LaneStateRecord {
	return {
		// An open starts a fresh life: a reopened lane keeps nothing of the run that launched it before.
		...(change.state !== 'open' && previous),
		issue: change.issue,
		state: change.state,
		changed_at: now.toISOString(),
		changed_by: change.command,
		...launch_fields(change, directory, now),
	}
}

function apply_held(change: LaneChange, directory: string, now: Date): RecordOutcome {
	const previous = read_record(directory, change.issue)

	if (!is_allowed(previous?.state, change.state)) {
		return { kind: 'skipped', reason: `no ${previous?.state ?? ''} → ${change.state} transition` }
	}

	const record = next_record(change, previous, directory, now)

	write_record(directory, record)

	return { kind: 'written', record }
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

	if (outcome.kind === 'skipped') warn(change, outcome.reason)

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

function adopted_held(change: LaneChange, directory: string, now: Date): RecordOutcome {
	if (read_record(directory, change.issue) !== undefined) {
		return { kind: 'skipped', reason: 'a record exists' }
	}

	return apply_held(change, directory, now)
}

/**
 * Write `change` for a lane that has no record, and only then: a record that appeared since the caller
 * read none is the lane command's, and is never overwritten (`lane:adopt`).
 */
async function adopted_outcome(change: LaneChange, options: StateOptions): Promise<RecordOutcome> {
	const directory = await resolve_directory(options.directory)

	if (directory === undefined) return NO_DIRECTORY

	const now = options.now ?? new Date()

	return locked(directory, change.issue, () => adopted_held(change, directory, now))
}

async function record_adopted(
	change: LaneChange,
	options: StateOptions = {},
): Promise<RecordOutcome> {
	return await settled(async () => await adopted_outcome(change, options))
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

/** `paused_text` for a paused record, `undefined` for any other. */
function paused_note(record: LaneStateRecord | undefined): string | undefined {
	if (record?.state !== 'paused') return undefined

	return paused_text(Date.parse(record.changed_at), record.changed_by)
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
	record_adopted,
	record_change,
	record_stuck,
	state_path,
}

export { lane_state }
export type { LaneChange, LaneRecords, LaneState, LaneStateRecord, RecordOutcome, StuckProcess }
