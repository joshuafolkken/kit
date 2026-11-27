import type { Cue } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_notice } from './run-board-theme-wopr-notice'
import { run_board_theme_wopr_panel } from './run-board-theme-wopr-panel'
import { run_board_theme_wopr_row } from './run-board-theme-wopr-row'

// The wopr theme's own voices, each from values measured on the film's audio (joshuafolkken/kit#9137):
// the two notes of a launch-code position locking, and the same two pitches alternating as tic-tac-toe
// is played, on the moves the screen shows. Every voice is computed from its partials, none recorded.

const { SAMPLE_RATE } = run_board_sound_shape
const { sample_at } = run_board_sound_voice
const { PEAK_TICKS, TICK_MS } = run_board_theme_host_state
const { MATCHED_AT } = run_board_theme_wopr_led
const { notice_pace } = run_board_theme_wopr_notice
const { game_at } = run_board_theme_wopr_panel
const { ROW_MOVE_TICKS } = run_board_theme_wopr_row

// A sine partial: its pitch, and its level under the note's loudest partial in dB.
interface Overtone {
	hz: number
	level: number
}

// A note: its partials sounding together, its length, the time it rises in, and the time constant its
// level dies away by (none: flat).
interface Note {
	partials: ReadonlyArray<Overtone>
	ms: number
	attack_ms: number
	decay_ms?: number
}

const MS_PER_SECOND = 1000
const RADIANS_PER_CYCLE = Math.PI + Math.PI
const DECADE = 10
const DB_PER_DECADE = 20
const PAIR = 2
// A note is gated off hard (measured); it falls to nothing within this, so the cut does not click
// (invented). A sharp attack rises within `SHARP_MS` (invented).
const RELEASE_MS = 1
const SHARP_MS = 2

// A position locking (measured under music, medium confidence): a high note with odd harmonics, struck
// and falling `HIGH_FALL.level` dB over `HIGH_FALL.over_ms`, and a low, flat, near-square note that
// follows the high's onset by `LOCK.low_after_ms`.
const HIGH_PARTIALS: ReadonlyArray<Overtone> = [
	{ hz: 640, level: 0 },
	{ hz: 1923, level: -15 },
	{ hz: 3206, level: -26 },
]
const LOW_PARTIALS: ReadonlyArray<Overtone> = [
	{ hz: 274, level: 0 },
	{ hz: 824, level: -19 },
	{ hz: 1374, level: -27 },
]
const HIGH_FALL = { level: 10, over_ms: 120 }
const HIGH_DECAY_MS = (HIGH_FALL.over_ms * DB_PER_DECADE) / (HIGH_FALL.level * Math.LN10)
const LOCK = { high_ms: 190, low_ms: 250, low_after_ms: 450, peak: 0.11 }

// Tic-tac-toe (measured under music, medium confidence): the high note struck and the low note flat,
// in turn; a beep is shorter as its interval shrinks. The low note's harmonics are the lock's
// (invented), its length the measured range from the film's fastest pace to its slowest; a beep fills
// at most `share` of its interval (invented), and the peak is invented.
const GAME_LOW_PARTIALS: ReadonlyArray<Overtone> = [
	{ hz: 275, level: 0 },
	{ hz: 825, level: -19 },
	{ hz: 1375, level: -27 },
]
const GAME = {
	pace_ms: { fastest: 170, slowest: 430 },
	high_ms: 200,
	share: 0.8,
	low_ms: { least: 110, most: 240 },
	peak: 0.04,
}
// The NOTICE's build plays its games a move a tick or faster, too close to tell beeps apart: a beep
// lands on a tick that puts marks down, no sooner than this many ticks after the last one (invented).
const BUILD_GAP_TICKS = 2

function amplitude(level: number): number {
	return DECADE ** (level / DB_PER_DECADE)
}

// The note's gain `ms` in: its rise, its hard gate at the end, its decay.
function gain_at(note: Note, ms: number): number {
	const edge = Math.max(0, Math.min(1, ms / note.attack_ms, (note.ms - ms) / RELEASE_MS))

	return note.decay_ms === undefined ? edge : edge * Math.exp(-ms / note.decay_ms)
}

function partials_at(partials: ReadonlyArray<Overtone>, seconds: number): number {
	let value = 0

	for (const { hz, level } of partials) {
		value += amplitude(level) * Math.sin(RADIANS_PER_CYCLE * hz * seconds)
	}

	return value
}

function note_samples(note: Note): Array<number> {
	return Array.from({ length: sample_at(note.ms) }, (_, index) => {
		const seconds = index / SAMPLE_RATE

		return partials_at(note.partials, seconds) * gain_at(note, seconds * MS_PER_SECOND)
	})
}

