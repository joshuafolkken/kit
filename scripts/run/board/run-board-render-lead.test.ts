import { stripVTControlCharacters } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lead } from './run-board-render-lead'

// joshuafolkken/kit#4292: a lane row leads with its progress, its phase's icon, the phase's time and
// the run's time, each in a column of its own, so a held, a running and a stopped row line up and the
// cells after them start where the processes rows' do.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const { ELAPSED_START, LANE_INDENT, TIME_WIDTH, USAGE_START, lead_of } = run_board_render_lead
const LANE = 4267
const SPINNER = '⠧'
const SECOND = 1000

function lane(state: BoardRow['state'] = 'running'): BoardRow {
	const status = {
		state,
		started_ms: NOW - 20 * MINUTE,
		track: ['gate' as const],
		phase_ms: NOW - 2 * MINUTE,
	}

	return { number: LANE, title: 'Lane', kind: undefined, state, status, waits: [] }
}

function wait(extra: Partial<BudgetWait> = {}): BudgetWait {
	return {
		command: 'gate test',
		lane: String(LANE),
		elsewhere: undefined,
		waited_ms: 43 * SECOND,
		reason: 'cores',
		...extra,
	}
}

function board(row: BoardRow, waits: ReadonlyArray<BudgetWait> = []): BoardHeader {
	const layout = { ...EMPTY_LAYOUT, active: [row] }

	return header({ layout, budget_waits: waits, spinner: SPINNER })
}

function lead(row: BoardRow, waits: ReadonlyArray<BudgetWait> = []): string {
	return stripVTControlCharacters(lead_of(row, board(row, waits)))
}

function width(text: string): number {
	return run_board_fit.width_of(`${LANE_INDENT}${text}`)
}

describe('run_board_render_lead.lead_of', () => {
	it('turns the spinner in the progress column of a running row', () => {
		expect(lead(lane())).toBe(`${SPINNER}  🚦    2′00″   20′00″`)
	})

	it('draws 🚧 in the progress column and the hold in the run time’s column while held', () => {
		expect(lead(lane(), [wait()])).toBe('🚧 🚦    2′00″ 💪   43″')
		expect(lead(lane(), [wait({ reason: 'memory', waited_ms: 65 * SECOND })])).toBe(
			'🚧 🚦    2′00″ 🧠 1′05″',
		)
	})

	it('blanks the progress column of a stopped row', () => {
		expect(lead(lane('stopped')).startsWith(' '.repeat(3))).toBe(true)
	})

	it('ends every lead where the usage cells start less one blank', () => {
		const leads = [lead(lane()), lead(lane(), [wait()]), lead(lane('stopped'))]

		expect(leads.map((text) => width(text))).toStrictEqual([
			USAGE_START - 1,
			USAGE_START - 1,
			USAGE_START - 1,
		])
	})

	it('starts the run’s time at the column the rule’s ⏰ stands over', () => {
		const before = lead(lane()).slice(0, -TIME_WIDTH)

		expect(width(before)).toBe(ELAPSED_START)
	})
})
