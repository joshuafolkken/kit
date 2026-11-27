import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_score, type Cue } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Segment, type Sound } from './run-board-sound-voice'
import { run_board_sound_wopr, type Note, type Overtone } from './run-board-sound-wopr'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_wopr_alarm } from './run-board-theme-wopr-alarm'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_parts } from './run-board-theme-wopr-parts'

// The wopr theme's command-room voices, each from values measured on the film's audio
// (joshuafolkken/kit#9137): NORAD's beep, the cabinet's ambience, the alarm's drone, the tone
// tic-tac-toe ends on and the tick of the code spinning. Every voice is computed, none recorded.

const { scaled } = run_board_sound_score
const { SAMPLE_RATE, silence } = run_board_sound_shape
const { add_into, rest, sample_at } = run_board_sound_voice
const { BUILD_GAP_TICKS, GAME, build_cues, flat_note, note_samples, sound_of } =
	run_board_sound_wopr
const { PEAK_TICKS, TICK_MS } = run_board_theme_host_state
const { ALARM } = run_board_theme_wopr_alarm
const { MATCHED_AT } = run_board_theme_wopr_led
const { BEATS } = run_board_theme_wopr_parts
const { LOCK_HIGH, LOCK_LOW } = run_board_sound_wopr

const RADIANS_PER_CYCLE = Math.PI + Math.PI
const NOISE_SPAN = 2

// NORAD's beep (measured): one long note of several pitches, then `shorts` short ones of one pitch,
// `every_ms` apart, every note flat. The long note's partials' levels are not measured: equal
// (invented), as is the rest before the first short note, the one between the short ones. Each short
// note is the middle of its measured length's range.
const CALL_LONG: ReadonlyArray<Overtone> = [
	{ hz: 1905, level: 0 },
	{ hz: 2380, level: 0 },
	{ hz: 2740, level: 0 },
	{ hz: 2860, level: 0 },
]
const CALL_SHORT: ReadonlyArray<Overtone> = [{ hz: 4090, level: 0 }]
const CALL = { long_ms: 770, short_ms: 275, every_ms: 440, shorts: 3, peak: 0.16 }

// The cabinet's ambience (measured): a hum inside a rumble of noise under `rumble_hz`, and a tick as
// a pair `pair_ms` apart every `every_ms`. Invented: the rumble's and the tick's levels beside the
// hum's, how steeply the noise is cut (`poles`), where the first pair falls, the fade at both ends.
const ROOM = {
	hum_hz: 125,
	rumble_hz: 190,
	rumble: 0.6,
	poles: 4,
	tick_ms: 24,
	tick: 0.5,
	pair_ms: 210,
	every_ms: 2600,
	first_ms: 1300,
	fade_ms: 5,
	seed: 9137,
}
const ROOM_TICK: ReadonlyArray<Overtone> = [{ hz: 2120, level: 0 }]

// The alarm's drone (measured under dialogue, low confidence): its pitch and harmonics. Invented: the
// harmonics' levels, its rise and fall, its peak, and its on and off — the beacon's turn
// (`run-board-theme-wopr-alarm.ts`), since the film's pattern could not be told apart.
const DRONE_PARTIALS: ReadonlyArray<Overtone> = [
	{ hz: 416, level: 0 },
	{ hz: 832, level: -6 },
	{ hz: 1248, level: -10 },
	{ hz: 1660, level: -14 },
	{ hz: 2080, level: -18 },
]
const DRONE = { edge_ms: 20, peak: 0.05 }

// The tone tic-tac-toe ends on (measured): near-square, held without a break. Invented: the
// harmonics' levels (the odd ones a square's, the even ones well under them) and its peak. It fills the
// build from its last beep's end to the peak, far shorter than the film's.
const FINALE_PARTIALS: ReadonlyArray<Overtone> = [
	{ hz: 640, level: 0 },
	{ hz: 1280, level: -20 },
	{ hz: 1920, level: -9.5 },
	{ hz: 2560, level: -24 },
	{ hz: 3200, level: -14 },
	{ hz: 3840, level: -28 },
]
const FINALE = { peak: 0.06 }

// The code spinning (measured): a faint tick every `every_ms`, the middle of the measured range.
// Invented: the tick's length and its peak.
const SPIN_TICK: ReadonlyArray<Overtone> = [{ hz: 4930, level: 0 }]
const SPIN = { every_ms: 37, tick_ms: 6, peak: 0.015 }

// The notice's blink (no measurement: invented): NORAD's short note, cut shorter, on each bar.
const BLINK = { ms: 140, peak: 0.12 }
// The opening's and the ending's one-shots (no measurement: every choice and value invented): the
// lock's two notes and the cabinet's tick pair, on the ticks those parts draw something new
// (`run-board-theme-wopr-parts.ts` → `BEATS`), the notes no louder than `note_peak`.
const PART = { note_peak: 0.08, tick_peak: 0.06 }

// A note at full level, so notes of different partials laid end to end are as loud as one another.
function level_note(note: Note): Segment {
	return { samples: () => scaled(note_samples(note), 1) }
}

function call_sound(): Sound {
	const gap = rest(CALL.every_ms - CALL.short_ms)
	const short = level_note(flat_note(CALL_SHORT, CALL.short_ms))
	const shorts = Array.from({ length: CALL.shorts }, () => [gap, short]).flat()

	return { peak: CALL.peak, layers: [[level_note(flat_note(CALL_LONG, CALL.long_ms)), ...shorts]] }
}

function blink_sound(): Sound {
	return sound_of(flat_note(CALL_SHORT, BLINK.ms), BLINK.peak)
}

