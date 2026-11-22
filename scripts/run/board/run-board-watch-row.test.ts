import { figure_format } from '#scripts/lib/figure-format'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_estimate } from './run-board-estimate'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import type { PinnedIssue } from './run-board-pinned-graphql'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_theme } from './run-board-theme'
import { run_board_watch_row } from './run-board-watch-row'

// joshuafolkken/kit#8607: a pin's watch line — the icon its run row leads with, its number, and the
// time it closed or is foretold to finish.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const { PHASE_ICONS, STATE_ICONS } = run_board_labels
const { watch_row } = run_board_watch_row
const DAY = 24 * 60 * MINUTE
const PIN = 8591
const TODAY = NOW + MINUTE
const OTHER_DAY = NOW - 2 * DAY

function open_pin(): PinnedIssue {
	return { number: PIN, is_closed: false, closed_ms: undefined }
}

function row_of(extra: Partial<BoardRow>): BoardRow {
	return {
		number: PIN,
		title: 'Pinned',
		state: 'waiting',
		status: undefined,
		kind: undefined,
		waits: [],
		...extra,
	}
}

const RUNNING = row_of({
	state: 'running',
	status: { state: 'running', started_ms: NOW - MINUTE, track: ['investigate', 'gate'] },
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('watch_row of a pin the run holds no row for', () => {
	it('draws a closed pin as merged at the minute it closed today', () => {
		const pin = { number: PIN, is_closed: true, closed_ms: TODAY }

		expect(watch_row(header(), pin)).toBe(
			`${STATE_ICONS.merged} 8591 ${figure_format.minute_of(TODAY)}`,
		)
	})

	it('draws a pin closed on another day by its day', () => {
		const pin = { number: PIN, is_closed: true, closed_ms: OTHER_DAY }

		expect(watch_row(header(), pin)).toBe(
			`${STATE_ICONS.merged} 8591 ${figure_format.day_of(OTHER_DAY)}`,
		)
	})

	it('draws an open pin the run holds no row for as waiting with no time', () => {
		expect(watch_row(header(), open_pin())).toBe(`${STATE_ICONS.waiting} 8591 —`)
	})
})

describe('watch_row of a pin the run holds a row for', () => {
	it("leads a running pin with its phase's icon and ends it on its lane's finish", () => {
		vi.spyOn(run_board_estimate, 'is_finish_drawn').mockReturnValue(true)
		vi.spyOn(run_board_estimate, 'row_finish').mockReturnValue({ finish_ms: TODAY, drift_ms: 0 })
		const board = header({ layout: { ...EMPTY_LAYOUT, active: [RUNNING] } })

		expect(watch_row(board, open_pin())).toBe(
			`${PHASE_ICONS.gate} 8591 ${figure_format.minute_of(TODAY)}`,
		)
	})

	it("ends a queued pin on the queued child's own finish", () => {
		vi.spyOn(run_board_estimate, 'queued_finish_ms').mockReturnValue(OTHER_DAY)
		const board = header({
			layout: { ...EMPTY_LAYOUT, queued: [{ kind: 'row', row: row_of({}) }] },
		})

		expect(watch_row(board, open_pin())).toBe(
			`${STATE_ICONS.waiting} 8591 ${figure_format.day_of(OTHER_DAY)}`,
		)
	})

	it('leads a pin waiting on a person with the decision icon', () => {
		const board = header({ layout: { ...EMPTY_LAYOUT, people: [row_of({ state: 'human' })] } })

		expect(watch_row(board, open_pin())).toBe(`${STATE_ICONS.human} 8591 —`)
	})
})

describe('watch_row icon set', () => {
	it('draws its icon in the icon set the board draws, as wide as the emoji', () => {
		const line = watch_row(header(), open_pin())
		const letters = run_board_theme.restyle('wargames', line, 'letters')

		expect(letters).not.toContain(STATE_ICONS.waiting)
		expect(run_board_fit.width_of(letters)).toBe(run_board_fit.width_of(line))
	})
})

describe('stamp_of', () => {
	it('draws no moment as a dash', () => {
		expect(run_board_watch_row.stamp_of(NOW, undefined)).toBe(run_board_watch_row.NO_TIME)
	})
})
