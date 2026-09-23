import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observation_ledger_home } from './observation-ledger-home'
import { observations_flush } from './observations-flush'
import { main } from './observations-flush-cli'

vi.mock('./observation-ledger-home', () => ({
	observation_ledger_home: { is_lane: vi.fn(), ledger_root: vi.fn() },
}))
vi.mock('./observations-flush', () => ({ observations_flush: { flush: vi.fn() } }))

const PRIMARY = '/work/kit'
const MERGED = 'merged `observations/2026-09-23-000000`'
const REFUSAL = 'this checkout is on `feature`. Run `pnpm josh ms` first.'

const mocked_is_lane = vi.mocked(observation_ledger_home.is_lane)
const mocked_flush = vi.mocked(observations_flush.flush)

const chdir = vi.spyOn(process, 'chdir')

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
	chdir.mockImplementation(() => undefined)
	vi.mocked(observation_ledger_home.ledger_root).mockReturnValue(PRIMARY)
	mocked_flush.mockResolvedValue(MERGED)
})

describe('observations:flush — in the primary checkout', () => {
	it('flushes where it runs', async () => {
		mocked_is_lane.mockReturnValue(false)

		await main()

		expect(chdir).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(MERGED)
	})
})

// joshuafolkken/kit#2419: from a lane the flush was refused off the default branch, and the refusal's
// `pnpm josh ms` is itself refused in a lane — so the recovery could not be completed there.
describe('observations:flush — from a lane', () => {
	beforeEach(() => {
		mocked_is_lane.mockReturnValue(true)
	})

	it('moves to the primary checkout before flushing', async () => {
		await main()

		expect(chdir).toHaveBeenCalledWith(PRIMARY)
		expect(chdir.mock.invocationCallOrder[0]).toBeLessThan(
			mocked_flush.mock.invocationCallOrder[0] ?? 0,
		)
		expect(vi.mocked(console.info).mock.calls[0]?.[0]).toContain(PRIMARY)
	})

	it('names the primary checkout in a refusal', async () => {
		mocked_flush.mockRejectedValue(new Error(REFUSAL))

		await main()

		const message: unknown = vi.mocked(console.error).mock.calls[0]?.[0]

		expect(String(message)).toContain(PRIMARY)
		expect(String(message)).toContain(REFUSAL)
		expect(process.exit).toHaveBeenCalledWith(1)
	})
})
