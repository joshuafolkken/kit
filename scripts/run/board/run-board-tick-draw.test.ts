import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_display } from './run-board-display'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { CueName } from './run-board-sound-cues'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { bounds_of } = run_board_tick_draw
const { minute_of } = run_board_labels
const SIZE = { rows: 15, columns: 80 }
const FOOTER = ['footer']
const HEADER_LINES = 3
const SECOND = 1000
// Past the time the header's now line takes to type through.
const TYPED_MS = 10 * SECOND
const EPIC = 90

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

describe('run_board_tick_draw.draw_display', () => {
	it('writes one frame', () => {
		const { ports, frames } = harness(LOCAL, [])
		const state = planned()
		const run_layout = layout_for(state, LOCAL, START)

		drawn_from(state, LOCAL, { ports, now_ms: START }, run_layout)

		expect(frames).toHaveLength(1)
	})
})

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// A redraw over `rows`, its cues recorded in `cues`.
function drawn_over(
	state: BoardState,
	rows: ReadonlyArray<BoardRow>,
	cues: Array<CueName>,
): BoardState {
	const { ports } = harness(LOCAL, [])
	const run_layout = { ...layout_for(state, LOCAL, START), active: rows }

	function cue(name: CueName): void {
		cues.push(name)
	}

	return drawn_from(state, LOCAL, { ports: { ...ports, cue }, now_ms: START }, run_layout)
}

// joshuafolkken/kit#7951: the live board sounds the cue a redraw picks over the last frame's.
describe('run_board_tick_draw.draw_display cue', () => {
	it('sounds a launch once on the redraw a lane starts on, and not again while it runs', () => {
		const cues: Array<CueName> = []
		const before = drawn_over(planned(), [], cues)
		const launched = drawn_over(before, [row(1, 'running')], cues)

		drawn_over(launched, [row(1, 'running')], cues)

		expect(cues).toStrictEqual(['launch'])
	})

	it('sounds nothing on the first redraw over a wait on a person and a stopped lane', () => {
		const cues: Array<CueName> = []
		const drawn = drawn_over(planned(), [row(1, 'human'), row(2, 'stopped')], cues)

		expect(cues).toStrictEqual([])
		expect(drawn.sound_snapshot).toBeDefined()
	})

	it('sounds nothing on the redraw the plan arrives on with a wait already there', () => {
		const cues: Array<CueName> = []
		const before = drawn_over({ ...planned(), plan: undefined }, [], cues)

		drawn_over({ ...before, plan: plan_titled('a') }, [row(1, 'human')], cues)

		expect(before.sound_snapshot).toBeUndefined()
		expect(cues).toStrictEqual([])
	})
})

interface SoundDraw {
	is_on: boolean
	state?: BoardState
	rows?: ReadonlyArray<BoardRow>
}

interface SoundDrawn {
	lines: Array<string>
	state: BoardState
}

// The header's three lines a live redraw over `rows` writes with the sound switch at `is_on`.
function header_drawn({ is_on, state = planned(), rows }: SoundDraw): SoundDrawn {
	const { ports, frames } = harness(LOCAL, [])
	const run_layout = layout_for(state, LOCAL, START)
	const sound_ports = { ...ports, sound: (): boolean => is_on }
	const drawn = drawn_from(
		state,
		LOCAL,
		{ ports: sound_ports, now_ms: START },
		{ ...run_layout, active: rows ?? run_layout.active },
	)
	const lines = stripVTControlCharacters(frames.join('')).split('\n').slice(0, HEADER_LINES)

	return { lines, state: drawn }
}

