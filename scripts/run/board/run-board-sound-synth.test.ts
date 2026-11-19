import { describe, expect, it } from 'vitest'
import { run_board_sound_cues } from './run-board-sound-cues'
import { run_board_sound_synth, type Note } from './run-board-sound-synth'

// joshuafolkken/kit#7943: note definitions synthesize 16-bit mono PCM with faded edges.
// joshuafolkken/kit#8190: every note sounds at the same target RMS whatever its wave.

const { REST, TARGET_RMS, FULL_SCALE, frequency_of, samples_of } = run_board_sound_synth

const SAMPLE_RATE = 44_100
const SECOND_MS = 1000
const A4_CROSSINGS_PER_SECOND = 880
const CROSSING_TOLERANCE = 2
const EDGE_TOLERANCE = 1
const NOTE_MS = 50
const NOTE_SAMPLES = 2205
const DEFAULT_TARGET_RMS = 0.1
const RMS_TOLERANCE = 0.1
// The synth's edge fade in samples at the sample rate, left out of a note's RMS.
const FADE_SAMPLES = 221
const WAVES = ['sine', 'square', 'triangle'] as const

// A note's RMS past its edge fades, as a ratio of the target RMS.
function rms_ratio(samples: Int16Array): number {
	const body = [...samples.subarray(FADE_SAMPLES, samples.length - FADE_SAMPLES)]
	const mean_square = body.reduce((sum, sample) => sum + sample * sample, 0) / body.length

	return Math.sqrt(mean_square) / (TARGET_RMS * FULL_SCALE)
}

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

describe('run_board_sound_synth.samples_of loudness', () => {
	it('sounds the same note at the target RMS on all three waves, never clipping', () => {
		const tones = WAVES.map((wave) =>
			samples_of([{ pitch: 'A4', ms: SECOND_MS, wave }], SAMPLE_RATE),
		)

		expect(TARGET_RMS).toBe(DEFAULT_TARGET_RMS)

		for (const tone of tones) {
			expect(Math.abs(rms_ratio(tone) - 1)).toBeLessThanOrEqual(RMS_TOLERANCE)
			expect(peak_of(tone)).toBeLessThan(FULL_SCALE)
		}
	})

	it('sounds every cue note at the target RMS and stays silent on a rest', () => {
		const notes = Object.values(run_board_sound_cues.CUES)
			.flatMap((cue) => cue.notes)
			.filter((cue_note) => cue_note.pitch !== REST)
		const rest = samples_of([{ pitch: REST, ms: NOTE_MS, wave: 'square' }], SAMPLE_RATE)

		for (const note of notes) {
			const ratio = rms_ratio(samples_of([note], SAMPLE_RATE))

			expect(Math.abs(ratio - 1), `${note.pitch} ${note.wave}`).toBeLessThanOrEqual(RMS_TOLERANCE)
		}

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
