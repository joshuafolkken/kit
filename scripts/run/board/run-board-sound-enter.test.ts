import { readFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_dtmf } from './run-board-sound-dtmf'
import { run_board_sound_enter } from './run-board-sound-enter'
import { run_board_sound_wav } from './run-board-sound-wav'

const create_directory = temporary_directory()
const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2
const SAMPLES_PER_MS = 48
const CHANNELS_OFFSET = 22
const BITS_OFFSET = 34
const SIXTEEN_BITS = 16
const ROW_HZ = 941
const COLUMN_HZ = 1477

const { BEEP_MS, GAP_MS, SPACING_MS } = run_board_sound_enter
const samples = run_board_sound_enter.enter_samples()
const beep = run_board_sound_dtmf.beep(run_board_sound_enter.KEY, BEEP_MS)

function slice_ms(from_ms: number, to_ms: number): Array<number> {
	return samples.slice(from_ms * SAMPLES_PER_MS, to_ms * SAMPLES_PER_MS)
}

describe('run_board_sound_enter.enter_samples — the bttf ENTER double beep', () => {
	it('holds the approved timings: 120 ms gap, 70 ms beeps, 110 ms apart', () => {
		expect([GAP_MS, BEEP_MS, SPACING_MS]).toStrictEqual([120, 70, 110])
	})

	it('starts with 120 ms of silence', () => {
		expect(slice_ms(0, GAP_MS).every((sample) => sample === 0)).toBe(true)
	})

	it('plays two 70 ms beeps, start to start 110 ms apart, silent between them', () => {
		const second_ms = GAP_MS + SPACING_MS

		expect(samples).toHaveLength((second_ms + BEEP_MS) * SAMPLES_PER_MS)
		expect(slice_ms(GAP_MS, GAP_MS + BEEP_MS)).toStrictEqual(beep)
		expect(slice_ms(GAP_MS + BEEP_MS, second_ms).every((sample) => sample === 0)).toBe(true)
		expect(slice_ms(second_ms, second_ms + BEEP_MS)).toStrictEqual(beep)
	})

	it('beeps the # key pair, 941 + 1477 Hz, with the dtmf envelope and 0.35 peak', () => {
		expect(run_board_sound_dtmf.pair_of(run_board_sound_enter.KEY)).toStrictEqual({
			low: ROW_HZ,
			high: COLUMN_HZ,
		})
		expect(run_board_sound_dtmf.PEAK).toBe(0.35)
		expect(Math.max(...samples.map((sample) => Math.abs(sample)))).toBeLessThanOrEqual(0.35)
	})
})

describe('run_board_sound_enter.enter_wav — the cached ENTER WAV', () => {
	it('writes a 48 kHz 16-bit mono WAV cached as enter-<hash>.wav', () => {
		const file = run_board_sound_enter.enter_wav(create_directory('josh-enter-')) ?? ''
		const bytes = readFileSync(file)

		expect(path.basename(file)).toMatch(/^enter-\w+\.wav$/u)
		expect(run_board_sound_wav.rate_of(file)).toBe(48_000)
		expect(bytes.readUInt16LE(CHANNELS_OFFSET)).toBe(1)
		expect(bytes.readUInt16LE(BITS_OFFSET)).toBe(SIXTEEN_BITS)
		expect(bytes.subarray(WAV_HEADER_BYTES)).toHaveLength(samples.length * BYTES_PER_SAMPLE)
	})
})
