import { repository_lock } from '#scripts/git/repository-lock'
import { session_cite } from '#scripts/issue/session-cite'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { run_carry } from '#scripts/run/carry/run-carry'
import { z } from 'zod'

// One record per lane of where it is in its life — opened, running, paused, ended — written only by
// the lane commands (joshuafolkken/kit#4268), so a reader asks the record rather than guessing from
// the `.env` mtime, the event stream or the `ps` state.
//
// **It is a `stamp_path` keyed on the common git directory**, beside the carry record and the event
// stream and outside every work tree, so it is the same file from the main checkout and from inside
// the lane, it outlives `lane:close`'s removal of the lane, and `JOSH_TEMP_ROOT` moves it with every
// other record the run keeps.
//
// **The write is `stamp_file.replace_stamp`'s** — a temporary file beside the target, renamed over it —
// so two commands writing the same lane at once leave one whole record, never a torn one. **The read,
// the transition check and that write are one step under a per-record lock**, as the event stream's
// append is: unlocked, a pause that read `running` could rename its `paused` over a merge's `ended`.
//
// **A transition the lifecycle does not have is not written** (an `ended` lane is not paused); it is
// warned about and the command carries on, as it does when the record cannot be written at all — the
// record never fails the command that keeps it.

const STATE_PREFIX = 'josh-lane-state-'
const STATE_SUFFIX = '.json'
const LOCK_SUFFIX = '.lock'
// A change holds the lock for one read and one rename; a wait this long means a holder is stuck.
const LOCK_WAIT_MS = 5000
const LANE_STATES = ['open', 'running', 'paused', 'ended'] as const

type LaneState = (typeof LANE_STATES)[number]

const lane_run_schema = z.object({ started_at: z.string(), owner_pid: z.number().optional() })

const lane_state_schema = z.object({
	issue: z.string(),
	run: lane_run_schema.optional(),
	state: z.enum(LANE_STATES),
	launched_at: z.string().optional(),
	changed_at: z.string(),
	changed_by: z.string(),
})

type LaneRun = z.infer<typeof lane_run_schema>
type LaneStateRecord = z.infer<typeof lane_state_schema>

// The states each one moves to. A lane with no record yet (opened before the record existed) moves to
// any of them.
const TRANSITIONS: Record<LaneState, ReadonlyArray<LaneState>> = {
	open: ['open', 'running', 'ended'],
	running: ['running', 'paused', 'ended'],
	paused: ['paused', 'running', 'ended'],
	ended: ['ended', 'open'],
}

// One command's change: the state it leaves the lane in, and whether it launched a child — a launch
// stamps the launch time and the run that launched it, which every other change keeps. `launched_at`
// is a launch time known without a launch: the backfill's, read off the lane's `.env`.
interface LaneChange {
	issue: string
	state: LaneState
	command: string
	is_launch?: boolean
	launched_at?: Date | undefined
}

interface StateOptions {
	directory?: string | undefined
	now?: Date
}

type RecordOutcome =
	{ kind: 'written'; record: LaneStateRecord } | { kind: 'skipped'; reason: string }

function state_path(directory: string, issue: string): string {
	return stamp_file.stamp_path(STATE_PREFIX, directory, `-${issue}${STATE_SUFFIX}`)
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
	if (change.is_launch === true) {
		return { run: current_run(directory), launched_at: now.toISOString() }
	}

	return change.launched_at === undefined ? {} : { launched_at: change.launched_at.toISOString() }
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

function apply(change: LaneChange, directory: string, now: Date): RecordOutcome {
	const lock = `${state_path(directory, change.issue)}${LOCK_SUFFIX}`
	const outcome = repository_lock.with_lock_sync(
		() => apply_held(change, directory, now),
		lock,
		LOCK_WAIT_MS,
	)

	return outcome ?? { kind: 'skipped', reason: `gave up waiting for the lock at ${lock}` }
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

	if (directory === undefined) return { kind: 'skipped', reason: 'no git directory' }

	return apply(change, directory, options.now ?? new Date())
}

async function settled_outcome(change: LaneChange, options: StateOptions): Promise<RecordOutcome> {
	try {
		return await outcome_of(change, options)
	} catch (error: unknown) {
		return { kind: 'skipped', reason: error instanceof Error ? error.message : String(error) }
	}
}

async function record_change(
	change: LaneChange,
	options: StateOptions = {},
): Promise<RecordOutcome> {
	const outcome = await settled_outcome(change, options)

	if (outcome.kind === 'skipped') warn(change, outcome.reason)

	return outcome
}

async function read_state(issue: string, directory?: string): Promise<LaneStateRecord | undefined> {
	const root = await resolve_directory(directory)

	return root === undefined ? undefined : read_record(root, issue)
}

const lane_state = { LANE_STATES, is_allowed, read_state, record_change, state_path }

export { lane_state }
export type { LaneChange, LaneState, LaneStateRecord, RecordOutcome }
