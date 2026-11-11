import { describe, expect, it, vi } from 'vitest'
import { run_board_profile } from './run-board-profile'

vi.mock(import('./run-board-profile'), () => ({
	run_board_profile: { format: vi.fn(), measure: vi.fn(), measure_all: vi.fn() },
}))

describe('run-board-profile-main', () => {
	it('measures nothing when it is imported rather than run', async () => {
		await import('./run-board-profile-main')

		expect(run_board_profile.measure_all).not.toHaveBeenCalled()
	})
})
