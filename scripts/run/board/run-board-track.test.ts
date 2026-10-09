import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_phase, type Phase } from './run-board-phase'
import { run_board_track } from './run-board-track'

// joshuafolkken/kit#3460: a running row's phase as the icons of the phases it has passed and a `──` for
// each one ahead, fourteen columns at every phase.

const { track_of } = run_board_track
const TRACK_COLUMNS = 14
const EMOJI_COLUMNS = 2
const AHEAD = '─'
const segmenter = new Intl.Segmenter()

// A track's columns as a terminal draws them: an emoji two, the line one.
function columns_of(track: string): number {
	const segments = [...segmenter.segment(stripVTControlCharacters(track))]

	return segments.reduce((sum, { segment }) => sum + (segment === AHEAD ? 1 : EMOJI_COLUMNS), 0)
}

describe('run_board_track.track_of', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it.each([
		['investigate', '🔍────────────'],
		['implement', '🔍📝🔨────────'],
		['gate', '🔍📝🔨👀🚦────'],
		['followup', '🔍📝🔨👀🚦📦🔁'],
	] as const)('draws the phases passed at %s and a dim line for each ahead', (phase, expected) => {
		expect(stripVTControlCharacters(track_of(phase))).toBe(expected)
	})

	it('is fourteen columns at every phase', () => {
		const tracked: ReadonlyArray<Phase> = run_board_phase.PHASES.filter(
			(phase) => phase !== 'merged',
		)

		expect(tracked.map((phase) => columns_of(track_of(phase)))).toStrictEqual(
			tracked.map(() => TRACK_COLUMNS),
		)
	})

	it('draws the line without an escape where the output has no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(track_of('plan')).toBe('🔍📝──────────')
	})

	it('names the phases passed, its own included', () => {
		expect(run_board_track.passed_of('investigate')).toStrictEqual(['investigate'])
		expect(run_board_track.passed_of('plan')).toStrictEqual(['investigate', 'plan'])
	})
})
