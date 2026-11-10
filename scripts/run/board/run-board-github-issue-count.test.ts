import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_github, type Gather } from './run-board-github'
import type { IssueCount } from './run-board-issue-count'
import type { BoardPlan } from './run-board-layout'
import type { Snapshot } from './run-board-snapshot'
import { run_board_state, type Pace } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#7088: the repository's issue count is read on the board's GitHub reads, once the
// plan names the repository and as often as the plan — never on a redraw — and kept in the snapshot.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { PLAN_RETRY_MS, gather_github } = run_board_github
const { FRESH_STATE } = run_board_state
const REPO = 'joshuafolkken/kit'
const COUNT: IssueCount = { open: 87, closed: 6912 }

type ReadCount = (repo: string) => Promise<IssueCount | undefined>

// A read that never answers.
async function never(): Promise<undefined> {
	return await new Promise(() => undefined)
}

function count_gather(read_issue_count: ReadCount, pace: Pace, now_ms = START): Gather {
	const plans: Array<BoardPlan | undefined> = [plan_titled('a'), plan_titled('a'), plan_titled('a')]
	const { ports } = harness(LOCAL, plans)

	return { ports: { ...ports, read_issue_count }, local: LOCAL, now_ms, pace }
}

describe('run_board_github.gather_github issue count', () => {
	it('reads the count for the repository the plan names and folds it in', async () => {
		const read = vi.fn<ReadCount>().mockResolvedValue(COUNT)
		const state = await gather_github(FRESH_STATE, count_gather(read, 'settled'))

		expect(read).toHaveBeenCalledWith(REPO)
		expect(state.issue_count).toStrictEqual(COUNT)
		expect(state.issue_count_fetch).toBeUndefined()
	})

	it('asks nothing before a plan names the repository', async () => {
		const read = vi.fn<ReadCount>().mockResolvedValue(COUNT)
		const gather = count_gather(read, 'settled')
		const state = await gather_github(FRESH_STATE, {
			...gather,
			ports: { ...gather.ports, read_plan: async () => await undefined },
		})

		expect(read).not.toHaveBeenCalled()
		expect(state.issue_count).toBeUndefined()
	})

	it('launches the read and returns without it in the background', async () => {
		const planned = { ...FRESH_STATE, plan: plan_titled('a') }
		const state = await gather_github(planned, count_gather(never, 'background'))

		expect(state.issue_count).toBeUndefined()
		expect(state.issue_count_fetch?.answer()).toBeUndefined()
		expect(state.issue_count_attempted_ms).toBe(START)
	})
})

describe('run_board_github.gather_github issue count throttle', () => {
	it('reads again only after the plan interval, clearing the count when that read fails', async () => {
		const read = vi
			.fn<ReadCount>()
			.mockResolvedValueOnce(COUNT)
			.mockRejectedValueOnce(new Error('offline'))
		const first = await gather_github(FRESH_STATE, count_gather(read, 'settled'))
		const early = START + PLAN_RETRY_MS - 1
		const second = await gather_github(first, count_gather(read, 'settled', early))
		const third = await gather_github(second, count_gather(read, 'settled', early + 1))

		expect(second.issue_count).toStrictEqual(COUNT)
		expect(third.issue_count).toBeUndefined()
		expect(read).toHaveBeenCalledTimes(2)
	})
})

describe('run_board_github.gather_github issue count hold', () => {
	it('launches no second read while one is still in flight, however long it has taken', async () => {
		const planned = { ...FRESH_STATE, plan: plan_titled('a') }
		const pending = await gather_github(planned, count_gather(never, 'background'))
		const read = vi.fn<ReadCount>().mockResolvedValue(COUNT)
		const late = START + PLAN_RETRY_MS * 2

		await gather_github(pending, count_gather(read, 'background', late))

		expect(read).not.toHaveBeenCalled()
	})

	it('holds the count it has once the run has ended', async () => {
		const read = vi.fn<ReadCount>().mockResolvedValue(COUNT)
		const first = await gather_github(FRESH_STATE, count_gather(read, 'settled'))
		const later = count_gather(read, 'settled', START + PLAN_RETRY_MS * 2)

		await gather_github(first, { ...later, local: { ...later.local, ended_ms: START + 1 } })

		expect(read).toHaveBeenCalledTimes(1)
	})
})

describe('run_board_github.gather_github issue count snapshot', () => {
	it('keeps the count in the snapshot', async () => {
		const saved: Array<Snapshot> = []
		const gather = count_gather(async () => await COUNT, 'settled')
		const snapshot = {
			load: () => undefined,
			save: (kept: Snapshot): void => {
				saved.push(kept)
			},
		}

		await gather_github(FRESH_STATE, { ...gather, ports: { ...gather.ports, snapshot } })

		expect(saved.at(-1)?.issue_count).toStrictEqual(COUNT)
	})
})

describe('run_board_tick.tick issue count', () => {
	it('starts from the count the last board on this run kept', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const kept: Snapshot = {
			run_started_ms: START,
			titles: new Map(),
			labels: new Map(),
			closed: new Map(),
			issue_count: COUNT,
		}
		const snapshot = { load: (): Snapshot => kept, save: vi.fn() }
		const board_ports = { ...ports, read_issue_count: never, snapshot }

		const state = await run_board_tick.tick(FRESH_STATE, board_ports, 'background')

		expect(state.issue_count).toStrictEqual(COUNT)
	})

	it('draws the count it read on the first line of the frame', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await run_board_tick.tick(FRESH_STATE, { ...ports, read_issue_count: async () => await COUNT })

		expect(frames.at(-1)?.split('\n', 1)[0]).toContain('📮 87/6,912')
	})
})
