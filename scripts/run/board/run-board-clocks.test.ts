import { describe, expect, it } from 'vitest'
import { run_board_clocks, type ClockHeader } from './run-board-clocks'
import { run_board_labels } from './run-board-labels'

// joshuafolkken/kit#8478: the header's clock column — the finish over now over the start, all dated once
// one falls on another day, the finish `--:--` where none is known and the end once the run ended. The
// icons stay emoji; a theme's glyph table draws them (joshuafolkken/kit#8505).

const { clocks_of } = run_board_clocks
const { day_minute_of, minute_of } = run_board_labels
const MINUTE = 60_000
const HOUR = 60 * MINUTE
// Noon in local time, so an hour either way stays on the same day whatever the zone.
const NOW = new Date(2026, 10, 22, 12, 0).getTime()
const STARTED = NOW - HOUR

function header(extra: Partial<ClockHeader> = {}): ClockHeader {
	return { now_ms: NOW, started_ms: STARTED, ended_ms: undefined, ...extra }
}

describe('run_board_clocks.clocks_of', () => {
	it('draws the finish, now and the start in HH:MM on one day', () => {
		const finish = NOW + HOUR

		expect(clocks_of(header(), finish)).toStrictEqual([
			`🎯 ${minute_of(finish)}`,
			`🕒 ${minute_of(NOW)}`,
			`🚀 ${minute_of(STARTED)}`,
		])
	})

	it('dates all three once the finish falls on another day', () => {
		const finish = NOW + 24 * HOUR

		expect(clocks_of(header(), finish)).toStrictEqual([
			`🎯 ${day_minute_of(finish)}`,
			`🕒 ${day_minute_of(NOW)}`,
			`🚀 ${day_minute_of(STARTED)}`,
		])
	})
})

describe('run_board_clocks.clocks_of finish and start', () => {
	it('draws an unknown finish --:-- at the clocks’ width', () => {
		const [same_day] = clocks_of(header(), undefined)
		const [crossed] = clocks_of(header({ started_ms: NOW - 24 * HOUR }), undefined)

		expect(same_day).toBe('🎯 --:--')
		expect(crossed).toBe(`🎯 ${'--:--'.padStart(day_minute_of(NOW).length)}`)
	})

	it('draws an ended run’s finish as when it ended', () => {
		const ended = NOW - MINUTE

		expect(clocks_of(header({ ended_ms: ended }), NOW + HOUR)[0]).toBe(`🎯 ${minute_of(ended)}`)
	})
})
