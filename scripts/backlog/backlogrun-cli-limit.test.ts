import { describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#6166: the launcher keeps the limit the run starts under on its carry record, so a
// later `lane:limit --reset` restores it rather than the shell's `.env`.

vi.mock('#scripts/lane/lane-limit-history', () => ({
	lane_limit_history: {
		record_current: vi.fn(async () => undefined),
		record_launch: vi.fn(async () => undefined),
	},
}))

const { lane_limit_history } = await import('#scripts/lane/lane-limit-history')
const { backlogrun_cli } = await import('./backlogrun-cli')

describe('backlogrun_cli.LIVE_PORTS.record_limit', () => {
	it('records the start limit, not the limit a shell reads now', async () => {
		await backlogrun_cli.LIVE_PORTS.record_limit()

		expect(lane_limit_history.record_launch).toHaveBeenCalledOnce()
		expect(lane_limit_history.record_current).not.toHaveBeenCalled()
	})
})
