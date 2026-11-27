import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_enter } from './run-board-sound-enter'
import { run_board_sound_score, type Palette } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'
import { run_board_sound_wopr } from './run-board-sound-wopr'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_wopr } from './run-board-theme-wopr'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'

// The film boards' palettes (joshuafolkken/kit#8917): wopr's old terminal beeps and machine hum, trace's
// thin falling electronics, flux's electric crackle and rising whine. Each is the kind and texture of
// its work's sound, never a melody or a figure of notes from it.

/* eslint-disable @typescript-eslint/no-magic-numbers -- a palette is its numbers: hz, ms and peaks */

const { beep, hiss, rest, sound_samples, sample_at, add_into } = run_board_sound_voice
const { scaled } = run_board_sound_score
const { silence } = run_board_sound_shape
const { TICK_MS } = run_board_theme_host_state
const { WAR_START, CLOSE_FROM, CLOSE_TYPED, EFFECT_END } = run_board_theme_wopr_phase

function one(peak: number, ...segments: Sound['layers'][number]): Sound {
	return { peak, layers: [segments] }
}

// wopr: the terminal's single square beep, the same pitch thrice to call.
const WOPR_BEEP = 880
const WOPR_FLASH: Sound = one(0.14, hiss(220, 90, 41))
const WOPR_TABLE: Sound = one(0.05, beep(1500, 20, 'square', { decay_ms: 12 }))
const WOPR_TYPE: Sound = one(0.09, beep(932, 25, 'sine'), beep(1175, 25, 'sine'))
// joshuafolkken/kit#8917: the teletype's typed end — a line typed through, a short pip and the carriage
// falling back — sounded wherever wopr types a line (its opening, its ending, its NOTICE's last lines).
const WOPR_TYPED: Sound = one(
	0.1,
	beep(1175, 30, 'sine'),
	rest(40),
	beep(587, 120, 'sine', { decay_ms: 80 }),
)
const WOPR_TYPE_EVERY_MS = 2 * TICK_MS
const WOPR_TABLE_EVERY_MS = 150

// Sounds of `sound` from `from_ms` to `to_ms`, `every(ms)` apart, into `out`.
function strewn(
	out: Array<number>,
	sound: Sound,
	span: [number, number],
	every: (at_ms: number) => number,
): void {
	const samples = scaled(sound_samples(sound), sound.peak)
	const [from_ms, to_ms] = span

	for (let at_ms = from_ms; at_ms < to_ms; at_ms += every(at_ms)) {
		add_into(out, samples, sample_at(at_ms))
	}
}

// wopr after its peak, from the peak on: the war's white flashes, ever closer, with the table's short
// beeps under them, then the last three lines typed in the terminal's pips while they type, and the
// typed end once they are through.
function wopr_after_peak(): Array<number> {
	const war: [number, number] = [WAR_START * TICK_MS, CLOSE_FROM * TICK_MS]
	const typed_ms = CLOSE_TYPED * TICK_MS
	const out = silence(EFFECT_END * TICK_MS)
	const random = run_board_sound_click.seeded(1983)
	const [war_from, war_to] = war

	// The flashes come closer as the war goes on, their gaps shrinking to under a third.
	strewn(out, WOPR_FLASH, war, (at_ms) => {
		const share = (at_ms - war_from) / (war_to - war_from)

		return (900 - 650 * share) * (0.5 + random())
	})
	strewn(out, WOPR_TABLE, war, () => WOPR_TABLE_EVERY_MS)
	strewn(out, WOPR_TYPE, [war_to, typed_ms], () => WOPR_TYPE_EVERY_MS)
	add_into(out, scaled(sound_samples(WOPR_TYPED), WOPR_TYPED.peak), sample_at(typed_ms))

	return out
}

// wopr's typed end as a WAV, the theme row's `typed_end`.
function wopr_typed_wav(directory?: string): string | undefined {
	const render = sound_samples.bind(undefined, WOPR_TYPED)

	return run_board_sound_shape.voice_wav(
		{ name: 'wopr-typed', key: '', peak: WOPR_TYPED.peak, render },
		directory,
	)
}

