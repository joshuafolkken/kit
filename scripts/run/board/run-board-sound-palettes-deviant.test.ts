import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_palettes_deviant } from './run-board-sound-palettes-deviant'
import { run_board_sound_score, type Cue } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_tables } from './run-board-theme-deviant-tables'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// joshuafolkken/kit#9096: the deviant board's palette — its NOTICE as long as the host shows it with
// the afterglow from the peak, a ROW's beats on the timeline's ticks and its end ringing past the
// letters, the OPENING's and ENDING's cues, and its voices. No WAV is written and no sound plays.

const { DEVIANT, DEVIANT_VOICES } = run_board_sound_palettes_deviant
const { loudest, score_of } = run_board_sound_score
const { TICK_MS, PEAK_TICKS, NOTICE_END } = run_board_theme_host_state
const { MENU, STAMP, TIMELINE } = run_board_theme_deviant_data
const { CARD_AT, RESULTS } = run_board_theme_deviant_tables
const MS_PER_SECOND = 1000
const LETTER_MS = 50
const LETTERS = 40
const PART_MS = 6000
// The afterglow's pad, very quiet; the end's ring past the letters; the typed end's ping.
const AFTERGLOW_PEAK = 0.02
const RING_MS = 1900
const TYPED_MS = 90
const PRECISION = 6
// The host's NOTICE on screen, one tick fewer than its peak and tail.
const NOTICE_MS = (PEAK_TICKS + NOTICE_END - 1) * TICK_MS
// The OPENING's cues besides a click a menu bar: the hum, three screen changes, the menu pad, the
// plate's ping and the chapter card's chime.
const OPENING_OTHERS = 7

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

function beats_of(letters: number): ReadonlyArray<Cue> {
	return DEVIANT.row.beats?.(letters) ?? []
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_sound_palettes_deviant NOTICE', () => {
	it('names the palette and lasts its NOTICE as the host shows it', () => {
		expect(DEVIANT.name).toBe('deviant')
		expect(DEVIANT.notice.ms).toBe(NOTICE_MS)
	})

	it('lays the afterglow from the peak to the NOTICE’s end, very quiet', () => {
		const after = DEVIANT.notice.after_peak?.() ?? []

		expect(ms_of(after)).toBe(NOTICE_MS - PEAK_TICKS * TICK_MS)
		expect(loudest(after)).toBeCloseTo(AFTERGLOW_PEAK, PRECISION)
	})
})

describe('run_board_sound_palettes_deviant ROW', () => {
	it('beats once a timeline tick, in order, while the head plays', () => {
		const times = beats_of(LETTERS).map(({ at_ms }) => at_ms)

		expect(times).toHaveLength(TIMELINE.ticks)
		expect(times).toStrictEqual(times.toSorted((left, right) => left - right))
		expect(times.every((at) => at > STAMP.rewind * TICK_MS && at < LETTERS * TICK_MS)).toBe(true)
	})

	it('beats louder on the ticks a clue card hangs from', () => {
		const beats = beats_of(LETTERS)
		const top = Math.max(...beats.map(({ sound }) => sound.peak))
		const cards = beats.filter(({ sound }) => sound.peak === top)

		expect(cards).toHaveLength(Object.keys(CARD_AT).length)
	})

	it('holds every beat at the rewind’s end when nothing plays past it', () => {
		const times = beats_of(STAMP.rewind).map(({ at_ms }) => at_ms)

		expect(new Set(times)).toStrictEqual(new Set([STAMP.rewind * TICK_MS]))
	})

	it('rings its end past the letters', () => {
		const tracks = written()

		score_of({ ...DEVIANT, name: 'deviant-row-test' }).row(LETTERS)

		expect(DEVIANT.row.ring_ms).toBe(RING_MS)
		expect(tracks.map(({ ms }) => ms)).toStrictEqual([LETTERS * TICK_MS + RING_MS])
	})
})

describe('run_board_sound_palettes_deviant parts', () => {
	it('cues the OPENING from its start, a click a menu bar', () => {
		const cues = DEVIANT.opening_cues ?? []

		expect(cues).toHaveLength(OPENING_OTHERS + MENU.words.length)
		expect(cues[0]?.at_ms).toBe(0)
	})

	it('cues the ENDING’s swell from its start and UI sound two as the numbers come', () => {
		const times = (DEVIANT.ending_cues ?? []).map(({ at_ms }) => at_ms)

		expect(times).toStrictEqual([0, RESULTS.first_from * TICK_MS])
	})

	it('lays the NOTICE, the OPENING and the ENDING no longer than they show', () => {
		const tracks = written()
		const score = score_of({ ...DEVIANT, name: 'deviant-part-test' })

		score.notice()
		score.part('opening', PART_MS)
		score.part('ending', PART_MS)

		expect(tracks.map(({ ms }) => ms)).toStrictEqual([NOTICE_MS, PART_MS, PART_MS])
	})
})

describe('run_board_sound_palettes_deviant voices', () => {
	it('writes the typing loop and the typed end', () => {
		const tracks = written()

		DEVIANT_VOICES.typing_wav(LETTER_MS)
		DEVIANT_VOICES.typed_wav()

		expect(tracks).toStrictEqual([
			{ name: 'deviant-typing', ms: LETTER_MS * run_board_sound_typing.TRILL_PAIRS },
			{ name: 'deviant-typed', ms: TYPED_MS },
		])
	})
})
