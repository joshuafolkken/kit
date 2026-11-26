import { describe, expect, it, vi } from 'vitest'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_theme_sound } from './run-board-theme-sound'

const { SILENT, is_crossed, opening_sound_of, sounded, trill_left } = run_board_theme_sound
const { THEME_DEFS } = run_board_theme_defs

describe('run_board_theme_sound.opening_sound_of', () => {
	it('keeps the wargames intro: its line typed with the trill, the typed end after it', () => {
		const { line, letter_ms } = THEME_DEFS.wopr.intro
		const typed_ms = line.length * letter_ms

		expect(opening_sound_of('wopr')).toEqual({
			spans: [{ from_ms: 0, to_ms: typed_ms }],
			typed_ms,
		})
	})

	it('keeps the matrix intro: each lead line typed, its hold and gap silent, no typed end', () => {
		const { letter_ms, leads } = THEME_DEFS.trace.intro
		const sound = opening_sound_of('trace')
		const [first, second] = sound.spans
		const first_ms = (leads.lines[0]?.length ?? 0) * letter_ms

		expect(sound.spans).toHaveLength(leads.lines.length)
		expect(first).toEqual({ from_ms: 0, to_ms: first_ms })
		expect(second?.from_ms).toBe(first_ms + leads.hold_ms + leads.gap_ms)
		expect(sound.typed_ms).toBeUndefined()
	})

	it('sounds nothing in no theme', () => {
		expect(opening_sound_of(undefined)).toBe(SILENT)
	})

	// joshuafolkken/kit#8917 (Issue 4-3): three of the works the demo added sound the wargames opening.
	it.each(['codec', 'nixie', 'skynet'] as const)('sounds the %s opening as wopr', (theme) => {
		expect(opening_sound_of(theme)).toStrictEqual(opening_sound_of('wopr'))
	})
})

// joshuafolkken/kit#8917: wopr and magi each end their opening as their own line types through.
describe('run_board_theme_sound.opening_sound_of typed end', () => {
	it('ends the wopr opening at 1050 ms and the magi opening at its own title, 1000 ms', () => {
		expect(opening_sound_of('wopr').typed_ms).toBe(1050)
		expect(opening_sound_of('magi')).toStrictEqual({
			spans: [{ from_ms: 0, to_ms: 1000 }],
			typed_ms: 1000,
		})
	})

	it('keeps the flux opening its own: the keypad line typed, the typed end after it', () => {
		const { line, letter_ms } = THEME_DEFS.flux.intro
		const typed_ms = line.length * letter_ms

		expect(opening_sound_of('flux')).toEqual({ spans: [{ from_ms: 0, to_ms: typed_ms }], typed_ms })
	})
})

describe('run_board_theme_sound.is_crossed', () => {
	const sound = { spans: [], typed_ms: 1000 }

	it('crosses once, on the first frame at or past the moment', () => {
		expect(is_crossed(sound, 900, 999)).toBe(false)
		expect(is_crossed(sound, 900, 1500)).toBe(true)
		expect(is_crossed(sound, 1500, 1550)).toBe(false)
		expect(is_crossed(sound, undefined, 2000)).toBe(true)
	})
})

describe('run_board_theme_sound.sounded', () => {
	const sound = { spans: [{ from_ms: 0, to_ms: 500 }], typed_ms: 500 }

	it('sounds the trill untimed while the opening types, its typed end not yet crossed', () => {
		const trill = { set: vi.fn(), typed: vi.fn() }

		sounded(trill, sound, { last_ms: undefined, since_ms: 100 }, { is_on: false, left_ms: 0 })

		expect(trill.set).toHaveBeenCalledWith(true, undefined)
		expect(trill.typed).not.toHaveBeenCalled()
		expect(trill_left(sound, 600)).toBe(0)
	})

	it('times the trill by the board once the opening typed through, its typed end once', () => {
		const trill = { set: vi.fn(), typed: vi.fn() }

		sounded(trill, sound, { last_ms: 450, since_ms: 520 }, { is_on: true, left_ms: 300 })
		sounded(trill, sound, { last_ms: 520, since_ms: 600 }, { is_on: false, left_ms: 0 })

		expect(trill.set.mock.calls).toStrictEqual([
			[true, 300],
			[false, 0],
		])
		expect(trill.typed).toHaveBeenCalledOnce()
	})
})
