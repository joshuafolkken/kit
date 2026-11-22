import { readFileSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_enter } from './run-board-sound-enter'
import { run_board_sound_wav } from './run-board-sound-wav'

const create_directory = temporary_directory()
const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2
const SAMPLES_PER_MS = 48

describe('run_board_sound_enter.enter_wav — the bttf ENTER socket writes the silent gap', () => {
	it('writes a 48 kHz WAV of the 120 ms gap, silent', () => {
		const file = run_board_sound_enter.enter_wav(create_directory('josh-enter-')) ?? ''
		const data = readFileSync(file).subarray(WAV_HEADER_BYTES)

		expect(run_board_sound_wav.rate_of(file)).toBe(48_000)
		expect(data).toHaveLength(run_board_sound_enter.GAP_MS * SAMPLES_PER_MS * BYTES_PER_SAMPLE)
		expect(data.every((byte) => byte === 0)).toBe(true)
	})
})
