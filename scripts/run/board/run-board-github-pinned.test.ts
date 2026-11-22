import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_github, type Gather } from './run-board-github'
import type { BoardPlan } from './run-board-layout'
import type { PinnedIssue } from './run-board-pinned-graphql'
import { run_board_state, type BoardData } from './run-board-state'

// joshuafolkken/kit#8606: the repository's pinned issues are read on the board's GitHub reads, as
// often as the plan; a failed read keeps the pins last read and the next interval asks again.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { PLAN_RETRY_MS, gather_github } = run_board_github
const { FRESH_STATE } = run_board_state
const REPO = 'joshuafolkken/kit'
const PINS: ReadonlyArray<PinnedIssue> = [{ number: 5, is_closed: false, closed_ms: undefined }]
const NEWER: ReadonlyArray<PinnedIssue> = [{ number: 5, is_closed: true, closed_ms: START }]

type ReadPinned = (repo: string) => Promise<ReadonlyArray<PinnedIssue> | undefined>

function pinned_gather(read_pinned: ReadPinned, now_ms = START): Gather {
	const plans: Array<BoardPlan | undefined> = [plan_titled('a'), plan_titled('a'), plan_titled('a')]
	const { ports } = harness(LOCAL, plans)

	return { ports: { ...ports, read_pinned }, local: LOCAL, now_ms, pace: 'settled' }
}

// A read that lands on a later timer turn, after the reads that answer at once.
async function later_pins(): Promise<ReadonlyArray<PinnedIssue>> {
	return await new Promise((resolve) => {
		setTimeout(resolve, 0, PINS)
	})
}

async function first_read(read: ReadPinned): Promise<BoardData> {
	return await gather_github(FRESH_STATE, pinned_gather(read))
}

describe('run_board_github.gather_github pinned issues', () => {
	it('reads the pins of the repository the plan names and folds them in', async () => {
		const read = vi.fn<ReadPinned>().mockResolvedValue(PINS)
		const state = await first_read(read)

		expect(read).toHaveBeenCalledWith(REPO)
		expect(state.pinned).toStrictEqual(PINS)
		expect(state.pinned_fetch).toBeUndefined()
	})

	it('keeps an empty list when nothing is pinned', async () => {
		const state = await first_read(vi.fn<ReadPinned>().mockResolvedValue([]))

		expect(state.pinned).toStrictEqual([])
	})

	it('asks nothing again before the interval has passed', async () => {
		const read = vi.fn<ReadPinned>().mockResolvedValue(PINS)
		const state = await first_read(read)

		await gather_github(state, pinned_gather(read, START + PLAN_RETRY_MS - 1))

		expect(read).toHaveBeenCalledTimes(1)
	})
})

describe('run_board_github.gather_github pinned issues asked again', () => {
	it('waits at the settled pace for a read that lands after the others', async () => {
		const state = await first_read(later_pins)

		expect(state.pinned).toStrictEqual(PINS)
	})

	it('launches no second read while one is still in flight', async () => {
		const read = vi.fn<ReadPinned>(async () => await new Promise(() => undefined))
		const planned = { ...FRESH_STATE, plan: plan_titled('a') }
		const background = { ...pinned_gather(read), pace: 'background' as const }
		const launched = await gather_github(planned, background)

		await gather_github(launched, { ...background, now_ms: START + PLAN_RETRY_MS })

		expect(launched.pinned_fetch).toBeDefined()
		expect(read).toHaveBeenCalledTimes(1)
	})

	it('keeps the last pins on a failed read and asks again at the next interval', async () => {
		const read = vi.fn<ReadPinned>().mockResolvedValueOnce(PINS).mockResolvedValueOnce(undefined)
		const first = await first_read(read)
		const failed = await gather_github(first, pinned_gather(read, START + PLAN_RETRY_MS))

		expect(failed.pinned).toStrictEqual(PINS)

		read.mockResolvedValueOnce(NEWER)
		const retried = await gather_github(failed, pinned_gather(read, START + 2 * PLAN_RETRY_MS))

		expect(read).toHaveBeenCalledTimes(3)
		expect(retried.pinned).toStrictEqual(NEWER)
	})
})
