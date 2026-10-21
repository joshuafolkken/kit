import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_state } from '#scripts/lane/lane-state'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended, type EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_wake } from '#scripts/run/wake/run-wake'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { vi } from 'vitest'

const REPOSITORY = '/repo/.git'
const MAIN_ROOT = '/repo'
const ENDED_AT = '2026-10-08T10:00:00.000Z'
const INSIDE: RunEvent = {
	pos: 1,
	at: '2026-10-08T09:30:00.000Z',
	kind: 'merge',
	text: '#1 merged',
}
const AFTER: RunEvent = { pos: 2, at: '2026-10-08T10:30:00.000Z', kind: 'merge', text: '#2 merged' }
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: ENDED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
// Three lanes allowed and one open: two more may open.
const LANE_LIMIT = 3

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

// The run's records, each keyed on the repository and read off the machine: never a real one from a test.
function arrange_records(read: CarryRead, ended: EndedRun | undefined): void {
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	vi.spyOn(run_carry_ended, 'read_ended').mockReturnValue(ended)
	vi.spyOn(backlogrun_launch, 'pending_launch').mockReturnValue(undefined)
	vi.spyOn(run_wake, 'read_wake').mockReturnValue(undefined)
	vi.spyOn(lane_state, 'read_state').mockResolvedValue(undefined)
	vi.spyOn(lane_state, 'read_records').mockResolvedValue([])
}

function arrange(read: CarryRead, ended: EndedRun | undefined): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
	arrange_records(read, ended)
	vi.spyOn(run_event_stream, 'read_events').mockReturnValue([INSIDE, AFTER])
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane('3432')])
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(MAIN_ROOT)
	// The limit is read off the environment and a live run's override: never a real one from a test.
	vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: LANE_LIMIT })
	// Every log is read off the machine: never a real one from a test.
	vi.spyOn(time_density_hook, 'read_tail').mockReturnValue('')
	// Each lane's child is probed with `pgrep`: never a real process from a test.
	vi.spyOn(lane_spent, 'idle_lanes').mockReturnValue([])
	// Each lane's branch and tree are read with git: never a real lane from a test.
	vi.spyOn(lane_vacant, 'vacant_issues').mockResolvedValue([])
}

const run_board_read_fixture = {
	AFTER,
	CARRY,
	ENDED_AT,
	INSIDE,
	LANE_LIMIT,
	MAIN_ROOT,
	REPOSITORY,
	arrange,
	lane,
}

export { run_board_read_fixture }
