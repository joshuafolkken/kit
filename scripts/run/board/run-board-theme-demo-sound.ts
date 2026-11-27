import type { CueName } from './run-board-sound-cues'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel } from './run-board-theme-host-types'
import { run_board_theme_run, type ThemeRun } from './run-board-theme-run'

// Demo mode's sound (joshuafolkken/kit#8917): the screen plays the demo's events, so the trill and the
// typed end follow the demo's timeline — on while its NOTICE, PROGRESS or ROW text types, the typed end
// once it types through — and the board's real events, which the screen does not show, sound nothing.
// The demo's letters type one a tick, as the host types them (`run-board-theme-host-state.ts`). Out of
// demo mode the trill follows the same three places on the timeline of the board's own events.

const { TICK_MS, state_of } = run_board_theme_host_state
const TYPED_CHANNELS = ['notice_text', 'progress', 'row'] as const

// Whether a frame's text types and how long it still types.
interface Typing {
	is_on: boolean
	left_ms: number
}

type Cue = ((name: CueName) => void) | undefined

const SILENT: Typing = { is_on: false, left_ms: 0 }

// The ticks the longest of `channels` still typing takes; 0 where none types.
function left_ticks(channels: ReadonlyArray<Channel>): number {
	const lefts = channels.filter((each) => each.is_typing).map((each) => each.total - each.length)

	return Math.max(0, ...lefts)
}

// The typing the theme's frame shows at `at_ms`, of the timeline it draws — demo mode's, else the
// board's events'; silent while a part plays — its own sound is the opening's
// (`run-board-theme-sound.ts`) — or before a theme is built.
function shown_typing(run: ThemeRun, at_ms: number): Typing {
	const layout = run.built?.layout

	if (layout === undefined || run.part !== undefined) return SILENT
	const tick = run_board_theme_run.tick_at(run, at_ms)
	const state = state_of(layout, run_board_theme_run.timeline_at(run, tick), tick)
	const left = left_ticks(TYPED_CHANNELS.map((name) => state[name]))

	return { is_on: left > 0, left_ms: left * TICK_MS }
}

// The demo timeline's typing at `at_ms`; silent out of demo mode.
function demo_typing(run: ThemeRun, at_ms: number): Typing {
	return run.demo === undefined ? SILENT : shown_typing(run, at_ms)
}

// What a frame types to the ear: the typing its theme shows — a board row that starts no event (a
// done, queued, waiting or decision row), or whose event shows its text whole under a higher one,
// types no letter on screen and sounds nothing. Through a part out of demo mode it is the board's own,
// which the part's sound keeps or drops (`run-board-theme-layer.ts` → `sound_typing`).
function heard(run: ThemeRun, at_ms: number, board: Typing): Typing {
	if (run.demo === undefined && run.part !== undefined) return board

	return shown_typing(run, at_ms)
}

// The board's cue, silent while `run` is in demo mode — the real event it sounds for is not on screen —
// and while a theme is shown, whose own score sounds its events instead (joshuafolkken/kit#8917).
function muted(cue: Cue, run: ThemeRun | undefined): Cue {
	if (cue === undefined || run === undefined) return cue

	return (name) => {
		if (run.demo === undefined && run.value === '') cue(name)
	}
}

const run_board_theme_demo_sound = { SILENT, demo_typing, heard, muted }

export { run_board_theme_demo_sound }
export type { Typing }
