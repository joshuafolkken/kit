import { readFileSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_keypad } from './run-board-sound-keypad'
import { run_board_sound_wav } from './run-board-sound-wav'

const create_directory = temporary_directory()
const WAV_HEADER_BYTES = 44
const LETTER_MS = 50

describe('run_board_sound_keypad.typing_wav — the bttf keypad socket writes a silent WAV', () => {
	it('writes a 48 kHz WAV of silence', () => {
		const file =
			run_board_sound_keypad.typing_wav(LETTER_MS, create_directory('josh-keypad-')) ?? ''
		const data = readFileSync(file).subarray(WAV_HEADER_BYTES)

		expect(run_board_sound_wav.rate_of(file)).toBe(48_000)
		expect(data.length).toBeGreaterThan(0)
		expect(data.every((byte) => byte === 0)).toBe(true)
	})
})
