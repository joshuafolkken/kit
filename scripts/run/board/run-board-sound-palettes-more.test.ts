import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_palettes_more } from './run-board-sound-palettes-more'
import { run_board_sound_score } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// joshuafolkken/kit#8917: the other boards' palettes — codec, nixie, skynet and magi — and magi's own
// typing and typed end. No WAV is written and no sound plays: the writer is stubbed.

const { CODEC, MAGI, NIXIE, SKYNET, magi_typed_wav, magi_typing_wav } =
	run_board_sound_palettes_more
const { TICK_MS, PEAK_TICKS, NOTICE_END } = run_board_theme_host_state
const MS_PER_SECOND = 1000
const LETTER_MS = 50
const LETTERS = 20
// The confirming pair magi's typed end sounds.
const CONFIRM_MS = 40 + 50
// The host's NOTICE on screen, one tick fewer than its peak and tail.
const NOTICE_MS = (PEAK_TICKS + NOTICE_END - 1) * TICK_MS

interface Track {
	name: string
	ms: number
}

function ms_of(samples: { length: number }): number {
	return (samples.length * MS_PER_SECOND) / run_board_sound_shape.SAMPLE_RATE
}

// The WAV writer stubbed: each track it was handed, by its name and length.
function written(): Array<Track> {
	const tracks: Array<Track> = []

	vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
		tracks.push({ name: track.name, ms: ms_of(track.render()) })

		return `/sounds/${track.name}.wav`
	})

	return tracks
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_sound_palettes_more palettes', () => {
	it('names each palette after its theme', () => {
		expect([CODEC, NIXIE, SKYNET, MAGI].map(({ name }) => name)).toStrictEqual([
			'codec',
			'nixie',
			'skynet',
			'magi',
		])
	})

	it.each([CODEC, NIXIE, SKYNET, MAGI])(
		'lays the $name NOTICE and ROW no longer than they show',
		(palette) => {
			const tracks = written()
			const score = run_board_sound_score.score_of({ ...palette, name: `${palette.name}-test` })

			score.notice()
			score.row(LETTERS)

			expect(tracks.map(({ ms }) => ms)).toStrictEqual([NOTICE_MS, LETTERS * TICK_MS])
		},
	)
})

describe('run_board_sound_palettes_more magi voice', () => {
	it('types magi a click a letter, as many letters as the teletype trill', () => {
		const tracks = written()

		magi_typing_wav(LETTER_MS)

		expect(tracks).toStrictEqual([
			{ name: 'magi-typing', ms: LETTER_MS * run_board_sound_typing.TRILL_PAIRS },
		])
	})

	it('ends a magi line with its confirming pair', () => {
		const tracks = written()

		magi_typed_wav()

		expect(tracks).toStrictEqual([{ name: 'magi-typed', ms: CONFIRM_MS }])
	})
})
