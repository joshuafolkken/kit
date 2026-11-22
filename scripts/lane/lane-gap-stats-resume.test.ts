import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_gap_stats } from './lane-gap-stats'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#8583: a resumed session's wait until its first progress — its first edit or its ship
// launch, whichever comes first, bounded by the issue's next cut.

const NOW = Date.parse('2026-11-22T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const MS_PER_SECOND = 1000
const ISSUE = '#4300'
const GAP = 'resume → progress'
const UNMEASURED = 'not measured | not measured'

function event(kind: string, text: string, seconds_before: number): RunEvent {
	return { pos: 0, at: new Date(NOW - seconds_before * MS_PER_SECOND).toISOString(), kind, text }
}

function row_of(events: ReadonlyArray<RunEvent>): string | undefined {
	return lane_gap_stats
		.table([], WINDOW, events)
		.split('\n')
		.find((line) => line.startsWith(`| ${GAP} |`))
}

const RESUME_KIND = 'resume'
const RESUME = event(RESUME_KIND, `${ISSUE} resumed`, 100)
const GATE_RESUME = event(RESUME_KIND, `${ISSUE} resumed (gate)`, 100)

function first_edit(seconds_before: number, issue = ISSUE): RunEvent {
	return event('lane-phase', `${issue} implement`, seconds_before)
}

function ship_launch(seconds_before: number): RunEvent {
	return event('ship-launch', `${ISSUE} ship supervisor launched`, seconds_before)
}

describe('lane_gap_stats.table -- resume → progress', () => {
	it('ends a resume at its first edit when that comes before the ship launch', () => {
		const events = [RESUME, first_edit(95, '#4356'), first_edit(70), ship_launch(40)]

		expect(row_of(events)).toBe(`| ${GAP} | 1 | 30 | 30 | 0 |`)
	})

	it('ends a gate resume at its ship launch when no edit came first', () => {
		const events = [GATE_RESUME, ship_launch(60), first_edit(20)]

		expect(row_of(events)).toBe(`| ${GAP} | 1 | 40 | 40 | 0 |`)
	})

	it('counts a resume whose next cut came before any progress as not ended', () => {
		const events = [RESUME, event('cut', `${ISSUE} cut (implementation)`, 50), first_edit(20)]

		expect(row_of(events)).toBe(`| ${GAP} | 1 | ${UNMEASURED} | 1 |`)
	})
})
