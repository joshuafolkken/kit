import path from 'node:path'
import { durable_state_root } from '#scripts/josh/durable-state-root'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// **A lane-state record's shape, its file name and its synchronous read, with no import that asks git
// or takes a lock** — what `lane-state.ts` writes, read here by the vitest config at load to leave idle
// lanes out of the worker share (`unit-run-marker.ts`, joshuafolkken/kit#6916).

const STATE_SUFFIX = '.json'
const PAUSE_COMMAND = 'lane:pause'
const DEPENDENCY_WAIT_COMMAND = 'lane:dependency-wait'
// Who paused a lane, each with the command that pauses it so: a person (`lane:pause`), or a dependency
// wait the launch found. A dependency wait's release resumes only its own pause, never a person's.
const BY_PERSON = 'person' as const
const BY_DEPENDENCY_WAIT = 'dependency-wait' as const
const PAUSE_ORIGIN_COMMANDS = {
	[BY_PERSON]: PAUSE_COMMAND,
	[BY_DEPENDENCY_WAIT]: DEPENDENCY_WAIT_COMMAND,
} as const
const PAUSE_ORIGINS = [BY_PERSON, BY_DEPENDENCY_WAIT] as const
// The `changed_by` of a lane no child was ever started in — `lane:dispatch` moves it on (`run-preflight.ts`).
const OPEN_COMMAND = 'lane:open'
// `as const` so the literal type survives export on `lane_state_record` (a bare const widens there).
const HUMAN_REVIEW = 'human-review' as const
const LANE_STATES = ['open', 'running', 'paused', HUMAN_REVIEW, 'ended'] as const

type LaneState = (typeof LANE_STATES)[number]

// The states a lane opens no suite in: it waits on a person or is over.
const IDLE_STATES: ReadonlySet<LaneState> = new Set<LaneState>(['paused', HUMAN_REVIEW, 'ended'])

const lane_run_schema = z.object({ started_at: z.string(), owner_pid: z.number().optional() })

// A process the last `lane:close` could not end even with a SIGKILL, and why (`lane-reap-settle.ts`).
const stuck_schema = z.object({ pid: z.number(), reason: z.string() })

const lane_state_schema = z.object({
	issue: z.string(),
	run: lane_run_schema.optional(),
	state: z.enum(LANE_STATES),
	launched_at: z.string().optional(),
	// When a later run took the lane over from the run that launched it, its `run` now names the
	// adopting run; this keeps the hand-over on record (the 🎯 estimate leaves such a lane out).
	adopted_at: z.string().optional(),
	changed_at: z.string(),
	changed_by: z.string(),
	// Set while the lane is `paused`; a record written before it existed is read off `changed_by`.
	paused_by: z.enum(PAUSE_ORIGINS).optional(),
	stuck: z.array(stuck_schema).optional(),
})

type LaneRun = z.infer<typeof lane_run_schema>
type LaneStateRecord = z.infer<typeof lane_state_schema>
type StuckProcess = z.infer<typeof stuck_schema>
type PauseOrigin = (typeof PAUSE_ORIGINS)[number]

/** Who paused a `paused` lane — its `paused_by`, or an older record's `changed_by` — else `undefined`. */
function pause_origin(record: LaneStateRecord | undefined): PauseOrigin | undefined {
	if (record?.state !== 'paused') return undefined
	if (record.paused_by !== undefined) return record.paused_by

	return record.changed_by === DEPENDENCY_WAIT_COMMAND ? BY_DEPENDENCY_WAIT : BY_PERSON
}

// The record's file name, keyed on the common git directory as `durable_state.path` keys it.
function record_name(common: string, issue: string): string {
	return stamp_file.stamp_name(
		durable_state_root.PREFIX.LANE_STATE,
		common,
		`-${issue}${STATE_SUFFIX}`,
	)
}

// The record at `source`, or nothing when it is missing, unreadable or not a record.
function read_record_file(source: string): LaneStateRecord | undefined {
	const raw = stamp_file.read_stamp_text(source)

	return raw === undefined ? undefined : json_value.parse_with(raw, lane_state_schema)
}

// **Only a record that says so makes a lane idle**: no record, or one that cannot be read, keeps it
// counted — the upper bound the lanes root alone gave.
function is_idle(state_root: string, common: string, issue: string): boolean {
	const record = read_record_file(path.join(state_root, record_name(common, issue)))

	return record !== undefined && IDLE_STATES.has(record.state)
}

const lane_state_record = {
	DEPENDENCY_WAIT_COMMAND,
	HUMAN_REVIEW,
	LANE_STATES,
	OPEN_COMMAND,
	PAUSE_COMMAND,
	PAUSE_ORIGIN_COMMANDS,
	STATE_SUFFIX,
	is_idle,
	pause_origin,
	read_record_file,
	record_name,
}

export { lane_state_record }
export type { LaneRun, LaneState, LaneStateRecord, PauseOrigin, StuckProcess }
