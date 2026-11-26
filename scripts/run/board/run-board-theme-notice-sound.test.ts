import { describe, expect, it, vi } from 'vitest'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_notice_sound } from './run-board-theme-notice-sound'
import type { ThemeRun } from './run-board-theme-run'

// joshuafolkken/kit#8917: a themed board's event sounds play once as each event starts on the timeline
// drawn, on the first frame at or past its start however many ticks were skipped; an event begun before
// the run's first frame stays silent, and a part sounds once as it starts.

const { is_notice_started, sound_events, sound_part } = run_board_theme_notice_sound
const { VIEW, base_canvas, ticking_run } = run_board_theme_layer_fixture
const { TICK_MS } = run_board_theme_host_state
const ORIGIN_MS = 10_000
const NOTICE_TICK = 5
const ESC = '\u{1B}'

type Timeline = NonNullable<ThemeRun['demo']>['timeline']

function at_tick(tick: number): number {
	return ORIGIN_MS + tick * TICK_MS
}

// A run showing `timeline`, as demo mode shows its own.
function showing(timeline: Timeline): ThemeRun {
	const run = ticking_run(ORIGIN_MS)

	run.demo = { timeline, entered: 'wopr' }

	return run
}

function notice_at(start: number, text = 'abc'): Timeline {
	return { notice: [{ start, text }], progress: [], row: [] }
}

const NOTHING: Timeline = { notice: [], progress: [], row: [] }

describe('run_board_theme_notice_sound.is_notice_started', () => {
	it('is true once per NOTICE, on the first frame at or past its start', () => {
		const run = showing(NOTHING)

		expect(is_notice_started(run, at_tick(0))).toBe(false)
		run.demo = { timeline: notice_at(NOTICE_TICK), entered: 'wopr' }

		expect(is_notice_started(run, at_tick(NOTICE_TICK - 1))).toBe(false)
		expect(is_notice_started(run, at_tick(NOTICE_TICK + 2))).toBe(true)
		expect(is_notice_started(run, at_tick(NOTICE_TICK + 3))).toBe(false)
	})

	it('is true for a NOTICE started in the tick a frame was already drawn in', () => {
		const run = showing(NOTHING)

		expect(is_notice_started(run, at_tick(NOTICE_TICK))).toBe(false)
		run.demo = { timeline: notice_at(NOTICE_TICK), entered: 'wopr' }

		expect(is_notice_started(run, at_tick(NOTICE_TICK))).toBe(true)
	})

	it('keeps a NOTICE begun before the run’s first frame silent', () => {
		const run = showing(notice_at(0))

		expect(is_notice_started(run, at_tick(NOTICE_TICK))).toBe(false)
	})
})

describe('run_board_theme_notice_sound.sound_events', () => {
	it('sounds each event once as it starts, with its text’s letters, its colors left out', () => {
		const run = showing(NOTHING)
		const trill = { event: vi.fn(), part: vi.fn() }

		sound_events(run, trill, at_tick(0))
		run.demo = {
			timeline: { notice: [], progress: [], row: [{ start: 2, text: `${ESC}[33m8917${ESC}[0m` }] },
			entered: 'wopr',
		}
		sound_events(run, trill, at_tick(3))
		sound_events(run, trill, at_tick(4))

		expect(trill.event.mock.calls).toStrictEqual([['row', 4]])
	})
})

describe('run_board_theme_notice_sound.sound_part', () => {
	it('sounds a part once as it starts, for its length', () => {
		const run = ticking_run(0)
		const trill = { part: vi.fn() }

		run_board_theme_layer.theme_layer(run, VIEW).draw(base_canvas(), 0)
		run.part = { name: 'ending', start_ms: 0 }
		sound_part(run, trill)
		sound_part(run, trill)

		expect(trill.part).toHaveBeenCalledOnce()
		expect(trill.part.mock.calls[0]?.[0]).toBe('ending')
	})

	it('sounds nothing with no part playing', () => {
		const trill = { part: vi.fn() }

		sound_part(ticking_run(0), trill)

		expect(trill.part).not.toHaveBeenCalled()
	})
})
