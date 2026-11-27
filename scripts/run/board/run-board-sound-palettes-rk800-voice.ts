import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Segment, type Sound } from './run-board-sound-voice'

// The rk800 board's sounds one by one, built from values measured on the work's own sound effects:
// each is a sum of sine partials at the measured pitches and relative strengths, over the measured
// length. Effects only: no melody, no music. A compound keeps its parts at their measured spacing.
// Sounds whose partials all lie above 10 kHz (TICK, TAIL, SPARKLE) are inaudible to many ears and
// many speakers on their own: the palette sounds each over a lower one
// (`run-board-sound-palettes-rk800.ts`).

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

// A sound of one layer of computed samples.
function computed(samples: () => Array<number>): Sound {
	return { peak: 1, layers: [[{ samples }]] }
}

// Sine partials sounding together for `ms`, dying away by `decay_ms`.
function partials(ms: number, decay_ms: number, ...parts: ReadonlyArray<Partial>): Sound {
	return computed(() =>
		summed(
			parts.map(([hz, strength]) =>
				tone({ hz, ms, wave: 'sine', decay_ms }).map((value) => value * strength),
			),
		),
	)
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

// Partials for `ms` under an envelope that takes each sample's place in the whole (0 to 1).
function shaped(ms: number, parts: ReadonlyArray<Partial>, gain: (share: number) => number): Sound {
	return computed(() =>
		summed(
			parts.map(([hz, strength]) =>
				tone({ hz, ms, wave: 'sine' }).map(
					(value, index, all) => value * strength * gain(index / all.length),
				),
			),
		),
	)
}

// A hum swelling in and fading out over `ms`.
function swell(ms: number, ...parts: ReadonlyArray<Partial>): Sound {
	return shaped(ms, parts, (share) => Math.sin(Math.PI * share))
}

// A pad swelling `swells` times over `ms`, never quite silent between them.
function pad(ms: number, swells: number, ...parts: ReadonlyArray<Partial>): Sound {
	return shaped(ms, parts, (share) => 0.6 - 0.4 * Math.cos(2 * Math.PI * swells * share))
}

// The measured vocabulary.
const TICK = partials(30, 12, [11_843, 1], [10_078, 0.57], [13_609, 0.46])
const PING = partials(90, 45, [8893, 1], [6374, 0.77])
const CHIME_A = partials(1800, 800, [6352, 1], [9259, 0.52])
const CHIME_B = partials(2400, 1000, [9625, 1], [7084, 0.8])
const CHIME_C = partials(1500, 650, [9173, 1], [12_037, 0.44])
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
// A ROW's soft thump.
const THUMP = partials(160, 96, [97, 1])
// A screen change's boom, 60–110 Hz dying over a second.
const SCREEN_BOOM = partials(1000, 450, [60, 1], [85, 0.8], [110, 0.6])
// The low swell, four seconds: 215 Hz sinking toward 194 and 151.
const LOW_SWELL = computed(() =>
	summed([
		tone({ hz: 215, to_hz: 194, ms: 4000, wave: 'sine' }),
		tone({ hz: 215, to_hz: 151, ms: 4000, wave: 'sine' }).map((value) => value * 0.6),
	]).map((value, index, all) => value * Math.sin((Math.PI * index) / all.length)),
)

// The software instability rising, its parts at their measured spacing: TICK, BODY, PING and a very
// quiet tail.
const INSTABILITY_UP = compound(
	1,
	[0, 0.6, TICK],
	[120, 1, BODY],
	[980, 0.7, PING],
	[1300, 0.1, TAIL],
)
// The software instability falling, likewise: a short cluster, a soft noise, PING and the tail.
const INSTABILITY_DOWN = compound(
	1,
	[0, 0.8, CLUSTER],
	[260, 0.35, BREATH],
	[920, 0.7, PING],
	[1200, 0.1, TAIL],
)
// UI sound five: two close partials over a low one, fading into a high shimmer. Where the shimmer
// starts inside it is this theme's choice.
const UI_FIVE = compound(
	1,
	[0, 1, partials(1400, 600, [2907, 1], [3015, 0.9], [86, 0.6])],
	[500, 0.2, partials(900, 450, [9500, 1], [10_150, 0.8], [10_800, 0.8])],
)
// UI sound two: four high partials settling to two lower ones. Where it settles inside it is this
// theme's choice.
const UI_TWO = compound(
	1,
	[0, 1, partials(900, 400, [7429, 1], [10_831, 0.6], [11_068, 0.5], [8506, 0.7])],
	[700, 0.8, partials(1500, 700, [7192, 1], [4673, 0.7])],
)

// The menu pad for `ms`: 581 Hz swelling about every half second, a faint partial near 2350 Hz.
function menu_pad(ms: number): Sound {
	return pad(ms, Math.max(1, Math.round(ms / 500)), [581, 1], [2350, 0.08])
}

const run_board_sound_palettes_rk800_voice = {
	BLIP_FIRST,
	BLIP_SECOND,
	BLIP_THIRD,
	BOOM,
	BURST,
	CHIME_A,
	CHIME_B,
	CHIME_C,
	CLICK,
	CRUNCH,
	HIT,
	INSTABILITY_DOWN,
	INSTABILITY_UP,
	LOW_SWELL,
	PING,
	SCREEN_BOOM,
	SPARKLE,
	THUMP,
	TICK,
	UI_FIVE,
	UI_TWO,
	compound,
	menu_pad,
	partials,
	swell,
}

export { run_board_sound_palettes_rk800_voice }