// The cabinet's tick as its pair, alone.
function tick_pair(): Sound {
	const tick = level_note(flat_note(ROOM_TICK, ROOM.tick_ms))

	return { peak: PART.tick_peak, layers: [[tick, rest(ROOM.pair_ms - ROOM.tick_ms), tick]] }
}

function at_tick(tick: number, sound: Sound): Cue {
	return { at_ms: tick * TICK_MS, sound: { ...sound, peak: Math.min(sound.peak, PART.note_peak) } }
}

// The opening: the lock's high note as its first line appears, its low note as the board starts to be
// written.
function opening_cues(): Array<Cue> {
	return [at_tick(0, LOCK_HIGH), at_tick(BEATS.reveal, LOCK_LOW)]
}

// The ending: the lock's low note as the screen goes dark, its high note as the last line starts, the
// cabinet's tick pair as the screen empties.
function ending_cues(): Array<Cue> {
	return [
		at_tick(BEATS.dark, LOCK_LOW),
		at_tick(BEATS.words, LOCK_HIGH),
		at_tick(BEATS.empty, tick_pair()),
	]
}

// `signal` through one low-pass pole at `hz`.
function low_passed(signal: ReadonlyArray<number>, hz: number): Array<number> {
	const share = 1 - Math.exp((-RADIANS_PER_CYCLE * hz) / SAMPLE_RATE)
	let held = 0

	return signal.map((value) => {
		held += share * (value - held)

		return held
	})
}

// Noise under the rumble's ceiling, `count` samples, at the rumble's level.
function rumble(count: number): Array<number> {
	const random = run_board_sound_click.seeded(ROOM.seed)
	let signal = Array.from({ length: count }, () => random() * NOISE_SPAN - 1)

	for (let pole = 0; pole < ROOM.poles; pole++) signal = low_passed(signal, ROOM.rumble_hz)

	return scaled(signal, ROOM.rumble)
}

// The tick's pairs laid into `out`, `ms` long.
function lay_ticks(out: Array<number>, ms: number): void {
	const tick = scaled(note_samples(flat_note(ROOM_TICK, ROOM.tick_ms)), ROOM.tick)

	for (let at_ms = ROOM.first_ms; at_ms < ms; at_ms += ROOM.every_ms) {
		add_into(out, tick, sample_at(at_ms))
		add_into(out, tick, sample_at(at_ms + ROOM.pair_ms))
	}
}

// The cabinet's ambience `ms` long: the hum in the rumble, the ticks over them, faded at both ends.
function ambience(ms: number): Array<number> {
	const count = sample_at(ms)
	const fade = sample_at(ROOM.fade_ms)
	const out = rumble(count).map((value, index) => {
		return value + Math.sin((RADIANS_PER_CYCLE * ROOM.hum_hz * index) / SAMPLE_RATE)
	})

	lay_ticks(out, ms)

	return out.map((value, index) => value * Math.min(1, index / fade, (count - 1 - index) / fade))
}

// The alarm's drone from the peak on: a note each turn of the beacon, for as long as it is lit.
function alarm_cues(): Array<Cue> {
	const edge = { attack_ms: DRONE.edge_ms, release_ms: DRONE.edge_ms }
	const note: Note = { partials: DRONE_PARTIALS, ms: ALARM.on * TICK_MS, ...edge }
	const sound = sound_of(note, DRONE.peak)
	const turns = Math.floor(ALARM.ticks / ALARM.turn)
	const from = ALARM.from - PEAK_TICKS + 1

	return Array.from({ length: turns }, (_, turn) => {
		return { at_ms: (from + turn * ALARM.turn) * TICK_MS, sound }
	})
}

// The held tone from the last tic-tac-toe beep's end to the peak.
function finale_cue(): Cue {
	const last = build_cues().at(-1)?.at_ms ?? 0
	const at_ms = last + BUILD_GAP_TICKS * TICK_MS * GAME.share
	const note = flat_note(FINALE_PARTIALS, PEAK_TICKS * TICK_MS - at_ms)

	return { at_ms, sound: sound_of(note, FINALE.peak) }
}

function spin_samples(ms: number): Array<number> {
	const out = silence(ms)
	const tick = note_samples(flat_note(SPIN_TICK, SPIN.tick_ms))

	for (let at_ms = 0; at_ms + SPIN.tick_ms <= ms; at_ms += SPIN.every_ms) {
		add_into(out, tick, sample_at(at_ms))
	}

	return out
}

// The code spinning for `ms` from an event's start.
function spin_cue(ms: number): Cue {
	return { at_ms: 0, sound: { peak: SPIN.peak, layers: [[{ samples: () => spin_samples(ms) }]] } }
}

// The NOTICE's cues before its peak: the build's beeps and the lock's notes, the tick while a position
// still spins, and the held tone the games end on.
function notice_cues(): Array<Cue> {
	return [...run_board_sound_wopr.notice_cues(), spin_cue(MATCHED_AT * TICK_MS), finale_cue()]
}

// A ROW's beats: the game's beeps, and the tick all through — WOPR never gets the code there.
function row_beats(letters: number): Array<Cue> {
	return [...run_board_sound_wopr.row_beats(letters), spin_cue(Math.max(1, letters) * TICK_MS)]
}

const run_board_sound_wopr_norad = {
	alarm_cues,
	ambience,
	blink_sound,
	call_sound,
	ending_cues,
	finale_cue,
	notice_cues,
	opening_cues,
	row_beats,
	spin_cue,
}

export { run_board_sound_wopr_norad }
