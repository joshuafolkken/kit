import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_live } from './run-board-live'
import { run_board_panel_fixture } from './run-board-panel-fixture'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_run } from './run-board-theme-run'
import { run_board_theme_sound } from './run-board-theme-sound'

const { LINK, TICK_AT, VIEW, base_canvas, row_text, ticking_run } = run_board_theme_layer_fixture
const { theme_layer, after_frame } = run_board_theme_layer
const ORIGIN_MS = 10_000
const TICK_MS = 50
// The fixture's lane row (0-based).
const LANE_Y = 14
// The stand-in theme's body color as the base's foreground.
const BODY_SGR = '38;2;1;2;3'

// The canvas a frame at `at_ms` leaves: the base, then the theme layer over it.
function drawn_at(layer: ReturnType<typeof theme_layer>, at_ms: number): Cells {
	const canvas = base_canvas()

	layer.draw(canvas, at_ms)

	return canvas
}

function tick_text(cells: Cells): string {
	return row_text(cells, TICK_AT.y).slice(TICK_AT.x).trim()
}

describe('run_board_theme_layer.theme_layer', () => {
	it('changes on each 50 ms boundary from the run start', () => {
		const layer = theme_layer(ticking_run(ORIGIN_MS), VIEW)

		expect(layer.next_change_ms(ORIGIN_MS)).toBe(ORIGIN_MS + TICK_MS)
		expect(layer.next_change_ms(ORIGIN_MS + 49)).toBe(ORIGIN_MS + TICK_MS)
		expect(layer.next_change_ms(ORIGIN_MS + TICK_MS)).toBe(ORIGIN_MS + 2 * TICK_MS)
	})

	it('draws the tick of the moment, the same within one tick', () => {
		const layer = theme_layer(ticking_run(ORIGIN_MS), VIEW)

		expect(tick_text(drawn_at(layer, ORIGIN_MS + 120))).toBe('2')
		expect(tick_text(drawn_at(layer, ORIGIN_MS + 149))).toBe('2')
		expect(tick_text(drawn_at(layer, ORIGIN_MS + 150))).toBe('3')
	})

	it('draws the same cells at the same moment, frames skipped or not', () => {
		const stepped = theme_layer(ticking_run(ORIGIN_MS), VIEW)
		const skipped = theme_layer(ticking_run(ORIGIN_MS), VIEW)

		for (let at = ORIGIN_MS; at < ORIGIN_MS + 500; at += TICK_MS) drawn_at(stepped, at)
		const after_steps = drawn_at(stepped, ORIGIN_MS + 777)
		const after_skip = drawn_at(skipped, ORIGIN_MS + 777)

		expect(after_skip.chars).toEqual(after_steps.chars)
		expect(after_skip.styles).toEqual(after_steps.styles)
	})
})

describe('run_board_theme_layer.theme_layer over the base', () => {
	it('keeps the hyperlink of a base cell whose character the theme left', () => {
		const cells = drawn_at(theme_layer(ticking_run(ORIGIN_MS), VIEW), ORIGIN_MS)
		const lane = row_text(cells, LANE_Y)
		const at = LANE_Y * cells.columns + lane.indexOf('8899')

		expect(run_board_cells.style_of(cells.styles[at] ?? 0).link).toBe(LINK)
	})

	it('paints the base in the theme colors, not the matrix palette', () => {
		const cells = drawn_at(theme_layer(ticking_run(ORIGIN_MS), VIEW), ORIGIN_MS)

		expect(run_board_cells.style_of(cells.styles[2] ?? 0).sgr).toContain(BODY_SGR)
	})

	// The confirmed specification §2: with no lamp panel on screen (a folded section, a small pane) the
	// theme keeps its looks; only what draws in the area falls off the frame.
	it('keeps drawing the theme and its colors without a lamp panel', () => {
		const layer = theme_layer(ticking_run(ORIGIN_MS), { ...VIEW, lamps: [] })
		const cells = drawn_at(layer, ORIGIN_MS + 120)

		expect(run_board_cells.style_of(cells.styles[2] ?? 0).sgr).toContain(BODY_SGR)
		expect(tick_text(cells)).toBe('2')
	})

	// The level display is the work's own (the confirmed specification §2): wopr's DEFCON, right-aligned
	// to the rule's end, shows the real alert level while no event plays.
	it('lays the real alert level over the theme while no event plays', () => {
		const run = run_board_theme_run.run_of('wopr', run_board_theme_registry.factory_of)

		run.origin_ms = ORIGIN_MS
		run.part = undefined
		run.level = 2
		const rule = row_text(drawn_at(theme_layer(run, VIEW), ORIGIN_MS), 4).trimEnd()

		expect(rule.endsWith('DEFCON 5 4 3 [2] 1')).toBe(true)
	})

	it('lays no level of its own for a theme that draws none', () => {
		const run = ticking_run(ORIGIN_MS)

		run.level = 2
		const cells = drawn_at(theme_layer(run, VIEW), ORIGIN_MS)

		expect(row_text(cells, 4)).not.toContain('DEFCON')
	})
})

