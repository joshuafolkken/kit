import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_every } from './run-board-every'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_store, type FrameStore } from './run-board-frame-store'
import { run_board_gather, type GatherRead } from './run-board-gather'
import { run_board_gather_record, type RecordSetup } from './run-board-gather-record'
import type { RoundState, WorkerSeed } from './run-board-gather-thread'
import type { MachineGauges } from './run-board-machine'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_state } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8161: the live board's worker records the frames `--chat` and `--once` answer from,
// every five seconds, so the board's own thread only draws.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { CHAT_KEY, once_key } = run_board_frame_store
const { RECORD_EVERY_MS } = run_board_every
const SECOND_MS = 1000
const ROUNDS = 12
const SETUP: RecordSetup = { theme: undefined, icons: 'emoji', is_tty: true, is_linked: false }
const TERMINAL_ONCE = once_key(undefined, true)
const ESCAPE = '\u{1B}'
const OSC = `${ESCAPE}]`
const BEL = '\u{7}'

// `terminal-link` decides support as it loads, so the test decides it here; a supported link is the
// escape `ansi-escapes` 7 writes — no `id=` of its own.
const hyperlinks = vi.hoisted(() => ({ is_supported: false }))

vi.mock('terminal-link', () => ({
	default: Object.assign(
		(text: string, url: string) =>
			hyperlinks.is_supported ? `\u{1B}]8;;${url}\u{7}${text}\u{1B}]8;;\u{7}` : text,
		{ isSupported: false },
	),
}))

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

// The worker's recorder over a round a second for `ROUNDS` seconds, on a clock it advances: the same
// round each second, or the one `round_at` gives for it.
function recorded(
	setup: RecordSetup,
	round: RoundState | ((second: number) => RoundState),
): Counted {
	const frames = counted()
	const clock = { now_ms: START }
	const record = run_board_gather_record.round_recorder(setup, {
		now: () => clock.now_ms,
		frames: frames.store,
	})

	for (let second = 0; second < ROUNDS; second += 1) {
		clock.now_ms = START + second * SECOND_MS
		record(typeof round === 'function' ? round(second) : round)
	}

	return frames
}

// The chat and once keys saved by `records` records.
function saved_keys(records: number): Array<string> {
	return Array.from({ length: records }, () => [CHAT_KEY, TERMINAL_ONCE]).flat()
}

describe('run_board_gather_record.round_recorder', () => {
	it('records the chat and once frames at most once every five seconds', () => {
		const { saves } = recorded(SETUP, (second) => round_of(START + second * SECOND_MS))
		const records = Math.ceil((ROUNDS * SECOND_MS) / RECORD_EVERY_MS)

		expect(RECORD_EVERY_MS).toBe(5 * SECOND_MS)
		expect(saves).toStrictEqual(saved_keys(records))
	})
})

// joshuafolkken/kit#8335: an unchanged board is not drawn again for the record.
describe('run_board_gather_record.round_recorder over unchanged rounds', () => {
	it('records an unchanged round once (ac-aa38dcc8)', () => {
		expect(recorded(SETUP, round_of(START)).saves).toStrictEqual(saved_keys(1))
	})

	it('records a changed round at the next chance to record (ac-2a04f774)', () => {
		const changed_at = 7
		const reread_ms = START + changed_at * SECOND_MS
		const { saves, store } = recorded(SETUP, (second) =>
			round_of(second < changed_at ? START : reread_ms),
		)

		expect(saves).toStrictEqual(saved_keys(2))
		expect(store.load(CHAT_KEY)?.saved_ms).toBe(reread_ms)
	})
})

const GAUGES: MachineGauges = {
	cpu_percent: 20,
	memory_percent: 37,
	swap_mb_per_s: 0,
	memory_pressure: undefined,
}

describe('run_board_gather_record.round_recorder over sampled rounds', () => {
	it.each<Partial<GatherRead>>([
		{ gauges: { ...GAUGES, memory_percent: 90 } },
		{ usages: run_board_render_fixture.board_usage(new Map()) },
		{ quotas: { claude: { windows: [], taken_ms: START }, codex: undefined } },
		{
			budget_waits: [
				{
					lane: '8335',
					elsewhere: undefined,
					command: 'gate',
					waited_ms: SECOND_MS,
					reason: 'memory',
				},
			],
		},
	])('records changed samples: %j', (sample) => {
		const round = round_of(START)
		const initial = { ...round.gather, gauges: GAUGES }
		const { saves } = recorded(SETUP, (second) => ({
			...round,
			gather: second < 6 ? initial : { ...initial, ...sample },
		}))

		expect(saves).toStrictEqual(saved_keys(2))
	})
})

