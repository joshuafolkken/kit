import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, expect, it, vi } from 'vitest'
import { lane_dispatch } from './lane-dispatch'
import { lane_dispatch_dependency } from './lane-dispatch-dependency'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seat_start } from './lane-seat-start'

const ISSUE = '5444'
const SEAT = 2
const WAIT_KIND = 'dependency-wait'
const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: '/lanes/5444',
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

afterEach(() => {
	vi.restoreAllMocks()
})

function prepare(): void {
	vi.spyOn(lane_dispatch_dependency, 'check').mockResolvedValue(undefined)
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(LANE)
	vi.spyOn(lane_output, 'record_output').mockResolvedValue({
		kind: 'recorded',
		lane: LANE,
		output: 'log',
	})
	vi.spyOn(git_gh_command, 'issue_apply_label').mockResolvedValue({ is_applied: true })
	vi.spyOn(git_gh_command, 'issue_clear_label').mockResolvedValue(true)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(undefined)
	vi.spyOn(detached_launch, 'launch').mockReturnValue({ kind: 'launched', pid: 1 })
	vi.spyOn(lane_seat_start, 'start').mockImplementation(
		async (lane, action) => await action({ ...lane, seat: SEAT }),
	)
	vi.spyOn(lane_seat_start, 'environment').mockImplementation((lane) => ({
		JOSH_LANE_SEAT: String(lane.seat),
	}))
}

it('uses the common acquired seat and launch environment for a normal dispatch', async () => {
	prepare()
	const begin = vi.spyOn(lane_dispatch_dependency, 'begin').mockResolvedValue(undefined)

	await lane_dispatch.dispatch_child(ISSUE)
	const request = vi.mocked(detached_launch.launch).mock.calls[0]?.[0]

	expect(request?.env).toMatchObject({ JOSH_LANE_SEAT: String(SEAT) })
	expect(lane_seat_start.start).toHaveBeenCalledWith(LANE, expect.any(Function))
	expect(begin).toHaveBeenCalledExactlyOnceWith(ISSUE)
	expect(begin).toHaveBeenCalledBefore(vi.mocked(detached_launch.launch))
})

it('does not claim a label or spawn when the fresh dependency check refuses', async () => {
	prepare()
	vi.mocked(lane_dispatch_dependency.check).mockResolvedValue({
		kind: WAIT_KIND,
		reason: 'unfinished blocker',
	})

	const outcome = await lane_dispatch.dispatch_child(ISSUE)

	expect(outcome).toMatchObject({ kind: WAIT_KIND })
	expect(lane_dispatch.is_worth_warning(outcome)).toBe(false)
	expect(git_gh_command.issue_apply_label).not.toHaveBeenCalled()
	expect(detached_launch.launch).not.toHaveBeenCalled()
})
