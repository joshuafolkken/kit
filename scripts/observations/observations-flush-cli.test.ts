import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observations_flush } from './observations-flush'
import { main } from './observations-flush-cli'

vi.mock('./observations-flush', () => ({ observations_flush: { flush: vi.fn() } }))

const MERGED = 'merged `observations/2026-09-23-000000`'
const REFUSAL = 'this checkout is on `feature`. Run `pnpm josh ms` first.'

const mocked_flush = vi.mocked(observations_flush.flush)

const chdir = vi.spyOn(process, 'chdir')

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
	chdir.mockImplementation(() => undefined)
	mocked_flush.mockResolvedValue(MERGED)
})

// joshuafolkken/kit#2919: the ledger lives in the work tree the command runs in, so the flush never
// moves to another checkout — a lane's lines merge with the lane's own pull request.
describe('observations:flush — where it acts', () => {
	it('flushes in the checkout it runs in, without moving', async () => {
		await main()

		expect(chdir).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(MERGED)
	})

	it('prints a refusal as the message and exits non-zero', async () => {
		mocked_flush.mockRejectedValue(new Error(REFUSAL))

		await main()

		expect(console.error).toHaveBeenCalledWith(REFUSAL)
		expect(process.exit).toHaveBeenCalledWith(1)
	})
})
