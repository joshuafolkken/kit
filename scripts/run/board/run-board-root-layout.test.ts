import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardRow, type RowRead } from './run-board-layout'
import { run_board_root_layout } from './run-board-root-layout'
import type { EndedRoot } from './run-board-single'

// joshuafolkken/kit#7525: a root single run a merge ended is listed among the run's finished rows, in
// its place by its end, as a lane's finished row is.

const ROOT = 7521
const LANE = 7508
const OLDER_LANE = 7500
const START = 1_000_000
const MINUTE = 60_000
const TITLE = 'Draw a root single run above the lanes'
const READ: RowRead = { titles: new Map([[ROOT, TITLE]]), labels: new Map() }
const NO_LANES = { own: new Map(), earlier: new Map(), unknown: [] }

function lane_row(number: number, ended_ms: number): BoardRow {
	return {
		number,
		title: undefined,
		kind: undefined,
		state: 'merged',
		status: { state: 'merged', started_ms: START, ended_ms },
		waits: [],
	}
}

const ENDED: EndedRoot = {
	command: 'fullrun',
	issue: ROOT,
	started_ms: START,
	ended_ms: START + 2 * MINUTE,
}

function active_of(ended: ReadonlyArray<EndedRoot>): ReadonlyArray<BoardRow> {
	const layout = {
		...run_board_layout.EMPTY_LAYOUT,
		active: [lane_row(OLDER_LANE, START + MINUTE), lane_row(LANE, START + 3 * MINUTE)],
	}

	const local = { ended_roots: ended, lane_states: NO_LANES }

	return run_board_root_layout.layout_of(layout, local, READ).active
}

describe('run_board_root_layout.layout_of — a root single run a merge ended', () => {
	it('lists the run merged with its title, start and end, between the rows by end', () => {
		const active = active_of([ENDED])

		expect(active.map((row) => row.number)).toStrictEqual([LANE, ROOT, OLDER_LANE])
		expect(active[1]).toMatchObject({
			title: TITLE,
			state: 'merged',
			status: { started_ms: ENDED.started_ms, ended_ms: ENDED.ended_ms },
		})
	})

	it('replaces a row of the same issue rather than listing it twice', () => {
		const active = active_of([{ ...ENDED, issue: LANE }])

		expect(active.filter((row) => row.number === LANE)).toHaveLength(1)
	})

	it('leaves the run’s rows as they are with no ended run', () => {
		expect(active_of([]).map((row) => row.number)).toStrictEqual([OLDER_LANE, LANE])
	})

	it('draws no 🏠 row for an ended run', () => {
		const layout = run_board_root_layout.layout_of(
			{ ...run_board_layout.EMPTY_LAYOUT, active: [lane_row(LANE, START)] },
			{ ended_roots: [ENDED], lane_states: NO_LANES },
			READ,
		)

		expect(layout.root).toBeUndefined()
	})
})
