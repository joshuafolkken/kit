import type { Palette } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'

// Two more boards' palettes (deviant's is `run-board-sound-palettes-deviant.ts`): isac's triangle pings
// and radio squelch, ghost's high chirps and data noise. Each is the kind and texture of its work's
// sound, never a melody or a figure of notes from it. A board's letter and typed end are sounds of
// its palette, written out as its typing loop and typed-end WAVs by `voices_of`.

/* eslint-disable @typescript-eslint/no-magic-numbers -- a palette is its numbers: hz, ms and peaks */

const { beep, hiss, rest, sound_samples } = run_board_sound_voice

// The WAVs a theme's row in `THEME_DEFS` reads: its typing loop and its typed end.
interface Voices {
	typing_wav: (letter_ms: number, directory?: string) => string | undefined
	typed_wav: (directory?: string) => string | undefined
}

function one(peak: number, ...segments: Sound['layers'][number]): Sound {
	return { peak, layers: [segments] }
}

// A board's voices from two of its sounds: `letter` once a letter, `end` once a line types through.
function voices_of(name: string, letter: Sound, end: Sound): Voices {
	return {
		typing_wav: (letter_ms, directory) => {
			const voice = {
				name: `${name}-typing`,
				peak: letter.peak,
				part: () => sound_samples(letter),
			}

			return run_board_sound_shape.typing_wav(voice, letter_ms, directory)
		},
		typed_wav: (directory) =>
			run_board_sound_shape.voice_wav(
				{ name: `${name}-typed`, key: '', peak: end.peak, render: () => sound_samples(end) },
				directory,
			),
	}
}

// isac: a short triangle pip a letter; a higher one as a line ends.
const ISAC_LETTER: Sound = one(0.12, beep(1100, 12, 'triangle', { decay_ms: 6 }))
const ISAC_END: Sound = one(0.09, beep(1480, 70, 'triangle', { decay_ms: 50 }))
const ISAC_PIP = beep(980, 120, 'square', { decay_ms: 90 })

const ISAC: Palette = {
	name: 'isac',
	notice: {
		call: one(0.16, ISAC_PIP, rest(80), ISAC_PIP, rest(80), ISAC_PIP),
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			pulse: { wave: 'triangle', hz: 700, to_hz: 1000, ms: 60, every_ms: 600, to_every_ms: 180 },
		},
		peak: {
			peak: 0.22,
			layers: [
				[beep(520, 500, 'square', { decay_ms: 350 })],
				[beep(130, 600, 'triangle', { decay_ms: 400 })],
			],
		},
		blink: one(0.14, beep(1400, 35, 'triangle')),
		close: one(0.12, beep(1000, 100, 'triangle'), beep(700, 200, 'triangle', { decay_ms: 140 })),
	},
	row: {
		start: one(0.11, beep(1500, 160, 'sine', { decay_ms: 120 })),
		during: {
			peak: 0.06,
			from_gain: 1,
			pulse: { wave: 'sine', hz: 1500, to_hz: 1500, ms: 30, every_ms: 1000, to_every_ms: 1000 },
		},
		end: one(0.11, beep(1200, 60, 'triangle'), beep(1600, 140, 'triangle', { decay_ms: 100 })),
	},
	progress_end: one(0.09, hiss(60, 40, 11)),
	appear: one(
		0.1,
		beep(1000, 50, 'triangle'),
		rest(40),
		beep(1500, 120, 'triangle', { decay_ms: 90 }),
	),
	vanish: one(0.1, beep(900, 600, 'triangle', { to_hz: 150, decay_ms: 400 })),
}

// ghost: a very short, very high tick with a breath of noise a letter; a rising chirp as a line ends.
const GHOST_LETTER: Sound = {
	peak: 0.1,
	layers: [[beep(3000, 5, 'sine', { decay_ms: 3 })], [hiss(3, 2, 4)]],
}
const GHOST_END: Sound = one(0.09, beep(2400, 60, 'sine', { to_hz: 3200, decay_ms: 40 }))

const GHOST: Palette = {
	name: 'ghost',
	notice: {
		call: one(
			0.16,
			beep(1800, 90, 'sine', { to_hz: 2600 }),
			rest(50),
			hiss(120, 80, 6),
			rest(50),
			beep(2600, 140, 'sine', { to_hz: 1800, decay_ms: 100 }),
		),
		bed: {
			peak: 0.07,
			from_gain: 0.5,
			drone: { wave: 'sine', hz: 200, to_hz: 520 },
			pulse: {
				wave: 'noise',
				hz: 0,
				to_hz: 0,
				ms: 10,
				every_ms: 300,
				to_every_ms: 90,
				jitter: 0.4,
			},
		},
		peak: {
			peak: 0.22,
			layers: [
				[beep(2093, 350, 'sine', { decay_ms: 250 })],
				[beep(3136, 350, 'sine', { decay_ms: 150 })],
				[hiss(200, 120, 3)],
			],
		},
		blink: one(0.14, beep(2600, 25, 'sine')),
		close: one(
			0.12,
			beep(1300, 120, 'sine', { to_hz: 2000 }),
			beep(2000, 200, 'sine', { decay_ms: 150 }),
		),
	},
	row: {
		start: one(0.11, hiss(90, 60, 12)),
		during: {
			peak: 0.05,
			from_gain: 1,
			pulse: { wave: 'noise', hz: 0, to_hz: 0, ms: 4, every_ms: 60, to_every_ms: 60, jitter: 0.5 },
		},
		end: one(0.11, beep(2000, 180, 'sine', { to_hz: 2800, decay_ms: 130 })),
	},
	progress_end: GHOST_END,
	appear: one(0.1, beep(2400, 160, 'sine', { decay_ms: 120 })),
	vanish: one(0.1, hiss(500, 350, 13)),
}

const run_board_sound_palettes_extra = {
	GHOST,
	ISAC,
	GHOST_VOICES: voices_of('ghost', GHOST_LETTER, GHOST_END),
	ISAC_VOICES: voices_of('isac', ISAC_LETTER, ISAC_END),
	voices_of,
}

export { run_board_sound_palettes_extra }
