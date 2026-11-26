import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_nixie } from './run-board-sound-nixie'
import { run_board_sound_shape } from './run-board-sound-shape'

// joshuafolkken/kit#8917: the nixie theme's own voices — a low relay click a letter, a clear high tone
// as a line settles, and a hum rising to a held high tone for the NOTICE.

const { click, notice_wav, rise, settle, typed_wav, typing_wav } = run_board_sound_nixie
const MS_PER_SECOND = 1000
const CLICK_MS = 30
const SETTLE_MS = 110
// The rise and the hold after it.
const RISE_MS = 600 + 220
const LETTER_MS = 50
const create_directory = temporary_directory()

function ms_of(samples: ReadonlyArray<number>): number {
	return (samples.length * MS_PER_SECOND) / run_board_sound_shape.SAMPLE_RATE
}

describe('run_board_sound_nixie voices', () => {
	it('clicks a letter, settles a line, rises for a notice', () => {
		expect(ms_of(click())).toBe(CLICK_MS)
		expect(ms_of(settle())).toBe(SETTLE_MS)
		expect(ms_of(rise())).toBe(RISE_MS)
	})

	it('clicks the same every time', () => {
		expect(click()).toStrictEqual(click())
	})

	it('writes its typing, typed-end and notice WAVs, each its own file', () => {
		const directory = create_directory('run-board-sound-nixie-')
		const files = [typing_wav(LETTER_MS, directory), typed_wav(directory), notice_wav(directory)]

		expect(files.every((file) => file?.startsWith(directory))).toBe(true)
		expect(new Set(files).size).toBe(files.length)
	})
})
