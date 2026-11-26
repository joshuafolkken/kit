import { run_board_sound_codec } from './run-board-sound-codec'
import { run_board_sound_nixie } from './run-board-sound-nixie'
import type { Palette } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_skynet } from './run-board-sound-skynet'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'

// The other boards' palettes (joshuafolkken/kit#8917): codec's radio static and radar, nixie's relays and
// clear tubes, skynet's low square pulses and HUD pips, magi's slow two-tone alarm. A work's sounds made
// for it before (`run-board-sound-<work>.ts`) are kept as its call, typed end and clicks. Each is the
// kind and texture of its work's sound, never a melody or a figure of notes from it.

/* eslint-disable @typescript-eslint/no-magic-numbers -- a palette is its numbers: hz, ms and peaks */

const { beep, hiss, rest } = run_board_sound_voice

function one(peak: number, ...segments: Sound['layers'][number]): Sound {
	return { peak, layers: [segments] }
}

function made(peak: number, samples: () => Array<number>): Sound {
	return one(peak, { samples })
}

// A made sound twice, a short rest between.
function twice(samples: () => Array<number>): Sound['layers'][number] {
	return [{ samples }, rest(60), { samples }]
}

// magi's letter: a hard, short, lowish click.
function magi_click(): Array<number> {
	return run_board_sound_voice.sound_samples({
		peak: 1,
		layers: [[beep(520, 8, 'square', { decay_ms: 3 })], [hiss(4, 2, 3)]],
	})
}

// magi's typing: the hard click once a letter at `letter_ms`.
function magi_typing_wav(letter_ms: number, directory?: string): string | undefined {
	const voice = { name: 'magi-typing', peak: 0.14, part: magi_click }

	return run_board_sound_shape.typing_wav(voice, letter_ms, directory)
}

const CODEC: Palette = {
	name: 'codec',
	notice: {
		call: made(0.16, run_board_sound_codec.call),
		bed: {
			peak: 0.06,
			from_gain: 0.5,
			drone: { wave: 'noise', hz: 0, to_hz: 0 },
			pulse: { wave: 'sine', hz: 1200, to_hz: 1500, ms: 15, every_ms: 500, to_every_ms: 250 },
		},
		peak: one(0.22, beep(2800, 120, 'sine', { decay_ms: 60 })),
		blink: one(0.14, beep(2000, 30, 'sine')),
		close: {
			peak: 0.12,
			layers: [[{ samples: run_board_sound_codec.burst }], [beep(900, 80, 'sine')]],
		},
	},
	row: {
		start: one(0.11, beep(1600, 200, 'sine', { decay_ms: 120 })),
		during: {
			peak: 0.06,
			from_gain: 1,
			pulse: {
				wave: 'sine',
				hz: 1600,
				to_hz: 1600,
				alt_hz: 900,
				ms: 40,
				every_ms: 300,
				to_every_ms: 300,
			},
		},
		end: made(0.1, run_board_sound_codec.burst),
	},
	progress_end: made(0.09, run_board_sound_codec.burst),
	appear: one(0.1, beep(1200, 40, 'sine'), rest(40), beep(1600, 60, 'sine')),
	vanish: one(0.1, hiss(300, 150, 7)),
}

const NIXIE: Palette = {
	name: 'nixie',
	notice: {
		call: made(0.16, run_board_sound_nixie.rise),
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'triangle', hz: 60, to_hz: 240 },
			pulse: { wave: 'noise', hz: 0, to_hz: 0, ms: 6, every_ms: 400, to_every_ms: 150 },
		},
		peak: {
			peak: 0.22,
			layers: [
				[beep(1568, 300, 'sine', { decay_ms: 200 })],
				[beep(3136, 300, 'sine', { decay_ms: 120 })],
			],
		},
		blink: made(0.14, run_board_sound_nixie.click),
		close: made(0.12, run_board_sound_nixie.settle),
	},
	row: {
		start: one(0.11, ...twice(run_board_sound_nixie.click)),
		during: {
			peak: 0.05,
			from_gain: 1,
			pulse: { wave: 'noise', hz: 0, to_hz: 0, ms: 5, every_ms: 45, to_every_ms: 45, jitter: 0.3 },
		},
		end: one(0.11, beep(2093, 150, 'sine', { decay_ms: 80 })),
	},
	progress_end: made(0.09, run_board_sound_nixie.settle),
	appear: made(0.1, run_board_sound_nixie.settle),
	vanish: one(0.1, beep(240, 400, 'triangle', { to_hz: 60, decay_ms: 250 })),
}

