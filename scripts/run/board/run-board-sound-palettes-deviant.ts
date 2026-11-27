import { run_board_sound_palettes_extra } from './run-board-sound-palettes-extra'
import type { Palette } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Segment, type Sound } from './run-board-sound-voice'

// The deviant board's palette, built from values measured on the work's own sound effects: each
// sound is a sum of sine partials at the measured pitches and relative strengths, over the measured
// length — a glass tick and ping, three chimes, a low body, the scanner's three blips, a swelling
// hum, a soft thump, the wall's thud, crunch and shatter. Effects only: no melody, no music. Every
// sound is computed. An event's sounds are laid on its own time line inside the one sound its slot
// of the palette holds (`run-board-sound-score.ts`), each part at its moment and its level.

/* eslint-disable @typescript-eslint/no-magic-numbers -- a palette is its numbers: hz, ms and peaks */

const { hiss, rest, sound_samples } = run_board_sound_voice
const { tone } = run_board_sound_shape

// A partial of a sound: its pitch and its strength beside the sound's strongest.
type Partial = readonly [hz: number, strength: number]
// A part of a compound sound: when it starts, how loud it is beside the loudest part, and the sound.
type Part = readonly [at_ms: number, level: number, sound: Sound]

function summed(parts: ReadonlyArray<ReadonlyArray<number>>): Array<number> {
	const length = Math.max(0, ...parts.map((part) => part.length))

	return Array.from({ length }, (_, index) => {
		let sum = 0

		for (const part of parts) sum += part[index] ?? 0

		return sum
	})
}

// Sine partials sounding together for `ms`, dying away by `decay_ms`.
function partials(ms: number, decay_ms: number, ...parts: ReadonlyArray<Partial>): Sound {
	function samples(): Array<number> {
		return summed(
			parts.map(([hz, strength]) =>
				tone({ hz, ms, wave: 'sine', decay_ms }).map((value) => value * strength),
			),
		)
	}

	return { peak: 1, layers: [[{ samples }]] }
}

// A sound's samples with its loudest at `level`.
function leveled(sound: Sound, level: number): Segment {
	return {
		samples: () => {
			const samples = sound_samples(sound)
			let top = 0

			for (const value of samples) top = Math.max(top, Math.abs(value))

			return top === 0 ? samples : samples.map((value) => (value * level) / top)
		},
	}
}

// Sounds on one time line, each from its own moment at its own level; the whole at `peak`.
function compound(peak: number, ...parts: ReadonlyArray<Part>): Sound {
	return {
		peak,
		layers: parts.map(([at_ms, level, sound]) => [rest(at_ms), leveled(sound, level)]),
	}
}

// A hum swelling in and fading out over `ms`.
function swell(ms: number, ...parts: ReadonlyArray<Partial>): Sound {
	function samples(): Array<number> {
		return summed(
			parts.map(([hz, strength]) =>
				tone({ hz, ms, wave: 'sine' }).map(
					(value, index, all) => value * strength * Math.sin((Math.PI * index) / all.length),
				),
			),
		)
	}

	return { peak: 1, layers: [[{ samples }]] }
}

// The measured vocabulary.
const TICK = partials(30, 12, [11_843, 1], [10_078, 0.57], [13_609, 0.46])
const PING = partials(90, 45, [8893, 1], [6374, 0.77])
const CHIME_A = partials(1800, 800, [6352, 1], [9259, 0.52])
// Chime A cut short: a ROW's end sounds inside the row's own typing (below).
const CHIME_A_SHORT = partials(300, 140, [6352, 1], [9259, 0.52])
const CHIME_C = partials(1000, 450, [9173, 1], [12_037, 0.44])
const BODY = partials(560, 300, [883, 1], [581, 0.7], [9600, 0.12], [11_800, 0.1])
const TAIL = partials(300, 150, [12_900, 1], [10_500, 0.8])
const BLIP_FIRST = partials(100, 60, [431, 1], [646, 0.64], [861, 0.51])
const BLIP_SECOND = partials(120, 70, [452, 1], [366, 0.8], [1744, 0.63])
const BLIP_THIRD = partials(90, 50, [388, 1], [474, 0.89])
const HIT = partials(300, 150, [172, 1], [258, 1])
// The crunch's noise near 2.2–2.6 kHz as a cluster of partials: the shared noise is white, unfiltered.
const CRUNCH = partials(190, 80, [237, 1], [2200, 0.3], [2390, 0.3], [2600, 0.3])
const BURST: Sound = { peak: 1, layers: [[hiss(40, 25, 5)]] }
const BOOM = partials(400, 250, [151, 1], [237, 0.8], [1000, 0.3])
const SPARKLE = partials(300, 120, [11_000, 1])
const CLUSTER = partials(20, 10, [754, 1], [830, 1], [904, 1])
const BREATH: Sound = { peak: 1, layers: [[hiss(150, 90, 9)]] }
// The menu cursor's move: unconfirmed on the source, a short soft low click.
const CLICK = partials(40, 20, [180, 1], [240, 0.5])

