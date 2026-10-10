import { lane_registry } from '#scripts/lane/lane-registry'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_usage_read } from './run-board-usage-read'

// joshuafolkken/kit#3590: the board's `ps` and `lsof` carried no timeout, so one that never answered
// froze the usage column's reader instead of leaving the column blank for that sample.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

const ROOT = '/Users/me/Development/.kit-lanes'
const PARENT_AND_CHILD = '1 7 0:01 4\n2 1 0:01 4'

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(ROOT)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('run_board_usage_read.usage_reader against a probe that never answers', () => {
	it('reads nothing once the ps budget is spent', async () => {
		const pending = run_board_usage_read.usage_reader('darwin')(undefined)

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toBeUndefined()
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS])
	})

	// A mark that read the listed processes as being in no lane would keep them there for as long as
	// they live — a lane is asked for once per process — so the sample fails and the next one asks again.
	it('reads nothing once the lsof budget is spent', async () => {
		hanging_execa.answer_with('ps', PARENT_AND_CHILD)

		const pending = run_board_usage_read.usage_reader('darwin')(undefined)

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toBeUndefined()
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS])
	})
})
