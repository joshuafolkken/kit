import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { process_lane_marks } from './process-lane-marks'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const FAILURE = 1

afterEach(() => {
	vi.restoreAllMocks()
})

it('reports a ps command failure as unreadable ownership instead of no marked processes', () => {
	vi.mocked(spawnSync).mockReturnValue({
		pid: 0,
		output: [],
		stdout: '',
		stderr: 'permission denied',
		status: FAILURE,
		// eslint-disable-next-line unicorn/no-null -- Node represents a normal exit with a null signal.
		signal: null,
	})
	expect(process_lane_marks.list_all('darwin')).toBeUndefined()
})
