import { lane_process_table } from '#scripts/lane/lane-process-table'
import { describe, expect, it, vi } from 'vitest'
import { run_board_usage_read, type UsagePorts } from './run-board-usage-read'

// joshuafolkken/kit#4198: the paused lanes ride on the board's one `ps` listing a sample — its `stat`
// column read beside the rest — so a lane `lane:pause` stopped reads paused, and reads running again
// once `lane:resume` let it go, with no `ps` of its own.

const { sample } = run_board_usage_read
const ROOT = '/Users/me/Development/.kit-lanes'
const LANE = '4198'
const PAUSED = '1 0 0:01 4 T node\n2 1 0:01 4 T+ sh\n3 0 0:01 4 S other'
const RESUMED = '1 0 0:01 4 S node\n2 1 0:01 4 R+ sh\n3 0 0:01 4 S other'
const FIRST_SEEN = 1000
const STEP = 1000

function ports_of(listings: Array<string>): UsagePorts {
	const clock = { now: FIRST_SEEN - STEP }

	return {
		list: vi.fn(async () => lane_process_table.parse(listings.shift() ?? '')),
		rusage: undefined,
		top: vi.fn(async () => new Map()),
		directories: vi.fn(
			async () =>
				new Map([
					[1, `${ROOT}/${LANE}`],
					[2, `${ROOT}/${LANE}/src`],
				]),
		),
		now: () => (clock.now += STEP),
		root: ROOT,
	}
}

describe('run_board_usage_read.sample — paused lanes', () => {
	it('reads a lane paused while all its processes are stopped, and running once resumed', async () => {
		const ports = ports_of([PAUSED, PAUSED, RESUMED])
		const first = await sample(undefined, ports)
		const second = await sample(first, ports)
		const third = await sample(second, ports)

		expect(first.paused).toStrictEqual(new Map([[LANE, FIRST_SEEN]]))
		expect(second.paused).toStrictEqual(new Map([[LANE, FIRST_SEEN]]))
		expect(third.paused).toStrictEqual(new Map())
		expect(ports.list).toHaveBeenCalledTimes(3)
	})
})
