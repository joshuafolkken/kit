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
const PULSE: Pulse = { wave: 'sine', hz: HZ, to_hz: TO_HZ, ms: 20, every_ms: 100, to_every_ms: 50 }

function ms_of(samples: ReadonlyArray<number>): number {
	return (samples.length * MS_PER_SECOND) / SAMPLE_RATE
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