describe('run_board_gather_record.round_recorder over equal samples', () => {
	it('records equal samples once even when rebuilt each round', () => {
		const round = round_of(START)
		const { saves } = recorded(SETUP, () => ({
			...round,
			gather: { ...round.gather, gauges: { ...GAUGES }, budget_waits: [] },
		}))

		expect(saves).toStrictEqual(saved_keys(1))
	})
})

describe('run_board_cli.run over changed worker samples', () => {
	it.each([
		['--chat', CHAT_KEY],
		['--once', TERMINAL_ONCE],
	])('answers %s with the latest memory sample within the same minute', async (option, key) => {
		const round = round_of(START)
		const { store } = recorded(SETUP, (second) => ({
			...round,
			gather: { ...round.gather, gauges: { ...GAUGES, memory_percent: second < 6 ? 37 : 90 } },
		}))
		const { ports, frames } = harness(LOCAL, [])

		await run_board_cli.run([option], { ...ports, frames: store })

		expect(store.load(key)?.text).toContain('90%')
		expect(frames.join('')).toContain('90%')
	})
})

describe('run_board_gather_record.round_recorder’s frames', () => {
	it('records nothing before the plan read has settled', () => {
		const { saves } = recorded(SETUP, round_of(undefined))

		expect(saves).toStrictEqual([])
	})

	it('records the frames the board would for the same round, dated when the plan was read (ac-71e945f3)', () => {
		const { store } = recorded(SETUP, round_of(START))
		const expected = run_board_frame_store.memory_store()
		const { ports } = harness(LOCAL, [])
		const board = { local: LOCAL, read_ms: START, plan: plan_titled('a'), fetched_ms: START }

		run_board_every.record(
			{ ...run_board_tick.FRESH_STATE, ...board },
			{ ...ports, link: run_board_gather_record.link, frames: expected },
			undefined,
			START,
		)

		expect(store.load(CHAT_KEY)).toStrictEqual(expected.load(CHAT_KEY))
		expect(store.load(TERMINAL_ONCE)).toStrictEqual(expected.load(TERMINAL_ONCE))
		expect(store.load(CHAT_KEY)?.text).not.toContain(ESCAPE)
	})

	it.each([
		['shapes', '->'],
		['emoji', '🎯'],
	] as const)(
		'keys the once frame by the theme, icons %s and terminal it was started with (#8505)',
		(icons, clock) => {
			const setup: RecordSetup = { ...SETUP, theme: 'wargames', icons, is_tty: false }
			const { store, saves } = recorded(setup, round_of(START))
			const key = once_key('wargames', false, icons)

			expect(saves).toContain(key)
			expect(store.load(key)?.text).toContain(`${clock} `)
		},
	)
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

// joshuafolkken/kit#8242: an id-less OSC 8 link is a new record in xterm.js each frame, piled up on the
// alternate screen and dropped at once on leaving it — a long-running board froze VSCode on Ctrl+C.
describe('run_board_gather_record.link', () => {
	const URL = 'https://github.com/joshuafolkken/kit/issues/8242'

	afterEach(() => {
		hyperlinks.is_supported = false
	})

	it('opens each link with the same id, so a redraw re-uses the terminal’s record', () => {
		hyperlinks.is_supported = true
		const { link } = run_board_gather_record
		const linked = link('8242', URL)

		expect(linked).toBe(`${OSC}8;id=josh-run-board;${URL}${BEL}8242${OSC}8;;${BEL}`)
		expect(link('8242', URL)).toBe(linked)
	})

	it('draws the bare text on a terminal that opens no link', () => {
		expect(run_board_gather_record.link('8242', URL)).toBe('8242')
	})
})

describe('run_board_gather_record.setup_of', () => {
	it('carries the board’s theme', () => {
		expect(run_board_gather_record.setup_of('wargames').theme).toBe('wargames')
	})
})
