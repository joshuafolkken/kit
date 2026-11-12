import { statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentEventState } from '#scripts/agent/agent-event'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { run_liveness } from '#scripts/run/run-liveness'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_lane_result } from './run-board-lane-result'

// joshuafolkken/kit#6577: the board reads each open lane's transcript every second, so it parses one
// again only once it changed, and reads when it was last written.

const ISSUE = '6577'
const RUNNING = 'running'
const STATE: AgentEventState = {
	provider: 'anthropic',
	launch: 'pending',
	progress: undefined,
	result: RUNNING,
	reason: undefined,
	usage: undefined,
}
const DIRECTORY = temporary_directory('suite')('lane-result-')

function lane_of(output: string | undefined): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory: DIRECTORY,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output,
		is_stranded: false,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_lane_result.results_of', () => {
	it('reads a transcript’s result and last write, parsing it once while it is unchanged', () => {
		const output = path.join(DIRECTORY, 'unit.output')

		writeFileSync(output, '{}\n')

		const read = vi.spyOn(run_liveness, 'read_agent_state').mockReturnValue(STATE)
		const expected = { result: RUNNING, written_ms: statSync(output).mtimeMs }

		expect(run_board_lane_result.results_of([lane_of(output)]).get(ISSUE)).toStrictEqual(expected)
		expect(run_board_lane_result.results_of([lane_of(output)]).get(ISSUE)).toStrictEqual(expected)
		expect(read).toHaveBeenCalledTimes(1)
	})

	it.each([
		['an absent transcript', 'absent.output'],
		['a lane that recorded none', undefined],
	])('leaves %s out', (_, name) => {
		const output = name === undefined ? undefined : path.join(DIRECTORY, name)

		expect(run_board_lane_result.results_of([lane_of(output)]).has(ISSUE)).toBe(false)
	})
})