function sound_of(note: Note, peak: number): Sound {
	return { peak, layers: [[{ samples: () => note_samples(note) }]] }
}

// The struck high note and the flat low one, `ms` long.
function high_note(ms: number): Note {
	return { partials: HIGH_PARTIALS, ms, attack_ms: SHARP_MS, decay_ms: HIGH_DECAY_MS }
}

function low_note(partials: ReadonlyArray<Overtone>, ms: number): Note {
	return { partials, ms, attack_ms: SHARP_MS }
}

const LOCK_HIGH = sound_of(high_note(LOCK.high_ms), LOCK.peak)
const LOCK_LOW = sound_of(low_note(LOW_PARTIALS, LOCK.low_ms), LOCK.peak)

// The low beep's length for moves `every_ms` apart: the longest at the slowest pace, the shortest at
// the fastest.
function game_low_ms(every_ms: number): number {
	const { fastest, slowest } = GAME.pace_ms
	const share = Math.max(0, Math.min(1, (every_ms - fastest) / (slowest - fastest)))

	return GAME.low_ms.least + (GAME.low_ms.most - GAME.low_ms.least) * share
}

// The beep of move `count` (the first is 0) where beeps are `every_ms` apart, no longer than its share
// of that interval: the high note on even moves, the low on odd ones.
function game_beep(count: number, every_ms: number): Sound {
	const room_ms = every_ms * GAME.share
	const low_ms = Math.min(game_low_ms(every_ms), room_ms)
	const high_ms = Math.min(GAME.high_ms, room_ms)
	const note = count % PAIR === 1 ? low_note(GAME_LOW_PARTIALS, low_ms) : high_note(high_ms)

	return sound_of(note, GAME.peak)
}

// The mark the game paced by `pace_of` puts down on `tick`, counted from 1 in its game (the last of
// them where a tick puts down several); 0 where it puts none.
function mark_at(tick: number, pace_of: (game: number) => number): number {
	const play = game_at(tick, pace_of)
	const before = game_at(tick - 1, pace_of)
	const is_new = play.game !== before.game || play.marks !== before.marks

	return is_new && play.phase === 'play' ? play.marks : 0
}

// The build's beep ticks: the ticks its game puts marks down on, thinned to `BUILD_GAP_TICKS` apart,
// each with its game.
function build_beats(): Array<{ tick: number; game: number }> {
	const ticks = Array.from({ length: PEAK_TICKS }, (_, tick) => tick)
	const moves = ticks.filter((tick) => mark_at(tick, notice_pace) > 0)
	const beats: Array<{ tick: number; game: number }> = []
	let next = 0

	for (const tick of moves) {
		if (tick < next) continue
		beats.push({ tick, game: game_at(tick, notice_pace).game })
		next = tick + BUILD_GAP_TICKS
	}

	return beats
}

// The NOTICE's build: a beep on its game's moves from the first one to the peak, so the ear quickens
// as the eye does; each game starts on the high note (X) and its beeps alternate.
function build_cues(): Array<Cue> {
	const beats = build_beats()
	const every_ms = BUILD_GAP_TICKS * TICK_MS

	return beats.map(({ tick, game }, index) => {
		const count = index - beats.findIndex((beat) => beat.game === game)

		return { at_ms: tick * TICK_MS, sound: game_beep(count, every_ms) }
	})
}

// The NOTICE's cues before its peak: the tic-tac-toe beeps, and the lock's high then low note as the
// tenth position locks.
function notice_cues(): Array<Cue> {
	const matched_ms = MATCHED_AT * TICK_MS

	return [
		...build_cues(),
		{ at_ms: matched_ms, sound: LOCK_HIGH },
		{ at_ms: matched_ms + LOCK.low_after_ms, sound: LOCK_LOW },
	]
}

function row_pace(): number {
	return ROW_MOVE_TICKS
}

// A ROW's beats: a beep on each move of the game beside the code, the high note for X and the low
// for O. The ROW's start note is the first move's.
function row_beats(letters: number): Array<Cue> {
	const every_ms = ROW_MOVE_TICKS * TICK_MS
	const cues: Array<Cue> = []

	for (let tick = 1; tick < letters; tick++) {
		const mark = mark_at(tick, row_pace)

		if (mark > 0) cues.push({ at_ms: tick * TICK_MS, sound: game_beep(mark - 1, every_ms) })
	}

	return cues
}

const run_board_sound_wopr = {
	BUILD_GAP_TICKS,
	LOCK_HIGH,
	LOCK_LOW,
	build_cues,
	notice_cues,
	row_beats,
}

export { run_board_sound_wopr }
export type { Note, Overtone }
