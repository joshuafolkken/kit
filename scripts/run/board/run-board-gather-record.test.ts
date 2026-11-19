import { describe, expect, it } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_every } from './run-board-every'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_store, type FrameStore } from './run-board-frame-store'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_record, type RecordSetup } from './run-board-gather-record'
import type { RoundState, WorkerSeed } from './run-board-gather-thread'
import { run_board_state } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8161: the live board's worker records the frames `--chat` and `--once` answer from,
// every five seconds, so the board's own thread only draws.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { CHAT_KEY, once_key } = run_board_frame_store
const { RECORD_EVERY_MS } = run_board_every
const SECOND_MS = 1000
const ROUNDS = 12
const SETUP: RecordSetup = { theme: undefined, is_tty: true, is_linked: false }
const TERMINAL_ONCE = once_key(undefined, true)
const ESCAPE = '\u{1B}'

// A worker's round over `LOCAL`, its plan read when `fetched_ms` says.
function round_of(fetched_ms: number | undefined): RoundState {
	return {
		gather: { ...run_board_gather.FRESH_GATHER, local: LOCAL, read_ms: START },
		data: { ...run_board_state.FRESH_DATA, plan: plan_titled('a'), fetched_ms },
		board: run_board_state.FRESH_STATE,
	}
}

interface Counted {
	store: FrameStore
	saves: Array<string>
}

function counted(): Counted {
	const kept = run_board_frame_store.memory_store()
	const saves: Array<string> = []
	const store: FrameStore = {
		load: (key) => kept.load(key),
		save: (key, frame) => {
			saves.push(key)
			kept.save(key, frame)
		},
	}

	return { store, saves }
}

// The worker's recorder over a round a second for `ROUNDS` seconds, on a clock it advances.
function recorded(setup: RecordSetup, round: RoundState): Counted {
	const frames = counted()
	const clock = { now_ms: START }
	const record = run_board_gather_record.round_recorder(setup, {
		now: () => clock.now_ms,
		frames: frames.store,
	})

	for (let second = 0; second < ROUNDS; second += 1) {
		clock.now_ms = START + second * SECOND_MS
		record(round)
	}

	return frames
}

describe('run_board_gather_record.round_recorder', () => {
	it('records the chat and once frames once every five seconds', () => {
		const { saves } = recorded(SETUP, round_of(START))
		const records = Math.ceil((ROUNDS * SECOND_MS) / RECORD_EVERY_MS)

		expect(RECORD_EVERY_MS).toBe(5 * SECOND_MS)
		expect(saves).toStrictEqual(
			Array.from({ length: records }, () => [CHAT_KEY, TERMINAL_ONCE]).flat(),
		)
	})

	it('records nothing before the plan read has settled', () => {
		const { saves } = recorded(SETUP, round_of(undefined))

		expect(saves).toStrictEqual([])
	})

	it('records the frames the board would for the same round, dated when the plan was read', () => {
		const { store } = recorded(SETUP, round_of(START))
		const expected = run_board_frame_store.memory_store()
		const { ports } = harness(LOCAL, [])
		const board = { local: LOCAL, read_ms: START, plan: plan_titled('a'), fetched_ms: START }
		const last_record_ms = START + 2 * RECORD_EVERY_MS

		run_board_every.record(
			{ ...run_board_tick.FRESH_STATE, ...board },
			{ ...ports, link: run_board_gather_record.link, frames: expected },
			undefined,
			last_record_ms,
		)

		expect(store.load(CHAT_KEY)).toStrictEqual(expected.load(CHAT_KEY))
		expect(store.load(TERMINAL_ONCE)).toStrictEqual(expected.load(TERMINAL_ONCE))
		expect(store.load(CHAT_KEY)?.text).not.toContain(ESCAPE)
	})

	it('keys the once frame by the theme and terminal it was started with', () => {
		const { saves } = recorded({ ...SETUP, theme: 'wargames', is_tty: false }, round_of(START))

		expect(saves).toContain(once_key('wargames', false))
	})
})

// joshuafolkken/kit#8161: `--chat` answers from the frame the worker recorded, as it did from the
// board's own.
describe('run_board_cli.run --chat over the worker’s record', () => {
	it('answers with the chat frame the worker recorded', async () => {
		const { store } = recorded(SETUP, round_of(START))
		const { ports, frames, read_local } = harness(LOCAL, [])
		const text = store.load(CHAT_KEY)?.text

		await run_board_cli.run(['--chat'], { ...ports, frames: store })

		expect(text).toBeDefined()
		// Dated when the plan was read, at the round's start, as the board's own record was.
		expect(frames).toStrictEqual([`${String(text)}recorded 0s ago\n`])
		expect(read_local).not.toHaveBeenCalled()
	})
})

describe('run_board_gather_record.started_with', () => {
	it('reads back the seed and a recorder from a spawned worker’s data', () => {
		const given: WorkerSeed = { seed: undefined, setup: SETUP }
		const start = run_board_gather_record.started_with(given)

		expect(start.seed).toBeUndefined()
		expect(start.record).toBeTypeOf('function')
	})

	it('records nothing from a start that carries no setup', () => {
		expect(run_board_gather_record.started_with({ seed: undefined }).record).toBeUndefined()
		expect(run_board_gather_record.started_with('torn').record).toBeUndefined()
	})
})

describe('run_board_gather_record.worker_environment', () => {
	it('forces the worker’s links to the board terminal’s answer', () => {
		const { worker_environment } = run_board_gather_record

		expect(worker_environment({ ...SETUP, is_linked: true })['FORCE_HYPERLINK']).toBe('1')
		expect(worker_environment(SETUP)['FORCE_HYPERLINK']).toBe('0')
	})
})

describe('run_board_gather_record.setup_of', () => {
	it('carries the board’s theme', () => {
		expect(run_board_gather_record.setup_of('wargames').theme).toBe('wargames')
	})
})
