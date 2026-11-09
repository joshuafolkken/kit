import path from 'node:path'
import { durable_state_root } from '#scripts/josh/durable-state-root'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// **A lane-state record's shape, its file name and its synchronous read, with no import that asks git
// or takes a lock** — what `lane-state.ts` writes, read here by the vitest config at load to leave idle
// lanes out of the worker share (`unit-run-marker.ts`, joshuafolkken/kit#6916).

const STATE_SUFFIX = '.json'
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
	changed_at: z.string(),
	changed_by: z.string(),
	stuck: z.array(stuck_schema).optional(),
})

type LaneRun = z.infer<typeof lane_run_schema>
type LaneStateRecord = z.infer<typeof lane_state_schema>
type StuckProcess = z.infer<typeof stuck_schema>

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
	HUMAN_REVIEW,
	LANE_STATES,
	STATE_SUFFIX,
	is_idle,
	read_record_file,
	record_name,
}

export { lane_state_record }
export type { LaneRun, LaneState, LaneStateRecord, StuckProcess }
