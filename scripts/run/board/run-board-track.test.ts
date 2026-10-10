import { describe, expect, it } from 'vitest'
import type { Phase } from './run-board-phase'
import { run_board_track } from './run-board-track'

// joshuafolkken/kit#3460: a running row's phases as the icons of the phases it has passed.
// joshuafolkken/kit#3526: a history that grows with every round and draws nothing ahead.

const { track_of } = run_board_track

describe('run_board_track.track_of', () => {
	it('draws the phases passed and no line for any ahead', () => {
		expect(track_of(['investigate'])).toBe('🔍')
		expect(track_of(['investigate', 'plan', 'implement'])).toBe('🔍📝🔨')
		expect(track_of(['investigate', 'plan', 'implement'])).not.toContain('─')
	})

	it('draws a failed ship as 🚢💥 and the implement it went back to', () => {
		const track = track_of([
			'investigate',
			'plan',
			'implement',
			'ship',
			'failed',
			'implement',
			'ship',
			'review',
			'gate',
		])

		expect(track).toBe('🔍📝🔨🚢💥🔨🚢👀🚦')
	})

	it('draws nothing for no phase', () => {
		expect(track_of([])).toBe('')
	})
})

describe('run_board_track.track_of ship stages', () => {
	it('draws every ship stage with its own icon', () => {
		const stages: ReadonlyArray<Phase> = [
			'ship',
			'review',
			'gate',
			'sync',
			'commit',
			'round_two',
			'followup',
			'report',
		]

		expect(track_of(stages)).toBe('🚢👀🚦🔀📦🔂⚓📣')
	})
})
