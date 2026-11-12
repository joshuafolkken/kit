import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_ship_pre_detach } from './run-ship-pre-detach'
import { run_ship_pre_detach_pinned } from './run-ship-pre-detach-pinned'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'
import { run_ship_reship } from './run-ship-reship'
import type { ShipArguments } from './run-ship-steps'

// joshuafolkken/kit#6141: a re-ship after a review failure still runs a `--review` ship's
// `test:pinned` before the hand-off, and nothing else.

const ISSUE = '6141'
const RED = 1
const PINNED_RED = { code: RED, out: 'unpinned' }

function ship_arguments(is_review: boolean): ShipArguments {
	return {
		title: `Re-ship #${ISSUE}`,
		number: ISSUE,
		notify: [],
		body: [],
		body_path: undefined,
		cites: [],
		is_review,
		is_detach: true,
		unpinned_ok: [],
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_reship.checks', () => {
	it('keeps a --review ship’s test:pinned, timed as the full checks are', async () => {
		const timed = vi.spyOn(run_ship_pre_detach_timed, 'checks').mockResolvedValue(PINNED_RED)

		expect(await run_ship_reship.checks(ship_arguments(true))).toBe(PINNED_RED)
		expect(timed).toHaveBeenCalledWith(ISSUE, expect.any(Function))
	})

	it('runs test:pinned alone inside the timing, without the fast checks', async () => {
		const pinned = vi
			.spyOn(run_ship_pre_detach_pinned, 'pinned_check')
			.mockResolvedValue(PINNED_RED)
		const fast = vi.spyOn(run_ship_pre_detach, 'checks')

		vi.spyOn(run_ship_pre_detach_timed, 'checks').mockImplementation(async (_issue, run) => {
			return await (run ?? run_ship_pre_detach.checks)()
		})
		const result = await run_ship_reship.checks(ship_arguments(true))

		expect(result.code).toBe(RED)
		expect(pinned).toHaveBeenCalledOnce()
		expect(fast).not.toHaveBeenCalled()
	})

	it('runs nothing for any other ship', async () => {
		const timed = vi.spyOn(run_ship_pre_detach_timed, 'checks')

		expect(await run_ship_reship.checks(ship_arguments(false))).toStrictEqual({
			code: 0,
			out: run_ship_reship.SKIP_NOTE,
		})
		expect(timed).not.toHaveBeenCalled()
	})
})
