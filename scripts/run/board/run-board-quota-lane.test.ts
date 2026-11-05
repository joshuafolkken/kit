import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_quota_lane } from './run-board-quota-lane'

describe('run_board_quota_lane.codex_lane', () => {
	afterEach(() => vi.unstubAllEnvs())

	it('uses the configured lane root for a rollout below a custom directory', () => {
		vi.stubEnv('JOSH_LANE_ROOT', '/work/custom-lanes')
		const head = JSON.stringify({
			type: 'session_meta',
			payload: { cwd: '/work/custom-lanes/6375/scripts' },
		})

		expect(run_board_quota_lane.codex_lane(head)).toBe('6375')
		expect(run_board_quota_lane.codex_lane(head, '/other/lanes')).toBeUndefined()
	})
})
