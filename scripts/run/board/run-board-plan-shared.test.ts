import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardPlan } from './run-board-layout'
import { run_board_plan_shared } from './run-board-plan-shared'

// joshuafolkken/kit#4558: the board read its plan from GitHub on every redraw, apart from the
// `backlog:next` answer the drive's assignment and the arrival probe share.

const REPO = 'joshuafolkken/kit'
const NAMED: NamedPlan = { issues: [], only: false }
const AT = '2026-10-23T00:00:00.000Z'
const MINUTE_MS = 60_000
const AUTO_OK = 'auto-ok'

const PLAN: BoardPlan = {
	waves: {
		waves: [
			[{ number: 2, repo: REPO, state: 'OPEN', labels: [AUTO_OK], blocked_by: [], body: 'b' }],
		],
		unreached: [
			{ number: 3, repo: REPO, state: 'OPEN', labels: [], blocked_by: [{ repo: REPO, number: 2 }] },
		],
		running: [],
	},
	tracked: new Map([[2, 1]]),
	context: { repo: REPO, titles: new Map([[2, 'Two']]), open_numbers: new Set([2, 3]) },
	labels: new Map([[2, [AUTO_OK]]]),
	declared: new Map([[2, new Set(['scripts/a.ts'])]]),
	withheld: new Set([3]),
}

function event(pos: number): RunEvent {
	return { pos, kind: 'launch', text: `launched ${String(pos)}`, at: AT }
}

const read_plan = vi.fn<(named: NamedPlan) => Promise<BoardPlan | undefined>>()

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue('/stream/target')
	vi.spyOn(run_event_stream, 'read_last').mockReturnValue(event(1))
	read_plan.mockReset().mockResolvedValue(PLAN)

	return shared_cache_fixture.isolate_shared_cache(run_board_plan_shared.PLAN_CACHE)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('run_board_plan_shared.read keeping a plan', () => {
	// `toEqual` compares a map's and a set's contents, so the kept plan is the plan rebuilt.
	it('answers a second redraw within the minute without reading GitHub again', async () => {
		await run_board_plan_shared.read(NAMED, read_plan)

		expect(await run_board_plan_shared.read(NAMED, read_plan)).toEqual(PLAN)
		expect(read_plan).toHaveBeenCalledOnce()
	})

	it('keeps a plan read from a cut-short listing, its open issues unknown', async () => {
		const bare: BoardPlan = { ...PLAN, context: { ...PLAN.context, open_numbers: undefined } }

		read_plan.mockResolvedValue(bare)
		await run_board_plan_shared.read(NAMED, read_plan)

		expect(await run_board_plan_shared.read(NAMED, read_plan)).toEqual(bare)
		expect(read_plan).toHaveBeenCalledOnce()
	})
})

describe('run_board_plan_shared.read reading GitHub again', () => {
	it('reads again once a new event lands on the stream', async () => {
		await run_board_plan_shared.read(NAMED, read_plan)
		vi.mocked(run_event_stream.read_last).mockReturnValue(event(2))
		await run_board_plan_shared.read(NAMED, read_plan)

		expect(read_plan).toHaveBeenCalledTimes(2)
	})

	it('reads again for another scope', async () => {
		await run_board_plan_shared.read(NAMED, read_plan)
		await run_board_plan_shared.read({ issues: [4558], only: true }, read_plan)

		expect(read_plan).toHaveBeenCalledTimes(2)
	})

	it('reads again once the minute has passed', async () => {
		vi.useFakeTimers({ now: Date.parse(AT) })
		await run_board_plan_shared.read(NAMED, read_plan)
		vi.setSystemTime(Date.parse(AT) + MINUTE_MS)
		await run_board_plan_shared.read(NAMED, read_plan)

		expect(read_plan).toHaveBeenCalledTimes(2)
	})

	it('keeps no failed read', async () => {
		read_plan.mockResolvedValueOnce(undefined)
		await run_board_plan_shared.read(NAMED, read_plan)
		await run_board_plan_shared.read(NAMED, read_plan)

		expect(read_plan).toHaveBeenCalledTimes(2)
	})
})
