import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_skynet } from './run-board-sound-skynet'

// joshuafolkken/kit#8917: the skynet theme's own voices — a square blip a letter, a low buzz as a line
// ends, and a two-tone alarm three times over for the NOTICE.

const { alarm, blip, buzz, notice_wav, typed_wav, typing_wav } = run_board_sound_skynet
const MS_PER_SECOND = 1000
const BLIP_MS = 12
const BUZZ_MS = 260
// Three figures of a high tone, a low tone and a gap.
const FIGURE_MS = 90 + 90 + 40
const REPEATS = 3
const LETTER_MS = 50
const create_directory = temporary_directory()

function ms_of(samples: ReadonlyArray<number>): number {
	return (samples.length * MS_PER_SECOND) / run_board_sound_shape.SAMPLE_RATE
}

describe('run_board_sound_skynet voices', () => {
	it('blips a letter, buzzes a line’s end, sounds the alarm three times for a notice', () => {
		expect(ms_of(blip())).toBe(BLIP_MS)
		expect(ms_of(buzz())).toBe(BUZZ_MS)
		expect(ms_of(alarm())).toBe(FIGURE_MS * REPEATS)
	})

	it('repeats one alarm figure', () => {
		const samples = alarm()
		const figure = samples.length / REPEATS

		expect(samples.slice(figure, figure + figure)).toStrictEqual(samples.slice(0, figure))
	})

	it('writes its typing, typed-end and notice WAVs, each its own file', () => {
		const directory = create_directory('run-board-sound-skynet-')
		const files = [typing_wav(LETTER_MS, directory), typed_wav(directory), notice_wav(directory)]

		expect(files.every((file) => file?.startsWith(directory))).toBe(true)
		expect(new Set(files).size).toBe(files.length)
	})
})
