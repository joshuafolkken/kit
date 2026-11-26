import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { FrameScreen } from './run-board-frame-loop'
import type { BoardLayout } from './run-board-layout'
import { run_board_paint } from './run-board-paint'
import { run_board_panel_fixture } from './run-board-panel-fixture'
import type { LocalRead } from './run-board-read'
import { run_board_render_stress_fixture as stress } from './run-board-render-stress-fixture'
import { run_board_screen } from './run-board-screen'
import type { BoardPorts, BoardState, DrawKind } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_run } from './run-board-theme-run'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8825: every layer a themed board draws, all at once over the stress board in the
// pane the live board was profiled in (joshuafolkken/kit#5185), for one live second — the redraw timed
// as the tick and the frames between it and the next second as turns, as `--timing` splits them.
// joshuafolkken/kit#8917: a theme is its theme run's layer over the redraw, drawn on every tick,
// with the rows the stress redraw brings typing in as its events.

const { IDLE_ROW, LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const SECOND_MS = 1000
const PANE = { rows: 50, columns: 160 }
// The fewest milliseconds of a few seconds counts, so one slow second on a loaded runner fails none.
const RUNS = 3
const { THEMES } = run_board_theme_defs
// A live run: a lane in its implement phase draws the header's now line, and a usage hold puts the
// alert level at its worst.
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

// The reads a live board's panel is laid out by, so the theme layer draws (joshuafolkken/kit#8917).
const { PANEL_STATE } = run_board_panel_fixture
// What every themed second carries for its theme layer: the spinners, the colons, the lamp panel it
// lays itself out by, the keyed rows and the rows typing in as its events.
const CARRIED = ['spots', 'colons', 'lamps', 'keyed', 'typing'] as const
// Each theme's tick and turns held to the second they draw in.
const BUDGET_MS = SECOND_MS
// One write a frame that changed a cell (joshuafolkken/kit#8826): the redraw, then each theme tick.
const MIN_WRITES = 10

interface Recorder {
	draws: Record<DrawKind, number>
	writes: number
	clock: number
	// The last frame the redraw wrote, the base the second's layers draw over.
	frame: string
}

const SCREEN = run_board_screen.screen_of('live')

// The screen the last redraw left, as the live board leaves it: the frame restyled in the base look.
function base_of(theme: Theme, recorder: Recorder): FrameScreen {
	const bytes = SCREEN.frame(run_board_theme.restyle(theme, recorder.frame))

	return run_board_frame_fixture.settled(bytes, PANE)
}

type LivePorts = BoardPorts & {
	time_draw: NonNullable<BoardPorts['time_draw']>
	write_drawn: NonNullable<BoardPorts['write_drawn']>
}

// The theme's run past its opening, on its idle board, so the second draws the board and its events.
function idle_run(theme: Theme): BoardPorts['theme_run'] {
	const run = run_board_theme_registry.run_of(theme, run_board_paint.RGB_COLOR_DEPTH)

	if (run !== undefined) run_board_theme_run.end_part(run)

	return run
}

// The live ports on a colored pane of the stress size, on a clock `sleep` moves, every write counted
// and every draw timed into `recorder`.
function live_ports(theme: Theme, recorder: Recorder): LivePorts {
	function write(text: string): void {
		recorder.writes += 1
		recorder.frame = text
	}

	return {
		...harness(BUSY, []).ports,
		types_rows: true,
		is_live: true,
		is_tty: true,
		theme,
		theme_run: idle_run(theme),
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

function no_draws(): Record<DrawKind, number> {
	return { tick: 0, turn: 0, receive: 0, view: 0, reveal: 0, sound: 0 }
}

// One live second: the stress board's lanes drawn, then a second later its waits typing in under them
// as its first lane fails — that redraw timed as the tick, then the turns up to the next second.
async function second_of(theme: Theme): Promise<{ state: BoardState; recorder: Recorder }> {
	vi.stubEnv('FORCE_COLOR', '3')
	const recorder: Recorder = { draws: no_draws(), writes: 0, clock: START, frame: '' }
	const ports = live_ports(theme, recorder)
	const planned = {
		...FRESH_STATE,
		...PANEL_STATE,
		plan: plan_titled('a'),
		run_started_ms: LOCAL.started_ms,
	}
	const lanes = redraw_at(planned, ports, { ...stress.layout(), queued: [] })

	Object.assign(recorder, { draws: no_draws(), writes: 0, clock: START + SECOND_MS })
	const state = ports.time_draw('tick', () => redraw_at(lanes, ports, stress.layout(true)))

	await run_board_frame_fixture.spin_to_second(state, ports, base_of(theme, recorder))

	return { state, recorder }
}

// The fields `state` carries for the theme layer: each set and not empty.
function carried_of(state: BoardState): Array<string> {
	const fields = Object.entries({ ...state, typing: state.typing.lines })
	const set = fields.filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value))

	return set.map(([key]) => key)
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
		'carries what the %s theme layer draws by on the stress board (ac-d03d367d)',
		async (theme) => {
			const { state } = await second_of(theme)

			expect(carried_of(state)).toStrictEqual(expect.arrayContaining([...CARRIED]))
		},
	)

	it.each(THEMES)(
		'draws a %s second’s tick and turns within its budget (ac-ec0c9434)',
		async (theme) => {
			const recorders = await seconds_of(theme)
			const spent = recorders.map(({ draws }) => draws.tick + draws.turn)

			expect(Math.min(...spent)).toBeLessThan(BUDGET_MS)
		},
	)

	it.each(THEMES)('writes a %s second in a fixed count of writes (ac-8b2bf9e8)', async (theme) => {
		const recorders = await seconds_of(theme)
		const writes = recorders.map((recorder) => recorder.writes)
		const [first = 0] = writes

		expect(first).toBeGreaterThanOrEqual(MIN_WRITES)
		expect(writes).toStrictEqual(Array.from({ length: RUNS }, () => first))
	})
})
