import { existsSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_synth } from './run-board-sound-synth'
import { run_board_sound_typing } from './run-board-sound-typing'

// joshuafolkken/kit#8917: the building blocks of the themes' own voices — tones, noise, silence, a
// voice scaled to its peak and written once, and a typing loop of one part a letter.

const { SAMPLE_RATE, fitted, looped, mixed, noise, pcm, silence, tone, typing_wav, voice_wav } =
	run_board_sound_shape
const MS_PER_SECOND = 1000
const TONE_MS = 100
const HZ = 440
const GLIDE_TO_HZ = 880
const DECAY_MS = 10
const SEED = 7
const PEAK = 0.5
const LETTER_MS = 50
const PART_MS = 20
const WEIGHT = 0.25
const QUIET = 0.01
const DIRECTORY_PREFIX = 'run-board-sound-shape-'
const create_directory = temporary_directory()

function count_of(ms: number): number {
	return Math.round((ms * SAMPLE_RATE) / MS_PER_SECOND)
}

function top_of(samples: ReadonlyArray<number>): number {
	return Math.max(0, ...samples.map((value) => Math.abs(value)))
}

describe('run_board_sound_shape.tone', () => {
	it('lasts its length at 48 kHz, faded in and out at the edges', () => {
		const samples = tone({ hz: HZ, ms: TONE_MS, wave: 'sine' })

		expect(SAMPLE_RATE).toBe(48_000)
		expect(samples).toHaveLength(count_of(TONE_MS))
		expect(samples[0]).toBe(0)
		expect(Math.abs(samples.at(-1) ?? 1)).toBeLessThan(QUIET)
	})

	it.each(['sine', 'square', 'triangle'] as const)('keeps a %s tone within full scale', (wave) => {
		const samples = tone({ hz: HZ, to_hz: GLIDE_TO_HZ, ms: TONE_MS, wave })

		expect(top_of(samples)).toBeLessThanOrEqual(1)
		expect(top_of(samples)).toBeGreaterThan(PEAK)
	})

	it('dies away by its decay', () => {
		const samples = tone({ hz: HZ, ms: TONE_MS, wave: 'square', decay_ms: DECAY_MS })
		const half = count_of(TONE_MS) / 2

		expect(top_of(samples.slice(half))).toBeLessThan(QUIET)
	})
})

describe('run_board_sound_shape.noise and silence', () => {
	it('makes the same burst for the same seed', () => {
		expect(noise(TONE_MS, DECAY_MS, SEED)).toStrictEqual(noise(TONE_MS, DECAY_MS, SEED))
		expect(noise(TONE_MS, DECAY_MS, SEED)).toHaveLength(count_of(TONE_MS))
	})

	it('makes silence of its length', () => {
		expect(silence(TONE_MS)).toStrictEqual(Array.from({ length: count_of(TONE_MS) }, () => 0))
	})
})

describe('run_board_sound_shape.mixed and fitted', () => {
	it('mixes two parts by the second’s share, as long as the longer', () => {
		expect(mixed([1, 1], [-1], WEIGHT)).toStrictEqual([1 - WEIGHT - WEIGHT, 1 - WEIGHT])
	})

	it('cuts or pads a part to its length', () => {
		const part = tone({ hz: HZ, ms: TONE_MS, wave: 'sine' })

		expect(fitted(part, LETTER_MS)).toHaveLength(count_of(LETTER_MS))
		expect(
			fitted([1], PART_MS)
				.slice(1)
				.every((value) => value === 0),
		).toBe(true)
	})
})

describe('run_board_sound_shape.pcm', () => {
	it('scales the loudest sample to its peak of full scale', () => {
		const scaled = pcm([0.1, -0.2], PEAK)

		expect(scaled[1]).toBe(Math.round(-PEAK * run_board_sound_synth.FULL_SCALE))
	})

	it('keeps silence silent', () => {
		expect([...pcm([0, 0], PEAK)]).toStrictEqual([0, 0])
	})
})

describe('run_board_sound_shape.looped', () => {
	it('loops one part a letter, as many letters as the teletype trill', () => {
		const loop = looped([1], LETTER_MS)

		expect(loop).toHaveLength(count_of(LETTER_MS) * run_board_sound_typing.TRILL_PAIRS)
		expect(loop[count_of(LETTER_MS)]).toBe(1)
	})
})

describe('run_board_sound_shape WAVs', () => {
	it('writes a voice once under the directory, the same path asked again', () => {
		const directory = create_directory(DIRECTORY_PREFIX)
		const voice = { name: 'shape-test', key: '', peak: PEAK, render: () => [0.5, -0.5] }
		const file = voice_wav(voice, directory)

		expect(file).toBeDefined()
		expect(existsSync(file ?? '')).toBe(true)
		expect(voice_wav(voice, directory)).toBe(file)
	})

	it('writes a typing loop keyed by its letter pace', () => {
		const directory = create_directory(DIRECTORY_PREFIX)
		const voice = { name: 'shape-typing', peak: PEAK, part: () => [1] }
		const slow = typing_wav(voice, LETTER_MS, directory)

		expect(slow).toBeDefined()
		expect(typing_wav(voice, PART_MS, directory)).not.toBe(slow)
	})
})
