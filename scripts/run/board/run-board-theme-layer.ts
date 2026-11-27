import type { Cells } from './run-board-cells'
import type { Layer } from './run-board-layer'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_theme_canvas } from './run-board-theme-canvas'
import { run_board_theme_demo_sound, type Typing } from './run-board-theme-demo-sound'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { FinalGrid, PartName, ThemeModule, ThemeTimeline } from './run-board-theme-host-types'
import { run_board_theme_layout, type LayoutView } from './run-board-theme-layout'
import { run_board_theme_notice_sound } from './run-board-theme-notice-sound'
import { run_board_theme_roles } from './run-board-theme-roles'
import { run_board_theme_run, type Built, type ThemeRun } from './run-board-theme-run'
import { run_board_theme_sound, type OpeningSound } from './run-board-theme-sound'

// A themed live board's theme layer (joshuafolkken/kit#8917): drawn over the base, it reads the base's
// cells back as roles, lays the theme host's frame of the moment over them and puts it on the canvas.
// The host counts in ticks — `tick = floor((at_ms - start_ms) / TICK_MS)` — so the layer changes on each
// tick's boundary, and the same moment is the same cells however many frames were skipped. The theme is
// built (its helpers and the factory's precomputed tables) once per base and layout, not per frame.

const { TICK_MS } = run_board_theme_host_state
const { frame_of, part_frame_of, part_of } = run_board_theme_host_frame
const { end_part, factory_of, is_own_level, tick_at, timeline_at } = run_board_theme_run
const KEY_JOIN = '\u{0}'

// What a layer last built for: the base, the theme, the canvas's size and the ROW's lane.
interface Memo {
	key: string | undefined
	built: Built | undefined
}

function key_of(run: ThemeRun, view: LayoutView, canvas: Cells): string {
	const size = `${String(canvas.rows)}x${String(canvas.columns)}`

	// The dated clocks change once a minute: the theme is built again, so its time readouts keep up.
	return [run.value, size, view.row_key ?? '', ...(view.dated_clocks ?? [])].join(KEY_JOIN)
}

// `module` with its draw telling the run once the state it drew says no event plays, so demo mode's
// footer reads the frame's own state and none is built for it.
function watched(run: ThemeRun, module: ThemeModule): ThemeModule {
	return {
		...module,
		draw: (grid, state, tick) => {
			module.draw(grid, state, tick)
			if (module.playing?.(state) === false) run_board_theme_run.demo_over(run)
		},
	}
}

// The theme built over `canvas`, which holds the base: none without a theme or a layout.
function build(run: ThemeRun, view: LayoutView, canvas: Cells, key: string): Built | undefined {
	const factory = factory_of(run)

	if (factory === undefined) return undefined
	const board = run_board_theme_roles.grid_of(canvas)
	const layout = run_board_theme_layout.layout_of(view, board, canvas)

	if (layout === undefined) return undefined
	run_board_theme_layout.edit_board(board, layout, view)
	const api = run_board_theme_host_api.theme_api_of(layout, board)

	return { key, layout, api, module: watched(run, factory(api)) }
}

// The theme for this base, built once; the run keeps the last one built for its parts and events.
function built_of(memo: Memo, run: ThemeRun, view: LayoutView, canvas: Cells): Built | undefined {
	const key = key_of(run, view, canvas)

	if (memo.key === key) return memo.built
	memo.key = key
	memo.built = build(run, view, canvas, key)
	// None built — no layout fits the base — leaves the run none, so no part is timed by a stale one.
	run.built = memo.built

	return memo.built
}

// The part playing at `at_ms` and its tick: an ending holds its last frame once through; an opening
// through ends, giving the board back, as does an ending a demo key played.
function part_at(
	run: ThemeRun,
	built: Built,
	at_ms: number,
): { name: PartName; tick: number } | undefined {
	const { part } = run

	if (part === undefined) return undefined
	part.start_ms ??= at_ms
	const { ticks } = part_of(built.module, built.layout, part.name)
	const tick = Math.max(0, Math.floor((at_ms - part.start_ms) / TICK_MS))

	const is_on = tick < ticks || !run_board_theme_run.is_passing(part)

	if (is_on) return { name: part.name, tick: Math.min(tick, ticks - 1) }
	end_part(run)

	return undefined
}

// The timeline drawn at `tick`, carrying the board's real level while no event plays (Issue 4-3): the
// theme draws its own indicator either way, showing that level where its indicator carries one.
function leveled(run: ThemeRun, tick: number): ThemeTimeline {
	const timeline = timeline_at(run, tick)

	if (is_own_level(run, tick) || run.level === undefined) return timeline

	return { ...timeline, level: run.level }
}

