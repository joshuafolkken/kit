import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_palettes_film } from './run-board-sound-palettes-film'
import { run_board_sound_score, type Palette } from './run-board-sound-score'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice } from './run-board-sound-voice'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_sound_wopr } from './run-board-sound-wopr'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_wopr } from './run-board-theme-wopr'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'

// joshuafolkken/kit#8917: the film boards' palettes. wopr's NOTICE lasts as its screen effect does; its
// last lines type to the terminal's pips, which stop as they are through, and the typed end sounds
// there once. No WAV is written and no sound plays: the writer is stubbed.

const { FLUX, TRACE, WOPR, wopr_typed_wav } = run_board_sound_palettes_film
const { TICK_MS } = run_board_theme_host_state
const { CLOSE_FROM, CLOSE_TYPED, EFFECT_END } = run_board_theme_wopr_phase
const { sample_at } = run_board_sound_voice
const MS_PER_SECOND = 1000
// The typed end's pip, rest and falling carriage.
const TYPED_MS = 30 + 40 + 120
const { PEAK_MS } = run_board_sound_score
const PART_MS = 3000
// The build's last beep rings this long past the peak at the most.
const SPILL_MS = 300
const BED_PACE = { every_ms: 420, to_every_ms: 180, jitter: 0.8 }
// A 16-bit sample's bytes.
const SAMPLE_BYTES = 2

function ms_of(samples: { length: number }): number {
	return (samples.length * MS_PER_SECOND) / run_board_sound_shape.SAMPLE_RATE
}

function is_silent(samples: ReadonlyArray<number>): boolean {
	return samples.every((value) => value === 0)
}

// The opening, the ending and the NOTICE a palette's score renders, as the bytes of their samples.
function tracks_of(palette: Palette): { opening: Buffer; ending: Buffer; notice: Buffer } {
	const rendered: Array<Buffer> = []

	vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
		const pcm = track.render()

		rendered.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))

		return `/sounds/${track.name}.wav`
	})
	const score = run_board_sound_score.score_of(palette)

	score.part('opening', PART_MS)
	score.part('ending', PART_MS)
	score.notice()
	vi.restoreAllMocks()
	const [opening = Buffer.alloc(0), ending = Buffer.alloc(0), notice = Buffer.alloc(0)] = rendered

	return { opening, ending, notice }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_sound_palettes_film palettes', () => {
	it('names each palette after its theme', () => {
		expect([WOPR.name, TRACE.name, FLUX.name]).toStrictEqual(['wopr', 'trace', 'flux'])
	})

	it('lasts wopr’s NOTICE as long as its screen effect', () => {
		expect(WOPR.notice.ms).toBe(run_board_theme_wopr.NOTICE_LASTS * TICK_MS)
	})

	it('gives flux alone a PROGRESS typed end among the film boards', () => {
		expect([WOPR, TRACE, FLUX].map((palette) => palette.progress_end !== undefined)).toStrictEqual([
			false,
			false,
			true,
		])
	})
})

describe('run_board_sound_palettes_film wopr after its peak', () => {
	const after = WOPR.notice.after_peak?.() ?? []
	const typed_at = sample_at(CLOSE_TYPED * TICK_MS)

	it('runs from the peak to the effect’s end', () => {
		expect(ms_of(after)).toBe(EFFECT_END * TICK_MS)
	})

	it('sounds the pips while the last lines type', () => {
		const typing = after.slice(sample_at(CLOSE_FROM * TICK_MS + TICK_MS), typed_at)

		expect(is_silent(typing)).toBe(false)
	})

	it('sounds the typed end once the last lines are through, then nothing', () => {
		const typed = after.slice(typed_at, sample_at(CLOSE_TYPED * TICK_MS + TYPED_MS))
		const rest = after.slice(sample_at(CLOSE_TYPED * TICK_MS + TYPED_MS))

		expect(is_silent(typed)).toBe(false)
		expect(is_silent(rest)).toBe(true)
	})
})

// joshuafolkken/kit#9137: wopr's build has its own bed and cues; `bed` — the opening's, the ending's and
// the held one after the peak — and every track but the build sound as before.
describe('run_board_sound_palettes_film wopr’s build apart from its bed', () => {
	// The build as it was: `bed` rising to the peak, no cue.
	const plain = { ...WOPR.notice, build: WOPR.notice.bed, cues: [] }
	const now = tracks_of({ ...WOPR, name: 'wopr-build-now' })
	const before = tracks_of({ ...WOPR, name: 'wopr-build-before', notice: plain })
	const settled = sample_at(PEAK_MS + SPILL_MS) * SAMPLE_BYTES

	it('keeps the bed the opening, the ending and the held bed play', () => {
		expect(WOPR.notice.bed).toStrictEqual({
			peak: 0.08,
			from_gain: 0.5,
			drone: { wave: 'triangle', hz: 55, to_hz: 70 },
			pulse: { wave: 'square', hz: 1200, to_hz: 1200, ms: 25, ...BED_PACE },
		})
	})

	it('leaves the opening and the ending sample for sample', () => {
		expect(now.opening).toStrictEqual(before.opening)
		expect(now.ending).toStrictEqual(before.ending)
	})

	it('changes the NOTICE before its peak only', () => {
		expect(now.notice.subarray(0, settled).equals(before.notice.subarray(0, settled))).toBe(false)
		expect(now.notice.subarray(settled).equals(before.notice.subarray(settled))).toBe(true)
	})

	it('plays the game’s moves over a ROW’s noise alone, at half the former bed’s peak', () => {
		expect(WOPR.row.during).toStrictEqual({
			peak: 0.035,
			from_gain: 1,
			drone: { wave: 'noise', hz: 0, to_hz: 0 },
		})
		expect(WOPR.row.beats).toBe(run_board_sound_wopr.row_beats)
		expect([WOPR.row.start, WOPR.row.end]).toStrictEqual([
			run_board_sound_wopr.LOCK_HIGH,
			run_board_sound_wopr.LOCK_LOW,
		])
	})
})

describe('run_board_sound_palettes_film tracks', () => {
	it.each([WOPR, TRACE, FLUX])('lays the $name tracks no longer than their events', (palette) => {
		const lengths: Array<number> = []

		vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
			lengths.push(ms_of(track.render()))

			return `/sounds/${track.name}.wav`
		})
		const score = run_board_sound_score.score_of({ ...palette, name: `${palette.name}-test` })
		const letters = 20

		score.row(letters)
		score.notice()

		expect(lengths[0]).toBe(letters * TICK_MS)
		expect(lengths[1]).toBe(palette.notice.ms ?? lengths[1])
	})

	it('writes wopr’s typed end as its own WAV', () => {
		const names: Array<string> = []

		vi.spyOn(run_board_sound_wav, 'resolved_samples').mockImplementation((track) => {
			names.push(track.name)

			return ms_of(track.render()) === TYPED_MS ? 'typed.wav' : undefined
		})

		expect(wopr_typed_wav()).toBe('typed.wav')
		expect(names).toStrictEqual(['wopr-typed'])
	})
})
