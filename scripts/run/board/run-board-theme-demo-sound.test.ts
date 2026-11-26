import { describe, expect, it, vi } from 'vitest'
import { run_board_theme_demo_sound } from './run-board-theme-demo-sound'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import type { ThemeRun } from './run-board-theme-run'

// joshuafolkken/kit#8917: demo mode's sound follows the demo's timeline — the trill on while its text
// types — and the board's real events, which the screen does not show, sound nothing; the board's cue
// is silent in demo mode and while a theme is shown, whose score sounds instead.

const { SILENT, demo_typing, heard, muted } = run_board_theme_demo_sound
const { VIEW, base_canvas, ticking_run } = run_board_theme_layer_fixture
const { TICK_MS } = run_board_theme_host_state
const ROW_TEXT = 'abcdefghij'
const BOARD = { is_on: true, left_ms: 300 }
const TYPED_TICKS = 4

// A run built over the fixture's base, in demo mode with a ROW typing from tick 0.
function demo_run(): ThemeRun {
	const run = ticking_run(0)

	run_board_theme_layer.theme_layer(run, VIEW).draw(base_canvas(), 0)
	run.demo = {
		timeline: { notice: [], progress: [], row: [{ start: 0, text: ROW_TEXT }] },
		entered: 'wopr',
	}

	return run
}

describe('run_board_theme_demo_sound.demo_typing', () => {
	it('types while the demo’s ROW types, for the letters still to come', () => {
		const typing = demo_typing(demo_run(), TYPED_TICKS * TICK_MS)

		expect(typing).toStrictEqual({
			is_on: true,
			left_ms: (ROW_TEXT.length - TYPED_TICKS - 1) * TICK_MS,
		})
	})

	it('is silent once the demo’s text has typed through', () => {
		expect(demo_typing(demo_run(), ROW_TEXT.length * 2 * TICK_MS)).toStrictEqual(SILENT)
	})

	it('is silent out of demo mode, while a part plays, or before the theme is built', () => {
		const run = demo_run()
		const fresh = ticking_run(0)
		const out = demo_run()

		out.demo = undefined
		fresh.demo = run.demo
		run.part = { name: 'opening', start_ms: 0 }

		expect([run, fresh, out].map((each) => demo_typing(each, 0))).toStrictEqual([
			SILENT,
			SILENT,
			SILENT,
		])
	})
})

describe('run_board_theme_demo_sound.heard', () => {
	it('hears the board’s own typing out of demo mode, the demo’s in it', () => {
		const out = demo_run()

		out.demo = undefined

		expect(heard(out, 0, BOARD)).toBe(BOARD)
		expect(heard(demo_run(), ROW_TEXT.length * 2 * TICK_MS, BOARD)).toStrictEqual(SILENT)
	})
})

describe('run_board_theme_demo_sound.muted', () => {
	it('passes the cue through on a board showing no theme', () => {
		const cue = vi.fn()
		const run = ticking_run(0)

		run.value = ''
		muted(cue, run)?.('alert')

		expect(cue).toHaveBeenCalledWith('alert')
	})

	it('keeps the cue silent in demo mode and while a theme is shown', () => {
		const cue = vi.fn()

		muted(cue, demo_run())?.('alert')
		muted(cue, ticking_run(0))?.('alert')

		expect(cue).not.toHaveBeenCalled()
	})

	it('leaves the cue as it is with no run or no cue', () => {
		const cue = vi.fn()

		expect(muted(cue, undefined)).toBe(cue)
		expect(muted(undefined, ticking_run(0))).toBeUndefined()
	})
})
