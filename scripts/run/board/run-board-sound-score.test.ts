import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_score, type Cue, type Palette, type Score } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_synth } from './run-board-sound-synth'
import { run_board_sound_voice } from './run-board-sound-voice'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// joshuafolkken/kit#8917: a theme's sounds laid out on each event's own time line — one WAV an event,
// rendered once a run, none longer than its effect shows on screen, none louder than the track limit.
// No WAV is written and no sound plays: the writer is stubbed and what it was handed is kept.

const { PEAK_MS, laid, loudest, scaled, score_of } = run_board_sound_score
const { SAMPLE_RATE } = run_board_sound_shape
const { beep } = run_board_sound_voice
const { TICK_MS, PEAK_TICKS, NOTICE_END } = run_board_theme_host_state
const MS_PER_SECOND = 1000
const HZ = 440
const SOUND_MS = 60
const PEAK = 0.2
const LOUD_PEAK = 0.9
// A cue under the track's loudest, so the WAV's scale is left as it was.
const QUIET_PEAK = 0.05
const TRACK_LIMIT = 0.3
const LETTERS = 12
const PART_MS = 2000
const OWN_NOTICE_MS = 9000
// The host's NOTICE on screen, one tick fewer than its peak and tail.
const NOTICE_MS = (PEAK_TICKS + NOTICE_END - 1) * TICK_MS

interface Written {
	name: string
	ms: number
	top: number
}

const palettes = { count: 0 }

function sound(peak = PEAK): Palette['appear'] {
	return { peak, layers: [[beep(HZ, SOUND_MS, 'sine')]] }
}

// A palette of its own name, so the run's render memo never answers for another test's.
function palette_of(more: Partial<Palette> = {}): Palette {
	palettes.count += 1
	const bed = { peak: PEAK, from_gain: 0, drone: { wave: 'sine' as const, hz: HZ, to_hz: HZ } }

	return {
		name: `score-test-${String(palettes.count)}`,
		notice: { call: sound(), bed, peak: sound(), blink: sound(), close: sound() },
		row: { start: sound(), during: bed, end: sound() },
		appear: sound(),
		vanish: sound(),
		...more,
	}
}

// The WAV writer stubbed: each track it was handed, by its name, length and loudest sample.
function writes(): Array<Written> {
	const written: Array<Written> = []

	vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
		const pcm = track.render()

		written.push({
			name: track.name,
			ms: (pcm.length * MS_PER_SECOND) / SAMPLE_RATE,
			top: loudest([...pcm]),
		})

		return `/sounds/${track.name}-${track.key}.wav`
	})

	return written
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_sound_score.score_of lengths', () => {
	it('lays a NOTICE no longer than the host shows it', () => {
		const written = writes()

		score_of(palette_of()).notice()

		expect(written[0]?.ms).toBe(NOTICE_MS)
	})

	it('lays a NOTICE of a theme’s own length to that length', () => {
		const palette = palette_of()
		const written = writes()

		score_of({ ...palette, notice: { ...palette.notice, ms: OWN_NOTICE_MS } }).notice()

		expect(written[0]?.ms).toBe(OWN_NOTICE_MS)
	})

	it('lays a ROW and a PROGRESS as long as their letters type', () => {
		const written = writes()
		const score = score_of(palette_of({ progress_end: sound() }))

		score.row(LETTERS)
		score.progress(LETTERS)

		expect(written.map(({ ms }) => ms)).toStrictEqual([LETTERS * TICK_MS, LETTERS * TICK_MS])
	})

	it('lays an opening and an ending as long as the part', () => {
		const written = writes()
		const score = score_of(palette_of())

		score.part('opening', PART_MS)
		score.part('ending', PART_MS)

		expect(written.map(({ ms }) => ms)).toStrictEqual([PART_MS, PART_MS])
	})
})

describe('run_board_sound_score.score_of tracks', () => {
	it('writes no PROGRESS for a theme with no typed end', () => {
		const written = writes()

		expect(score_of(palette_of()).progress(LETTERS)).toBeUndefined()
		expect(written).toStrictEqual([])
	})

	it('renders each track once a run, the same file answered again', () => {
		const written = writes()
		const score = score_of(palette_of())
		const first = score.notice()

		expect(score.notice()).toBe(first)
		expect(written).toHaveLength(1)
	})

	it('keeps a ROW of other letters a track of its own', () => {
		const written = writes()
		const score = score_of(palette_of())

		expect(score.row(LETTERS)).not.toBe(score.row(LETTERS + 1))
		expect(written).toHaveLength(2)
	})

	it('holds a loud track under the limit', () => {
		const written = writes()

		score_of(palette_of({ appear: sound(LOUD_PEAK) })).appear()

		expect(written[0]?.top).toBeLessThanOrEqual(TRACK_LIMIT * run_board_sound_synth.FULL_SCALE + 1)
	})

	it('sounds the board appearing alone, as long as its sound', () => {
		const written = writes()

		score_of(palette_of()).appear()

		expect(written.map(({ ms }) => ms)).toStrictEqual([SOUND_MS])
	})
})

// The samples the first track `play` asks of the palette's score renders, the writer stubbed.
function track_pcm(palette: Palette, play: (score: Score) => void): Array<number> {
	const rendered: Array<Array<number>> = []

	vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
		rendered.push([...track.render()])

		return '/sounds/track.wav'
	})
	play(score_of(palette))
	vi.restoreAllMocks()

	return rendered[0] ?? []
}

