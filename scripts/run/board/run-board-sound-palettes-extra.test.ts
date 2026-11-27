import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_palettes_extra } from './run-board-sound-palettes-extra'
import { run_board_sound_score } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_sound_voice } from './run-board-sound-voice'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// joshuafolkken/kit#9096: isac's and ghost's palettes, and the typing loop and typed end each board's
// voices write from two of its sounds. No WAV is written and no sound plays: the writer is stubbed.

const { GHOST, GHOST_VOICES, ISAC, ISAC_VOICES, voices_of } = run_board_sound_palettes_extra
const { beep } = run_board_sound_voice
const { TICK_MS, PEAK_TICKS, NOTICE_END } = run_board_theme_host_state
const MS_PER_SECOND = 1000
const LETTER_MS = 50
const LETTERS = 20
// Each board's typed end: isac's high pip, ghost's rising chirp.
const ISAC_END_MS = 70
const GHOST_END_MS = 60
const HZ = 440
const END_MS = 80
const PEAK = 0.1
// The host's NOTICE on screen, one tick fewer than its peak and tail.
const NOTICE_MS = (PEAK_TICKS + NOTICE_END - 1) * TICK_MS

interface Track {
	name: string
	key: string
	ms: number
}

function ms_of(samples: { length: number }): number {
	return (samples.length * MS_PER_SECOND) / run_board_sound_shape.SAMPLE_RATE
}

// The WAV writer stubbed: each track it was handed, by its name, key and length.
function written(): Array<Track> {
	const tracks: Array<Track> = []

	vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
		tracks.push({ name: track.name, key: track.key, ms: ms_of(track.render()) })

		return `/sounds/${track.name}.wav`
	})

	return tracks
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_sound_palettes_extra palettes', () => {
	it('names each palette after its theme', () => {
		expect([ISAC.name, GHOST.name]).toStrictEqual(['isac', 'ghost'])
	})

	it('gives both boards a PROGRESS typed end and the host’s NOTICE length', () => {
		expect([ISAC, GHOST].map((palette) => palette.progress_end !== undefined)).toStrictEqual([
			true,
			true,
		])
		expect([ISAC.notice.ms, GHOST.notice.ms]).toStrictEqual([undefined, undefined])
	})

	it.each([ISAC, GHOST])('lays the $name NOTICE and ROW no longer than they show', (palette) => {
		const tracks = written()
		const score = run_board_sound_score.score_of({ ...palette, name: `${palette.name}-test` })

		score.notice()
		score.row(LETTERS)

		expect(tracks.map(({ ms }) => ms)).toStrictEqual([NOTICE_MS, LETTERS * TICK_MS])
	})
})

describe('run_board_sound_palettes_extra voices', () => {
	it.each([
		['isac', ISAC_VOICES, ISAC_END_MS],
		['ghost', GHOST_VOICES, GHOST_END_MS],
	] as const)('writes %s’s typing loop and its typed end', (name, voices, end_ms) => {
		const tracks = written()

		expect(voices.typing_wav(LETTER_MS)).toBe(`/sounds/${name}-typing.wav`)
		expect(voices.typed_wav()).toBe(`/sounds/${name}-typed.wav`)
		expect(tracks).toStrictEqual([
			{
				name: `${name}-typing`,
				key: String(LETTER_MS),
				ms: LETTER_MS * run_board_sound_typing.TRILL_PAIRS,
			},
			{ name: `${name}-typed`, key: '', ms: end_ms },
		])
	})

	it('builds a board’s voices from its letter and its end', () => {
		const tracks = written()
		const end = { peak: PEAK, layers: [[beep(HZ, END_MS, 'sine')]] }
		const voices = voices_of('voices-test', end, end)

		voices.typed_wav()

		expect(tracks).toStrictEqual([{ name: 'voices-test-typed', key: '', ms: END_MS }])
	})
})