// The frame at `at_ms`: the part playing, else the board on its timeline.
function frame_at(run: ThemeRun, built: Built, at_ms: number): FinalGrid {
	const part = part_at(run, built, at_ms)

	if (part !== undefined) return part_frame_of(built.module, built.api, part.name, part.tick)
	const tick = tick_at(run, at_ms)

	return frame_of(built.module, built.api, leveled(run, tick), tick)
}

// The theme layer over `screen`'s base for the second `view` was laid out in, drawn `delay` behind the
// moment — the sound output's delay, so the picture lands with the sounds started on time and every
// effect's timing shifts together (joshuafolkken/kit#9087); none by default.
function theme_layer(run: ThemeRun, view: LayoutView, delay: () => number = () => 0): Layer {
	// One layer is drawn over one second's base, so what it built holds for the whole of its second.
	const memo: Memo = { key: undefined, built: undefined }

	return {
		is_decor: true,
		next_change_ms: (now_ms) => {
			const delay_ms = delay()

			return run_board_theme_run.next_tick_ms(run, now_ms - delay_ms) + delay_ms
		},
		draw: (canvas, at_ms) => {
			const built = built_of(memo, run, view, canvas)

			if (built === undefined) return
			// A part starts in sound time, as its sound does; only the picture trails it.
			if (run.part !== undefined) run.part.start_ms ??= at_ms
			run_board_theme_canvas.put_frame(canvas, frame_at(run, built, at_ms - delay()))
		},
	}
}

// The part playing and how far into it a moment is.
interface Since {
	name: PartName
	since_ms: number
}

// How far into the part playing `at_ms` is — the launch's opening, demo mode's `q`, or the ending; none
// out of a part.
function part_since(run: ThemeRun, at_ms: number): Since | undefined {
	const { part } = run

	if (part?.start_ms === undefined) return undefined

	return { name: part.name, since_ms: at_ms - part.start_ms }
}

// The letters the part `name` types: the opening's are its theme's intro's; the ending's its own
// (`ThemePart.typing`), none where it types none.
function part_typing(run: ThemeRun, name: PartName): OpeningSound {
	const { built } = run

	if (name === 'opening') return run.opening_sound(run.value)
	if (built === undefined) return run_board_theme_sound.SILENT

	return part_of(built.module, built.layout, name).typing ?? run_board_theme_sound.SILENT
}

// The one-shot sounds a frame starts: through an opening its part's alone; else each event and part
// that started — an ending's board events keep sounding.
function sound_starts(
	run: ThemeRun,
	trill: Pick<TypingSound, 'event' | 'part'> | undefined,
	at_ms: number,
	since: Since | undefined,
): void {
	if (since?.name === 'opening') {
		run_board_theme_notice_sound.sound_part(run, trill)

		return
	}

	run_board_theme_notice_sound.sound_events(run, trill, at_ms)
}

type FrameTrill = Pick<TypingSound, 'set' | 'typed' | 'event' | 'part' | 'flush'>

// The typing a frame sounds: the trill of the typing on screen — the board's own, or in demo mode the
// demo's (`run-board-theme-demo-sound.ts`) — and through a part the letters it types; an opening
// sounds its own letters alone, an ending the board's with its own.
function sound_typing(
	run: ThemeRun,
	trill: FrameTrill | undefined,
	since: Since | undefined,
	typing: ReturnType<typeof run_board_theme_demo_sound.heard>,
): void {
	if (since === undefined) {
		trill?.set(typing.is_on, typing.left_ms)

		return
	}

	const at = { last_ms: run.sound_ms, since_ms: since.since_ms }
	// The board is not on screen through the opening: its rows' typing sounds nothing under it.
	const board = since.name === 'opening' ? run_board_theme_demo_sound.SILENT : typing

	run_board_theme_sound.sounded(trill, part_typing(run, since.name), at, board)
	run.sound_ms = since.since_ms
}

// What a frame sounds (joshuafolkken/kit#8917). Its event and part sounds are ranked first — a cut
// hushes at once — then its typing starts, then the ranked sounds start with `flush`, so the typing is
// never behind them in the same frame (joshuafolkken/kit#9087).
function after_frame(
	run: ThemeRun,
	trill: FrameTrill | undefined,
	at_ms: number,
	board: Typing,
): void {
	const typing = run_board_theme_demo_sound.heard(run, at_ms, board)
	const since = part_since(run, at_ms)

	sound_starts(run, trill, at_ms, since)
	sound_typing(run, trill, since, typing)
	trill?.flush?.()
}

const run_board_theme_layer = { after_frame, theme_layer }

export { run_board_theme_layer }
