import { describe, expect, it } from 'vitest'
import { run_board_repaint } from './run-board-repaint'
import { run_board_theme_events } from './run-board-theme-events'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_run, type ThemeRun } from './run-board-theme-run'

// joshuafolkken/kit#8969: in demo mode the theme's own frame says when the event a key played is over,
// so the footer goes back to IDLE on that frame; a part a demo key played passes once through, the run's
// own ending holds its last frame.

const { VIEW, base_canvas } = run_board_theme_layer_fixture
const { theme_layer } = run_board_theme_layer
const ORIGIN_MS = 10_000
const TICK_MS = 50
// Past the demo's NOTICE on wopr, and past either of its parts.
const LONG_MS = 60_000

function draw_at(run: ThemeRun, at_ms: number): void {
	theme_layer(run, VIEW).draw(base_canvas(), at_ms)
}

// A wopr run past its opening in demo mode, drawn once so its theme is built.
function demo_run(): ThemeRun {
	const run = run_board_theme_run.run_of('wopr', run_board_theme_registry.factory_of)

	run.origin_ms = ORIGIN_MS
	run.part = undefined
	run_board_theme_run.enter_demo(run)
	draw_at(run, ORIGIN_MS)

	return run
}

// `run` playing the demo's NOTICE from `at_ms`.
function noticed(run: ThemeRun, at_ms: number): ThemeRun {
	const tick = run_board_theme_run.tick_at(run, at_ms)

	if (run.demo !== undefined) {
		run.demo.timeline = run_board_theme_events.demo_timeline('n', 'row', tick)
	}

	return run
}

// The first frame, a tick apart from `from_ms`, on which demo mode's event is over; undefined if none is.
function over_at(run: ThemeRun, from_ms: number): number | undefined {
	for (let at = from_ms; at < from_ms + LONG_MS; at += TICK_MS) {
		draw_at(run, at)
		if (run.demo?.over === run.demo?.timeline) return at
	}

	return undefined
}

describe('run_board_theme_layer in demo mode', () => {
	it('marks the event over on the frame its theme says it no longer plays, not before', () => {
		const run = noticed(demo_run(), ORIGIN_MS)
		const timeline = run.demo?.timeline

		draw_at(run, ORIGIN_MS)
		expect(run.demo?.over).not.toBe(timeline)
		const at = over_at(run, ORIGIN_MS)

		expect(at).toBeGreaterThan(ORIGIN_MS)
		expect(run.demo?.over).toBe(timeline)
	})

	it('asks no further redraw for an event already over', () => {
		const run = noticed(demo_run(), ORIGIN_MS)
		const at = over_at(run, ORIGIN_MS) ?? ORIGIN_MS
		const is_current = run_board_repaint.current_of(run.repaint)

		draw_at(run, at + TICK_MS)

		expect(is_current?.()).toBe(true)
	})

	it('tells nothing while a part plays over the event', () => {
		const run = noticed(demo_run(), ORIGIN_MS)

		run_board_theme_run.play_part(run, 'ending', ORIGIN_MS, true)
		draw_at(run, ORIGIN_MS + TICK_MS)

		expect(run.demo?.over).toBe(run_board_theme_run.IDLE)
	})
})

describe('run_board_theme_layer parts in demo mode', () => {
	it('ends the ending a demo key played once it has played through', () => {
		const run = demo_run()

		run_board_theme_run.play_part(run, 'ending', ORIGIN_MS, true)
		draw_at(run, ORIGIN_MS + TICK_MS)
		expect(run.part?.name).toBe('ending')
		draw_at(run, ORIGIN_MS + LONG_MS)

		expect(run.part).toBeUndefined()
	})

	it('holds the run’s own ending, the one Ctrl-C plays, on its last frame', () => {
		const run = demo_run()

		run_board_theme_run.play_part(run, 'ending', ORIGIN_MS)
		draw_at(run, ORIGIN_MS + LONG_MS)

		expect(run.part?.name).toBe('ending')
	})
})
