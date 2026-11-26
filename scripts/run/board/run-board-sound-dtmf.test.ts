import { describe, expect, it } from 'vitest'
import { run_board_sound_dtmf } from './run-board-sound-dtmf'

const { beep, envelope, pair_of, pcm, silence } = run_board_sound_dtmf
const BEEP_MS = 42
const SAMPLES_PER_MS = 48

describe('run_board_sound_dtmf.pair_of — each key sounds its DTMF row and column tones', () => {
	it.each([
		['1', 697, 1209],
		['2', 697, 1336],
		['3', 697, 1477],
		['4', 770, 1209],
		['5', 770, 1336],
		['6', 770, 1477],
		['7', 852, 1209],
		['8', 852, 1336],
		['9', 852, 1477],
		['*', 941, 1209],
		['0', 941, 1336],
		['#', 941, 1477],
	])('sounds %s as %i Hz and %i Hz', (key, low, high) => {
		expect(pair_of(key)).toStrictEqual({ low, high })
	})

	it('throws for a character not on the keypad', () => {
		expect(() => pair_of('A')).toThrow('no DTMF key: A')
	})
})

describe('run_board_sound_dtmf.envelope — a 2 ms linear attack and an 8 ms linear release', () => {
	it.each([
		[0, 0],
		[1, 0.5],
		[2, 1],
		[BEEP_MS - 8, 1],
		[BEEP_MS - 4, 0.5],
		[BEEP_MS, 0],
		[BEEP_MS + 1, 0],
	])('is at level %f at %f ms into a 42 ms beep', (ms, level) => {
		expect(envelope(ms, BEEP_MS)).toBeCloseTo(level)
	})
})

describe('run_board_sound_dtmf.beep — the key pair summed and halved at 48 kHz', () => {
	it('is 48 samples a millisecond long', () => {
		expect(run_board_sound_dtmf.SAMPLE_RATE).toBe(48_000)
		expect(beep('1', BEEP_MS)).toHaveLength(BEEP_MS * SAMPLES_PER_MS)
	})

	it('peaks below 0.35 of full scale and near it', () => {
		const peak = Math.max(...beep('5', BEEP_MS).map((value) => Math.abs(value)))

		expect(run_board_sound_dtmf.PEAK).toBe(0.35)
		expect(peak).toBeLessThanOrEqual(0.35)
		expect(peak).toBeGreaterThan(0.3)
	})

	it('starts and ends silent', () => {
		const samples = beep('#', BEEP_MS)

		expect(samples[0]).toBe(0)
		expect(Math.abs(samples.at(-1) ?? 1)).toBeLessThan(0.01)
	})
})

describe('run_board_sound_dtmf.silence and pcm — silence as 16-bit samples', () => {
	it('is all zero, 48 samples a millisecond', () => {
		const samples = pcm(silence(10))

		expect(samples).toHaveLength(10 * SAMPLES_PER_MS)
		expect(samples.every((value) => value === 0)).toBe(true)
	})

	it('scales a full-level sample to full scale', () => {
		expect([...pcm([1, -1, 0.5])]).toStrictEqual([32_767, -32_767, 16_384])
	})
})
