import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_score, type Palette } from './run-board-sound-score'
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

// The samples a part's track renders, the writer stubbed.
function part_pcm(palette: Palette, part: 'opening' | 'ending'): Array<number> {
	const rendered: Array<Array<number>> = []

	vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
		rendered.push([...track.render()])

		return '/sounds/part.wav'
	})
	score_of(palette).part(part, PART_MS)
	vi.restoreAllMocks()

	return rendered[0] ?? []
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