const WOPR: Palette = {
	name: 'wopr',
	notice: {
		call: one(
			0.16,
			beep(WOPR_BEEP, 140, 'square'),
			rest(110),
			beep(WOPR_BEEP, 140, 'square'),
			rest(110),
			beep(WOPR_BEEP, 140, 'square'),
		),
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'triangle', hz: 55, to_hz: 70 },
			pulse: {
				wave: 'square',
				hz: 1200,
				to_hz: 1200,
				ms: 25,
				every_ms: 420,
				to_every_ms: 180,
				jitter: 0.8,
			},
		},
		peak: {
			peak: 0.22,
			layers: [[hiss(600, 220, 77)], [beep(70, 500, 'sine', { to_hz: 40, decay_ms: 250 })]],
		},
		close: one(0.13, beep(440, 260, 'square', { decay_ms: 180 })),
		ms: run_board_theme_wopr.NOTICE_LASTS * TICK_MS,
		after_peak: wopr_after_peak,
		// joshuafolkken/kit#9137: the build keeps `bed`'s drone at the level it has there (half the
		// bed's peak) and plays the tic-tac-toe beeps and the lock's two notes as cues, in place of
		// `bed`'s pulse train.
		build: { peak: 0.04, from_gain: 0.5, drone: { wave: 'triangle', hz: 55, to_hz: 70 } },
		cues: run_board_sound_wopr.notice_cues(),
	},
	// joshuafolkken/kit#9137: the lock's high note starts a ROW and its low note ends it; the game's
	// moves beep over the noise, which keeps the level it had under the former pulse (half the bed's).
	row: {
		start: run_board_sound_wopr.LOCK_HIGH,
		during: { peak: 0.035, from_gain: 1, drone: { wave: 'noise', hz: 0, to_hz: 0 } },
		end: run_board_sound_wopr.LOCK_LOW,
		beats: run_board_sound_wopr.row_beats,
	},
	appear: one(0.1, beep(WOPR_BEEP, 60, 'square'), rest(60), beep(1320, 80, 'square')),
	vanish: one(0.1, beep(440, 250, 'square', { to_hz: 220, decay_ms: 150 })),
}

// trace: thin sine falling from high, droplets of noise running down.
const TRACE: Palette = {
	name: 'trace',
	notice: {
		call: {
			peak: 0.16,
			layers: [
				[beep(2400, 450, 'sine', { to_hz: 600, decay_ms: 300 })],
				[beep(3600, 450, 'triangle', { to_hz: 900, decay_ms: 200 })],
			],
		},
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'noise', hz: 0, to_hz: 0 },
			pulse: {
				wave: 'sine',
				hz: 3000,
				to_hz: 1500,
				ms: 10,
				every_ms: 80,
				to_every_ms: 30,
				jitter: 0.8,
			},
		},
		peak: { peak: 0.22, layers: [[beep(60, 350, 'sine', { decay_ms: 200 })], [hiss(80, 30, 5)]] },
		blink: one(0.14, beep(3200, 40, 'sine', { decay_ms: 25 })),
		close: one(0.12, beep(1600, 400, 'sine', { to_hz: 400, decay_ms: 250 })),
	},
	row: {
		start: one(0.11, beep(2000, 150, 'sine', { to_hz: 900, decay_ms: 100 })),
		during: {
			peak: 0.05,
			from_gain: 1,
			pulse: { wave: 'noise', hz: 0, to_hz: 0, ms: 6, every_ms: 45, to_every_ms: 35, jitter: 0.7 },
		},
		end: one(0.1, beep(1800, 50, 'sine'), beep(2400, 70, 'sine', { decay_ms: 50 })),
	},
	appear: one(0.1, beep(1200, 200, 'sine', { to_hz: 2400, decay_ms: 150 })),
	vanish: one(0.1, beep(2400, 500, 'sine', { to_hz: 300, decay_ms: 300 })),
}

// flux: an electric crackle, a whine climbing as it speeds up.
const FLUX: Palette = {
	name: 'flux',
	notice: {
		call: {
			peak: 0.16,
			layers: [
				[hiss(25, 8, 11), rest(30), hiss(25, 8, 12), rest(30), hiss(25, 8, 13)],
				[rest(90), beep(300, 400, 'triangle', { to_hz: 1200 })],
			],
		},
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'triangle', hz: 80, to_hz: 320 },
			pulse: { wave: 'noise', hz: 0, to_hz: 0, ms: 10, every_ms: 260, to_every_ms: 60 },
		},
		peak: {
			peak: 0.22,
			layers: [[hiss(400, 150, 88)], [beep(320, 300, 'triangle', { to_hz: 80 })]],
		},
		blink: one(0.14, beep(1400, 35, 'square', { decay_ms: 20 })),
		close: one(0.12, beep(600, 300, 'triangle', { to_hz: 200, decay_ms: 200 })),
	},
	row: {
		start: one(0.11, hiss(30, 10, 21)),
		during: {
			peak: 0.06,
			from_gain: 1,
			drone: { wave: 'triangle', hz: 100, to_hz: 180 },
			pulse: { wave: 'noise', hz: 0, to_hz: 0, ms: 15, every_ms: 110, to_every_ms: 110 },
		},
		end: one(0.1, beep(900, 80, 'triangle', { decay_ms: 50 })),
	},
	progress_end: one(0.1, { samples: run_board_sound_enter.enter_samples }),
	appear: one(0.1, hiss(30, 10, 31), beep(400, 250, 'triangle', { to_hz: 1600 })),
	vanish: one(0.1, beep(1600, 600, 'triangle', { to_hz: 100, decay_ms: 300 })),
}

const run_board_sound_palettes_film = { FLUX, TRACE, WOPR, wopr_typed_wav }

export { run_board_sound_palettes_film }
