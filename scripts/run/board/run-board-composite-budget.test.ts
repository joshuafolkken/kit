import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardLayout } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_render_stress_fixture as stress } from './run-board-render-stress-fixture'
import { run_board_spin } from './run-board-spin'
import type { BoardPorts, BoardState, DrawKind } from './run-board-state'
import { run_board_strip } from './run-board-strip'
import type { Theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8825: every effect a theme runs, all at once over the stress board in the pane the
// live board was profiled in (joshuafolkken/kit#5185), for one live second — the redraw timed as the
// tick and the writes between it and the next second as turns, as `--timing` splits them. The per-layer
// budgets stay in `run-board-frame-budget.test.ts`; this holds the composite, the base a reworked draw
// loop is held against.

const { IDLE_ROW, LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const SECOND_MS = 1000
const PANE = { rows: 50, columns: 160 }
// The fewest milliseconds of a few seconds counts, so one slow second on a loaded runner fails none.
const RUNS = 3
const THEMES: ReadonlyArray<Theme> = ['wargames', 'matrix', 'bttf']
// A live run: a lane in its implement phase draws the header's now line, whose age the wargames sweep
// runs under, and a usage hold puts the matrix TRACE field at its worst, where it traces.
const BUSY: LocalRead = {
	...LOCAL,
	throughput: [IDLE_ROW, IDLE_ROW],
	lanes: [String(stress.RUNNING)],
	events: [
		{
			pos: 0,
			at: new Date(START).toISOString(),
			kind: 'lane-phase',
			text: `#${String(stress.RUNNING)} implement`,
		},
	],
	usage_reset_ms: START + SECOND_MS * SECOND_MS,
}

// Each theme's effects on the stress second: the spinners, colons, lamp panel, typing and notice on
// every theme; the sweep, the rules' code and the strips on wargames; the drops, the flash with its
// deja vu and the TRACE field on matrix; the time jump on bttf.
const COMMON = ['spots', 'colons', 'lamps', 'panel', 'notice_trace', 'typing'] as const
const EFFECTS = {
	wargames: [...COMMON, 'sweep', 'rules', 'strips'],
	matrix: [...COMMON, 'drop', 'flash', 'deja_vu', 'traces'],
	bttf: [...COMMON, 'jump'],
} as const

// matrix and bttf are held to the second they draw in; wargames, several times lighter, to a fifth of
// it — the measured seconds are recorded on joshuafolkken/kit#8825.
const BUDGET_MS: Record<string, number> = { wargames: 200, matrix: SECOND_MS, bttf: SECOND_MS }
// The writes the second makes today; a frame loop that writes once a frame lowers these.
const WRITES: Record<string, number> = { wargames: 76, matrix: 140, bttf: 75 }

interface Recorder {
	draws: Record<DrawKind, number>
	writes: number
	clock: number
}

type LivePorts = BoardPorts & {
	time_draw: NonNullable<BoardPorts['time_draw']>
	write_drawn: NonNullable<BoardPorts['write_drawn']>
}

// The live ports on a colored pane of the stress size, on a clock `sleep` moves, every write counted
// and every draw timed into `recorder`.
function live_ports(theme: Theme, recorder: Recorder): LivePorts {
	function write(): void {
		recorder.writes += 1
	}

	return {
		...harness(BUSY, []).ports,
		types_rows: true,
		is_live: true,
		is_tty: true,
		theme,
		opened_ms: START,
		size: () => PANE,
		now: () => recorder.clock,
		sleep: async (ms) => {
			recorder.clock += ms
		},
		write,
		write_drawn: write,
		time_draw: (kind, draw) => {
			const started = performance.now()
			const result = draw()

			recorder.draws[kind] += performance.now() - started

			return result
		},
	}
}

function redraw_at(state: BoardState, ports: LivePorts, rows: BoardLayout): BoardState {
	const now_ms = ports.now()
	const run_layout = { ...layout_for(state, BUSY, now_ms), ...rows }

	return drawn_from(state, BUSY, { ports, now_ms }, run_layout)
}

// No built-in theme turns the strips on (`run-board-theme-defs.ts`), so the wargames rules carry them
// on every screen row above a rule — the most a strip theme could light.
function striped(state: BoardState): BoardState {
	if (state.rules?.length === 0) return state
	const starts = Array.from({ length: PANE.rows }, (_, index) => index + 1)
	const blank = starts.map(() => '')
	const panel = { lamps: state.lamps ?? [], rules: state.rules ?? [] }

	return { ...state, strips: run_board_strip.strip_cells(blank, starts, panel) }
}

function no_draws(): Record<DrawKind, number> {
	return { tick: 0, turn: 0, receive: 0, view: 0, reveal: 0, sound: 0 }
}

// One live second: the stress board's lanes drawn, then a second later its waits typing in under them
// as its first lane fails — that redraw timed as the tick, then the turns up to the next second.
async function second_of(theme: Theme): Promise<{ state: BoardState; recorder: Recorder }> {
	vi.stubEnv('FORCE_COLOR', '3')
	const recorder: Recorder = { draws: no_draws(), writes: 0, clock: START }
	const ports = live_ports(theme, recorder)
	const planned = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const lanes = redraw_at(planned, ports, { ...stress.layout(), queued: [] })

	Object.assign(recorder, { draws: no_draws(), writes: 0, clock: START + SECOND_MS })
	const state = striped(ports.time_draw('tick', () => redraw_at(lanes, ports, stress.layout(true))))

	await run_board_spin.spin_to_second(state, ports)

	return { state, recorder }
}

// The effects `state` carries: each Turning field set and not empty, and the flash's deja vu.
function effects_of(state: BoardState): Array<string> {
	const fields = Object.entries({ ...state, typing: state.typing.lines })
	const set = fields.filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value))
	const deja = (state.flash?.deja_vu.length ?? 0) > 0 ? ['deja_vu'] : []

	return [...set.map(([key]) => key), ...deja]
}

async function seconds_of(theme: Theme): Promise<Array<Recorder>> {
	const recorders: Array<Recorder> = []

	for (let run = 0; run < RUNS; run += 1) {
		// eslint-disable-next-line no-await-in-loop -- the seconds run one after another, as live ones do
		const { recorder } = await second_of(theme)

		recorders.push(recorder)
	}

	return recorders
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_spin.spin_to_second composite budget', () => {
	it.each(THEMES)(
		'carries every %s effect at once on the stress board (ac-d03d367d)',
		async (theme) => {
			const { state } = await second_of(theme)

			expect(effects_of(state)).toStrictEqual(expect.arrayContaining([...EFFECTS[theme]]))
		},
	)

	it.each(THEMES)(
		'draws a %s second’s tick and turns within its budget (ac-ec0c9434)',
		async (theme) => {
			const recorders = await seconds_of(theme)
			const spent = recorders.map(({ draws }) => draws.tick + draws.turn)

			expect(Math.min(...spent)).toBeLessThan(BUDGET_MS[theme] ?? 0)
		},
	)

	it.each(THEMES)('writes a %s second in a fixed count of writes (ac-8b2bf9e8)', async (theme) => {
		const recorders = await seconds_of(theme)
		const writes = recorders.map((recorder) => recorder.writes)

		expect(writes).toStrictEqual(Array.from({ length: RUNS }, () => WRITES[theme]))
	})
})
