import { describe, expect, it } from 'vitest'
import { run_board_sound_synth, type Note } from './run-board-sound-synth'

// joshuafolkken/kit#7943: note definitions synthesize 16-bit mono PCM with faded edges at 50% volume.

const { REST, VOLUME, FULL_SCALE, frequency_of, samples_of } = run_board_sound_synth

const SAMPLE_RATE = 44_100
const SECOND_MS = 1000
const A4_CROSSINGS_PER_SECOND = 880
const CROSSING_TOLERANCE = 2
const EDGE_TOLERANCE = 1
const NOTE_MS = 50
const NOTE_SAMPLES = 2205

function zero_crossings(samples: Int16Array): number {
	const signs = [...samples].map((sample) => Math.sign(sample)).filter((sign) => sign !== 0)

	return signs.filter((sign, index) => index > 0 && sign !== signs[index - 1]).length
}

function peak_of(samples: Int16Array): number {
	return Math.max(...[...samples].map((sample) => Math.abs(sample)))
}

describe('run_board_sound_synth.samples_of', () => {
	it('gives each note as many samples as its length at the sample rate', () => {
		const notes: Array<Note> = [
			{ pitch: 'C5', ms: NOTE_MS, wave: 'sine' },
			{ pitch: REST, ms: NOTE_MS, wave: 'sine' },
		]

		expect(samples_of(notes, SAMPLE_RATE)).toHaveLength(NOTE_SAMPLES + NOTE_SAMPLES)
	})

	it('sounds A4 at 440 Hz, counted by its zero crossings over one second', () => {
		const samples = samples_of([{ pitch: 'A4', ms: SECOND_MS, wave: 'sine' }], SAMPLE_RATE)
		const crossings = zero_crossings(samples)

		expect(frequency_of('A4')).toBe(440)
		expect(Math.abs(crossings - A4_CROSSINGS_PER_SECOND)).toBeLessThanOrEqual(CROSSING_TOLERANCE)
	})

	it('gives the three waves different sample runs', () => {
		const runs = (['sine', 'square', 'triangle'] as const).map((wave) =>
			[...samples_of([{ pitch: 'A4', ms: NOTE_MS, wave }], SAMPLE_RATE)].join(','),
		)

		expect(new Set(runs).size).toBe(runs.length)
	})

	it('fades every note to near 0 at its first and last sample', () => {
		const notes: Array<Note> = [
			{ pitch: 'C5', ms: NOTE_MS, wave: 'square' },
			{ pitch: 'E5', ms: NOTE_MS, wave: 'triangle' },
		]
		const samples = samples_of(notes, SAMPLE_RATE)
		const edges = [0, NOTE_SAMPLES - 1, NOTE_SAMPLES, samples.length - 1]
		const levels = edges.map((edge) => Math.abs(samples[edge] ?? 0))

		expect(Math.max(...levels)).toBeLessThanOrEqual(EDGE_TOLERANCE)
	})
})

describe('run_board_sound_synth.samples_of volume', () => {
	it('peaks at the default volume of full scale and stays silent on a rest', () => {
		const tone = samples_of([{ pitch: 'A4', ms: NOTE_MS, wave: 'square' }], SAMPLE_RATE)
		const rest = samples_of([{ pitch: REST, ms: NOTE_MS, wave: 'square' }], SAMPLE_RATE)

		expect(peak_of(tone)).toBe(Math.round(VOLUME * FULL_SCALE))
		expect(peak_of(rest)).toBe(0)
	})
})

describe('run_board_sound_synth.frequency_of', () => {
	it('reads sharps, flats and octaves on equal temperament and refuses an unknown pitch', () => {
		expect(frequency_of('A5')).toBe(880)
		expect(frequency_of('A#4')).toBeCloseTo(frequency_of('Bb4'))
		expect(frequency_of('C4')).toBeCloseTo(261.626, 2)
		expect(() => frequency_of('H2')).toThrow('Unknown pitch: H2')
	})
})
