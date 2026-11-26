import { symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherState } from './run-board-gather'
import { run_board_gather_thread } from './run-board-gather-thread'
import type { MachineGauges } from './run-board-machine'
import type { Quotas } from './run-board-quota-read'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_saved_state, type Saved, type SavedStore } from './run-board-saved-state'
import type { BoardGather } from './run-board-state'

// joshuafolkken/kit#8219: the last round a live board's worker handed over is kept, so the next board
// on the same run draws it the moment its screen opens.

const { FIRST_ROUND, LOCAL, START } = run_board_fixture
const { FRESH_GATHER, read_of } = run_board_gather
const { SAVE_EVERY_MS, file_store, for_run, saver } = run_board_saved_state

const READ: GatherState = { ...FRESH_GATHER, local: LOCAL, read_ms: START }
const POST = run_board_gather_thread.post_of(
	FIRST_ROUND.board,
	READ,
	{ ...FIRST_ROUND.data, ...read_of(READ), run_started_ms: START, attempted_ms: START },
	START,
).post
const GATHER: BoardGather = { ...POST.read, data: POST.data, display: POST.display }
const RUN_STARTED_MS = START
const SAVED: Saved = { run_started_ms: RUN_STARTED_MS, saved_ms: START, gather: GATHER }

const GAUGES: MachineGauges = {
	cpu_percent: 40,
	memory_percent: 50,
	swap_mb_per_s: 0,
	memory_pressure: 1,
}
const FRESH_GAUGES: MachineGauges = { ...GAUGES, cpu_percent: 60 }
const QUOTAS: Quotas = { claude: undefined, codex: undefined }
const SAMPLED: BoardGather = {
	...GATHER,
	gauges: GAUGES,
	usages: run_board_render_fixture.board_usage(new Map()),
	quotas: QUOTAS,
}

const create_directory = temporary_directory()

function temporary_file(): string {
	return path.join(create_directory('run-board-saved-'), 'saved')
}

async function this_run(): Promise<number> {
	return await RUN_STARTED_MS
}

async function other_run(): Promise<number> {
	return RUN_STARTED_MS + 1
}

function memory_store(saved?: Saved): SavedStore & { save: Mock<SavedStore['save']> } {
	return { load: () => saved, save: vi.fn<SavedStore['save']>() }
}

describe('run_board_saved_state.file_store', () => {
	it('reads back the round it saved, Maps and Sets kept', () => {
		const store = file_store(temporary_file())

		store.save(SAVED)

		expect(store.load()).toStrictEqual(SAVED)
	})

	it('reads a malformed file as none', () => {
		const target = temporary_file()

		writeFileSync(target, 'not a round')

		expect(file_store(target).load()).toBeUndefined()
	})

	it('reads a missing file as none', () => {
		expect(file_store(temporary_file()).load()).toBeUndefined()
	})

	it('reads a symlink as none, never what it points at', () => {
		const real = temporary_file()
		const link = `${real}-link`

		file_store(real).save(SAVED)
		symlinkSync(real, link)

		expect(file_store(link).load()).toBeUndefined()
	})
})

describe('run_board_saved_state.for_run', () => {
	it('answers the saved round on the same run, its plan read asked again', async () => {
		const read = await for_run(memory_store(SAVED), this_run)

		expect(read?.display?.header).toStrictEqual(GATHER.display?.header)
		expect(read?.data).toMatchObject({ run_started_ms: START, attempted_ms: undefined })
	})

	it('answers the saved round without the cue the last board sounded', async () => {
		const shown = GATHER.display
		const display = shown === undefined ? undefined : { ...shown, cue: 'lane-end' as const }
		const read = await for_run(memory_store({ ...SAVED, gather: { ...GATHER, display } }), this_run)

		expect(display?.cue).toBe('lane-end')
		expect(read?.display?.cue).toBeUndefined()
	})

	it('answers none where the run check throws', async () => {
		const failing = vi.fn<() => Promise<number>>().mockRejectedValue(new Error('git'))

		await expect(for_run(memory_store(SAVED), failing)).resolves.toBeUndefined()
	})

	it('answers none for a round saved on another run', async () => {
		await expect(for_run(memory_store(SAVED), other_run)).resolves.toBeUndefined()
	})

	it('answers none with nothing saved', async () => {
		await expect(for_run(memory_store(), this_run)).resolves.toBeUndefined()
	})
})

describe('run_board_saved_state.saver', () => {
	it('saves at most once every SAVE_EVERY_MS', () => {
		const store = memory_store()
		let now_ms = START
		const save = saver(store, () => now_ms)

		save(POST)
		now_ms += SAVE_EVERY_MS - 1
		save(POST)
		now_ms += 1
		save(POST)

		expect(store.save).toHaveBeenCalledTimes(2)
	})

	it('saves the round the post carries, its data and display', () => {
		const store = memory_store()

		saver(store, () => START)(POST)

		expect(store.save).toHaveBeenCalledWith(SAVED)
	})

	it('saves no round without a run’s data', () => {
		const store = memory_store()

		saver(store, () => START)({ ...POST, data: undefined })

		expect(store.save).not.toHaveBeenCalled()
	})

	it('saves no failed round', () => {
		const store = memory_store()

		saver(store, () => START)({ failed: 'read failed' })

		expect(store.save).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#8957: a new worker's early post lands before its machine samples, so a board quit
// within SAVE_EVERY_MS of opening must not leave the next one a round without them.
describe('run_board_saved_state.saver samples', () => {
	it('keeps the saved samples a new worker’s early post has not read yet', () => {
		const store = memory_store({ ...SAVED, gather: SAMPLED })

		saver(store, () => START)(POST)

		expect(store.save).toHaveBeenCalledWith({ ...SAVED, gather: SAMPLED })
	})

	it('takes no samples from a round saved on another run', () => {
		const store = memory_store({ ...SAVED, run_started_ms: START - 1, gather: SAMPLED })

		saver(store, () => START)(POST)

		expect(store.save).toHaveBeenCalledWith(SAVED)
	})

	it('saves the samples a post read over the saved ones', () => {
		const store = memory_store({ ...SAVED, gather: SAMPLED })

		saver(store, () => START)({ ...POST, read: { ...POST.read, gauges: FRESH_GAUGES } })

		expect(store.save.mock.calls[0]?.[0].gather.gauges).toStrictEqual(FRESH_GAUGES)
	})
})
