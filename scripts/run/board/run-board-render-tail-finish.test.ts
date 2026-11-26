import { describe, expect, it } from 'vitest'
import { run_board_estimate } from './run-board-estimate'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_tail } from './run-board-render-tail'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#7920: a running row's tail leads with its finish (#7994), `🎯 HH:MM` (no `~` since
// joshuafolkken/kit#8478), read from the
// lane totals the header's 🎯 reads, with `+N′` / `−N′` where it moved past a minute from its launch's;
// `🎯 —` where no lane total is measured, and after the reason of a parked row; a row waiting on a person
// ends on its reason alone (#8166).
// No row draws `over budget`.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const HOUR = 60 * MINUTE
const TOTALS = [20 * MINUTE, 30 * MINUTE, 40 * MINUTE]
const UNKNOWN = '🎯 —'

// Row 2 in implement, launched `elapsed` minutes ago.
function launched(elapsed: number): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - elapsed * MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - elapsed * MINUTE,
	}

	return { number: 2, title: 'Issue 2', kind: undefined, state: 'running', status, waits: [] }
}

function finish_of(row: BoardRow, lane_totals: ReadonlyArray<number> = TOTALS): string | undefined {
	return run_board_render_tail.tail_of(row, header({ lane_totals })).at(0)
}

function held(state: ItemState, tail?: string): BoardRow {
	const reason = tail === undefined ? undefined : { tail }

	return {
		number: 3,
		title: 'Issue 3',
		kind: undefined,
		state,
		status: undefined,
		reason,
		waits: [],
	}
}

describe('run_board_render_tail.tail_of finish', () => {
	it('ends a running row on its finish time, with no drift on the usual pace', () => {
		// 15′, 25′ and 35′ beyond 5′: the median 25′ is what its launch foretold.
		expect(finish_of(launched(5))).toBe(`🎯 ${run_board_labels.minute_of(NOW + 25 * MINUTE)}`)
	})

	it('draws how much later than its launch foretold a long lane finishes', () => {
		// 5′ and 15′ beyond 25′ end it in 10′, 5′ past the 30′ median from its launch.
		expect(finish_of(launched(25))).toBe(`🎯 ${run_board_labels.minute_of(NOW + 10 * MINUTE)} +5′`)
	})

	it('draws the day too for a finish on another day', () => {
		const finish = run_board_labels.day_minute_of(NOW + 30 * HOUR)

		expect(finish_of(launched(0), [30 * HOUR])).toBe(`🎯 ${finish}`)
	})

	it('draws 🎯 — where no lane total is measured', () => {
		expect(finish_of(launched(5), [])).toBe(UNKNOWN)
	})

	it('draws no over budget', () => {
		expect(run_board_render_tail.tail_of(launched(60), header()).join(' ')).not.toContain(
			'over budget',
		)
	})
})

// joshuafolkken/kit#8946: the root checkout's single run's 🏠 row draws its finish beside a stopped run.
describe('run_board_render_tail.tail_of finish on a 🏠 row', () => {
	const STOPPED = { last_event_ms: NOW - MINUTE, is_stopped: true }
	const ROOT = launched(25)

	// A stopped run's board with `name`'s running 🏠 row.
	function root_header(name: string, lane_totals: ReadonlyArray<number>): BoardHeader {
		const layout = { ...EMPTY_LAYOUT, singles: [{ name, row: ROOT }] }

		return header({ activity: STOPPED, layout, lane_totals })
	}

	function root_tail(lane_totals: ReadonlyArray<number>, name = 'fullrun'): string {
		return run_board_render_tail.tail_of(ROOT, root_header(name, lane_totals)).join(' ')
	}

	it('draws its finish and drift as a lane row does', () => {
		const finish = run_board_labels.minute_of(NOW + 10 * MINUTE)

		expect(root_tail(TOTALS)).toContain(`🎯 ${finish} +5′`)
	})

	it('draws 🎯 — on a 🏠 row where no lane total is measured', () => {
		expect(root_tail([])).toContain(UNKNOWN)
	})

	it('draws no finish on a halfrun', () => {
		expect(root_tail(TOTALS, 'halfrun')).not.toContain('🎯')
	})

	it('names the 🎯 in the legend', () => {
		const lines = lines_of(root_header('prrun', TOTALS))

		expect(lines.join('\n')).toContain(run_board_estimate.LEGEND)
	})
})

describe('run_board_render_tail.drift_of', () => {
	it('draws a later finish as +N′ and a sooner one as −N′', () => {
		expect(run_board_render_tail.drift_of(21 * MINUTE)).toBe('+21′')
		expect(run_board_render_tail.drift_of(-3 * MINUTE)).toBe('−3′')
	})

	it('draws nothing within a minute either way', () => {
		expect(run_board_render_tail.drift_of(MINUTE)).toBe('')
		expect(run_board_render_tail.drift_of(-MINUTE)).toBe('')
		expect(run_board_render_tail.drift_of(0)).toBe('')
	})
})

describe('run_board_render_condition.tail_of finish', () => {
	it('ends a row waiting on a person on its reason, with no 🎯 (joshuafolkken/kit#8166)', () => {
		expect(run_board_render_condition.tail_of(held('human', 'decide'), 0, header())).toBe('decide')
	})

	it('ends a parked row on 🎯 —, with or without a reason', () => {
		expect(run_board_render_condition.tail_of(held('parked'), 0, header())).toBe(UNKNOWN)
		expect(run_board_render_condition.tail_of(held('parked', 'stuck'), 0, header())).toBe(
			`stuck ${UNKNOWN}`,
		)
	})

	it('draws no finish after a waiting row', () => {
		expect(run_board_render_condition.tail_of(held('waiting', 'queued'), 0, header())).toBe(
			'queued',
		)
	})
})
