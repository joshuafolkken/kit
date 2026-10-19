import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_reap } from '#scripts/lane/lane-reap'
import { lane_registry } from '#scripts/lane/lane-registry'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#tools/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_usage_read } from './run-board-usage-read'
import { run_board_usage_top } from './run-board-usage-top'

// joshuafolkken/kit#3590: the board's `ps` and `lsof` carried no timeout, so one that never answered
// froze the usage column's reader instead of leaving the column blank for that sample.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#tools/test/hanging-execa')

	return { execa: stand_in.spawn }
})

const KB = 1024
const ROOT = '/Users/me/Development/.kit-lanes'
const PARENT_AND_CHILD = '1 7 0:01 4 S node\n2 1 0:01 4 S eslint'
const { TOP_TIMEOUT_MS } = run_board_usage_top

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(ROOT)
})

describe('run_board_usage_read.usage_reader against a top that never answers', () => {
	// joshuafolkken/kit#4171: `top` is the slow reader; a hung one costs the first sample its own
	// budget and leaves memory on the resident set, never the board's reader.
	it('reads the sample on ps’s figures once the top budget is spent', async () => {
		hanging_execa.answer_with(lane_reap.PS_COMMAND, PARENT_AND_CHILD)
		hanging_execa.answer_with('lsof', '')

		const pending = run_board_usage_read.usage_reader('darwin')(
			undefined,
			lane_process_table.read_table,
		)

		await vi.advanceTimersByTimeAsync(TOP_TIMEOUT_MS)

		const mark = await pending

		expect(mark?.processes.get(1)?.memory_bytes).toBe(4 * KB)
		expect(hanging_execa.timeouts()).toContain(TOP_TIMEOUT_MS)
	})
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('run_board_usage_read.usage_reader against a probe that never answers', () => {
	beforeEach(() => {
		hanging_execa.answer_with('top', '')
	})

	it('reads nothing once the ps budget is spent', async () => {
		const pending = run_board_usage_read.usage_reader('darwin')(
			undefined,
			lane_process_table.read_table,
		)

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toBeUndefined()
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS, TOP_TIMEOUT_MS])
	})

	// A mark that read the listed processes as being in no lane would keep them there for as long as
	// they live — a lane is asked for once per process — so the sample fails and the next one asks again.
	it('reads nothing once the lsof budget is spent', async () => {
		hanging_execa.answer_with(lane_reap.PS_COMMAND, PARENT_AND_CHILD)

		const pending = run_board_usage_read.usage_reader('darwin')(
			undefined,
			lane_process_table.read_table,
		)

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toBeUndefined()
		expect(hanging_execa.timeouts()).toStrictEqual([
			PROBE_TIMEOUT_MS,
			TOP_TIMEOUT_MS,
			PROBE_TIMEOUT_MS,
		])
	})
})
