import os from 'node:os'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream } from '#scripts/run/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch } from './lane-dispatch'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'

// joshuafolkken/kit#2464: the stall detector ages the last dispatch from the stream's `child-launch`, and
// nothing wrote one — so minutes after a launch every stall read "hours since the last dispatch". This
// pins that a started child is recorded, and that a launch which started nothing is not.

const ISSUE = '2464'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-lane`)
const LOG_PATH = path.join(os.tmpdir(), `josh-lane-dispatch-${ISSUE}.log`)
const PID = 2464

const launch = vi.spyOn(detached_launch, 'launch')
const emit = vi.spyOn(run_event_stream_emit, 'emit')

const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: LANE_DIRECTORY,
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

beforeEach(() => {
	vi.clearAllMocks()
	for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
	vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'session')
	vi.stubEnv('CODEX_THREAD_ID', '')
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(LANE)
	vi.spyOn(lane_output, 'record_output').mockResolvedValue({
		kind: 'recorded',
		lane: { ...LANE, output: LOG_PATH },
		output: LOG_PATH,
	})
	vi.spyOn(git_gh_command, 'issue_add_label').mockResolvedValue(true)
	vi.spyOn(git_gh_command, 'issue_remove_label').mockResolvedValue(undefined)
	emit.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('lane_dispatch.dispatch_child — the launch record the stall detector ages from', () => {
	it('records a child-launch naming the issue once the child has started', async () => {
		launch.mockReturnValue({ kind: 'launched', pid: PID })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('dispatched')
		expect(emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.CHILD_LAUNCH,
			`#${ISSUE} dispatched`,
		)
	})

	it('records nothing when the launch started no child', async () => {
		launch.mockReturnValue({ kind: 'failed', note: 'spawn claude ENOENT' })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('failed')
		expect(emit).not.toHaveBeenCalled()
	})
})
