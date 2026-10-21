import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4304: `lane:close` says on standard error how many processes still running from
// the lane checkout it ended, and says so when it could not read them rather than reporting none.

vi.mock('./lane-close', () => ({
	lane_close: { close_all_lanes: vi.fn(), close_lane: vi.fn(), prune_lanes: vi.fn() },
}))

const { lane_close } = await import('./lane-close')
const { lane_cli } = await import('./lane-cli')

const ISSUE = '1490'
const SUCCESS = 0

function closes_with(residents: Array<number> | undefined): void {
	vi.mocked(lane_close.close_lane).mockResolvedValue({
		issue: ISSUE,
		kind: 'closed',
		left_behind: [],
		reaped: [],
		residents,
	})
}

const printed: Array<string> = []

beforeEach(() => {
	printed.length = 0
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		printed.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('lane:close reporting what still ran from the checkout', () => {
	it('counts the processes the close ended', async () => {
		closes_with([66_330, 79_739])

		expect(await lane_cli.run(['close', ISSUE])).toBe(SUCCESS)
		expect(printed).toStrictEqual([ISSUE])
		expect(console.error).toHaveBeenCalledExactlyOnceWith(
			expect.stringMatching(
				/^Terminated 2 process\(es\) still running from the lane for .*#1490.*: 66330, 79739\.$/u,
			),
		)
	})

	it('says nothing more when none was running', async () => {
		closes_with([])

		expect(await lane_cli.run(['close', ISSUE])).toBe(SUCCESS)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('says so when the processes could not be read, rather than reporting none', async () => {
		closes_with(undefined)

		expect(await lane_cli.run(['close', ISSUE])).toBe(SUCCESS)
		expect(console.error).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining('(lsof or ps failed); none of them was ended.'),
		)
	})
})