// joshuafolkken/kit#7952, #8107: the live header ends its second line on the sound switch and the
// last notice. joshuafolkken/kit#8478: the machine sits on the first line, the time circuits before it.
describe('run_board_tick_draw.draw_display sound mark', () => {
	it('draws 🔊 and — at the end of the second line while the sound is on, none on the first', () => {
		const clock = minute_of(START)

		expect(header_drawn({ is_on: true }).lines).toStrictEqual([
			'⏸ josh-board     🎯 --:--  -  --′--″  💪 -  🧠 -  💾 -',
			`  -              🕒 ${clock}  +      0″  🔊 —`,
			`  kit            🚀 ${clock}`,
		])
	})

	it('records a notice the muted board keeps quiet, and draws it on the frame it is picked on', () => {
		const before = header_drawn({ is_on: false, rows: [] }).state
		const launched = header_drawn({ is_on: false, state: before, rows: [row(1, 'running')] })

		expect(launched.state.notice?.cause).toStrictEqual({ cue: 'launch', word: 'running', issue: 1 })
		expect(launched.lines[1]).toMatch(/🔇 \d{2}:\d{2} 🔄 launch · #1 running$/u)
	})
})

const CPU_PERCENT = 23

// joshuafolkken/kit#8330: a live board's worker assembles a frame only when its data moves, so the
// machine's samples are drawn as the board holds them now, not as the frame was assembled.
describe('run_board_tick_draw.draw_display machine samples', () => {
	it('draws the gauges the board holds now over a frame assembled before them', () => {
		const { ports, frames } = harness(LOCAL, [])
		const state = planned()
		const display = run_board_display.assemble_display(
			state,
			LOCAL,
			START,
			layout_for(state, LOCAL, START),
		)
		const gauges = {
			cpu_percent: CPU_PERCENT,
			memory_percent: 1,
			swap_mb_per_s: 0,
			memory_pressure: undefined,
		}

		run_board_tick_draw.draw_display({ ...state, gauges }, display, { ports, now_ms: START })
		const lines = stripVTControlCharacters(frames.join('')).split('\n')

		expect(display.header.machine).toBeUndefined()
		expect(lines[0]).toContain(`${String(CPU_PERCENT)}%`)
	})
})

// A themed redraw over `rows` at `now_ms`, typing the rows and the header's now line; `queued` stands in
// for the plan's queue where given.
function typed_over(
	state: BoardState,
	rows: ReadonlyArray<BoardRow>,
	now_ms: number,
	queued?: BoardLayout['queued'],
): BoardState {
	const { ports } = harness(LOCAL, [])
	const laid = layout_for(state, LOCAL, START)
	const run_layout = { ...laid, active: rows, queued: queued ?? laid.queued }

	return drawn_from(state, LOCAL, { ports: { ...ports, types_rows: true }, now_ms }, run_layout)
}

function typing_keys(state: BoardState): Array<string> {
	return state.typing.lines.map((line) => line.key)
}

// joshuafolkken/kit#8103: the header's now line types when its words change, and not again while they
// stay — its key is known to the next frame.
describe('run_board_tick_draw.draw_display now line typing', () => {
	it('types the now line once its words appear, and not again on a later redraw', () => {
		const now_key = 'now:1 running'
		const running = [row(1, 'running')]
		const base = typed_over(planned(), [], START)
		const appeared = typed_over(base, running, START + SECOND)
		const later = typed_over(appeared, running, START + TYPED_MS)

		expect(typing_keys(appeared)).toContain(now_key)
		expect(typing_keys(later)).not.toContain(now_key)
	})
})

function epic_of(title: string): BoardLayout['queued'] {
	return [{ kind: 'epic', epic: EPIC, title, rows: [row(EPIC + 1, 'waiting')] }]
}

// joshuafolkken/kit#8115: a queued epic's 📁 line types when it appears, and not again while it stays or
// when only its title changes — its key is the epic's number.
describe('run_board_tick_draw.draw_display epic line typing', () => {
	const epic_key = `epic:${String(EPIC)}`
	const base = typed_over(planned(), [], START, [])
	const appeared = typed_over(base, [], START + SECOND, epic_of('an epic'))

	it('types the 📁 line once the epic is queued after the base frame', () => {
		expect(typing_keys(base)).not.toContain(epic_key)
		expect(typing_keys(appeared)).toContain(epic_key)
	})

	it('types it not again on a later redraw, nor when only its title changes', () => {
		const later = typed_over(appeared, [], START + TYPED_MS, epic_of('an epic'))
		const retitled = typed_over(later, [], START + TYPED_MS + SECOND, epic_of('renamed'))

		expect(typing_keys(later)).not.toContain(epic_key)
		expect(typing_keys(retitled)).not.toContain(epic_key)
	})
})

// The empty seats a themed redraw draws: `free` seats, held by `hold`, on a pane `columns` wide.
interface Seated {
	free: number
	hold: string
	columns?: number
}

function seated_over(state: BoardState, now_ms: number, seated: Seated): BoardState {
	const local = { ...LOCAL, lane_limit: seated.free, occupied_count: 0, launch_hold: seated.hold }
	const { ports } = harness(local, [])
	const pane = { ...SIZE, columns: seated.columns ?? SIZE.columns }
	const typing = { ...ports, types_rows: true, size: (): typeof SIZE => pane }

	return drawn_from(state, local, { ports: typing, now_ms }, layout_for(state, local, START))
}

function seat_keys(state: BoardState): Array<string> {
	return typing_keys(state).filter((key) => key.startsWith('seat:'))
}

// joshuafolkken/kit#8116: an empty seat's 💺 line types when its reason appears or changes, and not
// again while the reason stays, whatever the pane's width.
describe('run_board_tick_draw.draw_display seat line typing', () => {
	const HELD = { free: 1, hold: 'hold-a' }
	const base = typed_over(planned(), [], START)
	const appeared = seated_over(base, START + SECOND, HELD)
	const later = seated_over(appeared, START + TYPED_MS, HELD)

	it('types a seat line that appears after the base frame, and not again on a later redraw', () => {
		expect(seat_keys(base)).toStrictEqual([])
		expect(seat_keys(appeared)).toHaveLength(1)
		expect(seat_keys(later)).toStrictEqual([])
	})

	it('types it again when its reason changes, and not when only the pane’s width changes', () => {
		const narrowed = seated_over(later, START + TYPED_MS + SECOND, { ...HELD, columns: 40 })
		const changed = seated_over(later, START + TYPED_MS + SECOND, { ...HELD, hold: 'hold-b' })

		expect(seat_keys(narrowed)).toStrictEqual([])
		expect(seat_keys(changed)).toHaveLength(1)
		expect(seat_keys(changed)[0]).toContain('hold-b')
	})
})

describe('run_board_tick_draw.bounds_of', () => {
	it('reads the pane size, footer and folded sections off the ports', () => {
		const { ports } = harness(LOCAL, [])
		const folded = new Set<never>()
		const bounds = bounds_of({ ...ports, size: () => SIZE, footer: FOOTER, folded: () => folded })

		expect(bounds).toStrictEqual({ size: SIZE, footer: FOOTER, folded })
	})

	it('leaves every bound unset on ports with none', () => {
		const { ports } = harness(LOCAL, [])
		const bare = { ...ports, size: undefined, footer: undefined, folded: undefined }

		expect(bounds_of(bare)).toStrictEqual({ size: undefined, footer: undefined, folded: undefined })
	})
})
