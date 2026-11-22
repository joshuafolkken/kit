import { readFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_dtmf } from './run-board-sound-dtmf'
import { run_board_sound_keypad } from './run-board-sound-keypad'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_theme_defs } from './run-board-theme-defs'

const { BEEP_MS, LETTERS_PER_BEEP, LINE, beat_keys, key_of, typing_samples, typing_wav } =
	run_board_sound_keypad
const { SAMPLE_RATE, beep, pcm } = run_board_sound_dtmf
const create_directory = temporary_directory()
const LETTER_MS = 50
const UNIT_MS = 100
const MS_PER_SECOND = 1000
const CHANNELS_OFFSET = 22
const RATE_OFFSET = 24
const BITS_OFFSET = 34
const BITS = 16
// "Roads? Where we're going, we don't need roads." at characters 0, 2, 4, …, a space taking the next key.
const OPENING_BEATS = [
	'7',
	'2',
	'7',
	'9',
	'4',
	'7',
	'9',
	'3',
	'7',
	'4',
	'6',
	'6',
	'*',
	'9',
	'3',
	'6',
	'*',
	'6',
	'3',
	'3',
	'7',
	'2',
	'7',
]

function samples_in(ms: number): number {
	return Math.round((ms * SAMPLE_RATE) / MS_PER_SECOND)
}

function unit_at(samples: Int16Array, index: number, unit: number): Int16Array {
	return samples.slice(index * unit, (index + 1) * unit)
}

describe('run_board_sound_keypad.key_of — a character pressed on the phone keypad', () => {
	it('takes a letter to its keypad digit, a digit to itself and a symbol to # or *', () => {
		expect(
			['R', 'a', 'd', 'w', 'q', 'z', '5', '?', ',', "'", '.'].map((character) => key_of(character)),
		).toEqual(['7', '2', '3', '9', '7', '9', '5', '#', '*', '*', '*'])
	})

	it('has no key for a space', () => {
		expect(key_of(' ')).toBeUndefined()
	})
})

describe('run_board_sound_keypad.beat_keys — a key every two letters of the opening line', () => {
	it('keys the opening line every two letters, a beat on a space taking the next key', () => {
		expect(LETTERS_PER_BEEP).toBe(2)
		expect(beat_keys()).toEqual(OPENING_BEATS)
	})

	it('keys a beat on a space with the next character that has a key', () => {
		expect(beat_keys('ab  gh')).toEqual(['2', '4', '4'])
	})
})

describe('run_board_sound_keypad.typing_samples — one unit per beat, a beep at its head', () => {
	it('makes 100 ms units at a 50 ms letter, each a 42 ms beep of its key then silence', () => {
		const unit = samples_in(UNIT_MS)
		const length = samples_in(BEEP_MS)
		const samples = typing_samples(LETTER_MS)

		expect(BEEP_MS).toBe(42)
		expect(samples).toHaveLength(unit * OPENING_BEATS.length)

		for (const [index, key] of OPENING_BEATS.entries()) {
			const at = unit_at(samples, index, unit)

			expect(at.slice(0, length)).toEqual(pcm(beep(key, BEEP_MS)))
			expect(at.slice(length).every((sample) => sample === 0)).toBe(true)
		}
	})

	it('cuts each beep off at the unit end at a pace faster than the beep', () => {
		const fast_ms = 10
		const unit = samples_in(fast_ms * LETTERS_PER_BEEP)
		const samples = typing_samples(fast_ms)

		expect(samples).toHaveLength(unit * OPENING_BEATS.length)
		expect(unit_at(samples, 1, unit)).toEqual(pcm(beep('2', BEEP_MS).slice(0, unit)))
	})
})

describe('run_board_sound_keypad.typing_wav — the bttf keypad loop as a cached WAV', () => {
	it('writes a 48 kHz 16-bit mono keypad-<hash>.wav of the samples', () => {
		const file = typing_wav(LETTER_MS, create_directory('josh-keypad-')) ?? ''
		const bytes = readFileSync(file)

		expect(path.basename(file)).toMatch(/^keypad-[\da-f]+\.wav$/u)
		expect(bytes.readUInt16LE(CHANNELS_OFFSET)).toBe(1)
		expect(bytes.readUInt32LE(RATE_OFFSET)).toBe(48_000)
		expect(bytes.readUInt16LE(BITS_OFFSET)).toBe(BITS)
		expect(bytes).toEqual(run_board_sound_wav.wav_of(typing_samples(LETTER_MS), SAMPLE_RATE))
	})

	it('keys the beats on the line the bttf theme types', () => {
		expect(LINE).toBe("Roads? Where we're going, we don't need roads.")
		expect(run_board_theme_defs.THEME_DEFS.bttf.intro.line).toBe(LINE)
	})
})
