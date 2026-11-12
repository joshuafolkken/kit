import { statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentEventState } from '#scripts/agent/agent-event'
import { lane_registry } from '#scripts/lane/lane-registry'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { run_liveness } from '#scripts/run/run-liveness'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

// joshuafolkken/kit#6577: the board's lane states carry each running lane's transcript, so a working
// child with a stopped label is not drawn stopped.

const { ENDED_AT, arrange, arrange_states, lane } = run_board_read_fixture
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const ISSUE = '3432'
const DIRECTORY = temporary_directory('suite')('board-read-result-')
const STATE: AgentEventState = {
	provider: 'anthropic',
	launch: 'pending',
	progress: undefined,
	result: 'running',
	reason: undefined,
	usage: undefined,
}
const RECORD: LaneStateRecord = {
	issue: ISSUE,
	run: { started_at: STARTED_AT },
	state: 'running',
	launched_at: STARTED_AT,
	changed_at: STARTED_AT,
	changed_by: 'lane:dispatch',
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_read.read_local lane transcripts', () => {
	it('carries a running lane’s transcript result and last write onto its lane state', async () => {
		const output = path.join(DIRECTORY, 'unit.output')

		writeFileSync(output, '{}\n')
		arrange(
			{ kind: 'none' },
			{ invocation: 'backlogrun', started_at: STARTED_AT, ended_at: ENDED_AT },
		)
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([{ ...lane(ISSUE), output }])
		arrange_states([RECORD])
		vi.spyOn(run_liveness, 'read_agent_state').mockReturnValue(STATE)

		const { lane_states } = (await run_board_read.read_local()) ?? {}

		expect(lane_states?.own.get(Number(ISSUE))).toMatchObject({
			result: 'running',
			written_ms: statSync(output).mtimeMs,
		})
	})
})
