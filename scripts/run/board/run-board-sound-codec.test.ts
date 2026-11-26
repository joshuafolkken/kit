import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_codec } from './run-board-sound-codec'
import { run_board_sound_shape } from './run-board-sound-shape'

// joshuafolkken/kit#8917: the codec theme's own voices — a radio pip a letter, a burst of static as a
// line ends, and a two-tone call for the NOTICE.

const { burst, call, notice_wav, pip, typed_wav, typing_wav } = run_board_sound_codec
const MS_PER_SECOND = 1000
const PIP_MS = 15
const STATIC_MS = 120
// The call's first tone, gap and second tone.
const CALL_MS = 120 + 40 + 200
const LETTER_MS = 50
const create_directory = temporary_directory()

function ms_of(samples: ReadonlyArray<number>): number {
	return (samples.length * MS_PER_SECOND) / run_board_sound_shape.SAMPLE_RATE
}

describe('run_board_sound_codec voices', () => {
	it('pips a letter, bursts static as a line ends, calls in two tones for a notice', () => {
		expect(ms_of(pip())).toBe(PIP_MS)
		expect(ms_of(burst())).toBe(STATIC_MS)
		expect(ms_of(call())).toBe(CALL_MS)
	})

	it('bursts the same static every time', () => {
		expect(burst()).toStrictEqual(burst())
	})

	it('writes its typing, typed-end and notice WAVs, each its own file', () => {
		const directory = create_directory('run-board-sound-codec-')
		const files = [typing_wav(LETTER_MS, directory), typed_wav(directory), notice_wav(directory)]

		expect(files.every((file) => file?.startsWith(directory))).toBe(true)
		expect(new Set(files).size).toBe(files.length)
	})
})
