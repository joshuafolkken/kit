import { figure_format } from '#scripts/lib/figure-format'
import { describe, expect, it } from 'vitest'
import { run_board_clocks, type ClockHeader } from './run-board-clocks'
import { run_board_labels } from './run-board-labels'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8478: the header's clock column — the finish over now over the start, all dated once
// one falls on another day, the finish `--:--` where none is known and the end once the run ended. The
// icons stay emoji; a theme's glyph table draws them (joshuafolkken/kit#8505).

const { clocks_of } = run_board_clocks
const { minute_of } = run_board_labels
const { day_of } = figure_format
const MINUTE = 60_000
const HOUR = 60 * MINUTE
// Noon in local time, so an hour either way stays on the same day whatever the zone.
const NOW = new Date(2026, 10, 22, 12, 0).getTime()
const STARTED = NOW - HOUR

function header(extra: Partial<ClockHeader> = {}): ClockHeader {
	return { now_ms: NOW, started_ms: STARTED, ended_ms: undefined, form: 'screen', ...extra }
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

	it('draws a finish a day or more ahead as MM-DD, and just under a day as HH:MM', () => {
		const [under] = clocks_of(header(), NOW + 24 * HOUR - MINUTE)
		const [over] = clocks_of(header(), NOW + 24 * HOUR)

		expect(under).toBe(`🎯 ${minute_of(NOW + 24 * HOUR - MINUTE)}`)
		expect(over).toBe(`🎯 ${day_of(NOW + 24 * HOUR)}`)
	})

	it('draws a start a day or more back as MM-DD, and just under a day as HH:MM', () => {
		const under = NOW - 24 * HOUR + MINUTE
		const over = NOW - 24 * HOUR

		expect(clocks_of(header({ started_ms: under }), undefined)[2]).toBe(`🚀 ${minute_of(under)}`)
		expect(clocks_of(header({ started_ms: over }), undefined)[2]).toBe(`🚀 ${day_of(over)}`)
	})

	it('keeps the time now as HH:MM and every row five columns wide', () => {
		const rows = clocks_of(header({ started_ms: NOW - 48 * HOUR }), NOW + 48 * HOUR)

		expect(rows[1]).toBe(`🕒 ${minute_of(NOW)}`)
		for (const row of rows) expect(row.split(' ', 2)[1]).toHaveLength(minute_of(NOW).length)
	})
})

describe('run_board_clocks.clocks_of finish and start', () => {
	it('draws an unknown finish --:--', () => {
		const [same_day] = clocks_of(header(), undefined)
		const [crossed] = clocks_of(header({ started_ms: NOW - 24 * HOUR }), undefined)

		expect(same_day).toBe('🎯 --:--')
		expect(crossed).toBe('🎯 --:--')
	})

	it('draws an ended run’s finish as when it ended', () => {
		const ended = NOW - MINUTE

		expect(clocks_of(header({ ended_ms: ended }), NOW + HOUR)[0]).toBe(`🎯 ${minute_of(ended)}`)
	})
})

// joshuafolkken/kit#8476: a live screen's running clocks carry their colons as placeholders the spin
// blinks; an ended run's, a chat's and a frame with no spinner keep them lit.
const LIVE = { spinner: run_board_spot.SPOT }

function marked(ms: number): string {
	return minute_of(ms).split(':').join(run_board_spot.COLON)
}

describe('run_board_clocks.clocks_of colons', () => {
	it('marks every running clock’s colon on a live screen, with no color of its own', () => {
		const finish = NOW + HOUR

		expect(clocks_of(header(LIVE), finish)).toStrictEqual([
			`🎯 ${marked(finish)}`,
			`🕒 ${marked(NOW)}`,
			`🚀 ${marked(STARTED)}`,
		])
		expect(clocks_of(header(LIVE), finish).join('')).not.toContain('\u{1B}')
	})

	it('keeps the colons lit once the run ended, in a chat and with no spinner', () => {
		const ended = clocks_of(header({ ...LIVE, ended_ms: NOW - MINUTE }), undefined)
		const chat = clocks_of(header({ ...LIVE, form: 'chat' }), undefined)
		const still = clocks_of(header(), undefined)

		for (const clocks of [ended, chat, still]) expect(clocks[1]).toBe(`🕒 ${minute_of(NOW)}`)
	})
})