// The samples a part's track renders, the writer stubbed.
function part_pcm(palette: Palette, part: 'opening' | 'ending'): Array<number> {
	return track_pcm(palette, (score) => score.part(part, PART_MS))
}

// The samples a ROW of `LETTERS` renders, the writer stubbed.
function row_pcm(palette: Palette): Array<number> {
	return track_pcm(palette, (score) => score.row(LETTERS))
}

describe('run_board_sound_score.score_of opening cues', () => {
	const CUE_MS = 500
	const cue_at = (CUE_MS * SAMPLE_RATE) / MS_PER_SECOND

	it('mixes each cue into the opening from its time, the track before it unchanged', () => {
		const plain = palette_of()
		const cued = part_pcm(
			{ ...plain, opening_cues: [{ at_ms: CUE_MS, sound: sound() }] },
			'opening',
		)
		const without = part_pcm({ ...plain, name: `${plain.name}-plain` }, 'opening')

		expect(cued.slice(0, cue_at)).toStrictEqual(without.slice(0, cue_at))
		expect(cued.slice(cue_at)).not.toStrictEqual(without.slice(cue_at))
		expect(cued).toHaveLength(without.length)
	})

	it('leaves out a cue past the opening, and the ending, unchanged', () => {
		const plain = palette_of()
		const late = { ...plain, opening_cues: [{ at_ms: PART_MS, sound: sound() }] }

		expect(part_pcm(late, 'opening')).toStrictEqual(part_pcm({ ...plain, name: 'p2' }, 'opening'))
		expect(part_pcm(late, 'ending')).toStrictEqual(part_pcm({ ...plain, name: 'p3' }, 'ending'))
	})

	it('mixes each ending cue into the ending from its time, the opening unchanged', () => {
		const plain = palette_of()
		const cued = { ...plain, ending_cues: [{ at_ms: CUE_MS, sound: sound() }] }
		const ending = part_pcm(cued, 'ending')
		const without = part_pcm({ ...plain, name: `${plain.name}-plain` }, 'ending')

		expect(ending.slice(0, cue_at)).toStrictEqual(without.slice(0, cue_at))
		expect(ending.slice(cue_at)).not.toStrictEqual(without.slice(cue_at))
		expect(part_pcm(cued, 'opening')).toStrictEqual(
			part_pcm({ ...plain, name: `${plain.name}-open` }, 'opening'),
		)
	})
})

describe('run_board_sound_score.score_of ROW beats and ring', () => {
	const TYPING_MS = LETTERS * TICK_MS
	const BEAT_MS = TYPING_MS / 2
	const beat_at = (BEAT_MS * SAMPLE_RATE) / MS_PER_SECOND
	const typed_at = (TYPING_MS * SAMPLE_RATE) / MS_PER_SECOND
	const RING_MS = 1000

	it('asks the beats of the ROW’s letters and mixes each from its time', () => {
		const asked: Array<number> = []
		const plain = palette_of()

		function beats(letters: number): ReadonlyArray<Cue> {
			asked.push(letters)

			return [{ at_ms: BEAT_MS, sound: sound(QUIET_PEAK) }]
		}

		const beaten = row_pcm({ ...plain, row: { ...plain.row, beats } })
		const without = row_pcm({ ...plain, name: `${plain.name}-plain` })

		expect(asked).toStrictEqual([LETTERS])
		expect(beaten.slice(0, beat_at)).toStrictEqual(without.slice(0, beat_at))
		expect(beaten.slice(beat_at)).not.toStrictEqual(without.slice(beat_at))
	})

	it('leaves out a beat past the typing', () => {
		const plain = palette_of()
		const late = { ...plain.row, beats: () => [{ at_ms: TYPING_MS, sound: sound() }] }

		expect(row_pcm({ ...plain, row: late })).toStrictEqual(
			row_pcm({ ...plain, name: `${plain.name}-plain` }),
		)
	})

	it('starts a ringing end as the letters finish and lays the track past them', () => {
		const plain = palette_of()
		const ringing = row_pcm({ ...plain, row: { ...plain.row, ring_ms: RING_MS } })
		const end_at = typed_at + (SOUND_MS * SAMPLE_RATE) / MS_PER_SECOND

		expect(ringing).toHaveLength(((TYPING_MS + RING_MS) * SAMPLE_RATE) / MS_PER_SECOND)
		expect(loudest(ringing.slice(typed_at, end_at))).toBeGreaterThan(0)
		expect(loudest(ringing.slice(end_at))).toBe(0)
	})
})

describe('run_board_sound_score helpers', () => {
	it('lays parts into a track long enough for the last of them', () => {
		const track = laid([{ at_ms: SOUND_MS, samples: [1, 1], gain: 1 }], 0)

		expect(track).toHaveLength((SOUND_MS * SAMPLE_RATE) / MS_PER_SECOND + 2)
		expect(track.at(-1)).toBe(1)
	})

	it('scales samples to a peak, silence left as it is', () => {
		expect(scaled([0.5, -1], PEAK)).toStrictEqual([PEAK / 2, -PEAK])
		expect(scaled([0, 0], PEAK)).toStrictEqual([0, 0])
	})

	it('peaks after the host’s peak ticks', () => {
		expect(PEAK_MS).toBe(PEAK_TICKS * TICK_MS)
	})
})
