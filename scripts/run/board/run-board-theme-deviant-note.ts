import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_tables } from './run-board-theme-deviant-tables'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, ThemeState } from './run-board-theme-host-types'

// The deviant theme's small notices, the corner notices the game shows most: one line on the
// THROUGHPUT rule, left of the level, fading in over a few ticks, held two seconds, fading out. The
// theme keeps nothing between frames, so each is read off the state of the tick:
// - `∧ SOFTWARE INSTABILITY` (red chevron) as a NOTICE's wall starts; and, with no event playing,
//   for its length in every `NOTE.every` ticks while the board's level stands above calm — the
//   moment the level rose is not in the state;
// - `∨ SOFTWARE INSTABILITY` (cyan chevron) over a NOTICE's last ticks and on past its end — a level
//   back at calm reads as rest, so its fall is not in the state either;
// - `▣ PATH UNLOCKED` from the tick a ROW has typed;
// - `◇ ANALYSIS COMPLETE` from the tick a PROGRESS has typed.

const { code_points, put } = run_board_theme_host_grid
const { NOTICE_END } = run_board_theme_host_state
const { RGB, STRESS, WALL } = run_board_theme_deviant_data
const { bold, ink, mix } = run_board_theme_deviant_parts
const { NOTE } = run_board_theme_deviant_tables

const NOTE_TICKS = NOTE.fade + NOTE.hold + NOTE.fade
// The falling notice starts this many ticks after a NOTICE's peak.
const FALL_FROM = NOTICE_END - NOTE.fall_lead

// A notice `age` ticks old: its sign in its own color and its words.
interface Note {
	age: number
	sign: string
	color: string
	words: string
}

function is_showing(age: number): boolean {
	return age >= 0 && age < NOTE_TICKS
}

// The ticks since `typed` finished; -1 while it types or before any.
function ended(typed: Channel): number {
	return typed.index >= 0 && !typed.is_typing ? typed.cooled : -1
}

// A NOTICE's two notices: the rise as its wall starts, the fall as it ends.
function notice_notes(state: ThemeState): Array<Note> {
	const { notice, tick } = state
	const risen = notice.index >= 0 ? tick - notice.start - WALL.from : -1
	const { words } = NOTE

	return [
		{ age: risen, sign: NOTE.up, color: RGB.red, words },
		{ age: ended(notice) - FALL_FROM, sign: NOTE.down, color: RGB.cyan, words },
	]
}

// The rise again while the board's level stands above calm, on its period.
function level_note(state: ThemeState): Note {
	const { level } = state.event
	const is_raised = level !== undefined && level < STRESS.calm
	const age = is_raised ? state.tick % NOTE.every : -1

	return { age, sign: NOTE.up, color: RGB.red, words: NOTE.words }
}

// The notice of the tick, the rarer event's first; none while none shows.
function note_of(state: ThemeState): Note | undefined {
	const notes: Array<Note> = [
		...notice_notes(state),
		{ age: ended(state.row), sign: NOTE.path_sign, color: RGB.blue, words: NOTE.path },
		{ age: ended(state.progress), sign: NOTE.done_sign, color: RGB.cyan, words: NOTE.done },
		level_note(state),
	]

	return notes.find(({ age }) => is_showing(age))
}

// How much of a notice shows `age` ticks in: up over the fade, whole through the hold, down again.
function shown(age: number): number {
	return Math.min(1, (age + 1) / NOTE.fade, (NOTE_TICKS - age) / NOTE.fade)
}

// The notice on the THROUGHPUT rule, a cell clear of the level; given up where the rule is too short.
function note(draw: ThemeDraw): void {
	const { api, grid, s } = draw
	const found = note_of(s)
	const { level_spot } = api.layout

	if (!found) return
	const share = shown(found.age)
	const text = ` ${found.sign} ${found.words} `
	const x = level_spot.x - NOTE.gap - code_points(text).length

	if (x < NOTE.min_x) return
	put(grid, { y: level_spot.y, x }, text, ink(mix(RGB.night, RGB.text, share)))
	put(grid, { y: level_spot.y, x: x + 1 }, found.sign, bold(mix(RGB.night, found.color, share)))
}

const run_board_theme_deviant_note = { note }

export { run_board_theme_deviant_note }