// The typing trill's letter: a quiet blip of the scanner's family; the typed end: analysis complete.
const DEVIANT_LETTER: Sound = { ...partials(20, 10, [646, 1], [861, 0.8]), peak: 0.1 }
const DEVIANT_END = compound(0.09, [0, 0.8, TICK], [60, 1, PING])

// NOTICE's call, the whole of its four seconds to the peak: the cursor moving to its second choice
// and the pulse on it; the instability rising as the wall starts a second in, at its measured
// spacing (TICK, then BODY, PING and the tail); the wall's eight hits at their ticks
// (`run-board-theme-deviant-data.ts` → `HITS`, a board tick each from the wall's start) — a triple
// tap, a single, four quickening, the last two with the crunch — then nothing until the peak.
const CALL = compound(
	0.16,
	[500, 0.25, CLICK],
	[800, 0.5, PING],
	[1000, 0.6, TICK],
	[1120, 1, BODY],
	[1980, 0.7, PING],
	[2300, 0.1, TAIL],
	[1100, 0.45, HIT],
	[1250, 0.45, HIT],
	[1400, 0.5, HIT],
	[1700, 0.55, HIT],
	[2000, 0.55, HIT],
	[2200, 0.55, HIT],
	[2350, 0.6, HIT],
	[2350, 0.45, CRUNCH],
	[2450, 0.6, HIT],
	[2450, 0.45, CRUNCH],
)

// The peak: the shatter — a bright burst, the boom and its sparkle — and the chime as the
// probability flips two ticks on.
const PEAK = compound(
	0.22,
	[0, 1, BURST],
	[30, 0.9, BOOM],
	[30, 0.25, SPARKLE],
	[100, 0.45, CHIME_A],
)

// The close: the instability falling, drawn in to end with the notice.
const CLOSE = compound(
	0.12,
	[0, 0.8, CLUSTER],
	[200, 0.35, BREATH],
	[600, 0.7, PING],
	[750, 0.1, TAIL],
)

const DEVIANT: Palette = {
	name: 'deviant',
	notice: {
		call: CALL,
		// The swelling hum, rising to the peak, under soft thumps that quicken and rise.
		bed: {
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'sine', hz: 151, to_hz: 215 },
			pulse: {
				wave: 'sine',
				hz: 86,
				to_hz: 108,
				ms: 180,
				every_ms: 2000,
				to_every_ms: 700,
				jitter: 0.2,
			},
		},
		peak: PEAK,
		blink: compound(0.14, [0, 1, PING]),
		close: CLOSE,
	},
	row: {
		start: compound(0.09, [0, 1, BLIP_FIRST], [350, 0.9, BLIP_SECOND], [620, 0.8, BLIP_THIRD]),
		during: {
			peak: 0.04,
			from_gain: 1,
			pulse: { wave: 'sine', hz: 97, to_hz: 97, ms: 160, every_ms: 450, to_every_ms: 450 },
		},
		end: compound(0.11, [0, 1, CHIME_A_SHORT]),
	},
	progress_end: DEVIANT_END,
	appear: compound(0.1, [0, 1, swell(2200, [237, 1], [323, 0.7])]),
	vanish: compound(0.1, [0, 1, CHIME_C]),
}

const run_board_sound_palettes_deviant = {
	DEVIANT,
	DEVIANT_VOICES: run_board_sound_palettes_extra.voices_of('deviant', DEVIANT_LETTER, DEVIANT_END),
}

export { run_board_sound_palettes_deviant }