const SKYNET: Palette = {
	name: 'skynet',
	notice: {
		call: made(0.16, run_board_sound_skynet.alarm),
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			pulse: { wave: 'square', hz: 100, to_hz: 140, ms: 80, every_ms: 500, to_every_ms: 500 },
		},
		peak: one(0.22, beep(90, 400, 'square', { decay_ms: 250 })),
		blink: one(0.14, beep(2400, 25, 'sine')),
		close: one(0.12, beep(140, 200, 'square', { decay_ms: 150 })),
	},
	row: {
		start: one(0.11, beep(2400, 20, 'sine')),
		during: {
			peak: 0.06,
			from_gain: 1,
			pulse: { wave: 'sine', hz: 2400, to_hz: 2400, ms: 12, every_ms: 400, to_every_ms: 70 },
		},
		end: one(0.11, beep(110, 220, 'square', { decay_ms: 150 })),
	},
	progress_end: made(0.09, run_board_sound_skynet.buzz),
	appear: one(0.1, ...twice(run_board_sound_skynet.blip)),
	vanish: one(0.1, beep(220, 500, 'square', { to_hz: 55, decay_ms: 300 })),
}

// magi: a hard, short, lowish click a letter; a short confirming pair; a slow alarm of two tones.
const MAGI_HIGH = 880
const MAGI_LOW = 660
const MAGI_CONFIRM: Sound = one(
	0.1,
	beep(1046, 40, 'sine'),
	beep(1318, 50, 'sine', { decay_ms: 40 }),
)

const MAGI: Palette = {
	name: 'magi',
	notice: {
		call: one(
			0.16,
			beep(MAGI_HIGH, 350, 'triangle'),
			beep(MAGI_LOW, 350, 'triangle'),
			beep(MAGI_HIGH, 350, 'triangle'),
			beep(MAGI_LOW, 350, 'triangle'),
		),
		bed: {
			peak: 0.07,
			from_gain: 0.5,
			pulse: {
				wave: 'triangle',
				hz: MAGI_HIGH,
				to_hz: MAGI_HIGH,
				alt_hz: MAGI_LOW,
				ms: 200,
				every_ms: 400,
				to_every_ms: 250,
			},
		},
		peak: {
			peak: 0.22,
			layers: [
				[beep(MAGI_HIGH, 400, 'triangle'), beep(MAGI_LOW, 400, 'triangle', { decay_ms: 300 })],
				[beep(110, 800, 'square', { decay_ms: 400 })],
			],
		},
		blink: { ...MAGI_CONFIRM, peak: 0.14 },
		close: one(0.12, beep(1318, 80, 'sine'), beep(1046, 160, 'sine', { decay_ms: 100 })),
	},
	row: {
		start: { ...MAGI_CONFIRM, peak: 0.11 },
		during: {
			peak: 0.06,
			from_gain: 1,
			pulse: {
				wave: 'triangle',
				hz: 600,
				to_hz: 1100,
				alt_hz: 1100,
				ms: 60,
				every_ms: 160,
				to_every_ms: 160,
			},
		},
		end: {
			peak: 0.11,
			layers: [
				[beep(1100, 250, 'sine', { decay_ms: 150 })],
				[beep(1650, 250, 'sine', { decay_ms: 150 })],
			],
		},
	},
	progress_end: MAGI_CONFIRM,
	appear: MAGI_CONFIRM,
	vanish: one(0.1, beep(MAGI_HIGH, 500, 'triangle', { to_hz: 220, decay_ms: 300 })),
}

// magi's typed end: the confirming pair.
function magi_typed_wav(directory?: string): string | undefined {
	const render = run_board_sound_voice.sound_samples.bind(undefined, MAGI_CONFIRM)

	return run_board_sound_shape.voice_wav(
		{ name: 'magi-typed', key: '', peak: MAGI_CONFIRM.peak, render },
		directory,
	)
}

const run_board_sound_palettes_more = {
	CODEC,
	MAGI,
	NIXIE,
	SKYNET,
	magi_typed_wav,
	magi_typing_wav,
}

export { run_board_sound_palettes_more }
