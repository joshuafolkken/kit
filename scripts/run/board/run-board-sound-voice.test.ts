import { describe, expect, it } from 'vitest'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice, type Bed, type Pulse } from './run-board-sound-voice'

// joshuafolkken/kit#8917: a theme's voices as data — a sound's layers summed, a bed's pulses and drone
// swelling across its length, and a sinking bed reversed in pitch and pace.

const { add_into, bed_samples, beep, hiss, rest, sample_at, sinking, sound_samples } =
	run_board_sound_voice
const { SAMPLE_RATE, silence, tone } = run_board_sound_shape
const MS_PER_SECOND = 1000
const HZ = 440
const TO_HZ = 880
const TONE_MS = 40
const REST_MS = 20
const BED_MS = 300
const PEAK = 0.2
const HALF = 0.5
// A pulse decays over this share of its length (run-board-sound-voice.ts → PULSE_DECAY_SHARE).
const PULSE_DECAY = 0.6
const PULSE: Pulse = { wave: 'sine', hz: HZ, to_hz: TO_HZ, ms: 20, every_ms: 100, to_every_ms: 50 }

function ms_of(samples: ReadonlyArray<number>): number {
	return (samples.length * MS_PER_SECOND) / SAMPLE_RATE
}

// A theme's own bed samples: full on for `ms`.
function ones(ms: number): Array<number> {
	return Array.from({ length: sample_at(ms) }, () => 1)
}

// The indices at which two sample runs part, by `!==` so a -0 matches a 0; a length gap parts too.
function parted(actual: ReadonlyArray<number>, expected: ReadonlyArray<number>): Array<number> {
	const length = Math.max(actual.length, expected.length)

	return Array.from({ length }, (_, index) => index).filter(
		(index) => actual[index] !== expected[index],
	)
}

describe('run_board_sound_voice.add_into', () => {
	it('adds a part from its start at its gain, cut at the end', () => {
		const out = [1, 1, 1]

		add_into(out, [1, 1, 1], 1, HALF)

		expect(out).toStrictEqual([1, 1 + HALF, 1 + HALF])
	})
})

describe('run_board_sound_voice.sound_samples', () => {
	it('runs a layer’s segments one after another', () => {
		const samples = sound_samples({
			peak: PEAK,
			layers: [[beep(HZ, TONE_MS, 'sine'), rest(REST_MS)]],
		})

		expect(ms_of(samples)).toBe(TONE_MS + REST_MS)
		expect(samples.slice(sample_at(TONE_MS)).every((value) => value === 0)).toBe(true)
	})

	it('sums its layers, as long as the longest', () => {
		const one = beep(HZ, TONE_MS, 'sine')
		const both = sound_samples({ peak: PEAK, layers: [[one], [one, rest(REST_MS)]] })
		const alone = tone({ hz: HZ, ms: TONE_MS, wave: 'sine' })

		expect(ms_of(both)).toBe(TONE_MS + REST_MS)
		expect(both[sample_at(REST_MS)]).toBeCloseTo((alone[sample_at(REST_MS)] ?? 0) * 2)
	})

	it('takes a noise burst and samples a theme renders', () => {
		const samples = sound_samples({
			peak: PEAK,
			layers: [[hiss(TONE_MS, REST_MS), { samples: () => silence(REST_MS) }]],
		})

		expect(ms_of(samples)).toBe(TONE_MS + REST_MS)
	})
})

describe('run_board_sound_voice.bed_samples', () => {
	const bed: Bed = {
		peak: PEAK,
		from_gain: 0,
		pulse: PULSE,
		drone: { wave: 'sine', hz: HZ, to_hz: HZ },
	}

	it('lasts its length', () => {
		expect(ms_of(bed_samples(bed, BED_MS))).toBe(BED_MS)
	})

	it('swells from its first gain, silent at the start from 0', () => {
		expect(bed_samples(bed, BED_MS)[0]).toBe(0)
	})

	it('is silent with neither pulse nor drone', () => {
		expect(bed_samples({ peak: PEAK, from_gain: 1 }, BED_MS).every((value) => value === 0)).toBe(
			true,
		)
	})
})

// joshuafolkken/kit#9137: a bed a theme computes itself gives its own samples in place of both voices.
describe('run_board_sound_voice.bed_samples — a bed’s own samples', () => {
	const LONE_MS = 1000
	const LONE: Pulse = { ...PULSE, every_ms: LONE_MS, to_every_ms: LONE_MS }
	const DRONE = { wave: 'sine' as const, hz: HZ, to_hz: TO_HZ }

	it('plays its own samples in place of its pulse and drone', () => {
		const bed: Bed = { peak: PEAK, from_gain: 1, pulse: PULSE, drone: DRONE, own: ones }

		expect(bed_samples(bed, BED_MS)).toStrictEqual(ones(BED_MS))
	})

	it('swells its own samples from its first gain', () => {
		const own = bed_samples({ peak: PEAK, from_gain: HALF, own: ones }, BED_MS)

		expect(own[0]).toBe(HALF)
		expect(own.at(-1)).toBeCloseTo(1, 2)
	})

	it('plays a drone without its own samples at half under no pulses, as before', () => {
		const drone = tone({ hz: HZ, to_hz: TO_HZ, ms: BED_MS, wave: 'sine' })

		const expected = drone.map((value) => value * HALF)

		expect(
			parted(bed_samples({ peak: PEAK, from_gain: 1, drone: DRONE }, BED_MS), expected),
		).toStrictEqual([])
	})

	it('plays a pulse train without its own samples alone at full, as before', () => {
		const pulse = tone({ hz: HZ, ms: LONE.ms, wave: 'sine', decay_ms: LONE.ms * PULSE_DECAY })
		const expected = silence(BED_MS).map((_, index) => pulse[index] ?? 0)

		expect(
			parted(bed_samples({ peak: PEAK, from_gain: 1, pulse: LONE }, BED_MS), expected),
		).toStrictEqual([])
	})

	it('renders an own left undefined the same as no own', () => {
		const bed: Bed = { peak: PEAK, from_gain: 0, pulse: PULSE, drone: DRONE }

		expect(bed_samples({ ...bed, own: undefined }, BED_MS)).toStrictEqual(bed_samples(bed, BED_MS))
	})
})

describe('run_board_sound_voice.sinking', () => {
	it('reverses the pulses’ pitch and pace and the drone’s pitch', () => {
		const drone = { wave: 'sine' as const, hz: HZ, to_hz: TO_HZ }
		const sunk = sinking({ peak: PEAK, from_gain: 1, pulse: PULSE, drone })

		expect(sunk.pulse).toMatchObject({ hz: TO_HZ, to_hz: HZ, every_ms: 50, to_every_ms: 100 })
		expect(sunk.drone).toMatchObject({ hz: TO_HZ, to_hz: HZ })
	})

	it('keeps a bed with neither as it is', () => {
		expect(sinking({ peak: PEAK, from_gain: 1 })).toStrictEqual({
			peak: PEAK,
			from_gain: 1,
			pulse: undefined,
			drone: undefined,
		})
	})
})
