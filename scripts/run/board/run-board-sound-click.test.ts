import { readFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8365: the matrix key click — the approved demo's synthesis values, a fixed noise
// seed, and one click per two letters.

const { CLICKS, LETTERS_PER_CLICK, PEAK, SAMPLE_RATE, click, envelope, seeded, typing_samples } =
	run_board_sound_click
const MS_PER_SECOND = 1000
const CLICK_MS = 9
const LETTER_MS = 50
const CLICK_INTERVAL_MS = 100
const HOLD_MS = 4.5
const HOLD_END_LEVEL = 0.75
const CLOSE = 6
const QUIET = 0.01
const LOUD = 0.25
const RATE_OFFSET = 24
const DIRECTORY_PREFIX = 'run-board-sound-click-'
const create_directory = temporary_directory()

function samples_in(ms: number): number {
	return Math.round((ms * SAMPLE_RATE) / MS_PER_SECOND)
}

function peak_of(samples: ReadonlyArray<number>): number {
	return Math.max(...samples.map((value) => Math.abs(value)))
}

describe('run_board_sound_click.click (ac-e08e20c2)', () => {
	it('lasts about 9 ms at 48 kHz', () => {
		expect(SAMPLE_RATE).toBe(48_000)
		expect(click()).toHaveLength(samples_in(CLICK_MS))
	})

	it('peaks at no more than 0.5, audibly', () => {
		const peak = peak_of(click())

		expect(peak).toBeLessThanOrEqual(PEAK)
		expect(peak).toBeGreaterThan(LOUD)
	})

	it('ends silent', () => {
		expect(Math.abs(click().at(-1) ?? 1)).toBeLessThan(QUIET)
	})
})

describe('run_board_sound_click.envelope (ac-e08e20c2)', () => {
	it('rises linearly to full at 1 ms', () => {
		expect(envelope(0)).toBe(0)
		expect(envelope(0.5)).toBeCloseTo(0.5, CLOSE)
		expect(envelope(1)).toBe(1)
	})

	it('falls to 0.75 by 4.5 ms, then releases linearly to 0 by 9 ms', () => {
		expect(envelope(HOLD_MS)).toBeCloseTo(HOLD_END_LEVEL, CLOSE)
		expect(envelope((HOLD_MS + CLICK_MS) / 2)).toBeCloseTo(HOLD_END_LEVEL / 2, CLOSE)
		expect(envelope(CLICK_MS)).toBe(0)
		expect(envelope(CLICK_MS + 1)).toBe(0)
	})
})

describe('run_board_sound_click fixed seed (ac-089f34f5)', () => {
	it('draws the same noise from the same seed and other noise from another', () => {
		const first = seeded()
		const second = seeded()
		const other = seeded(1)
		const drawn = [first(), first(), first()]

		expect([second(), second(), second()]).toStrictEqual(drawn)
		expect(other()).not.toBe(drawn[0])
		expect(drawn.every((value) => value > 0 && value < 1)).toBe(true)
	})

	it('renders the same click and the same WAV file name on every call', () => {
		const directory = create_directory(DIRECTORY_PREFIX)

		expect(click()).toStrictEqual(click())
		expect(run_board_sound_click.typing_wav(LETTER_MS, directory)).toBe(
			run_board_sound_click.typing_wav(LETTER_MS, directory),
		)
	})
})

describe('run_board_sound_click.typing_samples (ac-4fc27476)', () => {
	it('repeats one click then silence every two letters, 100 ms at the matrix pace', () => {
		const samples = typing_samples(LETTER_MS)
		const unit = samples_in(LETTER_MS * LETTERS_PER_CLICK)
		const key = samples.slice(0, samples_in(CLICK_MS))

		expect(unit).toBe(samples_in(CLICK_INTERVAL_MS))
		expect(samples).toHaveLength(unit * CLICKS)
		expect(samples.slice(unit, unit + key.length)).toStrictEqual(key)
		expect(samples.slice(key.length, unit).every((value) => value === 0)).toBe(true)
	})
})

describe('run_board_sound_click.typing_wav', () => {
	it('writes the clicks as a 48 kHz WAV', () => {
		const file =
			run_board_sound_click.typing_wav(LETTER_MS, create_directory(DIRECTORY_PREFIX)) ?? ''
		const bytes = readFileSync(file)

		expect(path.basename(file)).toMatch(/^click-[\da-f]+\.wav$/u)
		expect(bytes.readUInt32LE(RATE_OFFSET)).toBe(SAMPLE_RATE)
		expect(bytes).toStrictEqual(run_board_sound_wav.wav_of(typing_samples(LETTER_MS), SAMPLE_RATE))
	})
})
