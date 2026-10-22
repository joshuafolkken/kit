import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture, type Harness } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import type { Snapshot, SnapshotStore } from './run-board-snapshot'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4484: a board opened again drew every row `…` until its first GitHub read landed,
// and read each closed child again. It now draws the last board's snapshot of this run at once.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { STATE_ICONS } = run_board_labels
const RUNNING = 4466
const CLOSED = 4479
const LAUNCHED_AT = '2026-10-08T08:00:00.000Z'
const CLOSED_MS = Date.parse('2026-10-08T08:45:48.000Z')
// Another run's start, an hour before this one.
const EARLIER_START = START - 3_600_000
const SAVED_RUNNING = 'Saved running title'
const SAVED_CLOSED = 'Saved closed title'
const READ_RUNNING = 'Read running title'
// An issue the snapshot named that the open listing no longer holds.
const GONE = 4400
const GONE_TITLE = 'Left the listing'

function launch(issue: number, pos: number): RunEvent {
	return { pos, at: LAUNCHED_AT, kind: 'child-launch', text: `#${String(issue)} launched` }
}

const LOCAL_RUN = { ...LOCAL, events: [launch(RUNNING, 1), launch(CLOSED, 2)] }

// A listing read whole, holding the running child alone.
const PLAN: BoardPlan = {
	waves: { waves: [], unreached: [] },
	tracked: new Map(),
	context: {
		repo: 'joshuafolkken/kit',
		titles: new Map([[RUNNING, READ_RUNNING]]),
		open_numbers: new Set([RUNNING]),
	},
	labels: new Map([[RUNNING, ['enhancement']]]),
}

const SAVED: Snapshot = {
	run_started_ms: START,
	titles: new Map([[RUNNING, SAVED_RUNNING]]),
	labels: new Map([[RUNNING, ['enhancement']]]),
	closed: new Map([
		[
			CLOSED,
			{
				title: SAVED_CLOSED,
				labels: [],
				closed_ms: CLOSED_MS,
				is_merged: true,
				is_not_planned: false,
			},
		],
	]),
}

interface Store extends SnapshotStore {
	save: ReturnType<typeof vi.fn<(snapshot: Snapshot) => void>>
}

function store_of(snapshot: Snapshot | undefined): Store {
	return { load: () => snapshot, save: vi.fn<(snapshot: Snapshot) => void>() }
}

function board(): Harness {
	return harness(LOCAL_RUN, [PLAN])
}

// Every child a closed read asked about.
function asked(read_closed: Harness['read_closed']): Array<number> {
	return read_closed.mock.calls.flatMap(([issues]) => issues)
}

function row_of(frame: string | undefined, issue: number): string | undefined {
	return frame?.split('\n').find((line) => line.includes(String(issue)))
}

describe('run_board_tick.tick — a snapshot before the reads land', () => {
	it('draws the saved titles on the first frame', async () => {
		const { ports, frames } = board()

		await tick(FRESH_STATE, { ...ports, snapshot: store_of(SAVED) }, 'background')

		expect(row_of(frames.at(-1), RUNNING)).toContain(SAVED_RUNNING)
		expect(row_of(frames.at(-1), CLOSED)).toContain(SAVED_CLOSED)
	})

	it('draws a child the snapshot read closed as it closed on the first frame', async () => {
		const { ports, frames } = board()

		await tick(FRESH_STATE, { ...ports, snapshot: store_of(SAVED) }, 'background')

		expect(row_of(frames.at(-1), CLOSED)).toContain(STATE_ICONS.merged)
	})

	it('discards a snapshot written on another run', async () => {
		const { ports, frames } = board()
		const store = store_of({ ...SAVED, run_started_ms: EARLIER_START })

		await tick(FRESH_STATE, { ...ports, snapshot: store }, 'background')

		expect(frames.at(-1)).not.toContain(SAVED_RUNNING)
		expect(frames.at(-1)).not.toContain(SAVED_CLOSED)
	})

	it('saves nothing while no read has landed', async () => {
		const { ports } = board()
		const store = store_of(SAVED)

		await tick(FRESH_STATE, { ...ports, snapshot: store }, 'background')

		expect(store.save).not.toHaveBeenCalled()
	})
})

describe('run_board_tick.tick — a snapshot under the reads', () => {
	it('does not read a closed child the snapshot answered again', async () => {
		const { ports, read_closed } = board()

		await tick(FRESH_STATE, { ...ports, snapshot: store_of(SAVED) })

		expect(asked(read_closed)).not.toContain(CLOSED)
	})

	it('still reads the plan, draws its title over the saved one and saves it', async () => {
		const { ports, frames } = board()
		const store = store_of(SAVED)

		await tick(FRESH_STATE, { ...ports, snapshot: store })

		expect(row_of(frames.at(-1), RUNNING)).toContain(READ_RUNNING)
		expect(store.save).toHaveBeenCalledWith(
			expect.objectContaining({
				run_started_ms: START,
				titles: new Map([[RUNNING, READ_RUNNING]]),
				closed: SAVED.closed,
			}),
		)
	})

	it('keeps a saved title the plan no longer lists', async () => {
		const { ports } = board()
		const store = store_of({ ...SAVED, titles: new Map([[GONE, GONE_TITLE]]) })

		await tick(FRESH_STATE, { ...ports, snapshot: store })

		expect(store.save.mock.calls.at(-1)?.[0].titles.get(GONE)).toBe(GONE_TITLE)
	})

	it('starts from nothing where no snapshot was kept', async () => {
		const { ports, frames, read_closed } = board()

		await tick(FRESH_STATE, { ...ports, snapshot: store_of(undefined) })

		expect(row_of(frames.at(-1), RUNNING)).toContain(READ_RUNNING)
		expect(asked(read_closed)).toContain(CLOSED)
	})
})