describe('run_board_theme_layer.after_frame', () => {
	const sound = { spans: [{ from_ms: 0, to_ms: 1000 }], typed_ms: 1000 }

	function opening_run(): ReturnType<typeof ticking_run> {
		const run = ticking_run(ORIGIN_MS)

		run.opening_sound = () => sound
		run.part = { name: 'opening', start_ms: ORIGIN_MS }

		return run
	}

	it('sounds the typed end once on crossing its moment, frames skipped', () => {
		const run = opening_run()
		const trill = { set: vi.fn(), typed: vi.fn() }
		const board = { is_on: false, left_ms: 0 }

		for (const at of [0, 400, 1300, 1350, 1400]) {
			after_frame(run, trill, ORIGIN_MS + at, board)
		}

		expect(trill.typed).toHaveBeenCalledTimes(1)
		expect(trill.set.mock.calls.map(([is_on]) => is_on)).toEqual([true, true, false, false, false])
	})

	// joshuafolkken/kit#8917: a demo key plays the opening with its own sound, as the live board does.
	it('sounds the opening’s typed end in demo mode too, the board’s typing kept out', () => {
		const run = opening_run()
		const trill = { set: vi.fn(), typed: vi.fn() }

		run.demo = { timeline: { notice: [], progress: [], row: [] }, entered: 'wopr' }
		after_frame(run, trill, ORIGIN_MS + 1200, { is_on: true, left_ms: 500 })

		expect(trill.typed).toHaveBeenCalledOnce()
		expect(trill.set).toHaveBeenCalledWith(false, 0)
	})

	it('keeps the board typing trill outside the opening', () => {
		const run = ticking_run(ORIGIN_MS)
		const trill = { set: vi.fn(), typed: vi.fn() }

		after_frame(run, trill, ORIGIN_MS, { is_on: true, left_ms: 300 })

		expect(trill.set).toHaveBeenCalledWith(true, 300)
		expect(run_board_theme_sound.SILENT.typed_ms).toBeUndefined()
	})
})

// joshuafolkken/kit#8917: a live board in a theme, on a terminal of 24-bit color, drawn by the theme host.
const { IDLE_ROW, LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const STOP_AFTER_MS = 5000
const { PANE, paneled } = run_board_panel_fixture

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

// A sleep that moves the board's clock on by what it waits, stopping the board once enough has passed.
function clocked(clock: { now_ms: number }): (ms: number) => Promise<void> {
	const stop_at = clock.now_ms + STOP_AFTER_MS

	return async (ms) => {
		clock.now_ms += ms
		if (clock.now_ms > stop_at) throw STOPPED
	}
}

// A live board on the real board's pane, its usage section's three rows read, so its lamp panel is one
// a theme is drawn on: six rows, forty columns or more (`run-board-theme-layout.ts`).
async function watched(theme: 'wopr' | 'trace'): Promise<Array<string>> {
	const local = { ...LOCAL, throughput: [IDLE_ROW, IDLE_ROW] }
	const board = harness(local, [plan_titled('a')])
	const { frames, clock } = board
	const live = { ...paneled(board), sleep: clocked(clock) }

	await expect(run_board_live.watch(live, theme)).rejects.toBe(STOPPED)

	return frames
}

describe('run_board_live.watch in 24-bit color', () => {
	it('draws the board through the theme layer, as the wopr work', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const layer = vi.spyOn(run_board_theme_layer, 'theme_layer')
		const frames = await watched('wopr')
		const screen = run_board_frame_fixture.terminal_of(frames.slice(0, -1), PANE)

		expect(layer).toHaveBeenCalled()
		expect(run_board_frame_fixture.lines_of(screen).join('\n')).toContain('JOSH-WOPR')
	})

	it('writes every frame in one synchronized write, the screen cleared only by the first', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frames = await watched('trace')
		const drawn = frames.slice(1, -1).filter((frame) => frame !== '')

		expect(drawn.length).toBeGreaterThan(0)
		expect(drawn.every((frame) => run_board_frame_fixture.is_synced_once(frame))).toBe(true)
		expect(drawn.slice(1).some((frame) => frame.includes('\u{1B}[2J'))).toBe(false)
	})

	it('draws the board in no theme as before where the terminal has no 24-bit color', async () => {
		vi.stubEnv('FORCE_COLOR', '2')
		const layer = vi.spyOn(run_board_theme_layer, 'theme_layer')

		await watched('wopr')

		expect(layer).not.toHaveBeenCalled()
	})
})
