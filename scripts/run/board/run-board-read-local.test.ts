import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_found } from './run-board-found'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_single } from './run-board-single'
import { run_board_span_read } from './run-board-span-read'

// joshuafolkken/kit#7931: `read_local` takes the reads that need none of each other's results
// together — the lanes beside the span, then the roots, the run's events and the lane room — and
// reads what the reads taken one after another read.

const { ENDED_AT, arrange } = run_board_read_fixture
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const LANES_FAILED = 'git failed'

afterEach(() => vi.restoreAllMocks())

function arrange_run(): void {
	arrange(
		{ kind: 'none' },
		{ invocation: 'backlogrun', started_at: STARTED_AT, ended_at: ENDED_AT },
	)
}

// Holds `read`'s spied module function until the returned release, then calls the real one.
function held<T extends object, K extends keyof T>(module: T, read: K): () => void {
	const gate: { open?: () => void } = {}
	const opened = new Promise<void>((resolve) => {
		gate.open = resolve
	})
	const real = module[read]

	if (typeof real !== 'function') throw new TypeError(`${String(read)} is not a function`)

	vi.spyOn(module, read as never).mockImplementation((async (...args: Array<unknown>) => {
		await opened

		return await Reflect.apply(real, module, args)
	}) as never)

	return () => gate.open?.()
}

describe('run_board_read.read_local, side by side', () => {
	it('reads the lanes before the span has answered', async () => {
		arrange_run()
		const release = held(run_board_span_read, 'span_here')
		const read = run_board_read.read_local()

		await vi.waitFor(() => expect(lane_registry.list_lanes).toHaveBeenCalledOnce())
		release()
		await expect(read).resolves.toBeDefined()
	})

	it('reads the run events and the lane room before the roots have answered', async () => {
		arrange_run()
		const live_in = vi.spyOn(run_board_found, 'live_in')
		const lane_room = vi.spyOn(backlog_ready, 'lane_room')
		const release = held(run_board_single, 'ended_here')
		const read = run_board_read.read_local()

		await vi.waitFor(() => {
			expect(live_in).toHaveBeenCalledOnce()
			expect(lane_room).toHaveBeenCalledOnce()
		})
		release()
		await expect(read).resolves.toBeDefined()
	})

	it('reads what a read with no read held reads', async () => {
		arrange_run()
		const free = await run_board_read.read_local()
		const release = held(run_board_single, 'ended_here')
		const read = run_board_read.read_local()

		release()
		expect(await read).toEqual(free)
	})
})

describe('run_board_read.read_local, a failed lane read', () => {
	it('is no failure of a read with no run', async () => {
		arrange_run()
		vi.mocked(run_carry.repository_directory).mockResolvedValue(undefined)
		vi.mocked(lane_registry.list_lanes).mockRejectedValue(new Error(LANES_FAILED))

		await expect(run_board_read.read_local()).resolves.toBeUndefined()
	})

	it('fails a read with a run', async () => {
		arrange_run()
		vi.mocked(lane_registry.list_lanes).mockRejectedValue(new Error(LANES_FAILED))

		await expect(run_board_read.read_local()).rejects.toThrow(LANES_FAILED)
	})
})
